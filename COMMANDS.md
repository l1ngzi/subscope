# Command reference

## Reading

```
subscope                          default view (formal mode, last 14 days)
subscope quick                    X + YouTube only
subscope formal                   blogs, docs, support only
subscope --all / -a               no time filter
subscope -n <count>               limit to N items
subscope -g <group>               filter by group (supports prefix: -g ai)
subscope --type <type>            filter by source type (website/youtube/twitter)
```

Modes and flags combine: `subscope quick -n 5 -g ai/claude`.

When output fits one page, prints directly. When it overflows, enters interactive pager: left/right arrows to paginate, q to quit.

## Fetching

```
subscope fetch                    pull all sources concurrently
```

All sources fetch in parallel. Errors are printed per-source, never block other sources.

## Sources

```
subscope add <url>                add a source (auto-detects type and group)
subscope add <url> -g <group>     add to a specific group
subscope rm <id|url>              remove a source
subscope ls                       list all sources
subscope on <id>                  activate a source
subscope off <id>                 deactivate a source
```

Source IDs are the first 8 chars of the URL's SHA-256 hash.

## Groups

```
subscope group                    list all groups as tree
subscope group <path>             list sources in a group (prefix match)
subscope group <path> on          activate group and all children
subscope group <path> off         deactivate group and all children
subscope group <path> add <id>    move a source into a group
```

Groups are path-based: `ai/anthropic`, `ai/claude`. Operating on `ai` affects all `ai/*` children.

## Modes

```
subscope mode                     list modes with default indicator
subscope mode <name>              set default mode
```

Built-in modes:
- `formal` — source type `website` (blogs, docs, changelogs, support)
- `quick` — source types `youtube`, `twitter`

Custom modes can be added in the YAML config.

## Auth

```
subscope auth x                   show instructions for X auth setup
subscope auth x <token>           save X auth_token cookie
```

X/Twitter requires an auth_token cookie for the GraphQL API. Without it, X sources will fail.

## Interactive config

```
subscope config                   open TUI configuration
```

### Folder mode (default)

| Key | Action |
|-----|--------|
| up/down | navigate |
| space | toggle on/off |
| right | drill into folder |
| left | go back |
| s | enter source management |
| n | new folder |
| e | rename folder |
| d | delete empty folder |
| q | save and quit |

### Source mode (press s)

| Key | Action |
|-----|--------|
| up/down | navigate |
| space | toggle source on/off |
| a | add source from catalog |
| e | edit source name |
| d | delete source |
| q | back to folder mode |

### Add source (press a in source mode)

Type to search the catalog. Up/down to select. Enter to add. For template sources (YouTube, X, GitHub), you'll be prompted for a handle.

Pre-defined sources are filtered out once added.

## Files

```
~/.subscope/config.yml            sources, groups, modes, active states
~/.subscope/subscope.db           SQLite feed item cache
~/.subscope/auth.yml              X auth_token (gitignored)
```
