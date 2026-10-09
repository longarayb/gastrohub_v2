// Browser of the walkthroughs: the installed Edge on Windows; Playwright's Chromium on Linux
// (the project inside WSL, docs/SETUP.md). WALKTHROUGH_BROWSER=chromium|msedge forces one.
// Linux: `npx playwright-core install chromium` once (and the system libraries it asks for).
const wanted =
  process.env.WALKTHROUGH_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chromium');

/** Options for `chromium.launch`: always headless, one browser, no parallelism. */
export const BROWSER =
  wanted === 'msedge' ? { channel: 'msedge', headless: true } : { headless: true };
