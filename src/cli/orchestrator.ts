import pLimit from 'p-limit';
import { EventEmitter } from 'events';
import {
  Config,
  SearchOptions,
  PackageRawData,
  OrchestratorResult,
  ProgressEvent,
  ApiError,
} from '../shared/types.js';
import { SerperClient } from '../shared/clients/serper.js';
import { NpmClient } from '../shared/clients/npm.js';
import { GitHubClient } from '../shared/clients/github.js';
import { RedditClient } from '../shared/clients/reddit.js';
import { LlmClient } from '../shared/clients/llm.js';
import { lookupRetention } from '../shared/clients/stateofjs.js';
import { Scorer } from '../shared/scorer.js';
import { cache } from '../shared/cache.js';

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
      message: `Fetching npm + GitHub data for ${candidates.length} packages...`,
      total: candidates.length,
    } as ProgressEvent);

    const limit = pLimit(3);
    const rawPackages: PackageRawData[] = [];

    const fetchTasks = candidates.map((name, i) =>
      limit(async () => {
        this.emit('progress', {
          phase: 'npm',
          message: `Fetching: ${name}`,
          current: i + 1,
          total: candidates.length,
        } as ProgressEvent);

        // npm data — skip package entirely if this fails
        let npmData;
        try {
          npmData = await this.npm.getPackage(name);
        } catch (err) {
          warnings.push(`Skipping "${name}": ${(err as Error).message}`);
          return null;
        }

        // GitHub data — non-fatal
        let githubData = null;
        if (options.github) {
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

        // State of JS retention — instant static lookup, always runs
        const stateOfJsEntry = lookupRetention(name);
        const stateOfJsRetention = stateOfJsEntry?.score ?? null;

        return {
          npm: npmData,
          github: githubData,
          reddit: null,
          sentiment: null,
          stateOfJsRetention,
        } as PackageRawData;
      })
    );

    const fetchResults = await Promise.all(fetchTasks);
    for (const result of fetchResults) {
      if (result !== null) rawPackages.push(result);
    }

    // ---- Phase 3: Reddit (sequential, adaptive multi-query) ----
    if (options.reddit && rawPackages.length > 0) {
      this.emit('progress', {
        phase: 'reddit',
        message: `Searching Reddit for ${rawPackages.length} packages (adaptive)...`,
        total: rawPackages.length,
      } as ProgressEvent);

      try {
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
            // Pass npm keywords so the adaptive query can pick a topic keyword
            pkg.reddit = await this.reddit.search(pkg.npm.name, pkg.npm.keywords);
          } catch (err) {
            warnings.push(`Reddit search failed for "${pkg.npm.name}": ${(err as Error).message}`);
          }
        }
      } catch (err) {
        warnings.push(`Reddit auth failed: ${(err as Error).message}`);
        redditTokenValid = false;
      }
    }

    // ---- Phase 4: LLM sentiment (single batched call) ----
    if (options.llm && this.config.openrouterApiKey) {
      this.emit('progress', {
        phase: 'sentiment',
        message: `Analyzing community sentiment (batched)...`,
        total: rawPackages.length,
      } as ProgressEvent);

      try {
        const sentimentMap = await this.llm.batchAnalyzeSentiment(rawPackages);
        for (const pkg of rawPackages) {
          const sentiment = sentimentMap.get(pkg.npm.name);
          if (sentiment) {
            pkg.sentiment = sentiment;
            llmUsed = true;
          }
        }
      } catch (err) {
        warnings.push(`Batch sentiment analysis failed: ${(err as Error).message}`);
      }
    }

    // ---- Phase 5: Score ----
    const scoredPackages = this.scorer.score(rawPackages);
    const topPackages = scoredPackages.slice(0, options.top);
    const filteredPackages = options.minScore !== undefined
      ? topPackages.filter((p) => p.compositeScore >= options.minScore!)
      : topPackages;

    // ---- Phase 6: LLM recommendation ----
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
