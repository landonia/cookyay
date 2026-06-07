# Cookyay fixture site

A hermetic static site for E2E tests and scanner integration tests. **No real third-party scripts or external network requests.**

## Quick start

```sh
# From workspace root — build the cookyay package first
pnpm build

# Then serve the fixture site
pnpm fixture:serve
# → http://127.0.0.1:4000/fixtures/index.html
```

## Pages

| Path | Purpose |
|---|---|
| `/fixtures/index.html` | Entry page — links to all test pages |
| `/fixtures/blocking/inline-script.html` | Blocked inline `<script>` |
| `/fixtures/blocking/src-script.html` | Blocked `<script src>` (GA4 + Pixel stubs) |
| `/fixtures/blocking/iframe.html` | Blocked `<iframe>` (YouTube-style embed) |
| `/fixtures/blocking/undeclared.html` | Undeclared category — stays blocked + warns |
| `/fixtures/blocking/all.html` | All blocking cases on one page (primary E2E target) |
| `/fixtures/noscript.html` | Noscript fallback — no Cookyay loaded |

## Synthetic stubs

| File | Mimics | Sets cookies | Fires beacon |
|---|---|---|---|
| `/fixtures/stubs/ga4.js` | GA4 | `_ga`, `_ga_FIXTURE` | `POST /fixtures/stubs/collect` |
| `/fixtures/stubs/pixel.js` | Meta Pixel | `_fbp` | `POST /fixtures/stubs/collect` |
| `/fixtures/stubs/ytplayer.html` | YouTube embed | — | — |

The serve script replies `204` to `POST /fixtures/stubs/collect` — no real beacon leaves the machine.

## Service fingerprints

`fixtures/service-fingerprints.json` — synthetic cookie names and request URL patterns for ~20 common services. Import in both scanner tests and E2E tests to keep them in sync:

```ts
// Node (scanner tests, serve.mjs)
import fingerprints from '../../fixtures/service-fingerprints.json' assert { type: 'json' }

// Playwright E2E test
const fp = JSON.parse(fs.readFileSync('fixtures/service-fingerprints.json', 'utf8'))
```

## Serve script

`fixtures/serve.mjs` — zero-dependency Node ≥20 static server. Serves from the workspace root so both `/fixtures/**` and `/packages/cookyay/dist/**` resolve from the same origin. Also handles the beacon sink at `POST /fixtures/stubs/collect`.

## Playwright integration

Add to `playwright.config.ts`:

```ts
webServer: {
  command: 'pnpm fixture:serve',
  url: 'http://127.0.0.1:4000/fixtures/index.html',
  reuseExistingServer: !process.env.CI,
}
```
