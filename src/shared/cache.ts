// ============================================================
// IN-MEMORY SESSION CACHE
// TTL-based, typed, singleton exported for shared use across clients
// ============================================================

interface CacheEntry<T> {
  value: T;
  expiry: number; // Date.now() + TTL ms
}

export class SessionCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private hitCount = 0;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiry) {
      this.store.delete(key);
      return undefined;
    }
    this.hitCount++;
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number = TTL.NPM): void {
    this.store.set(key, { value, expiry: Date.now() + ttlMs });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.hitCount = 0;
  }

  getHitCount(): number {
    return this.hitCount;
  }

  size(): number {
    return this.store.size;
  }
}

// TTL constants (milliseconds)
export const TTL = {
  SERPER: 5 * 60 * 1000,           // 5 minutes
  NPM: 5 * 60 * 1000,              // 5 minutes
  GITHUB: 5 * 60 * 1000,           // 5 minutes
  REDDIT: 5 * 60 * 1000,           // 5 minutes
  LLM: 10 * 60 * 1000,             // 10 minutes
  REDDIT_TOKEN: 23 * 60 * 60 * 1000, // 23 hours (token expires in 24h)
} as const;

// Cache key builders — consistent naming across all clients
export const CacheKey = {
  serper: (query: string) => `serper:${query.toLowerCase().trim()}`,
  npmMeta: (name: string) => `npm:meta:${name}`,
  npmDownloads: (name: string) => `npm:dl:${name}`,
  githubRepo: (owner: string, repo: string) => `github:repo:${owner}/${repo}`,
  githubCommits: (owner: string, repo: string) => `github:commits:${owner}/${repo}`,
  githubContributors: (owner: string, repo: string) => `github:contributors:${owner}/${repo}`,
  reddit: (packageName: string) => `reddit:search:${packageName}`,
  redditToken: () => `reddit:token`,
  llmSentiment: (packageName: string, titlesHash: string) =>
    `llm:sentiment:${packageName}:${titlesHash}`,
} as const;

// Singleton cache instance shared across all clients
export const cache = new SessionCache();
