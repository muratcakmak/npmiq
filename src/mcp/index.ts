import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../shared/config.js';
import * as tools from './tools.js';

// ============================================================
// MCP Server — depiq
//
// Exposes 6 tools over stdio transport for any MCP client:
//   search_packages, get_npm_stats, get_github_stats,
//   search_reddit, get_stateofjs_retention, compare_packages
//
// Plus a helper: parse_github_url
// ============================================================

const config = loadConfig();

const server = new McpServer({
  name: 'depiq',
  version: '1.0.0',
});

// ---- Tool: search_packages --------------------------------

server.tool(
  'search_packages',
  'Discover npm packages for a use case via Google search. Returns candidate package names.',
  {
    query: z.string().describe('Natural language query, e.g. "table library for react"'),
  },
  async ({ query }) => {
    const result = await tools.searchPackages(query, config);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Tool: get_npm_stats ----------------------------------

server.tool(
  'get_npm_stats',
  'Fetch npm registry metadata and weekly downloads for a package.',
  {
    package_name: z.string().describe('Exact npm package name, e.g. "react-hook-form" or "@tanstack/react-table"'),
  },
  async ({ package_name }) => {
    const result = await tools.getNpmStats(package_name, config);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Tool: get_github_stats -------------------------------

server.tool(
  'get_github_stats',
  'Fetch GitHub repository health: stars, forks, commits (90d), open issues, contributors, freshness.',
  {
    owner: z.string().describe('GitHub repo owner, e.g. "react-hook-form"'),
    repo: z.string().describe('GitHub repo name, e.g. "react-hook-form"'),
  },
  async ({ owner, repo }) => {
    const result = await tools.getGithubStats(owner, repo, config);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Tool: search_reddit ----------------------------------

server.tool(
  'search_reddit',
  'Adaptive multi-query Reddit search for community signals. Runs 1-5 queries, filters false positives, returns relevant posts and upvotes.',
  {
    package_name: z.string().describe('npm package name to search for'),
    keywords: z.array(z.string()).optional().describe('npm keywords for topic disambiguation, e.g. ["validation", "schema"]'),
  },
  async ({ package_name, keywords }) => {
    const result = await tools.searchReddit(package_name, keywords ?? [], config);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Tool: get_stateofjs_retention ------------------------

server.tool(
  'get_stateofjs_retention',
  'Look up State of JS survey retention score (% of users who would use again). Instant static lookup from 2021-2024 data. Returns null if not in dataset.',
  {
    package_name: z.string().describe('npm package name, e.g. "react-hook-form"'),
  },
  async ({ package_name }) => {
    const result = tools.getStateOfJsRetention(package_name);
    return {
      content: [{
        type: 'text',
        text: result
          ? JSON.stringify(result, null, 2)
          : JSON.stringify({ found: false, package: package_name, message: 'Not in State of JS dataset' }),
      }],
    };
  }
);

// ---- Tool: compare_packages -------------------------------

server.tool(
  'compare_packages',
  'Score and rank packages from already-collected raw data. Pass the assembled PackageRawData array from the other tools. Returns ranked results with composite scores.',
  {
    packages: z.array(z.object({
      npm: z.object({
        name: z.string(),
        version: z.string(),
        description: z.string(),
        license: z.string().nullable(),
        homepage: z.string().nullable(),
        keywords: z.array(z.string()),
        maintainersCount: z.number(),
        repositoryUrl: z.string().nullable(),
        weeklyDownloads: z.number(),
      }),
      github: z.object({
        stars: z.number(),
        forks: z.number(),
        openIssues: z.number(),
        contributors: z.number().nullable(),
        commitsLast90d: z.number().nullable(),
        lastPushedAt: z.string(),
        archived: z.boolean(),
        language: z.string().nullable(),
        topics: z.array(z.string()),
      }).nullable(),
      reddit: z.object({
        totalPosts: z.number(),
        totalScore: z.number(),
        highQualityPosts: z.number(),
        topTitles: z.array(z.string()),
        subreddits: z.record(z.number()),
        relevantPosts: z.number(),
        totalFetched: z.number(),
        queriesUsed: z.number(),
      }).nullable(),
      sentiment: z.object({
        sentiment: z.enum(['positive', 'negative', 'neutral', 'mixed']),
        score: z.number(),
        summary: z.string(),
      }).nullable(),
      stateOfJsRetention: z.number().nullable(),
    })).describe('Array of PackageRawData assembled from other tool results'),
  },
  async ({ packages }) => {
    const result = tools.comparePackages(packages);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// ---- Tool: parse_github_url (helper) ----------------------

server.tool(
  'parse_github_url',
  'Parse a GitHub repository URL into owner/repo components. Use this to get args for get_github_stats from an npm package\'s repository URL.',
  {
    url: z.string().describe('GitHub URL from npm package metadata, e.g. "https://github.com/react-hook-form/react-hook-form"'),
  },
  async ({ url }) => {
    const result = tools.parseGithubUrl(url);
    return {
      content: [{
        type: 'text',
        text: result
          ? JSON.stringify(result, null, 2)
          : JSON.stringify({ error: 'Could not parse GitHub URL', url }),
      }],
    };
  }
);

// ---- Start server -----------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
