# subscope

A super subscription that merges multiple first-hand sources into one terminal feed. No secondhand info. All direct, all in one.

## What it does

You follow AI companies and academic journals across blogs, X, YouTube, support pages, GitHub releases, RSS feeds. The information is scattered across dozens of URLs. subscope pulls it all into one place, organized by company, filterable by type, searchable, with PDF downloads for papers.

Currently tracks 6 AI companies (Anthropic, Claude, OpenAI, DeepMind, DeepSeek, xAI), 2 photonics journals (Nature Photonics, Light: Science & Applications), and 6 economics/finance sources (Federal Reserve, PBOC, NBS, BLS, BEA, SEC EDGAR). 29 sources, all fetched concurrently in 2 seconds.

## Quick start

```
bun install
bun link
```

Auth setup (copy values, commands read from clipboard automatically):

```
subscope auth x              # X/Twitter: copy auth_token cookie, run this
subscope auth academic       # Papers: copy Cookie header from nature.com, run this
```

Fetch and read:

```
subscope fetch               # pull all sources (29 sources, ~2s)
subscope                     # interactive browser with search
```

## Usage

```
subscope                     # browse items (up/down, enter to open, / to search, g for PDF)
subscope quick               # social media only (X + YouTube)
subscope formal              # official sources only (blogs, docs, support)
subscope eco                 # economics & finance only (Fed, PBOC, NBS, BLS, BEA, SEC)
subscope --all               # no time filter
subscope -n 10               # latest 10
subscope -g ai/anthropic     # filter by group
```

Background monitoring:

```
subscope watch               # foreground, fetch every 10 minutes
subscope watch 5             # every 5 minutes
subscope watch-install       # Windows scheduled task, desktop notifications
subscope watch-uninstall     # remove scheduled task
```

Article reader (pipe-friendly for LLMs):

```
subscope read <url>          # extract clean article text from any eco source
subscope read <url> | llm    # pipe to LLM for analysis
```

Management:

```
subscope config              # interactive TUI (folders, sources, modes)
subscope group               # list group tree
subscope group ai on/off     # toggle entire subtree
subscope auth x              # X/Twitter auth (clipboard)
subscope auth academic       # academic publisher auth (clipboard)
```

Full command reference: [COMMANDS.md](COMMANDS.md)

## Interactive browser

The default `subscope` command opens an interactive browser:

- Up/down to navigate items
- Enter to open in browser
- / to search (filters by title, summary, source, URL)
- g to download PDF (academic papers)
- NEW badge on unseen items (disappears on scroll)
- Brand colors per company (orange Anthropic, peach Claude, green OpenAI, blue DeepMind, teal DeepSeek, white xAI)
- q to quit

## Architecture

```
Source (YAML) --> Adapter (fetch + parse) --> Store (SQLite) --> Render (TUI)
```

Site-specific adapters: Anthropic (RSC JSON payload), Claude blog (HTML articles), Claude support (Intercom), DeepSeek (changelog HTML), xAI (news page), PBOC (HTML scrape), NBS (RSS + HTML), BLS (RSS indicator parser), BEA (HTML scrape), SEC EDGAR (JSON API).

Generic adapters: RSS/Atom feeds (auto-detect XML), HTML scraping (link extraction), YouTube (ytInitialData JSON), X/Twitter (native GraphQL API), GitHub (Atom release feeds).

X/Twitter calls the same GraphQL endpoints the web app uses. Thread merging via conversation_id. No Playwright, no syndication, no paid API.

All sources fetch concurrently via Promise.allSettled. Individual failures don't block others.

## Groups

Path-based hierarchy. `subscope -g ai` matches all `ai/*` children.

```
ai/
  anthropic   (blog, research, engineering, youtube, x)
  claude      (blog, support x2, youtube, x)
  openai      (news rss, youtube, x)
  deepmind    (blog rss, youtube, x)
  deepseek    (changelog, github, x)
  xai         (news, x)
photonics/
  (nature photonics, light sci & app)
econ/
  fed         (Federal Reserve FOMC statements, monetary policy)
  pboc        (中国人民银行 news, financial data reports)
  nbs         (国家统计局 CPI, GDP, PMI data releases)
  bls         (Bureau of Labor Statistics CPI, unemployment, payrolls)
  bea         (Bureau of Economic Analysis GDP, personal income, trade)
  sec         (SEC EDGAR 8-K company filings)
```

## Stack

TypeScript, Bun (runtime + bun:sqlite), cheerio, yaml. No heavy dependencies.

## Files

```
~/.subscope/config.yml       sources, groups, modes, folders
~/.subscope/subscope.db      SQLite feed cache
~/.subscope/auth.yml         X auth_token + academic cookies
~/.subscope/seen.json        read tracking for NEW badges
```

## License

MIT
