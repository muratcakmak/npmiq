# Fix 1 — Objective & Accurate Scoring Overhaul

## Problems Identified

### Problem 1: Reddit False Positives (Critical)
`yup` scored higher than `react-hook-form` because Reddit search for `"yup"`
matched 21,600 upvotes from posts where people wrote "yup" as slang for "yes".
Same issue with `validator`, `informed`, `joi`, `zod` — common English words.
The LLM even flagged this: "No posts directly mention yup" — but the buzz score
still counted those posts at full weight (15% weight × 100 score = dominates ranking).

### Problem 2: Relative Normalization Causes Score Drift
Popularity and stars are normalized against max(candidates). If the candidate
set changes between runs (Serper returns slightly different results), every score
shifts. `react-hook-form` went 63.5 → 63.0 between two consecutive runs without
anything actually changing.

### Problem 3: Activity Underweighted vs Noisy Reddit Signal
`yup` (0 commits/90d) beat `react-hook-form` (32 commits/90d) because fake Reddit
buzz at 15% weight overwhelmed real activity at 15% weight. Zero commits in 90 days
is a serious maintenance red flag that should matter more.

### Problem 4: No Survey/Retention Signal
The most authoritative JS library quality signal — State of JS retention rate —
is not used at all. Retention rate measures: of developers who used a library,
what % would use it again. This is the strongest satisfaction signal in existence
for JS libraries, available for ~60 major libraries going back to 2021.

---

## Fixes

### Fix A — Reddit: Adaptive Multi-Query Strategy (reddit.ts)

Instead of one query that catches false positives, run adaptive targeted searches.

**Step 1 — Base search** (always runs):
Search `"packageName"` quoted. Count posts where the package name appears in the
title. Call this `relevantCount`.

**Step 2 — Adaptive expansion** (only fires if `relevantCount < 3`):
Run 4 additional targeted queries, deduplicate by post ID across all results:

1. `packageName npm` — eliminates slang/colloquial false positives
2. `packageName vs` — captures comparison/evaluation discussions (highest quality signal)
3. `packageName topicKeyword` — derived from npm `keywords[]` field, first keyword
   that is not the package name and not generic (`javascript`, `typescript`, `node`, `npm`)
   e.g. `yup` keywords `["schema","validation"]` → query = `yup schema`
4. `packageName javascript` — broad technical anchor

**Deduplication**: across all queries, deduplicate posts by post `id` so the same
post never gets double-counted regardless of how many queries returned it.

**Filtering**: after deduplication, only count posts whose title contains the
package name (case-insensitive, substring match). Store:
- `relevantPosts` — count of title-matched posts
- `totalFetched` — count of all posts fetched (before filtering)

This gives us 1 API call for unambiguous packages with good signal, or 5 calls
for ambiguous names. Well within Reddit's 100 req/min limit (5 packages × 5 = 25 max).

### Fix B — Scorer: Reddit Confidence Gate (scorer.ts)

Use `relevantPosts / totalFetched` as a confidence multiplier on redditBuzz:

```
confidence = relevantPosts / max(totalFetched, 1)
redditBuzz = rawBuzz * confidence
```

If 0 of 25 posts mention the package → buzz = 0, regardless of upvote count.
If 15 of 25 posts mention it → buzz discounted by 40%.
If 25 of 25 posts mention it (e.g. `react-hook-form`) → buzz at full value.

### Fix C — Scorer: Absolute Anchors for Downloads and Stars (scorer.ts)

Replace relative normalization with absolute log ceilings anchored to real-world
reference points. Scores become stable across runs and comparable across queries.

```typescript
const DOWNLOAD_CEILING = 50_000_000;  // ~React weekly downloads
const STARS_CEILING    = 150_000;     // ~React GitHub stars

popularity = clamp100(100 * safeLog(downloads) / safeLog(DOWNLOAD_CEILING))
stars      = clamp100(100 * safeLog(stars)     / safeLog(STARS_CEILING))
```

Relative normalization retained only for: communitySize, redditBuzz (inherently
comparative signals where only the relative ranking matters).

### Fix D — New Signal: State of JS Retention Score (clients/stateofjs.ts)

State of JS survey is the most authoritative developer satisfaction signal for JS
libraries. Retention rate = % of past users who would use it again.

Data embedded as a static TypeScript lookup table — no API, no scraping, works
offline. Data sourced from State of JS 2021–2024 public results.

