import { describe, it, expect } from 'vitest';
import { safeLog, sigmoidDecay, clamp100, Scorer } from './scorer.js';
import { PackageRawData } from './types.js';

// ---- Math helpers -----------------------------------------

describe('safeLog', () => {
  it('returns 0 for input 0', () => {
    expect(safeLog(0)).toBe(Math.log(1));
  });

  it('handles negative inputs gracefully', () => {
    expect(safeLog(-5)).toBeGreaterThanOrEqual(0);
  });

  it('grows with input', () => {
    expect(safeLog(1000)).toBeGreaterThan(safeLog(100));
  });
});

describe('sigmoidDecay', () => {
  it('returns > 50 for 0 days since push (before midpoint)', () => {
    expect(sigmoidDecay(0)).toBeGreaterThan(50);
  });

  it('returns ~50 at the midpoint (30 days)', () => {
    const val = sigmoidDecay(30);
    expect(val).toBeGreaterThan(45);
    expect(val).toBeLessThan(55);
  });

  it('returns a low value for 365 days', () => {
    expect(sigmoidDecay(365)).toBeLessThan(10);
  });

  it('is monotonically decreasing', () => {
    expect(sigmoidDecay(0)).toBeGreaterThan(sigmoidDecay(30));
    expect(sigmoidDecay(30)).toBeGreaterThan(sigmoidDecay(90));
    expect(sigmoidDecay(90)).toBeGreaterThan(sigmoidDecay(365));
  });
});

describe('clamp100', () => {
  it('clamps values above 100 to 100', () => {
    expect(clamp100(150)).toBe(100);
  });

  it('clamps negative values to 0', () => {
    expect(clamp100(-10)).toBe(0);
  });

  it('passes through values in range', () => {
    expect(clamp100(75)).toBe(75);
  });
});

// ---- Scorer -----------------------------------------------

function makePackage(overrides?: Partial<PackageRawData['npm']>): PackageRawData {
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  return {
    npm: {
      name: 'test-pkg',
      version: '1.0.0',
      description: 'A test package',
      license: 'MIT',
      homepage: null,
      keywords: [],
      maintainersCount: 1,
      repositoryUrl: 'https://github.com/test/test-pkg',
      weeklyDownloads: 100_000,
      ...overrides,
    },
    github: {
      stars: 1000,
      forks: 100,
      openIssues: 20,
      contributors: 15,
      commitsLast90d: 30,
      lastPushedAt: recent,
      archived: false,
      language: 'TypeScript',
      topics: [],
    },
    reddit: {
      totalPosts: 10,
      totalScore: 200,
      highQualityPosts: 5,
      topTitles: [],
      subreddits: {},
      relevantPosts: 8,   // 8 of 10 posts mention the package name
      totalFetched: 10,
      queriesUsed: 1,
    },
    sentiment: {
      sentiment: 'positive',
      score: 0.7,
      summary: 'Generally well-regarded',
    },
    stateOfJsRetention: 75, // B-tier retention
  };
}

