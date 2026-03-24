import { Config, RedditData, ApiError } from '../types.js';
import { cache, CacheKey, TTL } from '../cache.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const USER_AGENT = 'nodejs:npm-package-picker:v1.0.0 (by /u/npmpackagepicker)';

// Tier-1 subreddits with highest JS/npm developer density
const SUBREDDITS = 'reactjs+javascript+node+typescript+nextjs+webdev+vuejs+svelte';

// Minimum relevant posts from base search before we expand to more queries
const RELEVANCE_THRESHOLD = 3;

// Generic keywords to skip when picking a topic keyword from npm keywords[]
const GENERIC_KEYWORDS = new Set([
  'javascript', 'typescript', 'node', 'nodejs', 'npm', 'browser',
  'frontend', 'backend', 'web', 'library', 'util', 'utility', 'tools',
  'es6', 'es2015', 'esm', 'commonjs', 'module', 'package',
]);

interface RedditToken {
  access_token: string;
  expires_at: number;
}

interface RedditPost {
  id: string;
  title: string;
  score: number;
  upvote_ratio: number;
  num_comments: number;
  subreddit: string;
  created_utc: number;
  removed_by_category: string | null;
}

interface RedditResponse {
  data: {
    children: Array<{ kind: string; data: RedditPost }>;
    after: string | null;
    dist: number;
  };
}

export class RedditClient {
  private token: RedditToken | null = null;

  constructor(private config: Config) {}

  /**
   * Adaptive multi-query Reddit search.
   *
   * Strategy:
   * 1. Run base quoted search: "packageName"
   * 2. Count posts where package name appears in the title (relevantPosts)
   * 3. If relevantPosts >= 3 → signal is good, stop (1 query used)
   * 4. If relevantPosts < 3  → expand with 4 more targeted queries and
   *    deduplicate all results by post ID
   *
   * This means unambiguous packages like "react-hook-form" use 1 API call,
   * while ambiguous names like "yup" or "joi" use up to 5 calls for accuracy.
   */
  async search(packageName: string, npmKeywords: string[] = []): Promise<RedditData> {
    const cacheKey = CacheKey.reddit(packageName);
    const cached = cache.get<RedditData>(cacheKey);
    if (cached) return cached;

    const token = await this.getToken();
    const cleanName = extractCleanName(packageName);

    // ---- Step 1: Base search --------------------------------
    const basePosts = await this.runQuery(`"${cleanName}"`, token);
    const baseRelevant = filterRelevant(basePosts, cleanName);

    // ---- Step 2: Check if we have enough signal -------------
    if (baseRelevant.length >= RELEVANCE_THRESHOLD) {
      // Good signal from base search alone — don't waste more API calls
      const result = buildResult(baseRelevant, basePosts.length, 1);
      cache.set(cacheKey, result, TTL.REDDIT);
      return result;
    }

    // ---- Step 3: Expand with targeted queries ---------------
    const topicKeyword = pickTopicKeyword(npmKeywords, cleanName);
    const expandQueries = buildExpandQueries(cleanName, topicKeyword);

    const allPostsMap = new Map<string, RedditPost>();

    // Seed with base posts (all of them, relevant or not — dedup handles it)
    for (const p of basePosts) allPostsMap.set(p.id, p);

    for (const query of expandQueries) {
      const posts = await this.runQuery(query, token);
      for (const p of posts) allPostsMap.set(p.id, p); // dedup by ID
    }

    const allPosts = Array.from(allPostsMap.values());
    const allRelevant = filterRelevant(allPosts, cleanName);

    const result = buildResult(allRelevant, allPosts.length, 1 + expandQueries.length);
    cache.set(cacheKey, result, TTL.REDDIT);
    return result;
  }

