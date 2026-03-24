import { Config, SentimentResult, PackageResult, PackageRawData } from '../types.js';
import { cache, CacheKey, TTL } from '../cache.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

interface OpenRouterResponse {
  choices: Array<{
    message: { content: string; role: string };
    finish_reason: string;
  }>;
  error?: { message: string; code?: number };
}

interface BatchSentimentResult {
  [packageName: string]: SentimentResult;
}

export class LlmClient {
  constructor(private config: Config) {}

  /**
   * Batch-analyzes sentiment for ALL packages in a single API call.
   * Returns a map of packageName → SentimentResult.
   * Much cheaper and avoids rate limits vs one call per package.
   */
  async batchAnalyzeSentiment(
    packages: PackageRawData[]
  ): Promise<Map<string, SentimentResult>> {
    const results = new Map<string, SentimentResult>();
    if (!this.config.openrouterApiKey) return results;

    // Filter to packages that have Reddit data with titles
    const toAnalyze = packages.filter(
      (p) => p.reddit && p.reddit.topTitles.length > 0
    );
    if (toAnalyze.length === 0) return results;

    // Check cache for each — only call LLM for uncached ones
    const uncached: PackageRawData[] = [];
    for (const pkg of toAnalyze) {
      const titlesHash = simpleHash(pkg.reddit!.topTitles.join('|'));
      const cacheKey = CacheKey.llmSentiment(pkg.npm.name, titlesHash);
      const cached = cache.get<SentimentResult>(cacheKey);
      if (cached) {
        results.set(pkg.npm.name, cached);
      } else {
        uncached.push(pkg);
      }
    }

    if (uncached.length === 0) return results;

    // Build a single batched prompt for all uncached packages
    const packageSections = uncached
      .map((pkg) => {
        const titles = pkg.reddit!.topTitles.slice(0, 8).join('\n  ');
        return `### ${pkg.npm.name}\n  ${titles}`;
      })
      .join('\n\n');

    const prompt =
      `Analyze Reddit community sentiment for each npm package below.\n` +
      `Each section shows Reddit post titles (format: "upvotes: title").\n\n` +
      `${packageSections}\n\n` +
      `Return a JSON object where each key is the exact package name and the value is:\n` +
      `{ "sentiment": "positive"|"negative"|"neutral"|"mixed", "score": -1.0..1.0, "summary": "one sentence" }\n\n` +
      `Example format:\n` +
      `{ "react-hook-form": { "sentiment": "positive", "score": 0.8, "summary": "..." } }`;

    try {
      const response = await this.callApi({
        model: this.config.openrouterModel,
        temperature: 0,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are a JSON-only sentiment classifier. Respond ONLY with a valid JSON object. No markdown. No explanation.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return results;

      const parsed = JSON.parse(content) as BatchSentimentResult;

      for (const pkg of uncached) {
        const sentiment = parsed[pkg.npm.name];
        if (sentiment && isValidSentiment(sentiment)) {
          sentiment.score = Math.max(-1, Math.min(1, sentiment.score));
          const titlesHash = simpleHash(pkg.reddit!.topTitles.join('|'));
          cache.set(CacheKey.llmSentiment(pkg.npm.name, titlesHash), sentiment, TTL.LLM);
          results.set(pkg.npm.name, sentiment);
        }
      }
    } catch (err) {
      process.stderr.write(
        `Warning: Batch LLM sentiment failed: ${(err as Error).message}\n`
      );
    }

    return results;
  }

  /**
   * Generates a 2-sentence recommendation for the top packages.
   */
  async generateRecommendation(query: string, packages: PackageResult[]): Promise<string | null> {
    if (!this.config.openrouterApiKey || packages.length === 0) return null;

    const top3 = packages.slice(0, 3);
    const context = top3
      .map(
        (p, i) =>
          `${i + 1}. ${p.name} — score ${p.compositeScore.toFixed(1)}, ` +
          `${formatDownloads(p.npm.weeklyDownloads)} dl/wk, ` +
          `${p.github?.stars ? `⭐ ${formatDownloads(p.github.stars)}, ` : ''}` +
          `${p.reddit.sentiment ?? 'no'} community sentiment`
      )
      .join('\n');

    try {
      const response = await this.callApi({
        model: this.config.openrouterModel,
        temperature: 0.3,
        max_tokens: 200,
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
      process.stderr.write(`Warning: LLM recommendation failed: ${(err as Error).message}\n`);
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

    if (response.status === 402) throw new Error('OpenRouter: insufficient credits');
    if (response.status === 429) throw new Error('OpenRouter: rate limit exceeded');
    if (!response.ok) throw new Error(`OpenRouter API error: HTTP ${response.status}`);

    const data = (await response.json()) as OpenRouterResponse;
    if (data.error) throw new Error(`OpenRouter error: ${data.error.message}`);
    return data;
  }
}

function isValidSentiment(obj: unknown): obj is SentimentResult {
  if (!obj || typeof obj !== 'object') return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s['sentiment'] === 'string' &&
    ['positive', 'negative', 'neutral', 'mixed'].includes(s['sentiment']) &&
    typeof s['score'] === 'number' &&
    typeof s['summary'] === 'string'
  );
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}
