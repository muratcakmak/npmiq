import { Config, GitHubData, ApiError } from '../types.js';
import { cache, CacheKey, TTL } from '../cache.js';

const GITHUB_API_BASE = 'https://api.github.com';

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

  constructor(private config: Config) {
    this.headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'npm-package-picker/1.0.0',
    };
    if (config.githubToken) {
      this.headers['Authorization'] = `Bearer ${config.githubToken}`;
    }
  }

  /**
   * Parses a GitHub repository URL into owner/repo components.
   */
  static parseRepoUrl(url: string | null): { owner: string; repo: string } | null {
    if (!url) return null;
    const match = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/.*)?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  }

  /**
   * Returns the current rate limit remaining (from last API call).
   */
  getRateLimitRemaining(): number | null {
    return rateLimitRemaining;
  }

  /**
   * Fetches full GitHub repo health data.
   * Gracefully degrades on rate limiting — returns null for individual signals.
   */
  async getRepo(owner: string, repo: string): Promise<GitHubData> {
    const cacheKey = CacheKey.githubRepo(owner, repo);
    const cached = cache.get<GitHubData>(cacheKey);
    if (cached) return cached;

    // Check if we're rate limited before making calls
    if (rateLimitRemaining !== null && rateLimitRemaining <= 0) {
      const resetIn = rateLimitReset ? Math.max(0, rateLimitReset - Math.floor(Date.now() / 1000)) : 60;
      throw new ApiError(
        `GitHub API rate limit exceeded (resets in ~${resetIn}s)`,
        'GITHUB_RATE_LIMITED',
        429,
        `Set GITHUB_TOKEN env var to get 5,000 req/hr instead of 60 req/hr`
      );
    }

    // Fetch repo info (required)
    const repoData = await this.fetchRepo(owner, repo);

    // Fetch commits and contributors in parallel (non-fatal if they fail)
    const [commitsLast90d, contributors] = await Promise.all([
      this.fetchCommitsLast90d(owner, repo).catch(() => null),
      this.fetchContributorCount(owner, repo).catch(() => null),
    ]);

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

  private async fetchRepo(owner: string, repo: string): Promise<GitHubRepo> {
    const response = await this.fetchWithHeaders(`${GITHUB_API_BASE}/repos/${owner}/${repo}`);

    if (response.status === 404) {
      throw new ApiError(
        `GitHub repo ${owner}/${repo} not found`,
        'GITHUB_REPO_NOT_FOUND',
        404
      );
    }

    this.checkRateLimit(response);
    this.assertOk(response, `GitHub repo ${owner}/${repo}`);
    return response.json() as Promise<GitHubRepo>;
  }

  private async fetchCommitsLast90d(owner: string, repo: string): Promise<number | null> {
    const cacheKey = CacheKey.githubCommits(owner, repo);
    const cached = cache.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    // First attempt
    let response = await this.fetchWithHeaders(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/stats/commit_activity`
    );

    // GitHub returns 202 while cache warms — retry once after 2s
    if (response.status === 202) {
      await sleep(2000);
      response = await this.fetchWithHeaders(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/stats/commit_activity`
      );
    }

    if (!response.ok) return null;

    const weeks = (await response.json()) as CommitWeek[];
    if (!Array.isArray(weeks) || weeks.length === 0) return null;

    // Sum last 13 weeks (≈ 91 days)
    const last13 = weeks.slice(-13);
    const total = last13.reduce((sum, w) => sum + (w.total ?? 0), 0);

    cache.set(cacheKey, total, TTL.GITHUB);
    return total;
  }

  private async fetchContributorCount(owner: string, repo: string): Promise<number | null> {
    const cacheKey = CacheKey.githubContributors(owner, repo);
    const cached = cache.get<number>(cacheKey);
    if (cached !== undefined) return cached;

    const response = await this.fetchWithHeaders(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}/contributors?per_page=1&anon=false`
    );

    if (!response.ok) return null;

    // Parse total pages from Link header: <...?page=N>; rel="last"
    const linkHeader = response.headers.get('link') ?? '';
    const lastPageMatch = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
    const count = lastPageMatch ? parseInt(lastPageMatch[1], 10) : 1;

    // If no Link header with "last", we got all results on page 1
    // In that case, count the actual items returned
    if (!lastPageMatch) {
      const items = (await response.json()) as unknown[];
      const singlePageCount = Array.isArray(items) ? items.length : 1;
      cache.set(cacheKey, singlePageCount, TTL.GITHUB);
      return singlePageCount;
    }

    cache.set(cacheKey, count, TTL.GITHUB);
    return count;
  }

  private async fetchWithHeaders(url: string): Promise<Response> {
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
        'Set GITHUB_TOKEN env var to get 5,000 req/hr instead of 60 req/hr'
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
