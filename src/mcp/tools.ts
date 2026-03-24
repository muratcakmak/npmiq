import {
  Config,
  NpmData,
  GitHubData,
  RedditData,
  PackageRawData,
  PackageResult,
} from '../shared/types.js';
import { SerperClient } from '../shared/clients/serper.js';
import { NpmClient } from '../shared/clients/npm.js';
import { GitHubClient } from '../shared/clients/github.js';
import { RedditClient } from '../shared/clients/reddit.js';
import { lookupRetention, RetentionScore } from '../shared/clients/stateofjs.js';
import { Scorer } from '../shared/scorer.js';

// ============================================================
// MCP Tool Handlers
//
// Each function is a standalone tool callable by any MCP client.
// They instantiate their own clients from the shared config.
// No shared orchestration — the LLM decides what to call and when.
// ============================================================

/**
 * Tool: search_packages
 * Discovers npm package names from a natural language query via Google search.
 */
export async function searchPackages(
  query: string,
  config: Config
): Promise<{ packages: string[]; query: string }> {
  const client = new SerperClient(config);
  const packages = await client.discover(query);
  return { packages, query };
}

/**
 * Tool: get_npm_stats
 * Fetches npm registry metadata and weekly download count for a package.
 */
export async function getNpmStats(
  packageName: string,
  config: Config
): Promise<NpmData> {
  const client = new NpmClient(config);
  return client.getPackage(packageName);
}

/**
 * Tool: get_github_stats
 * Fetches GitHub repository health signals: stars, commits, issues, contributors.
 * Accepts owner and repo separately (parsed from npm repo URL by the caller).
 */
export async function getGithubStats(
  owner: string,
  repo: string,
  config: Config
): Promise<GitHubData> {
  const client = new GitHubClient(config);
  return client.getRepo(owner, repo);
}

/**
 * Tool: search_reddit
 * Adaptive multi-query Reddit search for community signal.
 * Runs 1–5 queries depending on signal quality, filters false positives.
 */
export async function searchReddit(
  packageName: string,
  keywords: string[],
  config: Config
): Promise<RedditData> {
  const client = new RedditClient(config);
  return client.search(packageName, keywords);
}

/**
 * Tool: get_stateofjs_retention
 * Looks up State of JS survey retention score from the static dataset.
 * No API call — instant lookup. Returns null if package not in dataset.
 */
export function getStateOfJsRetention(
  packageName: string
): RetentionScore | null {
  return lookupRetention(packageName);
}

/**
 * Tool: compare_packages
 * Takes already-collected raw data for multiple packages and returns
 * scored + ranked results with composite scores and sub-score breakdowns.
 * The LLM assembles PackageRawData from the other tools' outputs, then
 * passes the array here for final scoring.
 */
export function comparePackages(
  packages: PackageRawData[]
): PackageResult[] {
  const scorer = new Scorer();
  return scorer.score(packages);
}

/**
 * Helper: parse a GitHub repo URL into owner/repo components.
 * Exposed so the LLM can use it to go from npm repo URL → getGithubStats args.
 */
export function parseGithubUrl(
  url: string
): { owner: string; repo: string } | null {
  return GitHubClient.parseRepoUrl(url);
}
