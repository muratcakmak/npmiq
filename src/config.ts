import * as dotenv from 'dotenv';
import { Config, ConfigError } from './types.js';

dotenv.config();

const DEFAULT_OPENROUTER_MODEL = 'mistralai/mistral-small-3.1-24b-instruct:free';

export function loadConfig(overrides?: Partial<Config>): Config {
  const env = process.env;

  // Required keys
  const serperApiKey = overrides?.serperApiKey ?? env['SERPER_API_KEY'];
  const redditClientId = overrides?.redditClientId ?? env['REDDIT_CLIENT_ID'];
  const redditClientSecret = overrides?.redditClientSecret ?? env['REDDIT_CLIENT_SECRET'];

  const missing: string[] = [];
  if (!serperApiKey) missing.push('SERPER_API_KEY');
  if (!redditClientId) missing.push('REDDIT_CLIENT_ID');
  if (!redditClientSecret) missing.push('REDDIT_CLIENT_SECRET');

  if (missing.length > 0) {
    throw new ConfigError(
      `Missing required environment variables: ${missing.join(', ')}`,
      `Copy .env.example to .env and fill in the required values`
    );
  }

  // Optional keys — warn but don't fail
  const openrouterApiKey = overrides?.openrouterApiKey ?? env['OPENROUTER_API_KEY'];
  const githubToken = overrides?.githubToken ?? env['GITHUB_TOKEN'];
  const scrapedoApiKey = overrides?.scrapedoApiKey ?? env['SCRAPEDO_API_KEY'];
  const openrouterModel =
    overrides?.openrouterModel ?? env['OPENROUTER_MODEL'] ?? DEFAULT_OPENROUTER_MODEL;

  if (!openrouterApiKey) {
    process.stderr.write(
      'Warning: OPENROUTER_API_KEY not set — LLM sentiment analysis will be skipped\n'
    );
  }
  if (!githubToken) {
    process.stderr.write(
      'Warning: GITHUB_TOKEN not set — GitHub API limited to 60 req/hr (unauthenticated)\n'
    );
  }

  return {
    serperApiKey: serperApiKey!,
    redditClientId: redditClientId!,
    redditClientSecret: redditClientSecret!,
    openrouterApiKey,
    openrouterModel,
    githubToken,
    scrapedoApiKey,
  };
}

/**
 * Load config from a JSON file, merged with environment variables.
 * File values take precedence over env vars.
 */
export async function loadConfigFromFile(filePath: string): Promise<Config> {
  const { readFile } = await import('fs/promises');
  const raw = await readFile(filePath, 'utf-8');
  const fileConfig = JSON.parse(raw) as Partial<Config>;
  return loadConfig(fileConfig);
}
