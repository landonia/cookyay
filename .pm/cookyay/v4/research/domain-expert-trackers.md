# Domain-expert: third-party tracker signatures — Research findings

## Summary

- The existing v3 curated top-20 (`db.ts`) already demonstrates the right multi-signal design: each service carries cookie patterns, requestHosts, and localStorage keys. The v4 gap is breadth (~50 services) and tightening the false-positive surface on generic Google/Meta hostnames [prd.md §3.6, goals.md §Acceptance bar].
- Host-only signals are necessary but not sufficient: `googleapis.com`, `gstatic.com`, and `doubleclick.net` are shared infrastructure across many unrelated Google products; disambiguating requires combining host with cookie name or script URL path [prd.md §3.6].
- Category ambiguity is real for ~8 services in the target set; the defensible rule under Cookyay's strictest-everywhere posture [prd.md §3.3] is always to round up to the more privacy-invasive category when in doubt.
- The OCD (439 services, Apache-2.0) already covers cookie-name lookup; the v4 value-add is the ~30 additional curated services that need request-host signals the OCD lacks [goals.md §What's new in v4].

---

## Findings

**1. Multi-signal matching is required for the Google ecosystem [prd.md §3.6]**

`googletagmanager.com` loads GA4, Google Ads, Floodlight, and arbitrary custom tags. A host match alone resolves to GTM, not the specific product. The correct approach — already applied in `db.ts` lines 71–111 — is to let the GA4/UA/GTM entries share the GTM host while disambiguating by cookie name: `_ga` / `_ga_*` → GA4; `_gid`, `__utma` → UA. For Google Ads specifically, the cookie `_gcl_au` (conversion linker) and the host `googleadservices.com` / `googlesyndication.com` uniquely identify ad network activity and are currently absent from the curated set. `doubleclick.net` is used for both Display & Video 360 (marketing) and Google Analytics data collection; cookie `IDE` on `.doubleclick.net` → Display/DV360 marketing. Always prefer cookie-name signal over host-only for the Google estate.

**2. `googleapis.com` and `gstatic.com` must be excluded from requestHosts [prd.md §3.6]**

These domains serve fonts, Maps JS API, reCAPTCHA, Firebase, and dozens of unrelated SDKs. A host match would trigger false positives on every site using Google Fonts. The correct signal for Google Maps is the specific script path `maps.googleapis.com` (subdomain-level) plus the cookie `NID` (Google's cross-product preference cookie, `medium` confidence only). For Google Fonts specifically there are no cookies set; it is functional/necessary and should not appear as a tracker at all unless combined with other Google signals on the same page.

**3. YouTube: embed iframe vs full YouTube visit [goals.md §Acceptance bar, prd.md §3.3]**

`youtube.com` and `youtube-nocookie.com` are already in the curated set (category: `marketing`). The `marketing` default is correct under [prd.md §3.3] — `youtube-nocookie.com` reduces but does not eliminate tracking (the `VISITOR_INFO1_LIVE` cookie still fires on play). The `YSC` session cookie on `youtube-nocookie.com` iframes sets no persistent cross-site identifier, so it alone would be `functional`; however because `VISITOR_INFO1_LIVE` and `PREF` also load, `marketing` is the safe default. Do not split `youtube-nocookie.com` into a separate functional-category entry.

**4. reCAPTCHA category must be `functional`, not `necessary` [prd.md §3.3]**

reCAPTCHA v2/v3 loads `www.google.com/recaptcha/` and sets a `_GRECAPTCHA` cookie (session) plus `NID`. It is third-party, could be replaced, and sets cross-site identifiers — it therefore cannot be `necessary` under a strict GDPR reading (Art. 5(1)(b) purpose limitation). Category `functional` is the defensible default: the form literally does not work without it, but consent is still required [prd.md §3.3]. This is currently absent from the curated set and is a gap for any site using reCAPTCHA.

**5. GTM/GA4/Google Ads overlap creates duplicate hits [prd.md §3.6]**

A site running GTM+GA4 will trigger three curated entries: `ga4` (cookie `_ga`), `ua` (cookie `_ga`), and `gtm` (host `googletagmanager.com`). All three share the `_ga` cookie. The classifier's first-match-wins logic (line 340 in `db.ts`) correctly deduplicates the cookie to `ga4` (listed first), but the host match still independently produces a `gtm` result in `requestMap`. This is correct behavior — GTM as a loader deserves its own declaration because blocking it blocks all tags. Emit both.

**6. Confidence semantics should encode signal strength, not source alone [prd.md §3.6]**

Current semantics: `high` = curated source; `medium` = OCD or any host match; `low` = heuristic. This is sensible but misleading in one case: a host-only match on `analytics.tiktok.com` with no accompanying cookie is listed as `medium` (curated source + host match) but is actually less certain than `_fbp` cookie (globally unique to Meta). Proposed refinement: `high` = two independent signals agree (e.g. cookie + host both match the same service); `medium` = single unambiguous signal (e.g. `_hjid` cookie, or `static.hotjar.com` host — both are vendor-unique); `low` = single generic/shared signal (e.g. `PREF` cookie which appears on YouTube, Google Search, and Maps). The current implementation only needs a small adjustment: after classifying by cookie, cross-check the page's requestHosts; if the matched service's requestHosts also fired on the same page, upgrade to `high`.

**7. The ~50-service target: 30 additions needed beyond the current curated 20 [goals.md §What's new in v4]**

See Recommendations for the full list. High-value gaps: Google Ads (`_gcl_au`, `googleadservices.com`), reCAPTCHA (`_GRECAPTCHA`, `www.google.com/recaptcha`), Snapchat Pixel (`_scid`, `sc-analytics.appspot.com`), Pinterest Tag (`_pinterest_ct_ua`, `ct.pinterest.com`), Cloudflare Turnstile (functional; `challenges.cloudflare.com`), Sentry (`__sentry_*`, `o*.ingest.sentry.io`), Stripe (`__stripe_mid`, `js.stripe.com`), Plausible Analytics (`plausible.io/api/event`), Fathom (`usefathom.com`), PostHog (`ph_*`, `app.posthog.com`), FullStory (`fs_uid`, `fullstory.com`), Heap Analytics (`_hp2_*`, `cdn.heapanalytics.com`), Klaviyo (`__kla_id`, `static.klaviyo.com`), Mailchimp (`_mc_`, `chimpstatic.com`), ActiveCampaign (`ac_enable_tracking`, `trackcmp.net`), Braze (`ab.*`, `sdk.iad-01.braze.com`), Optimizely (`optimizelyBuckets`, `cdn.optimizely.com`), VWO (`_vwo_*`, `dev.visualwebsiteoptimizer.com`), Lucky Orange (`_lo_uid`, `d.luckyorange.com`), Crazy Egg (`_ceir`, `script.crazyegg.com`), Mouseflow (`_mf_*`, `cdn.mouseflow.com`), Freshdesk/Freshchat (`_fc_*`, `wchat.freshchat.com`), Tidio (`tidio_*`, `widget.tidio.com`), Olark (`hb_xid`, `static.olark.com`), Podium (`podium_*`, `api.podium.com`), Trustpilot widget (`trustpilot.com`), Google Optimize (sunset but still encountered; `_gaexp`, `optimize.google.com`), Quora Pixel (`_qca`, `q.quora.com`), Reddit Pixel (`rdt_uuid`, `alb.reddit.com`).

**8. Signature drift: vendor hostnames change slowly; cookie names change rarely [prd.md §7]**

Cookie names are the most stable signal — `_ga` has not changed in 10 years; `_fbp` since 2018. Script URL paths are the least stable (CDN URLs rotate, vendors add version suffixes). Recommendation: prefer suffix-wildcard host matching (`host.endsWith('.amplitude.com')`) over exact paths. The current `findServiceByHost` exact+subdomain approach (`db.ts` lines 362–373) is already correct. For the OCD refresh cadence: the ingest script (`scripts/ingest-ocd.mjs`) deletes `.ocd-cache.csv` to force a fresh pull — document a quarterly refresh cadence in `CONTRIBUTING.md`.

**9. OCD licensing is safe; Disconnect and EasyPrivacy are not [prd.md §5]**

The Open Cookie Database (Apache-2.0) is license-compatible. EasyPrivacy / EasyList are GPL; Ghostery/Disconnect lists are variously CC-BY-NC or proprietary. Do not ingest those lists. The `whotracks.me` dataset (MIT) is an alternative source for request-host → vendor mappings and is Apache-2.0-compatible. For v4, the curated hand-written supplement is sufficient; flag `whotracks.me` as a future Apache-2.0-safe host-pattern source [prd.md §5].

---

## Gotchas

- **`t.co` in requestHosts for Twitter Pixel** (db.ts line 253): `t.co` is Twitter's URL shortener and fires on every tweet link share — not just ads. This will produce false marketing positives on editorial sites that embed tweets. Remove `t.co`; keep only `static.ads-twitter.com` and `analytics.twitter.com`.
- **`facebook.com` in requestHosts for Meta Pixel** (db.ts line 122): `facebook.com` is too broad — social login, Like buttons, and share widgets all call `facebook.com` without the Pixel. Narrow to `connect.facebook.net` (the Pixel script host) and `facebook.com/tr` (the Pixel beacon path, but path-matching is not currently supported).
- **`mp_` wildcard** for Mixpanel (db.ts line 241): `mp_` is short enough to collide with unrelated first-party cookies. Always require a requestHosts hit on `api.mixpanel.com` before escalating confidence.
- **Vimeo `player` cookie** (db.ts line 279): the name `player` is extremely generic and will false-positive on any site using an embedded audio/video player that sets its own `player` cookie. Use only `vuid` as the Vimeo cookie signal.
- **Intercom wildcard prefix `intercom-id-`** matches correctly but varies by workspace ID suffix — any length suffix is fine. The existing wildcard pattern is correct.

---

## Recommendations

1. **Add ~30 curated services** to reach the ~50 target (see Finding 7 list above). Priority order: Google Ads, reCAPTCHA, Snapchat Pixel, Pinterest Tag, Stripe, Sentry, PostHog, FullStory, Heap, Klaviyo.
2. **Tighten Meta Pixel requestHosts**: remove `facebook.com`; keep `connect.facebook.net` only (and add path-prefix comment for `facebook.com/tr` as a future enhancement when path matching is added).
3. **Remove `t.co`** from Twitter Pixel requestHosts.
4. **Remove `player`** from Vimeo cookies; keep only `vuid`.
5. **Add confidence upgrade logic**: after cookie classification, cross-check if the same page also fired a requestHost from the matched service — if yes, upgrade to `high`. One additional lookup in `classifier.ts` `classify()` after the cookie loop, checking `page.requests` against the matched service's `requestHosts`.
6. **Add `_gcl_au` + `googleadservices.com` as a new `google-ads` curated entry** (category: `marketing`). This is the single highest-value gap in the current set for sites running Google Ads alongside GA4.
7. **Add reCAPTCHA** as a curated functional entry: cookie `_GRECAPTCHA`, requestHost `www.google.com` (subdomain `www` is narrow enough to not false-positive on fonts/maps).
8. **Document quarterly OCD refresh** in `CONTRIBUTING.md` — run `node scripts/ingest-ocd.mjs` after deleting `.ocd-cache.csv`.
9. **Add a `whotracks.me` ingest note** as a future Apache-2.0-compatible source for request-host → vendor mappings [prd.md §5, §7].

---

## Open questions for the user

1. **Google Ads vs GA4 co-emission**: when a site runs both, the scanner will emit two block rules targeting `googletagmanager.com`. Should the emitter deduplicate to a single GTM block rule and note both services as the reason, or emit one rule per service (cleaner attribution, duplicate host)?
2. **reCAPTCHA consent UX**: classifying reCAPTCHA as `functional` means form submission is blocked until consent — is the acceptable UX to show the banner before the user can submit a contact form? Confirm this is the intended trade-off under [prd.md §3.3] before adding this entry.
3. **Path-level matching**: several services (Meta Pixel beacon `facebook.com/tr`, Google reCAPTCHA `www.google.com/recaptcha/`) require matching on URL path, not just hostname. Should `ServiceDefinition` grow a `requestPaths` array in v4 or defer to v5?
4. **Self-hosted / privacy-friendly analytics** (Plausible, Fathom, Umami): these tools are often self-hosted on first-party domains, making request-host matching useless. Should the scanner surface a `low` confidence hit when it detects the Plausible/Fathom script served from the site's own origin (detectable via script path pattern `/js/plausible.js`, `/script.js?src=`)?

---

## Out of scope

- Runtime banner auto-block (deferred to v5+ per [goals.md §What's deferred to later versions]).
- IAB TCF / Global Vendor List integration — architectural mismatch with Cookyay's zero-infra posture [prd.md §4].
- Growing the signature database beyond ~50 services in v4 [goals.md §What's deferred to later versions].
- Geo-targeted category overrides (e.g. YouTube as `functional` in some jurisdictions) [prd.md §4].
- Server-side request log analysis — scanner is client-side Playwright only [prd.md §3.6].

## Update — 2026-06-10 (user resolutions)

- **Q1 (GTM co-emission) → DEDUPE BY HOST.** When GA4 + Google Ads (or any
  services) collide on one host (e.g. `googletagmanager.com`), emit a single
  block rule for that host that lists all services justifying it. Cleaner config
  over per-service attribution.
- **Q2 (reCAPTCHA) → INCLUDE AS `functional`.** Accept that forms gated behind
  reCAPTCHA are blocked until consent — consistent with the strictest-everywhere
  posture [prd.md §3.3]. The consent-before-submit UX is the site owner's to
  message; the comparison/docs page should call this trade-off out.
- **Q3 (path-level matching) → YES, add `requestPaths` in v4.** Needed for Meta
  Pixel beacon (`facebook.com/tr`) and reCAPTCHA (`www.google.com/recaptcha/`).
  Also resolves the narrowing fixes (bare `facebook.com` → `connect.facebook.net`
  + path).
- **Q4 (self-hosted privacy analytics, Plausible/Fathom/Umami)** — not decided;
  treat as a nice-to-have `low`-confidence script-path heuristic, in-scope only if
  it falls out cheaply. Planner can mark optional.
