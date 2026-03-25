#!/usr/bin/env node
import('../dist/cli/index.js').catch((err) => {
  console.error('Failed to start depiq:', err.message);
  process.exit(1);
});
