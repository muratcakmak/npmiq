import { Config, ApiError } from '../types.js';
import { cache, CacheKey, TTL } from '../cache.js';

const SERPER_API_URL = 'https://google.serper.dev/search';
const NPM_URL_REGEX = /npmjs\.com\/package\/((?:@[^/]+\/)?[^/?#]+)/;

interface SerperOrganic {
  title: string;
  link: string;
  snippet?: string;
  position: number;
}

interface SerperResponse {
  organic?: SerperOrganic[];
  searchParameters?: { q: string };
}

export class SerperClient {
  constructor(private config: Config) {}

  /**
   * Discovers npm package names from a free-form query using Google search.
   * Returns deduplicated list of package names (1–15 results).
   */
  async discover(query: string): Promise<string[]> {
    const cacheKey = CacheKey.serper(query);
    const cached = cache.get<string[]>(cacheKey);
    if (cached) return cached;

    // Primary search — npm package pages
    const npmPackages = await this.searchNpm(query);

    let candidates = npmPackages;

    // Fallback — if fewer than 3 from npm search, also search GitHub
    if (candidates.length < 3) {
      const githubPackages = await this.searchGitHub(query);
      // Merge without duplicates
      for (const pkg of githubPackages) {
        if (!candidates.includes(pkg)) candidates.push(pkg);
      }
    }

    // Deduplicate and cap at 15
    const result = [...new Set(candidates)].slice(0, 15);

    if (result.length > 0) {
      cache.set(cacheKey, result, TTL.SERPER);
    }

    return result;
  }

  private async searchNpm(query: string): Promise<string[]> {
    const data = await this.request(`${query} site:npmjs.com`);
    const packages: string[] = [];

    for (const item of data.organic ?? []) {
      const match = item.link.match(NPM_URL_REGEX);
      if (match?.[1]) {
        const name = decodeURIComponent(match[1]);
        if (isValidPackageName(name) && !packages.includes(name)) {
          packages.push(name);
        }
      }
    }

    return packages;
  }

  private async searchGitHub(query: string): Promise<string[]> {
    const data = await this.request(`${query} npm package site:github.com`);
    const packages: string[] = [];

    for (const item of data.organic ?? []) {
      // Extract potential package name from GitHub repo name (owner/repo)
      const ghMatch = item.link.match(/github\.com\/[\w-]+\/([\w.-]+)/);
      if (ghMatch?.[1]) {
        const repoName = ghMatch[1].toLowerCase().replace(/\./g, '-');
        if (isValidPackageName(repoName) && !packages.includes(repoName)) {
          packages.push(repoName);
        }
      }
    }

    return packages;
  }

  private async request(q: string): Promise<SerperResponse> {
    let response: Response;
    try {
      response = await fetch(SERPER_API_URL, {
        method: 'POST',
        headers: {
          'X-API-KEY': this.config.serperApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q,
          gl: 'us',
          hl: 'en',
          num: 10,
          autocorrect: true,
        }),
      });
    } catch (err) {
      throw new ApiError(
        `Serper API network error: ${(err as Error).message}`,
        'SERPER_NETWORK_ERROR',
        undefined,
        'Check your internet connection'
      );
    }

    if (response.status === 401) {
      throw new ApiError(
        'Serper API key is invalid or expired',
        'SERPER_AUTH_FAILED',
        401,
        'Check your SERPER_API_KEY environment variable at serper.dev'
      );
    }

    if (response.status === 429) {
      throw new ApiError(
        'Serper API credit quota exceeded',
        'SERPER_QUOTA_EXCEEDED',
        429,
        'Check your credit balance at serper.dev/dashboard'
      );
    }

    if (!response.ok) {
      throw new ApiError(
        `Serper API error: HTTP ${response.status}`,
        'SERPER_API_ERROR',
        response.status
      );
    }

    return response.json() as Promise<SerperResponse>;
  }
}

function isValidPackageName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 214) return false;
  // Must not be just a common word or path fragment
  const invalid = ['package', 'packages', 'npm', 'node', 'js', 'javascript', 'search'];
  if (invalid.includes(name.toLowerCase())) return false;
  // Basic npm name validation
  return /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);
}