Retention → score mapping:
- ≥ 90% → 100 (S-tier: Vite 98%, Vitest 98%, Playwright 94%)
- 80–89% → 80  (A-tier: Zod ~88%, Svelte 88%, Vue 87%)
- 70–79% → 60  (B-tier: React 75%, react-hook-form ~72%, Jest 73%)
- 60–69% → 40  (C-tier: Next.js 68%, Electron 62%, Cypress 64%)
- < 60%  → 20  (D-tier: webpack 35%, Gatsby 27%, Angular 54%)
- Not in survey → null (weight redistributes to other signals)

Retention trend bonus: if retention improved year-over-year → +5. If declined → -5.

### Fix E — Rebalanced Weights (scorer.ts)

| Signal         | Old    | New    | Reason |
|----------------|--------|--------|--------|
| popularity     | 25%    | 25%    | Stable now (absolute anchor) |
| activity       | 15%    | 20%    | Raise — 0 commits must hurt more |
| stateOfJs      | 0%     | 15%    | New — most reliable satisfaction signal |
| stars          | 10%    | 10%    | Keep |
| freshness      | 10%    | 10%    | Keep |
| issueHealth    | 10%    | 8%     | Slight reduction |
| redditBuzz     | 15%    | 7%     | Reduce — noisy even after fixes |
| communitySize  | 10%    | 5%     | Less meaningful than activity |
| redditSentiment| 5%     | 0%     | Removed — unreliable on short noisy lists |

Total: 100%

---

## State of JS Research Summary (2021–2024)

### Why Retention Rate is the Best Quality Signal

State of JS tracks 5 signals: Usage, Awareness, Interest, Retention, Positivity.
**Retention is the strongest**: it asks developers who already paid the adoption
cost (learned the API, integrated it, hit its rough edges) whether they'd do it
again. This filters out hype and measures real-world satisfaction.

### 2024 Retention Rates (State of JS)

**S Tier (≥90%)**
- Vite: 98% | Vitest: 98% | Playwright: 94% | Astro: 94%
- pnpm: 93% | esbuild: 91% | Testing Library: 91% | SvelteKit: 90%

**A Tier (80–89%)**
- Svelte: 88% | Vue.js: 87% | SWC: 86% | Rollup: 85%
- Nuxt: 81% | Remix: 80% | TanStack Query: ~89% est.
- Zod: ~88% est. | Zustand: ~85% est.

**B Tier (70–79%)**
- React: 75% | Jest: 73% | Storybook: 71%
- react-hook-form: ~72% est. | Axios: ~70% est.

**C Tier (60–69%)**
- Next.js: 68% | Electron: 62% | Cypress: 64% | Mocha: 61%

**D Tier (<60%)**
- Angular: 54% | webpack: 35% | Gatsby: 27%

### Key Trends (2019–2024)
- React positive opinion: 67% (2019) → 35% (2024) — steady decline
- Next.js positive opinion: 54% (2022) → 12% (2024) — alarming decline
- Vite: exploded from 40% usage (2022) to 78% (2024) at 98% retention
- webpack: now NET NEGATIVE in opinion despite 85% usage (lock-in, not love)

### What Surveys Don't Cover
Neither Stack Overflow nor State of JS cover: form validation libs (Zod/Yup
appear only as raw counts), HTTP clients, most utility libraries. For these,
npm downloads + GitHub activity + Reddit are the primary signals.

---

## Expected Score Changes

With all fixes applied to "form validation library for react":

| Package | Key facts | Old score | Expected |
|---------|-----------|-----------|----------|
| react-hook-form | 21.5M dl, 44.6k★, 32 commits, ~72% SoJS | 63 | ~78 |
| zod | ~5M dl, 35k★, active, ~88% SoJS | (not found) | ~72 |
| yup | 10.5M dl, 23.7k★, **0 commits**, 0 real reddit | 70 | ~50 |
| validator | 20.8M dl, 23.8k★, 8 commits, not in SoJS | 59 | ~52 |

---

## Files Changed

| File | Change |
|------|--------|
| `src/clients/reddit.ts` | Adaptive multi-query + title filtering + deduplication |
| `src/clients/stateofjs.ts` | New — static retention lookup table |
| `src/types.ts` | Add `relevantPosts`, `totalFetched` to `RedditData`; add `stateOfJsRetention` to `PackageRawData` |
| `src/scorer.ts` | Absolute anchors + confidence gate + stateOfJs signal + rebalanced weights |
| `src/orchestrator.ts` | Wire StateOfJsClient into pipeline |
