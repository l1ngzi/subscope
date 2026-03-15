# subscope

A super subscription that merges multiple sources you add. No secondhand info. All direct, all in one.

## What it does

You follow AI companies across blogs, X, YouTube, support pages, GitHub releases. The information is scattered. subscope pulls it all into one terminal feed, organized by company, filterable by type.

Currently tracks: Anthropic, Claude, OpenAI, DeepMind, DeepSeek, xAI.

Source types: websites (with site-specific adapters), X/Twitter (native GraphQL API), YouTube (channel page scraping), GitHub (Atom release feeds).

## Quick start

```
bun install
bun link
```

Set up X/Twitter access (optional but recommended):

```
subscope auth x <your_auth_token>
```

To get the token: open x.com in your browser, F12, Application, Cookies, copy the `auth_token` value.

Fetch and read:

```
subscope fetch
subscope
```

## How it works

```
subscope                      read (default: last 14 days, formal mode)
subscope quick                social media only (X + YouTube)
subscope formal               official sources only (blogs, docs, support)
subscope --all                everything, no time filter
subscope -n 10                latest 10 items
subscope -g ai/anthropic      filter by group
subscope fetch                pull all sources
subscope config               interactive TUI configuration
```

Full command reference: [COMMANDS.md](COMMANDS.md)

## Architecture

```
Source (config) --> Adapter (fetch + parse) --> Store (SQLite) --> Render (terminal)
```

Each source type has its own adapter. Some sites get a dedicated adapter (Anthropic RSC payload, DeepSeek changelog HTML, Claude support Intercom). Generic fallback handles RSS/Atom feeds and HTML scraping.

X/Twitter uses the internal GraphQL API directly (same endpoints the web app uses). No Playwright, no syndication API, no paid API. Requires your auth_token cookie.

YouTube scrapes the channel page and parses `ytInitialData` JSON. No API key needed.

All sources fetch concurrently. 21 sources in 2 seconds.

## Stack

TypeScript, Bun (runtime + bun:sqlite), cheerio (HTML parsing). Zero heavy dependencies. No Playwright, no Puppeteer, no Python.

## Config

Lives in `~/.subscope/`. YAML config, SQLite database.

Groups are path-based (`ai/anthropic`, `ai/claude`). Modes filter by source type. Everything is manageable through `subscope config` TUI or direct YAML editing.

## License

MIT
