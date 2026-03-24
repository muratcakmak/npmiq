import { Command } from 'commander';
import { createRequire } from 'module';
import { loadConfig, loadConfigFromFile } from './config.js';
import { searchCommand } from './commands/search.js';
import { SearchOptions, ConfigError } from './types.js';

const require = createRequire(import.meta.url);

// Load version from package.json
let version = '1.0.0';
try {
  const pkg = require('../package.json') as { version: string };
  version = pkg.version;
} catch {
  // fallback to hardcoded version
}

const program = new Command();

program
  .name('npm-picker')
  .description(
    'Best-in-class CLI for discovering and comparing npm packages.\n' +
    'Combines Google search, npm stats, GitHub health, and Reddit community\n' +
    'sentiment into a composite score to recommend the best package for your use case.'
  )
  .version(version, '-V, --version', 'Show version number')
  .exitOverride(); // Throw instead of process.exit() for testability

program
  .command('search <query>')
  .description('Search for the best npm packages for a use case')
  .option('-n, --top <number>', 'Number of packages to return', '5')
  .option('-j, --json', 'Output machine-readable JSON to stdout', false)
  .option('--no-reddit', 'Skip Reddit signal collection (faster)')
  .option('--no-llm', 'Skip LLM sentiment analysis (fastest)')
  .option('--no-github', 'Skip GitHub API calls')
  .option('--min-score <number>', 'Only return packages with composite score >= N')
  .option('--verbose', 'Show all sub-scores and raw signal values', false)
  .option('--no-color', 'Disable ANSI colors (auto-detected from TTY)')
  .option('--no-cache', 'Bypass in-memory session cache')
  .option('--config <path>', 'Path to a JSON config file (overrides env vars)')
  .action(async (query: string, cmdOptions: Record<string, unknown>) => {
    // Load config (from file override or env vars)
    let config;
    try {
      if (cmdOptions['config']) {
        config = await loadConfigFromFile(cmdOptions['config'] as string);
      } else {
        config = loadConfig();
      }
    } catch (err) {
      if (err instanceof ConfigError) {
        process.stderr.write(`Configuration Error: ${err.message}\n`);
        if (err.suggestion) process.stderr.write(`  Hint: ${err.suggestion}\n`);
        process.exit(2);
      }
      throw err;
    }

    const options: SearchOptions = {
      top: Math.max(1, Math.min(20, parseInt(cmdOptions['top'] as string, 10) || 5)),
      json: cmdOptions['json'] as boolean ?? false,
      reddit: cmdOptions['reddit'] as boolean ?? true,
      llm: cmdOptions['llm'] as boolean ?? true,
      github: cmdOptions['github'] as boolean ?? true,
      minScore: cmdOptions['minScore'] !== undefined
        ? parseFloat(cmdOptions['minScore'] as string)
        : undefined,
      verbose: cmdOptions['verbose'] as boolean ?? false,
      color: cmdOptions['color'] as boolean ?? true,
      cache: cmdOptions['cache'] as boolean ?? true,
    };

    await searchCommand(query, options, config);
  });

// Parse argv — handle errors gracefully
try {
  await program.parseAsync(process.argv);
} catch (err: unknown) {
  // Commander throws CommanderError for --version, --help, and bad args
  if (err && typeof err === 'object' && 'code' in err) {
    const ce = err as { code: string; exitCode?: number };
    if (ce.code === 'commander.version' || ce.code === 'commander.helpDisplayed') {
      process.exit(0);
    }
    // Bad arguments
    process.exit(2);
  }
  throw err;
}
