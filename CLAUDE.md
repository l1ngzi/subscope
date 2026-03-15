# CLAUDE.md

Project context for AI assistants working on this codebase.

## What this is

subscope is a personal CLI feed aggregator. It pulls first-hand information from AI companies, academic journals, and economic/financial institutions into one terminal interface. Built for one user, optimized for speed and precision over generality.

## Philosophy

- Pure raw information, no AI processing in the feed pipeline
- Each source gets the best possible adapter, not a generic one
- Fast: 29 sources fetch concurrently in 2 seconds
- No heavy dependencies: no Playwright, no Puppeteer, no Python
- Code should read like it was written by someone who cares

## Tech stack

- Runtime: Bun (TypeScript, bun:sqlite)
- Parsing: cheerio
- Config: yaml
- Storage: SQLite via bun:sqlite (zero external dependency)
- Platform: Windows (PowerShell for notifications, clipboard)

## Project structure

```
src/
  cli.ts                    Entry point, command router
  types.ts                  Core types: Source, FeedItem, SourceAdapter
  config.ts                 YAML config read/write, group/mode logic
  store.ts                  SQLite CRUD, dedup via INSERT OR IGNORE
  pipeline.ts               Orchestrator: fetch all -> store -> read
  render.ts                 Terminal output, interactive browser, colors
  interactive.ts            TUI config (folder/source/catalog/text modes)
  notify.ts                 Windows toast notifications
  adapters/
    index.ts                Adapter registry: URL -> adapter resolution
    website.ts              Generic: RSS auto-detect, HTML scrape fallback
    youtube.ts              Scrapes ytInitialData from channel page
    twitter.ts              Native X GraphQL API (UserByScreenName + UserTweets)
    github.ts               GitHub Atom release feeds
    sites/
      anthropic.ts          RSC JSON payload parser (blog/research/engineering)
      claude.ts             Claude.com blog HTML articles
      support-claude.ts     Intercom collection + release notes parser
      deepseek.ts           Changelog page with dated news links
      xai.ts                x.ai/news page scraper
      pboc.ts               People's Bank of China news scraper
      nbs.ts                China National Bureau of Statistics (RSS + HTML)
      bls.ts                Bureau of Labor Statistics RSS indicator parser
      bea.ts                Bureau of Economic Analysis releases scraper
      sec.ts                SEC EDGAR JSON API (filing search)
  reader.ts                 Article full-text extractor (per-site selectors)
```

## Key architectural decisions

### Adapter pattern
Each source URL resolves to an adapter via `index.ts`. Site-specific adapters (in `sites/`) match by hostname. Generic adapters (website, youtube, twitter, github) match by URL pattern. Website adapter is the fallback.

### X/Twitter approach
Uses the web app's public bearer token + user's auth_token cookie to call GraphQL endpoints directly. No intermediate APIs. Thread merging via `conversation_id_str` with reply-chain walking as fallback. Session (ct0 CSRF token) cached across all X sources in one fetch cycle.

### YouTube approach
Fetches `/@handle/videos` page, parses `ytInitialData` JSON from the HTML. Relative dates ("2 weeks ago") converted to ISO timestamps. No API key needed.

### RSS handling
Website adapter detects RSS/Atom by content-type or XML declaration. Handles `pubDate`, `published`, `updated`, and `dc:date` (Dublin Core, used by Nature journals).

### Groups
Path-based strings: `ai/anthropic`, `photonics`. Filtering with `-g ai` matches prefix. `activeGroups` list determines what shows in default view. `folders` list persists empty folders independently of sources.

### Modes
`formal` = website sources. `quick` = youtube + twitter. `eco` = economics/finance (`econ/*` groups). Modes can filter by `types` (source type) and/or `groups` (group prefix). `-g` flag bypasses mode filtering. Custom modes configurable in YAML.

### Interactive browser
Alternate screen buffer. Item-by-item navigation with auto-scrolling viewport. Search box at top (cursor = -1). NEW badges tracked via `seen.json`. PDF download via URL pattern matching (Nature `.pdf` suffix, arXiv `/pdf/` path).

### Economics & Finance sources
Six sources under the `econ/` group: Federal Reserve (RSS), PBOC (HTML scrape), NBS (RSS/HTML), BLS (RSS with full browser headers to bypass Akamai), BEA (HTML scrape), SEC EDGAR (JSON API at `efts.sec.gov`). Each has a dedicated adapter with site-specific parsing. Color-coded: Fed=sky blue, PBOC=red, NBS=gold, BLS/BEA=olive, SEC=navy.

### Article reader (`subscope read`)
Fetches article URL, extracts clean text using per-site CSS selectors (BEA: `.field--name-body.field--item`, PBOC: `#zoom`, NBS: `.txt-content`, Fed: `#article .col-sm-8`). Output is `# Title\n\ntext` — pipe-friendly for LLM consumption. Generic fallback for unknown sites.

### Thread merging (X)
Group tweets by `conversation_id_str`. Walk `in_reply_to_status_id_str` chain for threads missing conversation_id. Root tweet becomes title, replies concatenated into summary.

## Data flow

1. `subscope fetch`: load config -> resolve adapters -> Promise.allSettled all fetches -> store.save (INSERT OR IGNORE, returns new count)
2. `subscope` (read): load config -> activeSources (filter by mode + group) -> store.query (filter by sourceId, since) -> render

## Config location

`~/.subscope/` on all platforms. Contains `config.yml`, `subscope.db`, `auth.yml`, `seen.json`.

## Adding a new source type

1. If the site needs a dedicated adapter, create `src/adapters/sites/<name>.ts`
2. Export a function matching `(source: Source) => Promise<FeedItem[]>`
3. Register in `src/adapters/index.ts` siteRules array (host + optional path prefix)
4. Update `inferGroup` in `config.ts` if URL patterns need auto-group assignment
5. Update `sourceColor` in `render.ts` for brand color

If the site has RSS or standard HTML, the generic website adapter handles it automatically. No new code needed.

## Adding a new generic adapter

1. Create `src/adapters/<type>.ts` implementing `SourceAdapter` interface
2. Add to the `adapters` array in `index.ts` (order = priority, website is fallback)
3. Add type to `SourceType` union in `types.ts`
4. Update `detectType` in `index.ts`

## Common patterns

- ANSI colors: use `c(N)` for 256-color, constants for common ones
- Dates: `timeAgo()` for display, ISO strings for storage
- Dedup: hash-based IDs, `INSERT OR IGNORE` in SQLite
- Error handling: adapters throw on auth issues, return `[]` on parse failures. Pipeline uses `Promise.allSettled` so one failure doesn't block others.
- Text cleanup: `cleanTweetText()` strips t.co links. `cleanText()` strips HTML tags and collapses whitespace.
- TLS: all fetch calls use `tls: { rejectUnauthorized: false }` (Bun-specific) to handle proxy/cert issues with government sites.
- Anti-bot: BLS requires full `Sec-Fetch-*` browser headers. SEC EDGAR requires declared User-Agent.

## Testing

No test suite. The tool is tested by using it. If `subscope fetch && subscope` works, it works.

## Commit checklist

When committing changes, always update these docs together:
- `CLAUDE.md` — project context (this file)
- `README.md` — user-facing documentation
- `COMMANDS.md` — command reference

## Platform notes

- Bun + Playwright doesn't work on Windows (pipe communication bug, oven-sh/bun#27977). That's why X uses native GraphQL instead.
- Windows toast notifications via PowerShell inline script.
- Clipboard read via `powershell Get-Clipboard`.
- `cmd /c start` to open URLs in default browser.
