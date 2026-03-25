#!/usr/bin/env node
import('../dist/mcp/index.js').catch((err) => {
  console.error('Failed to start depiq MCP server:', err.message);
  process.exit(1);
});
