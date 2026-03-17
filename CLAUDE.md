# CLAUDE.md

Project context for AI assistants working on this codebase.

## What this is

subscope is a personal CLI intelligence feed. It pulls first-hand information from AI companies, central banks, financial regulators, global official media, energy agencies, and international organizations into one terminal interface. Built for one user, optimized for speed and precision over generality.

## Philosophy

- Pure raw information, no AI processing in the feed pipeline
- Each source gets the best possible adapter, not a generic one
- Fast: 65 sources fetch via serve daemon (warm connections, unlimited concurrency) or 12 cold workers in ~3 seconds
- Playwright as last-resort fallback in reader pipeline only (no feed adapter requires it), not in the hot path
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
  interactive.ts            TUI config (folder toggle, no source management)
  notify.ts                 Windows toast notifications
  serve.ts                  Localhost daemon (Ollama-style, SSE streaming, system tray)
  browser.ts                Playwright via node subprocess (anti-bot fallback)
  lib.ts                    Shared utils (hash, TLS, fetchPage, fetchWithCffi, fetchWithCurl, retry, item)
  cffi_fetch.py             Python curl_cffi subprocess for TLS impersonation
  adapters/
    index.ts                Adapter registry: URL -> adapter resolution
    website.ts              Generic: RSS auto-detect, HTML scrape fallback
    youtube.ts              Scrapes ytInitialData from channel page
    twitter.ts              X Guest Token + GraphQL API (UserTweets)
    github.ts               GitHub Atom release feeds
    sites/
      anthropic.ts          Sanity CMS GROQ API (blog/research/engineering)
      claude.ts             Claude.com blog HTML articles
      support-claude.ts     Intercom collection + release notes parser
      deepseek.ts           Changelog page with dated news links
      xai.ts                x.ai/news page scraper
      pboc.ts               People's Bank of China news scraper
      nbs.ts                China National Bureau of Statistics (RSS + HTML)
      bls.ts                Bureau of Labor Statistics RSS indicator parser
      bea.ts                Bureau of Economic Analysis releases scraper
      sec.ts                SEC EDGAR JSON API via cffi (filing search)
      treasury.ts           US Treasury press releases scraper
      imf.ts                IMF news scraper (cffi with Safari TLS)
      csrc.ts               CSRC UCAP JSON API (证监会要闻)
      mof.ts                Ministry of Finance news scraper (财政部)
      safe.ts               State Administration of Foreign Exchange scraper (外汇管理局)
      nfra.ts               National Financial Regulatory Administration (JSON API)
      boe.ts                Bank of England RSS feed via cffi
      boj.ts                Bank of Japan speeches/press HTML scraper
      apnews.ts             AP News hub page scraper (date from URL slug)
      eia.ts                EIA RSS feed via cffi
      iaea.ts               IAEA press releases scraper
      wto.ts                WTO news via JS data file (/library/news/news_YYYY_e.js)
      eu.ts                 EU Commission press releases (JSON API)
      ftc.ts                FTC press releases (RSS)
      fcc.ts                FCC headlines page scraper (cffi for Akamai bypass)
      opec.ts               OPEC press releases (HTML via curl)
      irena.ts              IRENA news (HTML via cffi)
      reuters.ts            Reuters world news (HTML via cffi, Datadome bypass)
      tass.ts               TASS news (HTML via cffi)
      worldbank.ts          World Bank JSON API via cffi
      cctv.ts               CCTV JSONP cmsdatainterface API
      xinhua.ts             Xinhua news scraper (/china/ → /politics/)
      people.ts             People's Daily scraper
      nhk.ts                NHK World JSON API
  sources.ts                Hardcoded source registry (all URLs + groups)
  reader/
    index.ts                Article full-text extractor (multi-layer fallback + Playwright last resort)
    types.ts                SiteRule interface
    econ.ts                 Economics/finance/energy/intl/reg site reader rules
    news.ts                 News media site reader rules
    ai.ts                   AI company + GitHub reader rules
