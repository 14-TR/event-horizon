// Opt-in local production verification on the real Apple GPU; no CI/dependency changes.
import base from '../playwright.config.js';
export default {
  ...base,
  testDir: './browser',
  workers: 1,
  timeout: 60000,
  use: {
    ...base.use,
    channel: 'chromium',
    launchOptions: { args: ['--use-angle=metal'] },
  },
};
