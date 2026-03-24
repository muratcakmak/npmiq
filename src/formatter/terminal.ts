import chalk from 'chalk';
import Table from 'cli-table3';
import type { Ora } from 'ora';
import { SearchResult, PackageResult, SearchOptions } from '../types.js';

// Lazily import ora (ESM dynamic import needed for CJS compat)
let oraModule: typeof import('ora') | null = null;
async function getOra() {
  if (!oraModule) oraModule = await import('ora');
  return oraModule.default;
}

export class TerminalFormatter {
  private useColor: boolean;

  constructor(options?: { color?: boolean }) {
    // Respect NO_COLOR env var and TTY detection
    this.useColor =
      options?.color !== false &&
      process.stdout.isTTY === true &&
      !process.env['NO_COLOR'] &&
      !process.env['CI'];

    if (!this.useColor) {
      chalk.level = 0;
    }
  }

  async createSpinner(text: string): Promise<Ora> {
    const ora = await getOra();
    return ora({ text, isSilent: !process.stderr.isTTY });
  }

  printResults(result: SearchResult, options: SearchOptions): void {
    this.printHeader(result.query);

    if (result.packages.length === 0) {
      process.stdout.write(chalk.yellow('\nNo packages found matching your query.\n\n'));
      return;
    }

    for (const pkg of result.packages) {
      this.printPackage(pkg, options);
    }

    if (result.llmRecommendation) {
      this.printRecommendation(result.llmRecommendation);
    }

    this.printMeta(result);
  }

  printHeader(query: string): void {
    const line = '━'.repeat(68);
    process.stdout.write('\n');
    process.stdout.write(chalk.bold.cyan(` Results for: `) + chalk.bold(`"${query}"`) + '\n');
    process.stdout.write(chalk.dim(` ${line}\n\n`));
  }

  private printPackage(pkg: PackageResult, options: SearchOptions): void {
    const scoreColor = pkg.compositeScore >= 80
      ? chalk.green
      : pkg.compositeScore >= 60
        ? chalk.yellow
        : chalk.red;

    const stars = scoreToStars(pkg.compositeScore);
    const archived = pkg.github?.archived ? chalk.red(' [ARCHIVED]') : '';

    // Header line
    process.stdout.write(
      chalk.bold(` #${pkg.rank}  ${pkg.name}`) +
      archived +
      chalk.dim('  —  ') +
      scoreColor(`Score: ${pkg.compositeScore.toFixed(1)}`) +
      chalk.dim(` ${stars}`) +
      '\n'
    );

    // Version / license / description
    process.stdout.write(
      chalk.dim(`     v${pkg.version}`) +
      (pkg.license ? chalk.dim(` · ${pkg.license}`) : '') +
      '\n'
    );

    if (pkg.description) {
      process.stdout.write(chalk.dim(`     ${truncate(pkg.description, 72)}\n`));
    }

    // npm stats line
    process.stdout.write(
      `     ` +
      chalk.cyan(`${formatDownloads(pkg.npm.weeklyDownloads)}/wk`) +
      (pkg.github
        ? chalk.dim(' · ') +
          chalk.yellow(`⭐ ${formatNum(pkg.github.stars)}`) +
          chalk.dim(' · ') +
          chalk.dim(`${pkg.npm.maintainers} maintainer${pkg.npm.maintainers !== 1 ? 's' : ''}`)
        : '') +
      '\n'
    );

    // GitHub stats line
    if (pkg.github) {
      const commitsText = pkg.github.commitsLast90d !== null
        ? `${pkg.github.commitsLast90d} commits/90d`
        : 'commits unavailable';
      const issuesText = `${pkg.github.openIssues} open issues`;
      const daysAgo = daysSince(pkg.github.lastPushedAt);
      const freshnessText = daysAgo === 0
        ? 'pushed today'
        : `pushed ${daysAgo}d ago`;

      process.stdout.write(
        `     ` +
        chalk.dim(`${commitsText} · ${issuesText} · ${freshnessText}`) +
        '\n'
      );
    }

    // Reddit line
    if (pkg.reddit.totalPosts > 0) {
      const sentimentEmoji = {
        positive: '😊',
        negative: '😟',
        neutral: '😐',
        mixed: '🤔',
      }[pkg.reddit.sentiment ?? 'neutral'] ?? '😐';

      process.stdout.write(
        `     ` +
        chalk.magenta(`Reddit: ${pkg.reddit.totalPosts} posts · ${formatNum(pkg.reddit.totalScore)} upvotes`) +
        (pkg.reddit.sentiment
          ? chalk.dim(` · Sentiment: `) + `${sentimentEmoji} ` + capitalize(pkg.reddit.sentiment)
          : '') +
        '\n'
      );

      if (pkg.reddit.communitySummary) {
        process.stdout.write(
          chalk.dim(`     "${truncate(pkg.reddit.communitySummary, 72)}"`) + '\n'
        );
      }
    }

    // Verbose: sub-score breakdown table
    if (options.verbose) {
      this.printScoreBreakdown(pkg);
    }

    // Links
    process.stdout.write(
      `     ` +
      chalk.dim(`npm: ${pkg.npmUrl}`) +
      (pkg.githubUrl ? chalk.dim(` · gh: ${pkg.githubUrl}`) : '') +
      '\n'
    );

    process.stdout.write('\n');
  }

