// ============================================================
// SHARED TYPES — npm-package-picker
// ============================================================

// ---- Config -----------------------------------------------

export interface Config {
  serperApiKey: string;
  redditClientId: string;
  redditClientSecret: string;
  scrapedoApiKey?: string;
  openrouterApiKey?: string;
  openrouterModel: string;
  githubToken?: string;
}

// ---- CLI Options ------------------------------------------

export interface SearchOptions {
  top: number;
  json: boolean;
  reddit: boolean;
  llm: boolean;
  github: boolean;
  minScore?: number;
  verbose: boolean;
  color: boolean;
  cache: boolean;
}

// ---- API Data Shapes --------------------------------------

export interface NpmData {
  name: string;
  version: string;
  description: string;
  license: string | null;
  homepage: string | null;
  keywords: string[];
  maintainersCount: number;
  repositoryUrl: string | null;
  weeklyDownloads: number;
}

export interface GitHubData {
  stars: number;
  forks: number;
  openIssues: number;
  contributors: number | null;
  commitsLast90d: number | null;
  lastPushedAt: string; // ISO 8601
  archived: boolean;
  language: string | null;
  topics: string[];
}

export interface RedditData {
  totalPosts: number;
  totalScore: number;
  highQualityPosts: number; // score >= 10
  topTitles: string[]; // format: "${score}: ${title}"
  subreddits: Record<string, number>;
}

export interface SentimentResult {
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  score: number; // -1.0 to 1.0
  summary: string;
}

// ---- Intermediate / Orchestrator --------------------------

export interface PackageRawData {
  npm: NpmData;
  github: GitHubData | null;
  reddit: RedditData | null;
  sentiment: SentimentResult | null;
}

// ---- Scorer Output ----------------------------------------

export interface PackageScores {
  popularity: number | null;
  stars: number | null;
  activity: number | null;
  communitySize: number | null;
  issueHealth: number | null;
  redditBuzz: number | null;
  redditSentiment: number | null;
  freshness: number | null;
}

export interface PackageResult {
  rank: number;
  name: string;
  version: string;
  description: string;
  license: string | null;
  homepage: string | null;
  npmUrl: string;
  githubUrl: string | null;
  compositeScore: number;
  scores: PackageScores;
  npm: {
    weeklyDownloads: number;
    maintainers: number;
    keywords: string[];
  };
  github: {
    stars: number;
    forks: number;
    openIssues: number;
    contributors: number | null;
    commitsLast90d: number | null;
    lastPushedAt: string;
    archived: boolean;
    language: string | null;
    topics: string[];
  } | null;
  reddit: {
    totalPosts: number;
    totalScore: number;
    highQualityPosts: number;
    subreddits: Record<string, number>;
    sentiment: 'positive' | 'negative' | 'neutral' | 'mixed' | null;
    sentimentScore: number | null;
    communitySummary: string | null;
  };
}

// ---- Full Output Schema -----------------------------------

export interface SearchResultMeta {
  candidatesFound: number;
  candidatesScored: number;
  githubRateLimitRemaining: number | null;
  redditTokenValid: boolean;
  llmUsed: boolean;
  cacheHits: number;
  durationMs: number;
  warnings: string[];
}

export interface SearchResult {
  success: true;
  query: string;
  timestamp: string;
  packages: PackageResult[];
  llmRecommendation: string | null;
  meta: SearchResultMeta;
}

export interface ErrorResult {
  success: false;
  error: {
    code: string;
    message: string;
    suggestion?: string;
  };
}

// ---- Orchestrator Internal --------------------------------

export interface OrchestratorResult {
  packages: PackageRawData[];
  recommendation: string | null;
  warnings: string[];
  meta: {
    candidatesFound: number;
    githubRateLimitRemaining: number | null;
    redditTokenValid: boolean;
    llmUsed: boolean;
    cacheHits: number;
    durationMs: number;
  };
}

// ---- Progress Events --------------------------------------

export type ProgressPhase =
  | 'searching'
  | 'npm'
  | 'github'
  | 'reddit'
  | 'sentiment'
  | 'recommendation'
  | 'done';

export interface ProgressEvent {
  phase: ProgressPhase;
  message: string;
  current?: number;
  total?: number;
}

// ---- Errors -----------------------------------------------

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly suggestion?: string
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}
