import pLimit from 'p-limit';
import { EventEmitter } from 'events';
import {
  Config,
  SearchOptions,
  PackageRawData,
  OrchestratorResult,
  ProgressEvent,
  ApiError,
} from './types.js';
import { SerperClient } from './clients/serper.js';
import { NpmClient } from './clients/npm.js';
import { GitHubClient } from './clients/github.js';
import { RedditClient } from './clients/reddit.js';
import { LlmClient } from './clients/llm.js';
import { Scorer } from './scorer.js';
import { cache } from './cache.js';

export class SearchOrchestrator extends EventEmitter {
  private serper: SerperClient;
  private npm: NpmClient;
  private github: GitHubClient;
  private reddit: RedditClient;
  private llm: LlmClient;
  private scorer: Scorer;

  constructor(private config: Config) {
    super();
    this.serper = new SerperClient(config);
    this.npm = new NpmClient(config);
    this.github = new GitHubClient(config);
    this.reddit = new RedditClient(config);
    this.llm = new LlmClient(config);
    this.scorer = new Scorer();
  }

  async search(query: string, options: SearchOptions): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const warnings: string[] = [];
    let redditTokenValid = false;
    let llmUsed = false;

    // ---- Phase 1: Discover candidates via Serper ----------
    this.emit('progress', {
      phase: 'searching',
      message: 'Searching Google for package candidates...',
    } as ProgressEvent);

    const candidates = await this.serper.discover(query);

    if (candidates.length === 0) {
      return {
        packages: [],
        recommendation: null,
        warnings: ['No npm packages found for this query'],
        meta: {
          candidatesFound: 0,
          githubRateLimitRemaining: null,
          redditTokenValid: false,
          llmUsed: false,
          cacheHits: cache.getHitCount(),
          durationMs: Date.now() - startTime,
        },
      };
    }

    // ---- Phase 2: Fetch npm + GitHub in parallel ----------
    this.emit('progress', {
      phase: 'npm',
      message: `Fetching npm data for ${candidates.length} packages...`,
      total: candidates.length,
    } as ProgressEvent);

    const limit = pLimit(3); // Max 3 concurrent package fetches
    const rawPackages: PackageRawData[] = [];

    const fetchTasks = candidates.map((name, i) =>
      limit(async () => {
        this.emit('progress', {
          phase: 'npm',
          message: `Fetching: ${name}`,
          current: i + 1,
          total: candidates.length,
        } as ProgressEvent);

        // npm fetch — fatal per-package if it fails
        let npmData;
        try {
          npmData = await this.npm.getPackage(name);
        } catch (err) {
          warnings.push(`Skipping "${name}": ${(err as Error).message}`);
          return null;
        }

        // GitHub fetch — non-fatal
        let githubData = null;
        if (options.github) {
          this.emit('progress', {
            phase: 'github',
            message: `GitHub: ${name}`,
          } as ProgressEvent);

          const parsed = GitHubClient.parseRepoUrl(npmData.repositoryUrl);
          if (parsed) {
            try {
              githubData = await this.github.getRepo(parsed.owner, parsed.repo);
            } catch (err) {
              if (err instanceof ApiError && err.code === 'GITHUB_RATE_LIMITED') {
                warnings.push('GitHub rate limit hit — GitHub signals unavailable for some packages');
              } else {
                warnings.push(`GitHub fetch failed for "${name}": ${(err as Error).message}`);
              }
            }
          }
        }

        return { npm: npmData, github: githubData, reddit: null, sentiment: null } as PackageRawData;
      })
    );

    const fetchResults = await Promise.all(fetchTasks);
    for (const result of fetchResults) {
      if (result !== null) rawPackages.push(result);
    }

    // ---- Phase 3: Reddit signals (sequential to respect rate limits) ----
    if (options.reddit && rawPackages.length > 0) {
      this.emit('progress', {
        phase: 'reddit',
        message: `Searching Reddit for ${rawPackages.length} packages...`,
        total: rawPackages.length,
      } as ProgressEvent);

      try {
        // Pre-warm the Reddit token
        await this.reddit.getToken();
        redditTokenValid = true;

        for (let i = 0; i < rawPackages.length; i++) {
          const pkg = rawPackages[i]!;
          this.emit('progress', {
            phase: 'reddit',
            message: `Reddit: ${pkg.npm.name}`,
            current: i + 1,
            total: rawPackages.length,
          } as ProgressEvent);

          try {
            pkg.reddit = await this.reddit.search(pkg.npm.name);
          } catch (err) {
            warnings.push(`Reddit search failed for "${pkg.npm.name}": ${(err as Error).message}`);
          }
        }
      } catch (err) {
        warnings.push(`Reddit auth failed: ${(err as Error).message}`);
        redditTokenValid = false;
      }
    }

    // ---- Phase 4: LLM sentiment (parallel, max 3) -----------
    if (options.llm && this.config.openrouterApiKey) {
      this.emit('progress', {
        phase: 'sentiment',
        message: `Analyzing sentiment for ${rawPackages.length} packages...`,
        total: rawPackages.length,
      } as ProgressEvent);

      const sentimentLimit = pLimit(3);
      await Promise.all(
        rawPackages.map((pkg, i) =>
          sentimentLimit(async () => {
            if (!pkg.reddit || pkg.reddit.topTitles.length === 0) return;

            this.emit('progress', {
              phase: 'sentiment',
              message: `Sentiment: ${pkg.npm.name}`,
              current: i + 1,
              total: rawPackages.length,
            } as ProgressEvent);

            try {
              pkg.sentiment = await this.llm.analyzeSentiment(
                pkg.npm.name,
                pkg.reddit.topTitles
              );
              if (pkg.sentiment) llmUsed = true;
            } catch (err) {
              warnings.push(`Sentiment analysis failed for "${pkg.npm.name}": ${(err as Error).message}`);
            }
          })
        )
      );
    }

    // ---- Phase 5: Score all packages ---------------------
    const scoredPackages = this.scorer.score(rawPackages);
    const topPackages = scoredPackages.slice(0, options.top);

    // Apply minScore filter if specified
    const filteredPackages = options.minScore !== undefined
      ? topPackages.filter((p) => p.compositeScore >= options.minScore!)
      : topPackages;

    // ---- Phase 6: LLM recommendation --------------------
    let recommendation: string | null = null;
    if (options.llm && this.config.openrouterApiKey && filteredPackages.length > 0) {
      this.emit('progress', {
        phase: 'recommendation',
        message: 'Generating recommendation...',
      } as ProgressEvent);

      try {
        recommendation = await this.llm.generateRecommendation(query, filteredPackages);
        if (recommendation) llmUsed = true;
      } catch (err) {
        warnings.push(`Recommendation generation failed: ${(err as Error).message}`);
      }
    }

    this.emit('progress', { phase: 'done', message: 'Done' } as ProgressEvent);

    return {
      packages: rawPackages,
      recommendation,
      warnings,
      meta: {
        candidatesFound: candidates.length,
        githubRateLimitRemaining: this.github.getRateLimitRemaining(),
        redditTokenValid,
        llmUsed,
        cacheHits: cache.getHitCount(),
        durationMs: Date.now() - startTime,
      },
    };
  }
}