```

## Key architectural decisions

### Adapter pattern
Each source URL resolves to an adapter via `index.ts`. Site-specific adapters (in `sites/`) match by hostname (+ optional path prefix, more specific rules first). Generic adapters (website, youtube, twitter, github) match by URL pattern. Website adapter is the fallback.

### X/Twitter approach
Guest Token + GraphQL API. `getGuestToken()` (POST to `/1.1/guest/activate.json` with public bearer token, singleton-cached per fetch cycle) → `resolveUserId()` via `UserByScreenName` GraphQL → `fetchUserTweets()` via `UserTweets` GraphQL. User ID cache persisted in `x-uid-cache.json`. Thread merging via `conversation_id_str` with reply-chain walking (`in_reply_to_status_id_str`). No auth needed, no Playwright, no syndication API.

### YouTube approach
Fetches `/@handle/videos` page, parses `ytInitialData` JSON from the HTML. Relative dates ("2 weeks ago") converted to ISO timestamps. No API key needed.

### RSS handling
Website adapter detects RSS/Atom by content-type or XML declaration. Handles `pubDate`, `published`, `updated`, and `dc:date` (Dublin Core, used by Nature journals).

### Groups
Path-based strings: `ai/anthropic`, `econ/fed`, `news/bbc`. Filtering with `-g ai` matches prefix. `activeGroups` list determines what shows in default view. `folders` list persists empty folders independently of sources.

### Modes
`ai` (default) = website sources in `ai/*`. `quick` = youtube + twitter. `eco` = economics/finance (`econ/*` groups). `glob` = global news (`news/*` groups). Built-in modes always from code, never saved to config.yml. Modes filter by `types` (source type) AND/OR `groups` (group prefix) — both conditions must pass. `-g` flag bypasses mode filtering.

### Interactive browser
Alternate screen buffer. Item-by-item navigation with auto-scrolling viewport. Search box at top (cursor = -1). NEW badges tracked via `seen.json`. PDF download via URL pattern matching (Nature `.pdf` suffix, arXiv `/pdf/` path).

### Economics & Finance sources
Sixteen sources under the `econ/` group: Federal Reserve (RSS), ECB (RSS), PBOC (HTML scrape), BOJ (HTML scrape), BOE (RSS via cffi — Bun TLS can't connect to bankofengland.co.uk), NBS (RSS/HTML), BLS (RSS with `Sec-Fetch-*` headers), BEA (HTML scrape), SEC EDGAR (JSON API via cffi), US Treasury (HTML scrape), IMF (cffi with Safari TLS), CSRC (UCAP JSON API), MOF (HTML scrape), SAFE (HTML scrape), NFRA (JSON API — `/cn/static/data/DocInfo/` endpoint, no Playwright needed), CFPB (RSS). Most have dedicated adapters; CFPB uses the generic website adapter.

### Global news sources
Eighteen sources under the `news/` group: BBC (RSS), France24 (RSS), DW (RSS), NHK (JSON API), Al Jazeera (RSS), TASS (HTML via cffi — RSS is dead/stale), Reuters (HTML via cffi — Datadome anti-bot, dates from URL slugs), Yonhap (RSS), AP News (HTML scrape), ABC Australia (RSS), CBC (RSS), Focus Taiwan (RSS), The Hindu (RSS), Anadolu Agency (RSS), CNA/Channel NewsAsia (RSS), CCTV (JSONP cmsdatainterface API), Xinhua (HTML scrape, /china/ remapped to /politics/), People's Daily (HTML scrape). Chinese news sources use `dateOnlyToISO` for date-only URLs (noon local time, avoids UTC midnight sort issues).

### Energy sources
Five sources under `energy/`: IEA (HTML scrape from iea.org/news), EIA (RSS via cffi — Bun's TLS blocked by eia.gov), DOE (energy.gov/newsroom, generic website adapter), OPEC (HTML scrape via curl — Cloudflare blocks Bun's BoringSSL), IRENA (HTML scrape via cffi — Azure WAF blocks Chrome TLS fingerprint).

### International organization sources
Five sources under `intl/`: UN News (RSS), WHO (RSS), IAEA (dedicated adapter scraping h3.card__title links from pressreleases page), WTO (dedicated adapter parsing /library/news/news_YYYY_e.js data file — structured JS objects with titles, summaries, dates), World Bank (JSON API via cffi at `search.worldbank.org/api/v2/news` — documents object with cdata-wrapped title/description).

### Regulation sources
Three sources under `reg/`: EU Commission (JSON API at `ec.europa.eu/commission/presscorner/api/search`, filtered to press releases), FTC (RSS feed at ftc.gov/feeds/press-release.xml), FCC (dedicated adapter scraping `/document/` links from headlines page via cffi — Akamai geo-blocking bypass).

### JSON output (`-j`)
`subscope glob -j 20` outputs clean JSON array: `[{title, source, url, summary, publishedAt}]`. Source names formatted for readability (e.g., "央视网" not "news.cctv.com/world"). Pipe-friendly for LLMs.

### Article reader (`subscope read`)
Pipe-friendly full-text extractor for LLM consumption. Output: `# Title\n\ntext`. Per-site CSS selectors for all blog-type sources:
- **AI**: Anthropic (CSS modules `Body-module`), Claude blog (`.u-rich-text-blog`), Claude Support (`.article_body`), OpenAI (`article`), Google AI Blog (`article` with AI-summary strip), NVIDIA (`article-body`), DeepMind (`main`), DeepSeek (`.theme-doc-markdown`), xAI (`.prose.prose-invert`)
- **Econ**: Fed (`#article .col-sm-8`), ECB (`main .section`), PBOC (`#zoom`), BOJ (`div.outline`), BOE (`.page-content, .content-block`), NBS (`.txt-content`), BLS (`#bodytext` with `<pre>` conversion, Sec-Fetch headers), BEA (`.field--name-body`), Treasury (`og:description` meta fallback), IMF (`article .column-padding`), SEC EDGAR (auto-follow `-index.htm` → document, company name from submissions API), CSRC (`.detail-news`), MOF (`.xwfb_content`), SAFE (`.detail_content`), NFRA (Angular auto-detect → Playwright networkidle in reader), CFPB (`.m-full-width-text`), EIA (`.tie-article` via cffi), IEA (`article` with metadata strip), IAEA (`article, .field--name-body`), WTO (`.centerCol`), World Bank (`article.lp__body_content`), EU (JSON API bypass for Angular SPA), FTC (`.node__content .field--name-body`), FCC (`article, main` — Akamai-protected, cffi/Playwright fallback), UN News (`.paragraph--type--one-column-text`), WHO (`article`)
- **News**: BBC (`data-component` text blocks), France24 (`.t-content__body`), DW (`.rich-text`), NHK (generic fallback), Al Jazeera (`.wysiwyg`), Reuters (`article, main` via cffi — Datadome-protected), TASS (`.text-content`), Yonhap (`article.story-news > p`), AP News (`.RichTextStoryBody`), ABC Australia (`engagement_target`), CBC (`.story > p/h2`), Focus Taiwan (`.PrimarySide .paragraph`), The Hindu (`.articlebodycontent`), Anadolu Agency (`.detay-icerik`), CNA (`.content-wrapper`), People's Daily (`.rm_txt_con`), CCTV (`.content_area`), Xinhua (`#detailContent`)
- **Other**: GitHub releases (`[data-test-selector="body-content"]`)
- Anti-bot bypass: Playwright (last-resort fallback in reader) spawns system Chrome with `--disable-blink-features=AutomationControlled`, `navigator.webdriver=false`, `--ignore-certificate-errors`
- Tables: colspan/rowspan grid extraction, compound headers flattened to `Group: Column` format
- Dedup: headings matching title auto-removed; share buttons, video tags, nav stripped

### Thread merging (X)
Group tweets by `conversation_id_str`. Walk `in_reply_to_status_id_str` chain for threads missing conversation_id. Root tweet becomes title, replies concatenated into summary.

## Data flow

1. `subscope fetch`: ensureServe() auto-starts background daemon → proxy fetch via SSE stream (warm connections, unlimited concurrency). Fallback: direct fetch with 12 concurrent workers. Both paths: resolve adapters → retry up to 3x → store.save (INSERT OR IGNORE) → stream results to terminal with per-source timing.
2. `subscope` (read): load config → activeSources (filter by mode + group) → store.query (filter by sourceId, since) → render
3. `subscope serve`: Ollama-style localhost HTTP daemon. Endpoints: `/health`, `/fetch` (SSE stream), `/read` (JSON), `/stop`. Keeps DNS/TLS/connection pool warm. Windows system tray icon via PowerShell. Port file at `~/.subscope/serve.json`.

## Config location

`~/.subscope/` on all platforms. Contains `config.yml`, `subscope.db`, `auth.yml`, `seen.json`, `x-uid-cache.json`, `serve.json`.

## Adding a new source

1. Add entry to `src/sources.ts` registry (URL + group)
2. If the site needs a dedicated adapter, create `src/adapters/sites/<name>.ts` and register in `src/adapters/index.ts`
3. Add reader rule in `src/reader/econ.ts`, `news.ts`, or `ai.ts` for `subscope read` support
4. Add brand color in `render.ts` BRAND array and display name in DISPLAY array
5. Test both `subscope fetch -g <group>` and `subscope read <article_url>`

If the site has RSS or standard HTML, the generic website adapter handles it automatically. No new adapter code needed, but reader rules and colors still required. For sites blocking Bun's TLS, use `fetchWithCffi()` (Safari impersonation) or `fetchWithCurl()` (Client Hints) from `lib.ts`.

## Adding a new generic adapter

1. Create `src/adapters/<type>.ts` implementing `SourceAdapter` interface
2. Add to the `adapters` array in `index.ts` (order = priority, website is fallback)
3. Add type to `SourceType` union in `types.ts`
4. Update `detectType` in `index.ts`

## Common patterns

- ANSI colors: use `c(N)` for 256-color, constants for common ones
- Dates: `timeAgo()` for display, ISO strings for storage. `dateOnlyToISO()` converts date-from-URL to noon local time (capped at now) for sources without precise timestamps (CCTV uses JSONP with precise times instead).
- CJK display: `truncate()` in render.ts uses `displayWidth()` to account for double-width CJK characters in terminal output
- Dedup: hash-based IDs, `INSERT OR IGNORE` in SQLite
- Error handling: adapters throw on auth issues, return `[]` on parse failures. Pipeline retries each source up to 3 times (`retry()` in lib.ts) with backoff. 12 concurrent workers via queue-based semaphore (avoids DNS/TLS congestion from 50+ simultaneous connections). Individual failures don't block others.
- Text cleanup: `cleanTweetText()` strips t.co links. `cleanText()` strips HTML tags and collapses whitespace.
- TLS: `TLS(url)` helper in `lib.ts` conditionally sets `rejectUnauthorized: false` only for hosts in the `INSECURE_HOSTS` whitelist (US gov, EU institutions, Chinese gov CDNs). Not applied globally.
- HTTP strategies: Three fetch methods in `lib.ts` for different anti-bot scenarios: `fetchWithCffi` (Python curl_cffi, impersonates Safari/Chrome TLS fingerprint — bypasses Azure WAF, Cloudflare JA3/JA4), `fetchWithCurl` (curl with Client Hints — bypasses Cloudflare BoringSSL blocking), `fetchPage` (cffi-first with Bun spawnSync fallback). Most adapters use plain `fetch()` + `TLS()` directly.
- Anti-bot: BLS requires full `Sec-Fetch-*` browser headers. SEC EDGAR uses cffi with declared User-Agent. IMF uses cffi with Safari impersonation. Reuters uses cffi (Datadome anti-bot on both feed and article pages). CSRC uses UCAP CMS JSON API to bypass TLS fingerprinting. NFRA uses JSON API directly (no Playwright). OPEC uses curl (Cloudflare). IRENA uses cffi (Azure WAF). Angular SPA auto-detected (`{{data.` + `ng-controller`) and retried with Playwright `networkidle` in reader fallback path.

## Testing

No test suite. The tool is tested by using it. If `subscope fetch && subscope` works, it works.

## Commit discipline

Small, atomic commits. One commit = one logical change. Never bundle multiple features or fixes into a single commit. Examples:
- **Good**: `feat: add MOF adapter` (one adapter, one commit)
- **Good**: `fix: BLS missing TLS cert bypass` (one bug, one commit)
- **Bad**: `feat: add MOF, SAFE, NFRA, CSRC adapters` (four adapters crammed into one commit)

Commit proactively when a logical unit of work is complete — don't wait to be asked. Judge the right moment: a new adapter works, a bug is fixed, a refactor is done. Push immediately after commit.

When a commit changes functionality, immediately follow with a separate docs commit updating:
- `CLAUDE.md` — project context (this file)
- `README.md` — user-facing documentation
- `COMMANDS.md` — command reference

## Platform notes

- Bun + Playwright doesn't work on Windows (pipe communication bug, oven-sh/bun#27977). Playwright is used via `node -e` subprocess as a last-resort fallback in the reader pipeline — not through Bun directly. `fetchWithBrowser` in `browser.ts` supports `waitUntil` parameter (`domcontentloaded` default, `networkidle` for Angular SPAs). No feed adapter currently requires Playwright (NFRA switched to JSON API, IMF uses cffi).
- Windows toast notifications via PowerShell inline script.
- Clipboard read via `powershell Get-Clipboard`.
- `cmd /c start` to open URLs in default browser.
