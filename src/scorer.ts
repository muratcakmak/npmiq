import { PackageRawData, PackageResult, PackageScores } from './types.js';

// Default signal weights (must sum to 1.0)
export const DEFAULT_WEIGHTS: Record<keyof PackageScores, number> = {
  popularity: 0.25,
  activity: 0.15,
  redditBuzz: 0.15,
  stars: 0.10,
  communitySize: 0.10,
  issueHealth: 0.10,
  freshness: 0.10,
  redditSentiment: 0.05,
};

export class Scorer {
  /**
   * Scores and ranks a set of packages. Returns sorted array (highest score first).
   * Pure function — same input always produces same output.
   */
  score(packages: PackageRawData[]): PackageResult[] {
    if (packages.length === 0) return [];

    // Step 1: Compute raw values for normalization
    const rawValues = packages.map(extractRawValues);

    // Step 2: Compute normalization maxima
    const maxLogDownloads = Math.max(...rawValues.map((v) => safeLog(v.weeklyDownloads)));
    const maxLogStars = Math.max(...rawValues.map((v) => safeLog(v.stars)));
    const maxLogContributors = Math.max(...rawValues.map((v) => safeLog(v.contributors)));
    const maxBuzz = Math.max(...rawValues.map((v) => v.buzzRaw));

    // Step 3: Score each package
    const scored = packages.map((pkg, i) => {
      const raw = rawValues[i]!;
      const scores = computeScores(raw, {
        maxLogDownloads,
        maxLogStars,
        maxLogContributors,
        maxBuzz,
      });
      const composite = computeComposite(scores);

      return buildResult(pkg, scores, composite);
    });

    // Step 4: Sort by composite score descending, assign ranks
    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    scored.forEach((pkg, i) => {
      pkg.rank = i + 1;
    });

    return scored;
  }
}

// ---- Raw value extraction ---------------------------------

interface RawValues {
  weeklyDownloads: number;
  stars: number;
  contributors: number;
  commits90d: number;
  openIssues: number;
  daysSincePush: number;
  buzzRaw: number; // posts*1 + totalScore*0.1
  sentimentScore: number | null;
  archived: boolean;
}

function extractRawValues(pkg: PackageRawData): RawValues {
  const now = Date.now();
  const pushedAt = pkg.github?.lastPushedAt
    ? new Date(pkg.github.lastPushedAt).getTime()
    : now - 365 * 24 * 60 * 60 * 1000; // default: 1 year ago if unknown

  const daysSincePush = Math.max(0, (now - pushedAt) / (1000 * 60 * 60 * 24));

  const buzzRaw = pkg.reddit
    ? pkg.reddit.totalPosts * 1 + pkg.reddit.totalScore * 0.1
    : 0;

  return {
    weeklyDownloads: pkg.npm.weeklyDownloads,
    stars: pkg.github?.stars ?? 0,
    contributors: pkg.github?.contributors ?? 0,
    commits90d: pkg.github?.commitsLast90d ?? 0,
    openIssues: pkg.github?.openIssues ?? 0,
    daysSincePush,
    buzzRaw,
    sentimentScore: pkg.sentiment?.score ?? null,
    archived: pkg.github?.archived ?? false,
  };
}

// ---- Sub-score computation --------------------------------

interface NormMaxima {
  maxLogDownloads: number;
  maxLogStars: number;
  maxLogContributors: number;
  maxBuzz: number;
}

