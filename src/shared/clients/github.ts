import { Config, GitHubData, ApiError } from '../types.js';
import { cache, CacheKey, TTL } from '../cache.js';

const GITHUB_API_BASE = 'https://api.github.com';
const SCRAPEDO_BASE = 'https://api.scrape.do';

// Tracks rate limit state across requests
let rateLimitRemaining: number | null = null;
let rateLimitReset: number | null = null; // Unix timestamp

interface GitHubRepo {
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  archived: boolean;
  language: string | null;
  topics: string[];
  full_name: string;
  html_url: string;
}

interface CommitWeek {
  week: number;
  total: number;
  days: number[];
}

export class GitHubClient {
  private headers: Record<string, string>;
  private hasToken: boolean;
  private hasScrapedo: boolean;

  constructor(private config: Config) {
    this.hasToken = !!config.githubToken;
    this.hasScrapedo = !!config.scrapedoApiKey;

    this.headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'npm-package-picker/1.0.0',
    };
    if (config.githubToken) {
      this.headers['Authorization'] = `Bearer ${config.githubToken}`;
    }
  }

  /** Parses a GitHub repository URL into owner/repo components. */
  static parseRepoUrl(url: string | null): { owner: string; repo: string } | null {
    if (!url) return null;
    const match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }

  getRateLimitRemaining(): number | null {
    return rateLimitRemaining;
  }

  /**
   * Fetches full GitHub repo health data.
   * Strategy:
   *   1. If GITHUB_TOKEN present → use direct GitHub API (5,000 req/hr)
   *   2. If rate limited or no token → use Scrape.do to proxy GitHub API JSON endpoints
   *   3. If Scrape.do also fails → return partial data from what we have
   */
  async getRepo(owner: string, repo: string): Promise<GitHubData> {
    const cacheKey = CacheKey.githubRepo(owner, repo);
    const cached = cache.get<GitHubData>(cacheKey);
    if (cached) return cached;

    // Decide strategy
    const isRateLimited = rateLimitRemaining !== null && rateLimitRemaining <= 2;
    const useScrapedo = (isRateLimited || !this.hasToken) && this.hasScrapedo;

    let repoData: GitHubRepo;
    let commitsLast90d: number | null = null;
    let contributors: number | null = null;

    if (useScrapedo) {
      // Use Scrape.do to proxy the GitHub API JSON endpoints — no rate limit concerns
      [repoData, commitsLast90d, contributors] = await Promise.all([
        this.fetchRepoViaScrapedo(owner, repo),
        this.fetchCommitsViaScrapedo(owner, repo).catch(() => null),
        this.fetchContributorsViaScrapedo(owner, repo).catch(() => null),
      ]);
    } else {
      // Use direct GitHub API
      try {
        repoData = await this.fetchRepoDirect(owner, repo);
        [commitsLast90d, contributors] = await Promise.all([
          this.fetchCommitsDirect(owner, repo).catch(() => null),
          this.fetchContributorsDirect(owner, repo).catch(() => null),
        ]);
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.code === 'GITHUB_RATE_LIMITED' &&
          this.hasScrapedo
        ) {
          // Rate limited mid-flight — fall back to Scrape.do
          process.stderr.write(
            `GitHub rate limited, switching to Scrape.do for ${owner}/${repo}\n`
          );
          [repoData, commitsLast90d, contributors] = await Promise.all([
            this.fetchRepoViaScrapedo(owner, repo),
            this.fetchCommitsViaScrapedo(owner, repo).catch(() => null),
            this.fetchContributorsViaScrapedo(owner, repo).catch(() => null),
          ]);
        } else {
          throw err;
        }
      }
    }

    const data: GitHubData = {
      stars: repoData.stargazers_count,
      forks: repoData.forks_count,
      openIssues: repoData.open_issues_count,
      contributors,
      commitsLast90d,
      lastPushedAt: repoData.pushed_at,
      archived: repoData.archived,
      language: repoData.language,
      topics: repoData.topics ?? [],
    };

    cache.set(cacheKey, data, TTL.GITHUB);
    return data;
  }

  // ---- Direct GitHub API methods ----------------------------

  private async fetchRepoDirect(owner: string, repo: string): Promise<GitHubRepo> {
    const response = await this.fetchDirect(`${GITHUB_API_BASE}/repos/${owner}/${repo}`);
    if (response.status === 404) {
      throw new ApiError(`GitHub repo ${owner}/${repo} not found`, 'GITHUB_REPO_NOT_FOUND', 404);
    }
    this.checkRateLimit(response);
    this.assertOk(response, `GitHub repo ${owner}/${repo}`);
    return response.json() as Promise<GitHubRepo>;
  }

  private async fetchCommitsDirect(owner: string, repo: string): Promise<number | null> {
    const cacheKey = CacheKey.githubCommits(owner, repo);
    const cached = cache.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    let response = await this.fetchDirect(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/stats/commit_activity`
    );
    if (response.status === 202) {
      await sleep(2000);
      response = await this.fetchDirect(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/stats/commit_activity`
      );
    }
    if (!response.ok) return null;

    const weeks = (await response.json()) as CommitWeek[];
    return sumLastWeeks(weeks, cacheKey);
  }

  private async fetchContributorsDirect(owner: string, repo: string): Promise<number | null> {
    const cacheKey = CacheKey.githubContributors(owner, repo);
    const cached = cache.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    const response = await this.fetchDirect(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contributors?per_page=1&anon=false`
    );
    if (!response.ok) return null;
    return parseContributorCount(response, cacheKey);
  }

  private async fetchDirect(url: string): Promise<Response> {
    try {
      const response = await fetch(url, { headers: this.headers });
      this.updateRateLimit(response);
      return response;
    } catch (err) {
      throw new ApiError(
        `GitHub API network error: ${(err as Error).message}`,
        'GITHUB_NETWORK_ERROR'
      );
    }
  }

  // ---- Scrape.do proxy methods (bypasses GitHub rate limits) ----

  /**
   * Proxy a GitHub API JSON endpoint through Scrape.do.
   * Scrape.do forwards the request with residential IPs, bypassing rate limits.
   * We still get clean JSON back — GitHub's API responds with JSON to Scrape.do's requests.
   */
  private async scrapeDoFetch(targetUrl: string): Promise<Response> {
    const encodedUrl = encodeURIComponent(targetUrl);
    const scrapeUrl = `${SCRAPEDO_BASE}/?token=${this.config.scrapedoApiKey}&url=${encodedUrl}&super=false`;

    try {
      const response = await fetch(scrapeUrl, {
        headers: {
          // Pass GitHub's expected headers through Scrape.do's forwardHeaders feature
          // by appending them as extra headers in the Scrape.do request
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      return response;
    } catch (err) {
      throw new ApiError(
        `Scrape.do network error: ${(err as Error).message}`,
        'SCRAPEDO_NETWORK_ERROR'
      );
    }
  }

  private async fetchRepoViaScrapedo(owner: string, repo: string): Promise<GitHubRepo> {
    const response = await this.scrapeDoFetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}`
    );

    if (!response.ok) {
      throw new ApiError(
        `Scrape.do fetch failed for ${owner}/${repo}: HTTP ${response.status}`,
        'SCRAPEDO_FETCH_FAILED',
        response.status
      );
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as GitHubRepo;
    } catch {
      throw new ApiError(
        `Scrape.do returned non-JSON for ${owner}/${repo}`,
        'SCRAPEDO_PARSE_ERROR'
      );
    }
  }

  private async fetchCommitsViaScrapedo(owner: string, repo: string): Promise<number | null> {
    const cacheKey = CacheKey.githubCommits(owner, repo);
    const cached = cache.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    const response = await this.scrapeDoFetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/stats/commit_activity`
    );

    // GitHub still returns 202 even via Scrape.do — retry once
    if (response.status === 202) {
      await sleep(2000);
      const retry = await this.scrapeDoFetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/stats/commit_activity`
      );
      if (!retry.ok) return null;
      const text = await retry.text();
      try {
        const weeks = JSON.parse(text) as CommitWeek[];
        return sumLastWeeks(weeks, cacheKey);
      } catch {
        return null;
      }
    }

    if (!response.ok) return null;

    const text = await response.text();
    try {
      const weeks = JSON.parse(text) as CommitWeek[];
      return sumLastWeeks(weeks, cacheKey);
    } catch {
      return null;
    }
  }

  private async fetchContributorsViaScrapedo(owner: string, repo: string): Promise<number | null> {
    const cacheKey = CacheKey.githubContributors(owner, repo);
    const cached = cache.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    const response = await this.scrapeDoFetch(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contributors?per_page=1&anon=false`
    );

    if (!response.ok) return null;
    return parseContributorCount(response, cacheKey);
  }

  // ---- Shared helpers ----------------------------------------

  private updateRateLimit(response: Response): void {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    if (remaining !== null) rateLimitRemaining = parseInt(remaining, 10);
    if (reset !== null) rateLimitReset = parseInt(reset, 10);
  }

  private checkRateLimit(response: Response): void {
    if (response.status === 403 || response.status === 429) {
      throw new ApiError(
        'GitHub API rate limit exceeded',
        'GITHUB_RATE_LIMITED',
        response.status,
        this.hasScrapedo
          ? 'Falling back to Scrape.do'
          : 'Set GITHUB_TOKEN env var to get 5,000 req/hr'
      );
    }
  }

  private assertOk(response: Response, context: string): void {
    if (!response.ok) {
      throw new ApiError(
        `GitHub API error for ${context}: HTTP ${response.status}`,
        'GITHUB_API_ERROR',
        response.status
      );
    }
  }
}

// ---- Pure helpers -------------------------------------------

function sumLastWeeks(weeks: CommitWeek[], cacheKey: string): number | null {
  if (!Array.isArray(weeks) || weeks.length === 0) return null;
  const last13 = weeks.slice(-13);
  const total = last13.reduce((sum, w) => sum + (w.total ?? 0), 0);
  cache.set(cacheKey, total, TTL.GITHUB);
  return total;
}

async function parseContributorCount(response: Response, cacheKey: string): Promise<number | null> {
  const linkHeader = response.headers.get('link') ?? '';
  const lastPageMatch = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);

  if (lastPageMatch) {
    const count = parseInt(lastPageMatch[1], 10);
    cache.set(cacheKey, count, TTL.GITHUB);
    return count;
  }

  // No pagination → count items on single page
  try {
    const items = (await response.json()) as unknown[];
    const count = Array.isArray(items) ? items.length : 1;
    cache.set(cacheKey, count, TTL.GITHUB);
    return count;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
