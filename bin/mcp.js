#!/usr/bin/env node
import('../dist/mcp/index.js').catch((err) => {
  console.error('Failed to start npmiq MCP server:', err.message);
  process.exit(1);
});