function computeScores(raw: RawValues, maxima: NormMaxima): PackageScores {
  // Archived packages get zeroed out for activity/freshness
  const archived = raw.archived;

  const popularity =
    maxima.maxLogDownloads > 0
      ? clamp100(100 * safeLog(raw.weeklyDownloads) / maxima.maxLogDownloads)
      : null;

  const stars =
    maxima.maxLogStars > 0
      ? clamp100(100 * safeLog(raw.stars) / maxima.maxLogStars)
      : null;

  const activity = archived
    ? 0
    : clamp100(100 * Math.min(raw.commits90d, 200) / 200);

  const communitySize =
    maxima.maxLogContributors > 0
      ? clamp100(100 * safeLog(raw.contributors) / maxima.maxLogContributors)
      : null;

  const issueHealth =
    raw.stars > 0 || raw.openIssues > 0
      ? clamp100(100 * Math.max(0, 1 - raw.openIssues / (raw.stars * 0.02 + 100)))
      : null;

  const freshness = archived ? 0 : clamp100(sigmoidDecay(raw.daysSincePush));

  const redditBuzz =
    maxima.maxBuzz > 0 ? clamp100(100 * raw.buzzRaw / maxima.maxBuzz) : 0;

  const redditSentiment =
    raw.sentimentScore !== null
      ? clamp100(100 * (raw.sentimentScore + 1) / 2)
      : null;

  return {
    popularity,
    stars,
    activity,
    communitySize,
    issueHealth,
    freshness,
    redditBuzz,
    redditSentiment,
  };
}

function computeComposite(scores: PackageScores): number {
  // Build map of available signals
  const available: Array<[keyof PackageScores, number]> = [];
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(DEFAULT_WEIGHTS) as Array<
    [keyof PackageScores, number]
  >) {
    const score = scores[key];
    if (score !== null && score !== undefined) {
      available.push([key, weight]);
      totalWeight += weight;
    }
  }

  if (available.length === 0) return 0;
  if (totalWeight === 0) return 0;

  // Re-normalize weights and compute weighted sum
  let composite = 0;
  for (const [key, weight] of available) {
    const normalizedWeight = weight / totalWeight;
    composite += (scores[key] as number) * normalizedWeight;
  }

  return parseFloat(composite.toFixed(2));
}

// ---- Result builder ---------------------------------------

function buildResult(pkg: PackageRawData, scores: PackageScores, composite: number): PackageResult {
  return {
    rank: 0, // Set after sorting
    name: pkg.npm.name,
    version: pkg.npm.version,
    description: pkg.npm.description,
    license: pkg.npm.license,
    homepage: pkg.npm.homepage,
    npmUrl: `https://www.npmjs.com/package/${pkg.npm.name}`,
    githubUrl: pkg.npm.repositoryUrl ?? null,
    compositeScore: composite,
    scores,
    npm: {
      weeklyDownloads: pkg.npm.weeklyDownloads,
      maintainers: pkg.npm.maintainersCount,
      keywords: pkg.npm.keywords,
    },
    github: pkg.github
      ? {
          stars: pkg.github.stars,
          forks: pkg.github.forks,
          openIssues: pkg.github.openIssues,
          contributors: pkg.github.contributors,
          commitsLast90d: pkg.github.commitsLast90d,
          lastPushedAt: pkg.github.lastPushedAt,
          archived: pkg.github.archived,
          language: pkg.github.language,
          topics: pkg.github.topics,
        }
      : null,
    reddit: {
      totalPosts: pkg.reddit?.totalPosts ?? 0,
      totalScore: pkg.reddit?.totalScore ?? 0,
      highQualityPosts: pkg.reddit?.highQualityPosts ?? 0,
      subreddits: pkg.reddit?.subreddits ?? {},
      sentiment: pkg.sentiment?.sentiment ?? null,
      sentimentScore: pkg.sentiment?.score ?? null,
      communitySummary: pkg.sentiment?.summary ?? null,
    },
  };
}

// ---- Math helpers -----------------------------------------

/** Natural log + 1 to handle 0 safely */
export function safeLog(n: number): number {
  return Math.log(Math.max(0, n) + 1);
}

/** Sigmoid decay: 100 at day 0, 50 at day 30, ~3 at day 365 */
export function sigmoidDecay(days: number, lambda = 0.01, midpoint = 30): number {
  return 100 / (1 + Math.exp(lambda * (days - midpoint)));
}

/** Clamp value to [0, 100] */
export function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}
