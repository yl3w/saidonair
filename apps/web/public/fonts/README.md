# Fonts

Self-hosted, never a font CDN: a Google Fonts stylesheet would tell a third party when each reader
sat down to read, and this product makes no such request (`docs/PRD.md` §1, `docs/design.md` §2.2).

| File | Family | Axes | Subset |
|---|---|---|---|
| `ibm-plex-sans-latin.woff2` | IBM Plex Sans | `wght` variable; declared at 400 and 600 | latin |
| `source-serif-4-latin.woff2` | Source Serif 4 | `opsz` 8–60, `wght` 200–900 variable | latin |

Both are the `latin` subset Google Fonts serves (v23 and v14 respectively), taken once and
committed; nothing fetches them again. Both are SIL Open Font License 1.1 — the licence files sit
beside them and travel with the fonts wherever the build goes.

The `@font-face` rules that load them are in `apps/web/src/styles.css`, the one stylesheet.
Refreshing a face means replacing the file here and checking the rendered column at both sizes; a
face that is never updated quietly diverges from the foundry's.
