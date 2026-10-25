import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createProductionServer } from './server.js';
import { mkdir } from 'node:fs/promises';

// Missing/failed configuration must not fall back to a guest editor.
const server = await createProductionServer({ env: {} });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await mkdir('output/cloud-testing', { recursive: true });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect(page.locator('#session-status')).toContainText('Sign in is not configured');
  await expect(page.locator('#auth-gate')).toBeHidden();
  await expect(page.locator('#auth-submit')).toBeDisabled();
  assert.equal(await page.locator('#dataset').count(), 0);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.screenshot({ path: 'output/cloud-testing/auth-unavailable.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/cloud-testing/signin-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.route('**/api/config', route => route.fulfill({ status: 503, body: '{}' }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('#auth-submit')).toBeDisabled();
  await expect(page.locator('#session-status')).toContainText('Sign in is not configured');
  await expect(page.locator('#auth-gate')).toBeHidden();
  assert.equal(await page.locator('#dataset').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Session screen: missing configuration, service failure, retry and mobile layout passed.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