describe('Scorer', () => {
  const scorer = new Scorer();

  it('returns empty array for empty input', () => {
    expect(scorer.score([])).toEqual([]);
  });

  it('assigns rank 1 to the best package', () => {
    const pkgA = makePackage({ weeklyDownloads: 1_000_000, name: 'popular-pkg' });
    const pkgB = makePackage({ weeklyDownloads: 100, name: 'obscure-pkg' });
    const results = scorer.score([pkgA, pkgB]);
    expect(results[0]!.rank).toBe(1);
    expect(results[0]!.name).toBe('popular-pkg');
  });

  it('assigns ascending ranks', () => {
    const pkgs = [makePackage({ name: 'a' }), makePackage({ name: 'b' }), makePackage({ name: 'c' })];
    const results = scorer.score(pkgs);
    results.forEach((r, i) => expect(r.rank).toBe(i + 1));
  });

  it('composite score is between 0 and 100', () => {
    const results = scorer.score([makePackage()]);
    expect(results[0]!.compositeScore).toBeGreaterThanOrEqual(0);
    expect(results[0]!.compositeScore).toBeLessThanOrEqual(100);
  });

  it('handles missing GitHub data gracefully', () => {
    const pkg: PackageRawData = { ...makePackage(), github: null };
    const results = scorer.score([pkg]);
    expect(results).toHaveLength(1);
    expect(results[0]!.compositeScore).toBeGreaterThanOrEqual(0);
    expect(results[0]!.github).toBeNull();
  });

  it('handles missing Reddit data gracefully', () => {
    const pkg: PackageRawData = { ...makePackage(), reddit: null, sentiment: null };
    const results = scorer.score([pkg]);
    expect(results).toHaveLength(1);
    expect(results[0]!.compositeScore).toBeGreaterThanOrEqual(0);
  });

  it('handles missing stateOfJsRetention gracefully', () => {
    const pkg: PackageRawData = { ...makePackage(), stateOfJsRetention: null };
    const results = scorer.score([pkg]);
    expect(results).toHaveLength(1);
    expect(isNaN(results[0]!.compositeScore)).toBe(false);
  });

  it('archives packages score lower on activity and freshness', () => {
    const active = makePackage({ name: 'active' });
    const archived: PackageRawData = {
      ...makePackage({ name: 'archived' }),
      github: { ...active.github!, archived: true },
    };
    const results = scorer.score([active, archived]);
    const activeResult = results.find((r) => r.name === 'active')!;
    const archivedResult = results.find((r) => r.name === 'archived')!;
    expect(activeResult.compositeScore).toBeGreaterThan(archivedResult.compositeScore);
  });

  it('zero commits scores lower than active package', () => {
    const active = makePackage({ name: 'active' });
    const stale: PackageRawData = {
      ...makePackage({ name: 'stale' }),
      github: { ...active.github!, commitsLast90d: 0 },
    };
    const results = scorer.score([active, stale]);
    const activeResult = results.find((r) => r.name === 'active')!;
    const staleResult = results.find((r) => r.name === 'stale')!;
    expect(activeResult.compositeScore).toBeGreaterThan(staleResult.compositeScore);
  });

  it('reddit confidence gate zeroes buzz for irrelevant posts', () => {
    const realBuzz: PackageRawData = {
      ...makePackage({ name: 'real' }),
      reddit: {
        totalPosts: 20, totalScore: 5000, highQualityPosts: 15,
        topTitles: [], subreddits: {},
        relevantPosts: 20, totalFetched: 20, queriesUsed: 1,
      },
    };
    const fakeBuzz: PackageRawData = {
      ...makePackage({ name: 'fake' }),
      reddit: {
        totalPosts: 0, totalScore: 0, highQualityPosts: 0,
        topTitles: [], subreddits: {},
        relevantPosts: 0, totalFetched: 25, queriesUsed: 5,
      },
    };
    const results = scorer.score([realBuzz, fakeBuzz]);
    const real = results.find((r) => r.name === 'real')!;
    const fake = results.find((r) => r.name === 'fake')!;
    expect(real.scores.redditBuzz).toBeGreaterThan(0);
    expect(fake.scores.redditBuzz).toBe(0);
  });

  it('high state of js score improves ranking', () => {
    const highRetention: PackageRawData = { ...makePackage({ name: 'loved' }), stateOfJsRetention: 100 };
    const lowRetention: PackageRawData = { ...makePackage({ name: 'disliked' }), stateOfJsRetention: 15 };
    const results = scorer.score([highRetention, lowRetention]);
    expect(results[0]!.name).toBe('loved');
  });

  it('single package scores sensibly (no divide-by-zero)', () => {
    const results = scorer.score([makePackage()]);
    expect(isNaN(results[0]!.compositeScore)).toBe(false);
  });
});
