# subscope

A super subscription that merges multiple first-hand sources into one terminal feed. No secondhand info. All direct, all in one.

## What it does

First-hand information from official sources only — no intermediaries, no aggregators, no SEO-polluted search results. Five dimensions: AI companies, central banks & financial regulators, global official media, energy agencies, and international organizations.

71 sources across 6 groups: AI (Anthropic, Claude, OpenAI, Google AI, NVIDIA, DeepMind, DeepSeek, xAI), economics (Fed, ECB, PBOC, BOJ, BOE, NBS, BLS, BEA, SEC, Treasury, IMF, CSRC, MOF, SAFE, NFRA, CFPB), global news (BBC, France24, DW, NHK, Al Jazeera, Reuters, TASS, Yonhap, AP, ABC Australia, CBC, CCTV, Xinhua, People's Daily, Focus Taiwan, The Hindu, Anadolu Agency, CNA), energy (IEA, EIA, DOE, OPEC, IRENA), international orgs (UN, WHO, IAEA, WTO, World Bank), regulation (EU Commission, FTC, FCC). All sources hardcoded in `src/sources.ts`.

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
subscope fetch               # pull all sources (68 sources, ~3s)
subscope                     # interactive browser with search
```

## Usage

```
subscope                     # browse items (up/down, enter to open, / to search, g for PDF)
subscope ai                  # AI company websites (default mode)
subscope quick               # social media only (X + YouTube)
subscope eco                 # economics & finance (16 sources)
subscope glob                # global news (18 sources)
subscope -g energy           # energy sources (5 sources)
subscope -g reg              # regulation (EU Commission, FTC, FCC)
subscope --all               # no time filter
subscope -n 10               # latest 10
subscope -g ai/anthropic     # filter by group
subscope glob -j 20          # JSON output for LLM piping (latest 20)
```

Background monitoring:

```
subscope watch               # foreground, fetch every 10 minutes
subscope watch 5             # every 5 minutes
subscope watch-install       # Windows scheduled task, desktop notifications
subscope watch-uninstall     # remove scheduled task
```

Article reader and JSON output (pipe-friendly for LLMs):

```
subscope read <url>          # extract clean article text from any source
subscope read <url> | llm    # pipe to LLM for analysis
subscope glob -j 20 | llm   # feed latest 20 news items as JSON to LLM
```

Server daemon (auto-started on first fetch):

```
subscope serve               # start localhost daemon (keeps connections warm)
subscope serve status        # check if running
subscope serve stop          # stop daemon
```

Management:

```
subscope config              # interactive TUI (toggle groups/sources on/off)
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
Source (hardcoded registry) --> Adapter (fetch + parse) --> Store (SQLite) --> Render (TUI)
                                     ^                          ^
                                     |                          |
                              Serve daemon (warm pool)    CLI or daemon
```

Site-specific adapters: Anthropic (Sanity CMS GROQ API), Claude blog (HTML), Claude support (Intercom), DeepSeek (changelog HTML), xAI (news page), PBOC (HTML scrape), NBS (RSS + HTML), BLS (RSS indicator parser), BEA (HTML scrape), SEC EDGAR (JSON API via cffi), US Treasury (HTML scrape), IMF (cffi with Safari TLS), CSRC (UCAP JSON API), MOF (HTML scrape), SAFE (HTML scrape), NFRA (JSON API), BOE (RSS via cffi), CCTV (JSONP API), NHK (JSON API), Reuters (HTML via cffi, Datadome bypass), OPEC (HTML via curl), IRENA (HTML via cffi), TASS (HTML via cffi), World Bank (JSON API via cffi), EU Commission (JSON API), FTC (RSS), FCC (HTML via cffi, Akamai bypass).

Generic adapters: RSS/Atom feeds (auto-detect XML), HTML scraping (link extraction), YouTube (ytInitialData JSON), X/Twitter (Guest Token + GraphQL API), GitHub (Atom release feeds).

X/Twitter uses public guest tokens and GraphQL endpoints — same as the web app. Thread merging via conversation_id. No auth needed, no Playwright, no paid API.

`subscope fetch` auto-starts a background daemon (`subscope serve`) that keeps DNS/TLS/connection pools warm. Subsequent fetches proxy through the daemon via SSE streaming with unlimited concurrency. Cold fallback: 12 concurrent workers. Each source streams to terminal as it completes with per-source timing. Failed sources retried up to 3 times. Individual failures don't block others.

## Groups

Path-based hierarchy. `subscope -g ai` matches all `ai/*` children.

```
ai/
  anthropic   (blog, research, engineering, youtube, x)
  claude      (blog, support x2, youtube, x)
  openai      (news rss, youtube, x)
  google      (Google AI Blog rss)
  nvidia      (NVIDIA News rss)
  deepmind    (blog rss, youtube, x)
  deepseek    (changelog, github, x)
  xai         (news, x)
econ/
  fed         (Federal Reserve FOMC statements, monetary policy)
  ecb         (European Central Bank press releases, speeches)
  pboc        (中国人民银行 news, financial data reports)
  boj         (Bank of Japan policy, statements)
  boe         (Bank of England news, monetary policy, RSS via cffi)
  nbs         (国家统计局 CPI, GDP, PMI data releases)
  bls         (Bureau of Labor Statistics CPI, unemployment, payrolls)
  bea         (Bureau of Economic Analysis GDP, personal income, trade)
  sec         (SEC EDGAR 8-K company filings)
  treasury    (US Treasury sanctions, fiscal policy, debt)
  imf         (IMF global economic assessments, country reports)
  csrc        (证监会 securities regulation, market rules)
  mof         (财政部 fiscal policy, budget, bond issuance)
  safe        (外汇管理局 forex reserves, cross-border capital)
  nfra        (金融监管总局 banking/insurance regulation)
  cfpb        (Consumer Financial Protection Bureau rss)
news/
  bbc, france24, dw, nhk, aljazeera, reuters, tass, yonhap, abc-au, cbc
  ap, focustw, thehindu, aa (Anadolu Agency), cna (Channel NewsAsia)
  cctv (world + china), xinhua (world + china), people
energy/
  iea         (HTML scrape)
  eia         (RSS via cffi)
  doe         (energy.gov newsroom, generic adapter)
  opec        (HTML via curl, Cloudflare bypass)
  irena       (HTML via cffi, Azure WAF bypass)
intl/
  un, who, iaea
  wto         (news via JS data file, not RSS)
  worldbank   (World Bank news, JSON API via cffi)
reg/
  eu          (EU Commission press releases, JSON API)
  ftc         (FTC press releases, RSS)
  fcc         (FCC headlines, cffi for Akamai bypass)
```

## Stack

TypeScript, Bun (runtime + bun:sqlite), cheerio, yaml. Playwright as optional fallback for anti-bot sites.

## Files

```
~/.subscope/config.yml       sources, groups, modes, folders
~/.subscope/subscope.db      SQLite feed cache
~/.subscope/auth.yml         X auth_token + academic cookies
~/.subscope/seen.json        read tracking for NEW badges
~/.subscope/x-uid-cache.json X/Twitter user ID cache
~/.subscope/serve.json       daemon port/PID (auto-managed)
```

## License

MIT
