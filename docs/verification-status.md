# Verification status (2026-10-03)

## Evidence identity

- Tested source commit: [`c3122c0b108e76d39e3aac673b58f2ef17f1990a`](https://github.com/Masanori-Spec/packmix/commit/c3122c0b108e76d39e3aac673b58f2ef17f1990a)
- Successful CI run: [Quality checks #37096571750](https://github.com/Masanori-Spec/packmix/actions/runs/37096571750)
- Browser evidence recorded: 2026-10-03T04:27:47.532Z; CI completed successfully at 04:27:51Z
- Downloaded CI artifact ZIP SHA-256: `93da8b0f53bba13ab3d343d65de268282f0401cad5e7d2acdf2b032897166ae9` (matched the GitHub artifact digest); artifact expiration 2026-10-10
- Runner: GitHub Actions `ubuntu-latest`, Node 24, pinned Playwright 1.62.1
- Actual browser version reported: headless Chromium 154.0.8037.0
- Raw result: [browser-results.json](browser-results.json)
- CI screenshots copied unchanged: [desktop](screenshots/desktop.png), [mobile width](screenshots/mobile.png)

The evidence above describes that exact source commit. Documentation/evidence additions made afterward do not change application code. Future code changes still require a new successful run. GitHub artifact retention is limited; the result JSON and two synthetic screenshots are preserved here for inspection.

## Passed

- Node syntax checks and 50 Node tests, including 1,000 fixed-seed randomized comparisons with an independent exhaustive oracle
- Optimizer coverage measured locally: lines/functions 100%, branches 98.99%; draft helper 100%. This is not UI coverage
- Fixture validation and local HTML/document reference checks
- Declared-limit local core benchmark: p95 14.84ms, maximum 16.15ms; DOM/rendering excluded
- Independent read-only review of algorithm, security boundary and UI source
- Review-driven fixes: keyboard focus restoration, long-text/large-total wrapping, labelled file picker, failed browser-launch cleanup, clearing derived need on invalid input, and stable-ID deletion preserving remaining raw edits

### Seventeen browser checks

1. Exact demo prices and purchase quantities
2. Switching cost/surplus plan and restoring selection focus
3. Participant changes and zero-demand inventory edge
4. Invalid input hides all stale results and export; valid input restores them
5. Invalid rows can be removed without losing unrelated draft edits
6. Item/pack addition and deletion bounds
7. Import Cancel, reopen and Escape behavior
8. Cancelling an in-flight file read prevents it replacing the current draft or a reopened dialog
9. Malicious JSON is rejected while retaining the previous plan
10. HTML-shaped labels remain inert text
11. Exported JSON round-trips current values
12. Saved shopping text contains quantities and exclusions
13. Lazy threshold details and inclusive range coverage
14. Ordinary interaction p95 below the 200ms target
15. Narrow-screen controls and no horizontal page overflow
16. Long valid labels and maximum totals fit the narrow viewport
17. No captured page errors or external application requests

## Browser measurement scope

The test used viewport sizes of 1440×1100, 390×844 and 320×740 CSS pixels. These are window-size tests in one headless Chromium instance, not physical desktop/phone testing and not an iPhone, Safari, touch-input or mobile-device emulation certification.

Thirty demo participant-input changes measured synchronous event dispatch, calculation, DOM updates and forced layout: median **2.7ms**, p95 **3.1ms**, maximum **3.3ms**. Paint, human input time and network I/O are excluded. This does not measure worst-case user interactions or promise performance on slower devices.

The complete raw report records no captured page errors and only localhost static-resource requests. The app is client-only, so no application backend was contacted. Hosting-provider page logs remain outside this statement.

The two full-page CI screenshots were visually inspected: the desktop view and 390px-wide view showed the intended columns/stacking and no visible horizontal clipping in those demo states. The viewport height differs from full-page image height because screenshots capture the entire document. This is not a review of every UI state.

## Still not verified

- Physical devices, Safari, Firefox, touch input, or low-powered hardware
- Comprehensive keyboard navigation, 200% text enlargement, contrast audit, or screen-reader workflows
- Print-dialog behavior and printed page layout
- Every possible user-generated content/layout combination or security payload
- Real event-organizer demand, repeat usage, commercial viability or willingness to pay

The original authoring environment refused Chromium's Unix socket and blocked its separate cloud browser from opening the loopback preview. Those restrictions were not bypassed. Browser verification was subsequently performed by the ordinary public-repository CI workflow.

## Reproduce

```sh
npm run check
npm run benchmark
npm install --no-save --ignore-scripts playwright@1.62.1
npx playwright install --with-deps chromium
npm run test:browser
```

The suite creates `artifacts/desktop.png`, `artifacts/mobile.png` and `docs/browser-results.json`. On a future successful run, compare the exact commit, version and measurement scope before updating claims. Automatic tests and visual inspection do not replace the remaining device/accessibility or demand validation.
