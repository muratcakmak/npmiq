import { Config, SentimentResult, PackageResult } from '../types.js';
import { cache, CacheKey, TTL } from '../cache.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SENTIMENT_SCHEMA = {
  type: 'object',
  properties: {
    sentiment: {
      type: 'string',
      enum: ['positive', 'negative', 'neutral', 'mixed'],
    },
    score: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['sentiment', 'score', 'summary'],
  additionalProperties: false,
};

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content: string;
      role: string;
    };
    finish_reason: string;
  }>;
  error?: { message: string; code?: number };
}

export class LlmClient {
  constructor(private config: Config) {}

  /**
   * Analyzes Reddit post titles to produce a sentiment score for a package.
   * Returns null if no API key or no titles provided.
   */
  async analyzeSentiment(
    packageName: string,
    topTitles: string[]
  ): Promise<SentimentResult | null> {
    if (!this.config.openrouterApiKey || topTitles.length === 0) return null;

    const titlesHash = simpleHash(topTitles.join('|'));
    const cacheKey = CacheKey.llmSentiment(packageName, titlesHash);
    const cached = cache.get<SentimentResult>(cacheKey);
    if (cached) return cached;

    const prompt = buildSentimentPrompt(packageName, topTitles);

    try {
      const response = await this.callApi({
        model: this.config.openrouterModel,
        temperature: 0,
        max_tokens: 300,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'sentiment',
            strict: true,
            schema: SENTIMENT_SCHEMA,
          },
        },
        messages: [
          {
            role: 'system',
            content:
              'You are a JSON-only sentiment classifier for npm package discussions. ' +
              'Respond ONLY with valid JSON. No markdown. No explanation. No preamble.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return null;

      // Parse and validate
      const parsed = JSON.parse(content) as SentimentResult;
      if (!isValidSentiment(parsed)) return null;

      // Clamp score to [-1, 1]
      parsed.score = Math.max(-1, Math.min(1, parsed.score));

      cache.set(cacheKey, parsed, TTL.LLM);
      return parsed;
    } catch (err) {
      // LLM failures are always non-fatal — warn to stderr and continue
      process.stderr.write(
        `Warning: LLM sentiment analysis failed for "${packageName}": ${(err as Error).message}\n`
      );
      return null;
    }
  }

  /**
   * Generates a 2-sentence recommendation for the top packages.
   * Returns null if no API key.
   */
  async generateRecommendation(query: string, packages: PackageResult[]): Promise<string | null> {
    if (!this.config.openrouterApiKey || packages.length === 0) return null;

    const top3 = packages.slice(0, 3);
    const context = top3
      .map(
        (p, i) =>
          `${i + 1}. ${p.name} — score ${p.compositeScore.toFixed(1)}, ` +
          `${formatDownloads(p.npm.weeklyDownloads)} dl/wk, ` +
          `${p.reddit.sentiment ?? 'unknown'} community sentiment`
      )
      .join('\n');

    try {
      const response = await this.callApi({
        model: this.config.openrouterModel,
        temperature: 0.3,
        max_tokens: 150,
        messages: [
          {
            role: 'system',
            content:
              'You are a pragmatic senior developer writing concise npm package advisories. ' +
              'Write exactly 2 sentences. Be direct. No superlatives. No filler words.',
          },
          {
            role: 'user',
            content:
              `Developer query: "${query}"\n\nTop candidates:\n${context}\n\n` +
              `Write a 2-sentence recommendation for which package to use and why.`,
          },
        ],
      });

      return response.choices[0]?.message?.content?.trim() ?? null;
    } catch (err) {
      process.stderr.write(
        `Warning: LLM recommendation failed: ${(err as Error).message}\n`
      );
      return null;
    }
  }

  private async callApi(body: Record<string, unknown>): Promise<OpenRouterResponse> {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.openrouterApiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/npm-package-picker',
        'X-Title': 'npm-package-picker',
      },
      body: JSON.stringify(body),
    });

    if (response.status === 402) {
      throw new Error('OpenRouter account has insufficient credits');
    }

    if (response.status === 429) {
      throw new Error('OpenRouter rate limit exceeded');
    }

    if (!response.ok) {
      throw new Error(`OpenRouter API error: HTTP ${response.status}`);
    }

    const data = (await response.json()) as OpenRouterResponse;

    if (data.error) {
      throw new Error(`OpenRouter error: ${data.error.message}`);
    }

    return data;
  }
}

function buildSentimentPrompt(packageName: string, titles: string[]): string {
  const titleList = titles.map((t, i) => `${i + 1}. ${t}`).join('\n');
  return (
    `Analyze the community sentiment toward the npm package "${packageName}" ` +
    `based on these Reddit post titles (format: "upvotes: title"):\n\n` +
    `${titleList}\n\n` +
    `Return JSON with:\n` +
    `- sentiment: exactly one of "positive", "negative", "neutral", "mixed"\n` +
    `- score: float -1.0 (very negative) to 1.0 (very positive)\n` +
    `- summary: one sentence describing community perception`
  );
}

function isValidSentiment(obj: unknown): obj is SentimentResult {
  if (!obj || typeof obj !== 'object') return false;
  const s = obj as Record<string, unknown>;
  const validSentiments = ['positive', 'negative', 'neutral', 'mixed'];
  return (
    typeof s['sentiment'] === 'string' &&
    validSentiments.includes(s['sentiment']) &&
    typeof s['score'] === 'number' &&
    typeof s['summary'] === 'string'
  );
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit int
  }
  return Math.abs(hash).toString(36);
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}
