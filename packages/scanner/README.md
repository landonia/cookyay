# @cookyay/scanner

CLI cookie scanner for [Cookyay](https://cookyay.com/) — crawls your site with a headless
Chromium browser, detects cookies and third-party requests, classifies known services, and
emits ready-to-use config JSON with copy-paste blocking snippets.

[![npm version](https://img.shields.io/npm/v/@cookyay/scanner)](https://www.npmjs.com/package/@cookyay/scanner)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../LICENSE)

> **Not legal advice.** This tool helps you discover what third-party scripts and cookies
> are present on your site. Whether your specific deployment is compliant with GDPR, CCPA,
> or other regulations is a legal question outside the scope of this tool.

---

## Install

```bash
# Run without installing (recommended for one-off scans):
npx @cookyay/scanner scan https://yoursite.com --config-out cookyay.config.json

# Or install globally:
npm install -g @cookyay/scanner
cookyay-scan scan https://yoursite.com --config-out cookyay.config.json
```

**First run:** No separate browser-install step required. On a machine that has never run
Playwright, the scanner automatically downloads the Chromium headless shell (~150 MB, one
time) before the crawl starts. You will see
`Chromium not found — downloading (~150MB, one time)...` in the terminal. Subsequent runs
reuse the downloaded binary. If the automatic download fails (offline or locked-down
network), the scanner surfaces a clear error and the manual fallback:
`npx playwright install chromium`.

---

## Auto-detection workflow

The scanner auto-detects ~50 known third-party services (Google Analytics, Meta Pixel,
YouTube, reCAPTCHA, Hotjar, Intercom, Stripe, Sentry, and more) by matching observed
cookies, request hosts, and script URLs against a curated signature database. For each
detected service it emits a ready-to-paste HTML snippet in `suggestedBlocking[]` — you
copy that snippet into your HTML to let the Cookyay banner hold it inert until the visitor
consents.

> **v4 boundary:** Auto-detection and suggested markup are scanner-side only. The Cookyay
> banner blocks only what is declared in your page's HTML using
> `type="text/plain" data-category="..."` — there is no runtime auto-block where the
> banner intercepts unknown scripts automatically. That is deferred to v5.

### Step 1 — Scan

```bash
npx @cookyay/scanner scan https://yoursite.com --config-out cookyay.config.json
```

The scanner crawls your site, records all cookies, localStorage keys, third-party
requests, scripts, and iframes, then classifies them against the signature database.

### Step 2 — Review `suggestedBlocking[]`

Open the emitted `cookyay.config.json`. The `suggestedBlocking` array lists every
detected third-party host with a copy-paste snippet:

```json
{
  "policyVersion": "REPLACE_ME",
  "categories": {
    "analytics": {
      "label": "Analytics",
      "services": [
        {
          "name": "Google Analytics 4",
          "cookies": ["_ga", "_gid"],
          "_meta": {
            "confidence": "high",
            "matchedBy": "cookie",
            "serviceId": "ga4",
            "pages": ["https://yoursite.com/"]
          }
        }
      ]
    }
  },
  "suggestedBlocking": [
    {
      "host": "googletagmanager.com",
      "services": ["ga4", "gtm"],
      "category": "analytics",
      "confidence": "high",
      "snippet": "<script type=\"text/plain\" data-category=\"analytics\" src=\"https://www.googletagmanager.com/gtag/js\"></script>"
    },
    {
      "host": "static.hotjar.com",
      "services": ["hotjar"],
      "category": "analytics",
      "confidence": "high",
      "snippet": "<script type=\"text/plain\" data-category=\"analytics\" src=\"https://static.hotjar.com/c/hotjar-\"></script>"
    }
  ],
  "_unclassified": [],
  "_noscriptWarnings": []
}
```

Each `suggestedBlocking` entry has:

| Field        | Description                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`       | The blocking host. When multiple services share a host (e.g. GA4 + Google Ads both load via `googletagmanager.com`), they are merged into one entry. |
| `services`   | All service IDs whose traffic traverses this host.                                                                                                   |
| `category`   | Cookyay category (`functional`, `analytics`, or `marketing`). When services sharing a host disagree, the more privacy-invasive category is used.     |
| `confidence` | `high`, `medium`, or `low` — see [Confidence levels](#confidence-levels) below.                                                                      |
| `snippet`    | The verbatim HTML to paste into your page.                                                                                                           |

### Step 3 — Paste snippets

For each entry in `suggestedBlocking`, copy the `snippet` value verbatim into your HTML
**before** the real script or iframe loads. The banner's blocking engine reads the
`type="text/plain"` / `data-src` attributes at init time and holds the element inert until
the visitor consents to the declared category.

**Script example** (add before your GTM container snippet):

```html
<!-- Declare BEFORE the real GTM snippet -->
<script
  type="text/plain"
  data-category="analytics"
  src="https://www.googletagmanager.com/gtag/js"
></script>

<!-- Your actual GTM snippet follows below -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXX"></script>
```

**Iframe example** (replace `src` with `data-src`):

```html
<!-- YouTube embed — blocked until marketing consent -->
<iframe
  data-src="https://www.youtube-nocookie.com/embed/VIDEO_ID"
  data-category="marketing"
  width="560"
  height="315"
  title="YouTube video"
  allowfullscreen
></iframe>
```

After pasting the snippets and initialising Cookyay with the emitted config, your site
blocks those third parties until the visitor consents — no further HTML changes needed.

---

## Confidence levels

The scanner assigns a confidence level to each detected service. Use this to prioritise
your review:

| Level    | Meaning                                                                                                                              | Example                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `high`   | Two independent signals agree: both a cookie name and a request host matched the same service. Strong evidence — act on these first. | `_ga` cookie observed **and** `google-analytics.com` request seen on the same page.                     |
| `medium` | One unambiguous signal: either a vendor-unique cookie name or a vendor-specific host, but not both independently confirming.         | `_hjid` cookie seen (Hotjar-specific), or `static.hotjar.com` request seen without the matching cookie. |
| `low`    | Single generic or shared signal: a cookie name or host that could plausibly match multiple services.                                 | `PREF` cookie (shared across Google Search, YouTube, Maps) or a heuristic script-path match.            |

You should act on `high` and `medium` confidence entries. For `low` confidence entries,
review the `_meta.matchedBy` field and the page list to decide whether the detection is
accurate before adding the blocking snippet.

---

## reCAPTCHA and form-gating trade-off

reCAPTCHA v2/v3 is classified as **`functional`** in the Cookyay signature database.
This is the defensible default under a strict GDPR reading:

- reCAPTCHA is a third-party service (`www.google.com/recaptcha/`) that sets the
  `_GRECAPTCHA` session cookie and `NID` cross-site identifier.
- It cannot be classified as `necessary` because it is not strictly required for the
  site to function — alternative CAPTCHA solutions exist, and the cross-site identifiers
  fall outside the "strictly necessary" exemption under Art. 5(1)(b) of the GDPR.
- Classifying it `functional` means **forms protected by reCAPTCHA are gated until the
  visitor consents to functional cookies**. Visitors who decline functional cookies will
  not be able to submit forms that use reCAPTCHA.

This trade-off is consistent with Cookyay's strictest-everywhere posture
[prd.md §3.3] and is the correct choice for most sites with EU/CCPA traffic.

**If you accept the legal risk** and want forms to be usable without functional consent,
you can reclassify reCAPTCHA as `necessary` in your config by overriding the emitted
category. This is a conscious deviation from the default and should be reviewed with
qualified legal counsel:

```json
{
  "categories": {
    "necessary": {
      "services": [{ "name": "reCAPTCHA", "cookies": ["_GRECAPTCHA"] }]
    }
  }
}
```

> **Note:** This is guidance, not legal advice. Consult qualified legal counsel before
> reclassifying third-party cookies as necessary.

---

## Output format (full)

The emitted JSON has these top-level fields:

| Field               | Description                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `policyVersion`     | Replace `"REPLACE_ME"` with an ISO date string (e.g. `"2026-01-01"`). Bump it whenever your cookie usage changes materially — this triggers re-consent for returning visitors. |
| `categories`        | Per-category service lists. Pass this directly to `Cookyay.init()` after removing `_meta` fields from each service (or use the scanner's `toCookyayConfig` helper).            |
| `suggestedBlocking` | Host-deduped blocking rules with paste-ready snippets. See [Auto-detection workflow](#auto-detection-workflow).                                                                |
| `_unclassified`     | Artifacts detected but not matched to any known service. Review manually and assign to the appropriate category.                                                               |
| `_noscriptWarnings` | `<noscript>` fallback tags detected. These bypass script blocking — remove them from your markup.                                                                              |
| `_scanMeta`         | Scan metadata: timestamp, target URL, pages visited, classifier version.                                                                                                       |

---

## CLI options

```
npx @cookyay/scanner [scan] <url> [options]

Arguments:
  url                 The URL to scan (required)

Options:
  --config-out <file> Write the emitted config JSON to this file (default: stdout)
  --raw-out <file>    Write the raw scan findings (before classification) to this file
  --depth <n>         Maximum crawl depth (default: 1 — home page only)
  --help, -h          Show this help
```

The `scan` subcommand is optional — `npx @cookyay/scanner https://yoursite.com` works
the same way.

---

## Known-services database

The scanner ships a curated database of ~50 known third-party services with multi-signal
signatures (cookie names, request hosts, script URL patterns). It also includes the Open
Cookie Database (Apache-2.0, 1,100+ entries) for broader cookie-name coverage.

Services in the curated database include: Google Analytics 4, Google Ads, Google Tag
Manager, reCAPTCHA, YouTube, Meta Pixel, Twitter/X Pixel, Snapchat Pixel, Pinterest Tag,
LinkedIn Insight, TikTok Pixel, Hotjar, Intercom, HubSpot, Stripe, Sentry, PostHog,
FullStory, Heap Analytics, Plausible Analytics, Fathom Analytics, Klaviyo, Mailchimp,
ActiveCampaign, Cloudflare Turnstile, Vimeo, and more.

The database is a contributable YAML file at `packages/scanner/data/services.yaml`.
See [CONTRIBUTING.md](../../CONTRIBUTING.md) (when available) for how to add a service.

---

## License

Apache-2.0 — see [LICENSE](../../LICENSE).
