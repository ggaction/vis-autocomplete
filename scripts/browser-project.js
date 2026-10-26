// Inspect the persisted account-scoped project without a manual export control.
import { readFileSync } from 'node:fs';
const readAccountProject = readFileSync(new URL('../test/fixtures/read-account-project.js', import.meta.url), 'utf8');

export async function readSavedProject(page) {
  // Leave hover previews and text inputs before observing committed state,
  // just as opening the former project menu did.
  await page.locator('.app-header h1').click();
  await page.waitForFunction(() => document.querySelector('#cloud-status')?.textContent === 'Saved');
  return page.evaluate(readAccountProject);
}
