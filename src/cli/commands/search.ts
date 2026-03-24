import type { Ora } from 'ora';
import { SearchOptions, Config, SearchResult, ApiError, ConfigError, ProgressEvent } from '../../shared/types.js';
import { SearchOrchestrator } from '../orchestrator.js';
import { Scorer } from '../../shared/scorer.js';
import { TerminalFormatter } from '../formatter/terminal.js';
import { formatJson, formatJsonError } from '../formatter/json.js';
import { cache } from '../../shared/cache.js';

export async function searchCommand(
  query: string,
  options: SearchOptions,
  config: Config
): Promise<void> {
  const startTime = Date.now();
  const formatter = new TerminalFormatter({ color: options.color });

  // Spinner management
  let spinner: Ora | null = null;
  const spinnerMessages: string[] = [];

  async function startSpinner(text: string): Promise<void> {
    if (!options.json && process.stderr.isTTY) {
      if (!spinner) {
        spinner = await formatter.createSpinner(text);
        spinner.start();
      } else {
        spinner.text = text;
      }
    }
  }

  function succeedSpinner(text: string): void {
    if (spinner) {
      spinner.succeed(text);
      spinner = null;
    }
  }

  function failSpinner(text: string): void {
    if (spinner) {
      spinner.fail(text);
      spinner = null;
    }
  }

  try {
    // Validate query
    if (!query || query.trim().length < 2) {
      const msg = 'Query must be at least 2 characters';
      if (options.json) {
        process.stdout.write(formatJsonError('INVALID_QUERY', msg) + '\n');
      } else {
        process.stderr.write(`Error: ${msg}\n`);
      }
      process.exit(2);
    }

    const orchestrator = new SearchOrchestrator(config);

    // Subscribe to progress events
    orchestrator.on('progress', async (event: ProgressEvent) => {
      if (options.json) return; // No progress in JSON mode

      spinnerMessages.push(event.message);
      await startSpinner(event.message);

      if (event.phase === 'done') {
        succeedSpinner('Analysis complete');
      }
    });

    // Run the search
    const result = await orchestrator.search(query.trim(), options);

    if (spinner) succeedSpinner('Analysis complete');

    // Print any warnings
    if (!options.json && result.warnings.length > 0) {
      formatter.printWarnings(result.warnings);
    }

    // Handle no results
    if (result.packages.length === 0) {
      if (options.json) {
        process.stdout.write(
          formatJsonError(
            'NO_RESULTS',
            `No npm packages found for query: "${query}"`,
            'Try a different search term or broaden your query'
          ) + '\n'
        );
      } else {
        process.stderr.write(`No packages found for "${query}"\n`);
      }
      process.exit(3);
    }

    // Score the packages
    const scorer = new Scorer();
    const scoredPackages = scorer.score(result.packages);

    // Apply top N limit and minScore filter
    let filtered = scoredPackages.slice(0, options.top);
    if (options.minScore !== undefined) {
      filtered = filtered.filter((p) => p.compositeScore >= options.minScore!);
    }

    // Re-assign ranks after filtering
    filtered.forEach((p, i) => { p.rank = i + 1; });

    const finalResult: SearchResult = {
      success: true,
      query: query.trim(),
      timestamp: new Date().toISOString(),
      packages: filtered,
      llmRecommendation: result.recommendation,
      meta: {
        candidatesFound: result.meta.candidatesFound,
        candidatesScored: filtered.length,
        githubRateLimitRemaining: result.meta.githubRateLimitRemaining,
        redditTokenValid: result.meta.redditTokenValid,
        llmUsed: result.meta.llmUsed,
        cacheHits: result.meta.cacheHits,
        durationMs: Date.now() - startTime,
        warnings: result.warnings,
      },
    };

    // Output
    if (options.json) {
      process.stdout.write(formatJson(finalResult) + '\n');
    } else {
      formatter.printResults(finalResult, options);
    }

    process.exit(0);

  } catch (err) {
    if (spinner) failSpinner('Failed');

    if (err instanceof ConfigError) {
      if (options.json) {
        process.stdout.write(
          formatJsonError('CONFIG_ERROR', err.message, err.suggestion) + '\n'
        );
      } else {
        process.stderr.write(`Configuration Error: ${err.message}\n`);
        if (err.suggestion) process.stderr.write(`  Hint: ${err.suggestion}\n`);
      }
      process.exit(2);
    }

    if (err instanceof ApiError) {
      if (options.json) {
        process.stdout.write(
          formatJsonError(err.code, err.message, err.suggestion) + '\n'
        );
      } else {
        process.stderr.write(`Error: ${err.message}\n`);
        if (err.suggestion) process.stderr.write(`  Hint: ${err.suggestion}\n`);
      }
      // Serper failures that prevent any results → exit 1
      if (err.code.startsWith('SERPER_')) {
        process.exit(1);
      }
      process.exit(1);
    }

    // Unknown error
    const msg = err instanceof Error ? err.message : String(err);
    if (options.json) {
      process.stdout.write(formatJsonError('UNKNOWN_ERROR', msg) + '\n');
    } else {
      process.stderr.write(`Unexpected error: ${msg}\n`);
      if (process.env['DEBUG']) {
        console.error(err);
      }
    }
    process.exit(1);
  }
}
