import { Config, RedditData, ApiError } from '../types.js';
import { cache, CacheKey, TTL } from '../cache.js';

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API_BASE = 'https://oauth.reddit.com';
const USER_AGENT = 'nodejs:npm-package-picker:v1.0.0 (by /u/npmpackagepicker)';

// Tier-1 subreddits with the highest JS/npm developer density
const SUBREDDITS = 'reactjs+javascript+node+typescript+nextjs+webdev+vuejs+svelte';

interface RedditToken {
  access_token: string;
  expires_at: number; // Date.now() + (expires_in - 60) * 1000
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
   * Searches across all tier-1 JS subreddits for a package name.
   * Returns aggregated mention counts and quality signals.
   */
  async search(packageName: string): Promise<RedditData> {
    const cacheKey = CacheKey.reddit(packageName);
    const cached = cache.get<RedditData>(cacheKey);
    if (cached) return cached;

    const token = await this.getToken();
    const query = buildSearchQuery(packageName);

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

    // Respect rate limit headers
    await this.handleRateLimit(response);

    // If 401, token may have expired — refresh and retry once
    if (response.status === 401) {
      this.token = null;
      const freshToken = await this.getToken();
      response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${freshToken}`,
          'User-Agent': USER_AGENT,
        },
      });
    }

    if (!response.ok) {
      // Non-fatal: return empty result rather than crashing
      return emptyRedditData();
    }

    const data = (await response.json()) as RedditResponse;
    const posts = data.data.children
      .map((c) => c.data)
      .filter((p) => p.removed_by_category === null); // only live posts

    const result = aggregatePosts(posts);
    cache.set(cacheKey, result, TTL.REDDIT);
    return result;
  }

  /**
   * Gets a cached OAuth2 token or fetches a new one.
   */
  async getToken(): Promise<string> {
    // Check session-level token cache
    const tokenKey = CacheKey.redditToken();
    const cachedToken = cache.get<string>(tokenKey);
    if (cachedToken) return cachedToken;

    // Also check instance-level token (belt and suspenders)
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
      throw new ApiError(
        `Reddit auth failed: HTTP ${response.status}`,
        'REDDIT_AUTH_ERROR',
        response.status
      );
    }

    const tokenData = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.token = {
      access_token: tokenData.access_token,
      expires_at: Date.now() + (tokenData.expires_in - 60) * 1000,
    };

    // Also store in session cache
    cache.set(tokenKey, tokenData.access_token, TTL.REDDIT_TOKEN);

    return this.token.access_token;
  }

  private async handleRateLimit(response: Response): Promise<void> {
    const remaining = parseFloat(response.headers.get('x-ratelimit-remaining') ?? '100');
    if (remaining < 5) {
      const resetSeconds = parseFloat(response.headers.get('x-ratelimit-reset') ?? '2');
      const waitMs = Math.min(resetSeconds * 1000, 3000); // wait at most 3s
      await sleep(waitMs);
    }
  }
}

// Build an effective search query for a package name
function buildSearchQuery(packageName: string): string {
  // For scoped packages like @tanstack/react-table, use the subpackage name
  if (packageName.startsWith('@')) {
    const parts = packageName.split('/');
    const subName = parts[1] ?? parts[0];
    return `"${subName}"`;
  }
  return `"${packageName}"`;
}

function aggregatePosts(posts: RedditPost[]): RedditData {
  let totalScore = 0;
  let highQualityPosts = 0;
  const subreddits: Record<string, number> = {};
  const topTitles: string[] = [];

  for (const post of posts) {
    totalScore += post.score;
    if (post.score >= 10) highQualityPosts++;

    const sub = post.subreddit.toLowerCase();
    subreddits[sub] = (subreddits[sub] ?? 0) + 1;

    if (topTitles.length < 10) {
      topTitles.push(`${post.score}: ${post.title}`);
    }
  }

  return {
    totalPosts: posts.length,
    totalScore,
    highQualityPosts,
    topTitles,
    subreddits,
  };
}

function emptyRedditData(): RedditData {
  return {
    totalPosts: 0,
    totalScore: 0,
    highQualityPosts: 0,
    topTitles: [],
    subreddits: {},
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
