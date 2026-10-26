// Local, isolated mock-account browser for test/browser/*.py CDP checks.
// Start the development server first (default APP_URL is localhost:5205).
import { chromium } from '@playwright/test';
import { newSession } from './audit-browser-session-2026-10-25.mjs';

const port = Number(process.env.AUDIT_CDP_PORT ?? 9333);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid AUDIT_CDP_PORT.');
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] });
try {
  await newSession(browser);
  console.log(`Audit browser ready on 127.0.0.1:${port}`);
  await new Promise(resolve => {
    process.once('SIGINT', resolve);
    process.once('SIGTERM', resolve);
    browser.once('disconnected', resolve);
  });
} finally {
  await browser.close();
}