  private printScoreBreakdown(pkg: PackageResult): void {
    const table = new Table({
      head: [chalk.bold('Signal'), chalk.bold('Score'), chalk.bold('Weight')],
      style: { head: [], border: [] },
      chars: {
        'top': '─', 'top-mid': '┬', 'top-left': '┌', 'top-right': '┐',
        'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '└', 'bottom-right': '┘',
        'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
        'right': '│', 'right-mid': '┤', 'middle': '│',
      },
      colWidths: [22, 10, 10],
    });

    const scoreRows: Array<[string, number | null, string]> = [
      ['Weekly Downloads', pkg.scores.popularity, '25%'],
      ['Commit Activity', pkg.scores.activity, '15%'],
      ['Reddit Buzz', pkg.scores.redditBuzz, '15%'],
      ['GitHub Stars', pkg.scores.stars, '10%'],
      ['Contributors', pkg.scores.communitySize, '10%'],
      ['Issue Health', pkg.scores.issueHealth, '10%'],
      ['Freshness', pkg.scores.freshness, '10%'],
      ['Reddit Sentiment', pkg.scores.redditSentiment, '5%'],
    ];

    for (const [label, score, weight] of scoreRows) {
      const scoreText =
        score === null
          ? chalk.dim('N/A')
          : score >= 70
            ? chalk.green(score.toFixed(1))
            : score >= 40
              ? chalk.yellow(score.toFixed(1))
              : chalk.red(score.toFixed(1));
      table.push([chalk.dim(label), scoreText, chalk.dim(weight)]);
    }

    process.stdout.write('     ');
    // Indent each line of the table
    const tableStr = table.toString().split('\n').join('\n     ');
    process.stdout.write(tableStr + '\n\n');
  }

  private printRecommendation(text: string): void {
    const line = '━'.repeat(68);
    process.stdout.write(chalk.dim(` ${line}\n`));
    process.stdout.write(chalk.bold.cyan(' Recommendation\n'));
    process.stdout.write(` ${text}\n\n`);
  }

  private printMeta(result: SearchResult): void {
    const parts: string[] = [
      `${result.meta.candidatesScored} packages scored`,
      `${result.meta.durationMs}ms`,
    ];
    if (result.meta.cacheHits > 0) parts.push(`${result.meta.cacheHits} cache hits`);
    if (result.meta.githubRateLimitRemaining !== null) {
      parts.push(`GitHub: ${result.meta.githubRateLimitRemaining} req remaining`);
    }
    process.stdout.write(chalk.dim(` ${parts.join(' · ')}\n\n`));
  }

  printWarnings(warnings: string[]): void {
    for (const w of warnings) {
      process.stderr.write(chalk.yellow(`Warning: ${w}\n`));
    }
  }

  printError(message: string): void {
    process.stderr.write(chalk.red(`Error: ${message}\n`));
  }
}

// ---- Helpers ----------------------------------------------

function scoreToStars(score: number): string {
  const filled = Math.round(score / 20);
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toString();
}

function formatNum(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function daysSince(isoDate: string): number {
  const d = new Date(isoDate).getTime();
  return Math.floor((Date.now() - d) / (1000 * 60 * 60 * 24));
}