  private async runQuery(query: string, token: string): Promise<RedditPost[]> {
    const url = new URL(`${API_BASE}/r/${SUBREDDITS}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('restrict_sr', 'true');
    url.searchParams.set('sort', 'relevance');
    url.searchParams.set('t', 'year');
    url.searchParams.set('limit', '25');
    url.searchParams.set('raw_json', '1');
    url.searchParams.set('type', 'link');

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': USER_AGENT,
        },
      });
    } catch (err) {
      throw new ApiError(
        `Reddit API network error: ${(err as Error).message}`,
        'REDDIT_NETWORK_ERROR'
      );
    }

    await this.handleRateLimit(response);

    // Token expired mid-session — refresh and retry once
    if (response.status === 401) {
      this.token = null;
      const freshToken = await this.getToken();
      response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${freshToken}`, 'User-Agent': USER_AGENT },
      });
    }

    if (!response.ok) return [];

    const data = (await response.json()) as RedditResponse;
    return data.data.children
      .map((c) => c.data)
      .filter((p) => p.removed_by_category === null);
  }

  async getToken(): Promise<string> {
    const tokenKey = CacheKey.redditToken();
    const cachedToken = cache.get<string>(tokenKey);
    if (cachedToken) return cachedToken;

    if (this.token && Date.now() < this.token.expires_at) {
      return this.token.access_token;
    }

    const credentials = Buffer.from(
      `${this.config.redditClientId}:${this.config.redditClientSecret}`
    ).toString('base64');

    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: 'grant_type=client_credentials',
      });
    } catch (err) {
      throw new ApiError(
        `Reddit auth network error: ${(err as Error).message}`,
        'REDDIT_AUTH_NETWORK_ERROR'
      );
    }

    if (response.status === 401) {
      throw new ApiError(
        'Reddit API credentials are invalid',
        'REDDIT_AUTH_FAILED',
        401,
        'Check your REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET at reddit.com/prefs/apps'
      );
    }

    if (!response.ok) {
      throw new ApiError(`Reddit auth failed: HTTP ${response.status}`, 'REDDIT_AUTH_ERROR', response.status);
    }

    const tokenData = (await response.json()) as { access_token: string; expires_in: number };
    this.token = {
      access_token: tokenData.access_token,
      expires_at: Date.now() + (tokenData.expires_in - 60) * 1000,
    };
    cache.set(tokenKey, tokenData.access_token, TTL.REDDIT_TOKEN);
    return this.token.access_token;
  }

  private async handleRateLimit(response: Response): Promise<void> {
    const remaining = parseFloat(response.headers.get('x-ratelimit-remaining') ?? '100');
    if (remaining < 5) {
      const resetSeconds = parseFloat(response.headers.get('x-ratelimit-reset') ?? '2');
      await sleep(Math.min(resetSeconds * 1000, 3000));
    }
  }
}

// ---- Query builders ----------------------------------------

/**
 * Strip scope prefix from package name for search.
 * @tanstack/react-table → react-table
 * react-hook-form → react-hook-form
 */
function extractCleanName(packageName: string): string {
  if (packageName.startsWith('@')) {
    return packageName.split('/')[1] ?? packageName;
  }
  return packageName;
}

/**
 * Pick the best topic keyword from npm keywords[] for disambiguation.
 * Skips generic words and the package name itself.
 */
function pickTopicKeyword(keywords: string[], packageName: string): string | null {
  for (const kw of keywords) {
    const k = kw.toLowerCase().trim();
    if (k !== packageName.toLowerCase() && !GENERIC_KEYWORDS.has(k) && k.length > 2) {
      return k;
    }
  }
  return null;
}

/**
 * Build the 4 expansion queries for ambiguous package names.
 */
function buildExpandQueries(cleanName: string, topicKeyword: string | null): string[] {
  const queries: string[] = [
    `${cleanName} npm`,           // eliminates slang false positives
    `${cleanName} vs`,            // comparison discussions — highest quality signal
    `${cleanName} javascript`,    // broad technical anchor
  ];
  if (topicKeyword) {
    queries.splice(2, 0, `${cleanName} ${topicKeyword}`); // insert before javascript
  }
  return queries.slice(0, 4); // cap at 4 expansion queries (5 total with base)
}

// ---- Post filtering & aggregation --------------------------

/**
 * Filter posts to only those where the package name appears in the title.
 * This is the core false-positive elimination step.
 */
function filterRelevant(posts: RedditPost[], cleanName: string): RedditPost[] {
  const nameLower = cleanName.toLowerCase();
  return posts.filter((p) => p.title.toLowerCase().includes(nameLower));
}

function buildResult(
  relevantPosts: RedditPost[],
  totalFetched: number,
  queriesUsed: number
): RedditData {
  let totalScore = 0;
  let highQualityPosts = 0;
  const subreddits: Record<string, number> = {};
  const topTitles: string[] = [];

  for (const post of relevantPosts) {
    totalScore += post.score;
    if (post.score >= 10) highQualityPosts++;

    const sub = post.subreddit.toLowerCase();
    subreddits[sub] = (subreddits[sub] ?? 0) + 1;

    if (topTitles.length < 10) {
      topTitles.push(`${post.score}: ${post.title}`);
    }
  }

  return {
    totalPosts: relevantPosts.length,
    totalScore,
    highQualityPosts,
    topTitles,
    subreddits,
    relevantPosts: relevantPosts.length,
    totalFetched,
    queriesUsed,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
