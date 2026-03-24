import { describe, it, expect } from 'vitest';
import { formatJson, formatJsonError } from './json.js';
import { SearchResult } from '../types.js';

function makeResult(): SearchResult {
  return {
    success: true,
    query: 'table library for react',
    timestamp: '2026-03-23T12:00:00.000Z',
    packages: [
      {
        rank: 1,
        name: '@tanstack/react-table',
        version: '8.20.5',
        description: 'Headless UI for building tables',
        license: 'MIT',
        homepage: 'https://tanstack.com/table',
        npmUrl: 'https://www.npmjs.com/package/%40tanstack%2Freact-table',
        githubUrl: 'https://github.com/TanStack/table',
        compositeScore: 87.3,
        scores: {
          popularity: 92.1,
          stars: 85.0,
          activity: 78.4,
          communitySize: 81.0,
          issueHealth: 74.5,
          redditBuzz: 88.0,
          redditSentiment: 90.0,
          freshness: 95.0,
        },
        npm: {
          weeklyDownloads: 4_823_000,
          maintainers: 3,
          keywords: ['react', 'table'],
        },
        github: {
          stars: 26300,
          forks: 3100,
          openIssues: 94,
          contributors: 342,
          commitsLast90d: 47,
          lastPushedAt: '2026-03-20T14:22:00Z',
          archived: false,
          language: 'TypeScript',
          topics: ['react', 'table'],
        },
        reddit: {
          totalPosts: 42,
          totalScore: 1284,
          highQualityPosts: 18,
          subreddits: { reactjs: 28, javascript: 14 },
          sentiment: 'positive',
          sentimentScore: 0.82,
          communitySummary: 'Widely praised for headless approach',
        },
      },
    ],
    llmRecommendation: 'Use @tanstack/react-table for its headless architecture.',
    meta: {
      candidatesFound: 8,
      candidatesScored: 1,
      githubRateLimitRemaining: 47,
      redditTokenValid: true,
      llmUsed: true,
      cacheHits: 0,
      durationMs: 4823,
      warnings: [],
    },
  };
}

describe('formatJson', () => {
  it('produces valid JSON', () => {
    const result = makeResult();
    const output = formatJson(result);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('includes success: true', () => {
    const parsed = JSON.parse(formatJson(makeResult()));
    expect(parsed.success).toBe(true);
  });

  it('uses snake_case field names in output', () => {
    const parsed = JSON.parse(formatJson(makeResult()));
    const pkg = parsed.packages[0];
    expect(pkg).toHaveProperty('composite_score');
    expect(pkg).toHaveProperty('npm_url');
    expect(pkg).toHaveProperty('github_url');
    expect(pkg.npm).toHaveProperty('weekly_downloads');
    expect(pkg.github).toHaveProperty('open_issues');
    expect(pkg.github).toHaveProperty('commits_last_90d');
    expect(pkg.github).toHaveProperty('last_pushed_at');
    expect(pkg.reddit).toHaveProperty('total_posts');
    expect(pkg.reddit).toHaveProperty('sentiment_score');
    expect(pkg.reddit).toHaveProperty('community_summary');
  });

  it('meta uses snake_case', () => {
    const parsed = JSON.parse(formatJson(makeResult()));
    expect(parsed.meta).toHaveProperty('candidates_found');
    expect(parsed.meta).toHaveProperty('duration_ms');
    expect(parsed.meta).toHaveProperty('github_rate_limit_remaining');
  });

  it('contains no ANSI escape codes', () => {
    const output = formatJson(makeResult());
    // eslint-disable-next-line no-control-regex
    expect(output).not.toMatch(/\x1b\[[0-9;]*m/);
  });

  it('handles null github gracefully', () => {
    const result = makeResult();
    result.packages[0]!.github = null;
    const parsed = JSON.parse(formatJson(result));
    expect(parsed.packages[0].github).toBeNull();
  });
});

describe('formatJsonError', () => {
  it('produces valid JSON', () => {
    const output = formatJsonError('TEST_ERROR', 'Something went wrong');
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('has success: false', () => {
    const parsed = JSON.parse(formatJsonError('ERR', 'msg'));
    expect(parsed.success).toBe(false);
  });

  it('includes error code and message', () => {
    const parsed = JSON.parse(formatJsonError('MY_CODE', 'My message'));
    expect(parsed.error.code).toBe('MY_CODE');
    expect(parsed.error.message).toBe('My message');
  });

  it('includes suggestion when provided', () => {
    const parsed = JSON.parse(formatJsonError('ERR', 'msg', 'Try this'));
    expect(parsed.error.suggestion).toBe('Try this');
  });

  it('omits suggestion when not provided', () => {
    const parsed = JSON.parse(formatJsonError('ERR', 'msg'));
    expect(parsed.error.suggestion).toBeUndefined();
  });
});
