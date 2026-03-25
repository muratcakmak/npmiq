# npmiq

Discover and compare npm packages using real signals. Given a natural language query, depiq finds candidates via Google, then scores them using:

- **Downloads** — weekly npm download count (absolute log scale)
- **GitHub health** — stars, commit activity, freshness, issue ratio, contributors
- **Reddit buzz** — community discussion with false-positive filtering
- **State of JS** — developer retention scores (2021–2024 survey data)
- **LLM sentiment** — optional community sentiment analysis via OpenRouter

Available as a **CLI** (`depiq`) and an **MCP server** (`depiq-mcp`) for AI agent use.

---

## Installation

```bash
npm install -g npmiq
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `SERPER_API_KEY` | Yes | Google search via [serper.dev](https://serper.dev) |
| `REDDIT_CLIENT_ID` | Yes | Reddit OAuth app client ID |
| `REDDIT_CLIENT_SECRET` | Yes | Reddit OAuth app client secret |
| `GITHUB_TOKEN` | No | Raises GitHub rate limit from 60 to 5000 req/hr |
| `OPENROUTER_API_KEY` | No | Enables LLM sentiment analysis via [openrouter.ai](https://openrouter.ai) |
| `OPENROUTER_MODEL` | No | Model to use (default: `mistralai/mistral-small-3.1-24b-instruct:free`) |
| `SCRAPEDO_API_KEY` | No | Proxy for GitHub API calls (bypasses rate limits without a token) |

**Getting credentials:**
- Serper: [serper.dev](https://serper.dev) — 2,500 free searches/month
- Reddit: [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) — create a "script" app, use any redirect URI

---

## CLI Usage

```bash
depiq search "<query>"
```

### Examples

```bash
# Find the best form validation library for React
npmiq search "form validation react"

# Find HTTP clients for Node.js, return top 3, skip Reddit for speed
npmiq search "http client node" --top 3 --no-reddit

# Full analysis with LLM sentiment and verbose score breakdown
npmiq search "state management react" --verbose

# Machine-readable JSON output
npmiq search "date utilities" --json

# Only show packages scoring above 70
npmiq search "testing framework" --min-score 70
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --top <n>` | `5` | Number of results to return (max 20) |
| `-j, --json` | `false` | Output JSON to stdout |
| `--no-reddit` | — | Skip Reddit signal collection |
| `--no-llm` | — | Skip LLM sentiment analysis |
| `--no-github` | — | Skip GitHub API calls |
| `--min-score <n>` | — | Filter results below composite score N |
| `--verbose` | `false` | Show sub-score breakdown table |
| `--no-color` | — | Disable ANSI colors |
| `--config <path>` | — | Load config from a JSON file |

---

## MCP Server

depiq exposes 7 tools over stdio for use with any MCP client (Claude Desktop, Cursor, etc.).

### Setup (Claude Desktop)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "npmiq": {
      "command": "npmiq-mcp",
      "env": {
        "SERPER_API_KEY": "your_key",
        "REDDIT_CLIENT_ID": "your_id",
        "REDDIT_CLIENT_SECRET": "your_secret",
        "GITHUB_TOKEN": "your_token"
      }
    }
  }
}
```

### Available Tools

| Tool | Description |
|------|-------------|
| `search_packages` | Discover package names from a natural language query |
| `get_npm_stats` | Fetch npm registry metadata and weekly downloads |
| `get_github_stats` | Fetch GitHub health signals (stars, commits, issues, contributors) |
| `search_reddit` | Adaptive multi-query Reddit search with false-positive filtering |
| `get_stateofjs_retention` | Look up State of JS retention score (instant, no API call) |
| `compare_packages` | Score and rank an assembled set of packages |
| `parse_github_url` | Parse a GitHub URL into owner/repo components |

---

## Scoring

Composite score is 0–100, weighted across signals:

| Signal | Weight | Notes |
|--------|--------|-------|
| Weekly Downloads | 25% | Log-normalized against 50M ceiling |
| Commit Activity | 20% | Commits in last 90 days, saturates at 200 |
| State of JS Retention | 15% | Survey satisfaction score, null if not in dataset |
| GitHub Stars | 10% | Log-normalized against 150k ceiling |
| Freshness | 10% | Sigmoid decay since last push |
| Issue Health | 8% | Open issues relative to repo size |
| Reddit Buzz | 7% | Upvotes × confidence (title-match ratio) |
| Contributors | 5% | Relative to candidate set |

Missing signals (e.g. no GitHub data) redistribute their weight to present signals.

---

## License

MIT — Oguzhan Cakmak
