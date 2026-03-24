import { PackageRawData, PackageResult, PackageScores } from './types.js';

// ---- Absolute normalization ceilings -----------------------
// Anchored to real-world reference points (React-level metrics).
// These make scores STABLE across runs and comparable across queries.
const DOWNLOAD_CEILING = 50_000_000; // ~React weekly downloads
const STARS_CEILING = 150_000;       // ~React GitHub stars
const CONTRIBUTORS_CEILING = 2_000; // ~large open source project

// ---- Weights -----------------------------------------------
// Must sum to 1.0
export const DEFAULT_WEIGHTS: Record<keyof PackageScores, number> = {
  popularity:    0.25, // anchored absolute — most reliable objective signal
  activity:      0.20, // raised from 0.15 — 0 commits must hurt meaningfully
  stateOfJs:     0.15, // new — State of JS retention (strongest satisfaction signal)
  stars:         0.10, // anchored absolute
  freshness:     0.10, // sigmoid decay on days since last push
  issueHealth:   0.08, // slightly reduced
  redditBuzz:    0.07, // reduced — noisy even after confidence gate
  communitySize: 0.05, // contributor count — less meaningful than activity
};

export class Scorer {
  /**
   * Scores and ranks a set of packages.
   * Returns sorted array (highest composite score first).
   * Pure function — same input always produces same output.
   */
  score(packages: PackageRawData[]): PackageResult[] {
    if (packages.length === 0) return [];

    // Raw values extraction
    const rawValues = packages.map(extractRawValues);

    // Relative maxima (only used for communitySize and redditBuzz now)
    const maxLogContributors = Math.max(...rawValues.map((v) => safeLog(v.contributors)));
    const maxBuzzConfident = Math.max(...rawValues.map((v) => v.buzzConfident));

    // Score each package
    const scored = packages.map((pkg, i) => {
      const raw = rawValues[i]!;
      const scores = computeScores(raw, { maxLogContributors, maxBuzzConfident });
      const composite = computeComposite(scores);
      return buildResult(pkg, scores, composite);
    });

    // Sort descending, assign ranks
    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    scored.forEach((pkg, i) => { pkg.rank = i + 1; });

    return scored;
  }
}

// ---- Raw value extraction ----------------------------------

interface RawValues {
  weeklyDownloads: number;
  stars: number;
  contributors: number;
  commits90d: number;
  openIssues: number;
  daysSincePush: number;
  buzzConfident: number; // buzz score after confidence gate (reddit relevance applied)
  stateOfJsScore: number | null;
  archived: boolean;
}

function extractRawValues(pkg: PackageRawData): RawValues {
  const now = Date.now();
  const pushedAt = pkg.github?.lastPushedAt
    ? new Date(pkg.github.lastPushedAt).getTime()
    : now - 365 * 24 * 60 * 60 * 1000;

  const daysSincePush = Math.max(0, (now - pushedAt) / (1000 * 60 * 60 * 24));

  // Reddit confidence gate: multiply raw buzz by the fraction of posts that
  // actually mentioned the package name in their title.
  // This zeroes out false positives (e.g. "yup" slang posts).
  const rawBuzz = pkg.reddit
    ? pkg.reddit.totalPosts * 1 + pkg.reddit.totalScore * 0.1
    : 0;

  const confidence = pkg.reddit && pkg.reddit.totalFetched > 0
    ? pkg.reddit.relevantPosts / pkg.reddit.totalFetched
    : 0;

  const buzzConfident = rawBuzz * confidence;

  return {
    weeklyDownloads: pkg.npm.weeklyDownloads,
    stars: pkg.github?.stars ?? 0,
    contributors: pkg.github?.contributors ?? 0,
    commits90d: pkg.github?.commitsLast90d ?? 0,
    openIssues: pkg.github?.openIssues ?? 0,
    daysSincePush,
    buzzConfident,
    stateOfJsScore: pkg.stateOfJsRetention,
    archived: pkg.github?.archived ?? false,
  };
}

// ---- Sub-score computation ---------------------------------

interface NormMaxima {
  maxLogContributors: number;
  maxBuzzConfident: number;
}

function computeScores(raw: RawValues, maxima: NormMaxima): PackageScores {
  const archived = raw.archived;

  // --- Absolute anchored signals (stable across runs) ---

  // Log-normalize against fixed absolute ceilings
  const popularity = clamp100(
    100 * safeLog(raw.weeklyDownloads) / safeLog(DOWNLOAD_CEILING)
  );

  const stars = clamp100(
    100 * safeLog(raw.stars) / safeLog(STARS_CEILING)
  );

  // --- Activity signals ---

  // Saturates at 200 commits — beyond that is not meaningfully "more active"
  const activity = archived
    ? 0
    : clamp100(100 * Math.min(raw.commits90d, 200) / 200);

  // Sigmoid decay: forgiving in first 30 days, aggressive after 90 days
  const freshness = archived ? 0 : clamp100(sigmoidDecay(raw.daysSincePush));

  // --- Community signals ---

  // Relative to candidate set (contributors are inherently comparative)
  const communitySize =
    maxima.maxLogContributors > 0
      ? clamp100(100 * safeLog(raw.contributors) / maxima.maxLogContributors)
      : null;

  // Issue health: penalises repos with many open issues relative to their size
  const issueHealth =
    raw.stars > 0 || raw.openIssues > 0
      ? clamp100(100 * Math.max(0, 1 - raw.openIssues / (raw.stars * 0.02 + 100)))
      : null;

  // --- Reddit buzz (with confidence gate applied in extraction) ---
  const redditBuzz =
    maxima.maxBuzzConfident > 0
      ? clamp100(100 * raw.buzzConfident / maxima.maxBuzzConfident)
      : 0;

  // --- State of JS retention score (already 0-100 from lookup) ---
  const stateOfJs = raw.stateOfJsScore;

  return {
    popularity,
    stars,
    activity,
    communitySize,
    issueHealth,
    redditBuzz,
    stateOfJs,
    freshness,
  };
}

function computeComposite(scores: PackageScores): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(DEFAULT_WEIGHTS) as Array<
    [keyof PackageScores, number]
  >) {
    const score = scores[key];
    if (score !== null && score !== undefined) {
      weightedSum += score * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;

  // Re-normalize so missing signals don't artificially deflate score
  return parseFloat(((weightedSum / totalWeight) * 1).toFixed(2));
}

// ---- Result builder ----------------------------------------

function buildResult(pkg: PackageRawData, scores: PackageScores, composite: number): PackageResult {
  return {
    rank: 0,
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
      relevantPosts: pkg.reddit?.relevantPosts ?? 0,
      totalFetched: pkg.reddit?.totalFetched ?? 0,
      queriesUsed: pkg.reddit?.queriesUsed ?? 0,
      subreddits: pkg.reddit?.subreddits ?? {},
      sentiment: pkg.sentiment?.sentiment ?? null,
      sentimentScore: pkg.sentiment?.score ?? null,
      communitySummary: pkg.sentiment?.summary ?? null,
    },
  };
}

// ---- Math helpers ------------------------------------------

/** Natural log + 1 to handle 0 safely */
export function safeLog(n: number): number {
  return Math.log(Math.max(0, n) + 1);
}

/** Sigmoid decay: ~57 at day 0, 50 at day 30, ~27 at day 90, ~3 at day 365 */
export function sigmoidDecay(days: number, lambda = 0.01, midpoint = 30): number {
  return 100 / (1 + Math.exp(lambda * (days - midpoint)));
}

/** Clamp value to [0, 100] */
export function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}
