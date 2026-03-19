# subscope

First-hand intelligence from 74 official sources in one terminal. AI companies, central banks, financial regulators, global news, energy agencies, international organizations — no intermediaries, no aggregators.

## Install

### 1. Bun (runtime)

subscope runs on [Bun](https://bun.sh)

```bash
# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"

# macOS / Linux
curl -fsSL https://bun.sh/install | bash
```

### 2. Python + curl_cffi (anti-bot bypass)

About 15 sources (SEC, IMF, Reuters, TASS, BOE, EIA, IRENA, OECD, World Bank, FCC, etc.) need TLS fingerprint impersonation to bypass anti-bot systems. Without this they'll fail silently.

```bash
# Install Python 3 if you don't have it
# Windows: https://www.python.org/downloads/ (check "Add to PATH")
# macOS: brew install python
# Linux: sudo apt install python3 python3-pip

pip install curl_cffi
```

### 3. subscope

```bash
npm install -g @zerozia/subscope
```

### 4. Playwright (optional, for article reader fallback)

Only needed if you use `subscope read` on sites with heavy JS rendering (Angular SPAs, etc.). Most sources work without it.

```bash
npm install -g playwright
npx playwright install chromium
```

### 5. Go

```bash
subscope fetch               # pull all 74 sources (~3s)
subscope                     # interactive browser
```

`fetch` pulls all sources. `subscope` opens an interactive browser — arrow keys to navigate, enter to open, `/` to search, `q` to quit.

## Modes

```
subscope                     # default: AI company websites
subscope eco                 # economics & finance (17 sources)
subscope glob                # global news (18 sources)
subscope quick               # social media only (X + YouTube)
subscope -g energy           # filter by group prefix
subscope -g ai/anthropic     # narrow to specific group
```

## Read articles

```
subscope read <url>          # extract clean text from any source
subscope read <url> | llm    # pipe to LLM
subscope glob -j 20 | llm   # feed latest 20 news as JSON to LLM
```

Per-site extractors for every source. Tables rendered as markdown. Multi-layer anti-bot fallback.

## Background fetch

```
subscope fetch               # auto-starts a background daemon for warm connections
subscope watch-install       # Windows scheduled task + desktop notifications
```

`fetch` auto-starts a localhost daemon that keeps DNS/TLS pools warm. Subsequent fetches stream via SSE with unlimited concurrency. Desktop toast when new items arrive.

## Config

```
subscope config              # interactive TUI (toggle groups/sources)
subscope group               # list group tree
subscope mode                # list/set default mode
```

Full command reference: [COMMANDS.md](COMMANDS.md). Architecture and internals: [CLAUDE.md](CLAUDE.md).

## Sources

74 source URLs across 6 groups. Every source is a direct official channel — no third-party rewrites.

```
ai/
  anthropic     blog, research, engineering, youtube, x
  claude        blog, support, release notes, youtube, x
  openai        news rss, youtube, x
  google        Google AI Blog rss
  nvidia        NVIDIA News rss
  deepmind      blog rss, youtube, x
  deepseek      changelog, x
  xai           news, x

econ/
  fed           Federal Reserve monetary policy (RSS)
  ecb           European Central Bank (RSS)
  pboc          中国人民银行 (HTML)
  boj           Bank of Japan (HTML)
  boe           Bank of England (RSS via cffi)
  nbs           国家统计局 CPI/GDP/PMI (RSS + HTML)
  bls           Bureau of Labor Statistics (RSS)
  bea           Bureau of Economic Analysis (HTML)
  sec           SEC EDGAR 8-K filings (JSON API)
  treasury      US Treasury (HTML)
  imf           IMF (cffi, Safari TLS)
  csrc          证监会 (UCAP JSON API)
  mof           财政部 (HTML)
  safe          外汇管理局 (HTML)
  nfra          金融监管总局 (JSON API)
  cfpb          Consumer Financial Protection Bureau (RSS)
  cftc          CFTC (HTML)

news/
  bbc           BBC World (RSS)
  france24      France 24 (RSS)
  dw            Deutsche Welle (RSS)
  nhk           NHK World (JSON API)
  aljazeera     Al Jazeera (RSS)
  reuters       Reuters World (cffi, Datadome bypass)
  tass          TASS (cffi)
  yonhap        Yonhap (RSS)
  ap            AP News (HTML)
  abc-au        ABC Australia (RSS)
  cbc           CBC (RSS)
  focustw       Focus Taiwan (RSS)
  thehindu      The Hindu (RSS)
  aa            Anadolu Agency (RSS)
  cna           Channel NewsAsia (RSS)
  cctv          央视网 world + china (JSONP API)
  xinhua        新华社 world + china (HTML)
  people        人民日报 (HTML)

energy/
  iea           IEA (HTML)
  eia           EIA (RSS via cffi)
  doe           DOE newsroom (generic adapter)
  opec          OPEC (HTML via curl, Cloudflare bypass)
  irena         IRENA (cffi, Azure WAF bypass)

intl/
  un            UN News (RSS)
  who           WHO (RSS)
  iaea          IAEA (HTML)
  wto           WTO (JS data file)
  worldbank     World Bank (JSON API via cffi)
  nato          NATO (JSON search API)
  oecd          OECD (cffi, Chrome120)

reg/
  eu            EU Commission (JSON API)
  ftc           FTC (RSS)
  fcc           FCC (cffi, Akamai bypass)
```

All sources hardcoded in `src/sources.ts`. Each site gets the best possible adapter — Sanity CMS API, GraphQL, JSONP, JSON endpoints, RSS, or HTML scrape — not a generic one.

## License

MIT
