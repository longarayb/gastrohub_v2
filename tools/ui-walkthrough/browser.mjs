// Browser of the walkthroughs: the installed Edge on Windows; Playwright's Chromium on Linux
// (the project inside WSL, docs/SETUP.md). WALKTHROUGH_BROWSER=chromium|msedge forces one.
// Linux: `npx playwright-core install chromium` once (and the system libraries it asks for).
import { chromium } from 'playwright-core';

const wanted =
  process.env.WALKTHROUGH_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chromium');

/** Options for `chromium.launch`: always headless, one browser, no parallelism. */
export const BROWSER =
  wanted === 'msedge' ? { channel: 'msedge', headless: true } : { headless: true };

// Simulated clock (libfaketime, e.g. to test late at night: docs/SETUP.md). The API, the seed
// and this script follow FAKETIME="<offset>s". The browser starts without libfaketime (it
// would apply only sometimes) and every page gets the same offset on its Date instead
// (timers keep running normally).
const fake = /^([+-]?\d+)s$/.exec(process.env.FAKETIME ?? '');
if (fake) {
  const offsetMs = Number(fake[1]) * 1000;
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (options) => {
    const { LD_PRELOAD: _preload, FAKETIME: _faketime, ...env } = process.env;
    const browser = await launch({ ...options, env });
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions) => {
      const context = await newContext(contextOptions);
      await context.addInitScript((offset) => {
        const RealDate = Date;
        class ShiftedDate extends RealDate {
          constructor(...args) {
            if (args.length === 0) super(RealDate.now() + offset);
            else super(...args);
          }
          static now() {
            return RealDate.now() + offset;
          }
        }
        globalThis.Date = ShiftedDate;
      }, offsetMs);
      return context;
    };
    return browser;
  };
}
