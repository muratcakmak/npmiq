import { Config, NpmData, ApiError } from '../types.js';
import { cache, CacheKey, TTL } from '../cache.js';

const REGISTRY_BASE = 'https://registry.npmjs.org';
const DOWNLOADS_BASE = 'https://api.npmjs.org';

interface NpmManifest {
  name: string;
  version: string;
  description?: string;
  license?: string;
  homepage?: string;
  keywords?: string[];
  maintainers?: Array<{ name: string; email?: string }>;
  repository?: { url?: string; type?: string };
  bugs?: { url?: string };
  main?: string;
}

interface NpmDownloadsResponse {
  downloads: number;
  start: string;
  end: string;
  package: string;
}

export class NpmClient {
  constructor(private _config: Config) {}

  /**
   * Fetches combined metadata + weekly download count for a package.
   */
  async getPackage(name: string): Promise<NpmData> {
    // Check combined cache
    const metaKey = CacheKey.npmMeta(name);
    const cached = cache.get<NpmData>(metaKey);
    if (cached) return cached;

    const [manifest, downloads] = await Promise.all([
      this.fetchManifest(name),
      this.fetchDownloads(name),
    ]);

    const data: NpmData = {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description ?? '',
      license: manifest.license ?? null,
      homepage: manifest.homepage ?? null,
      keywords: manifest.keywords ?? [],
      maintainersCount: manifest.maintainers?.length ?? 1,
      repositoryUrl: normalizeRepoUrl(manifest.repository?.url),
      weeklyDownloads: downloads,
    };

    cache.set(metaKey, data, TTL.NPM);
    return data;
  }

  private async fetchManifest(name: string): Promise<NpmManifest> {
    const encoded = encodePackageName(name);
    const url = `${REGISTRY_BASE}/${encoded}/latest`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new ApiError(
        `npm registry network error for "${name}": ${(err as Error).message}`,
        'NPM_NETWORK_ERROR'
      );
    }

    if (response.status === 404) {
      throw new ApiError(
        `Package "${name}" not found on npm`,
        'PACKAGE_NOT_FOUND',
        404,
        `Verify the package name is correct at npmjs.com/package/${name}`
      );
    }

    if (!response.ok) {
      throw new ApiError(
        `npm registry error for "${name}": HTTP ${response.status}`,
        'NPM_REGISTRY_ERROR',
        response.status
      );
    }

    return response.json() as Promise<NpmManifest>;
  }

  private async fetchDownloads(name: string): Promise<number> {
    const dlKey = CacheKey.npmDownloads(name);
    const cached = cache.get<number>(dlKey);
    if (cached !== undefined) return cached;

    const encoded = encodePackageName(name);
    const url = `${DOWNLOADS_BASE}/downloads/point/last-week/${encoded}`;

    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });

      if (!response.ok) {
        // Downloads API failures are non-fatal — return 0
        return 0;
      }

      const data = (await response.json()) as NpmDownloadsResponse;
      const count = data.downloads ?? 0;
      cache.set(dlKey, count, TTL.NPM);
      return count;
    } catch {
      return 0; // Non-fatal
    }
  }
}

/**
 * Encode a scoped package name for use in URLs.
 * @scope/name → %40scope%2Fname
 */
export function encodePackageName(name: string): string {
  if (name.startsWith('@')) {
    return name.replace('@', '%40').replace('/', '%2F');
  }
  return name;
}

/**
 * Normalize a repository URL from package.json to a clean https URL.
 * Handles: git+https://github.com/owner/repo.git
 *          git://github.com/owner/repo
 *          https://github.com/owner/repo
 *          github:owner/repo
 */
export function normalizeRepoUrl(url: string | undefined): string | null {
  if (!url) return null;

  // Strip git+ prefix
  let normalized = url.replace(/^git\+/, '');

  // Convert git:// to https://
  normalized = normalized.replace(/^git:\/\//, 'https://');

  // Handle shorthand github:owner/repo
  if (normalized.startsWith('github:')) {
    normalized = `https://github.com/${normalized.slice(7)}`;
  }

  // Strip .git suffix
  normalized = normalized.replace(/\.git$/, '');

  // Strip trailing slash
  normalized = normalized.replace(/\/$/, '');

  // Validate it looks like a URL
  try {
    new URL(normalized);
    return normalized;
  } catch {
    return null;
  }
}
