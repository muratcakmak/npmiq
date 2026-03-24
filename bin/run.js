#!/usr/bin/env node
import('../dist/cli.js').catch((err) => {
  console.error('Failed to start npm-picker:', err.message);
  process.exit(1);
});
