import { SearchResult, ErrorResult } from '../types.js';

/**
 * Serialize a successful search result to a JSON string.
 * Conforms exactly to the SearchResult interface.
 * No ANSI codes, no trailing content.
 */
export function formatJson(result: SearchResult): string {
  // Convert camelCase fields to snake_case for the JSON output schema
  const output = {
    success: true,
    query: result.query,
    timestamp: result.timestamp,
    packages: result.packages.map((pkg) => ({
      rank: pkg.rank,
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      homepage: pkg.homepage,
      npm_url: pkg.npmUrl,
      github_url: pkg.githubUrl,
      composite_score: pkg.compositeScore,
      scores: {
        popularity: pkg.scores.popularity,
        stars: pkg.scores.stars,
        activity: pkg.scores.activity,
        community_size: pkg.scores.communitySize,
        issue_health: pkg.scores.issueHealth,
        reddit_buzz: pkg.scores.redditBuzz,
        reddit_sentiment: pkg.scores.redditSentiment,
        freshness: pkg.scores.freshness,
      },
      npm: {
        weekly_downloads: pkg.npm.weeklyDownloads,
        maintainers: pkg.npm.maintainers,
        keywords: pkg.npm.keywords,
      },
      github: pkg.github
        ? {
            stars: pkg.github.stars,
            forks: pkg.github.forks,
            open_issues: pkg.github.openIssues,
            contributors: pkg.github.contributors,
            commits_last_90d: pkg.github.commitsLast90d,
            last_pushed_at: pkg.github.lastPushedAt,
            archived: pkg.github.archived,
            language: pkg.github.language,
            topics: pkg.github.topics,
          }
        : null,
      reddit: {
        total_posts: pkg.reddit.totalPosts,
        total_score: pkg.reddit.totalScore,
        high_quality_posts: pkg.reddit.highQualityPosts,
        subreddits: pkg.reddit.subreddits,
        sentiment: pkg.reddit.sentiment,
        sentiment_score: pkg.reddit.sentimentScore,
        community_summary: pkg.reddit.communitySummary,
      },
    })),
    llm_recommendation: result.llmRecommendation,
    meta: {
      candidates_found: result.meta.candidatesFound,
      candidates_scored: result.meta.candidatesScored,
      github_rate_limit_remaining: result.meta.githubRateLimitRemaining,
      reddit_token_valid: result.meta.redditTokenValid,
      llm_used: result.meta.llmUsed,
      cache_hits: result.meta.cacheHits,
      duration_ms: result.meta.durationMs,
      warnings: result.meta.warnings,
    },
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Serialize an error result to JSON (for --json mode failures).
 */
export function formatJsonError(
  code: string,
  message: string,
  suggestion?: string
): string {
  const result: ErrorResult = {
    success: false,
    error: { code, message, ...(suggestion ? { suggestion } : {}) },
  };
  return JSON.stringify(result, null, 2);
}
