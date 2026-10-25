// Isolated, authenticated UI audit fixture. No real account or network writes.
import { chromium } from '@playwright/test';

export async function newSession(browser, { url = process.env.APP_URL ?? 'http://127.0.0.1:5205/', mode = 'transition', viewport = { width: 1800, height: 1200 } } = {}) {
  const context = await browser.newContext({ viewport });
  const projects = new Map(), uploads = new Map(), errors = [], requests = [];
  const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', email: 'audit@example.invalid',
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { vis_view_mode: mode }, identities: [], created_at: new Date().toISOString() };
  const token = ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now()/1000)+86400 })).toString('base64url'), 'audit-only'].join('.');
  let revision = 0, profile = { id: user.id, research_enabled: false, consent_version: 'history-only-v1', consent_revision: 1 };
  await context.route('**/api/config', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    supabaseUrl: 'https://cloud-audit.supabase.co', supabaseKey: 'sb_publishable_audit', release: 'local-audit' }) }));
  await context.route('https://cloud-audit.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url());
    const body = req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : {};
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    requests.push({ method: req.method(), path: u.pathname });
    if (u.pathname === '/auth/v1/token') return json({ access_token: token, refresh_token: 'audit-refresh', expires_in: 86400, token_type: 'bearer', user });
    if (u.pathname === '/auth/v1/user') { if (req.method() === 'PUT' && body.data) user.user_metadata = { ...user.user_metadata, ...body.data }; return json(user); }
    if (u.pathname === '/auth/v1/logout') return json({});
    if (u.pathname === '/rest/v1/profiles') return json([profile]);
    if (u.pathname.endsWith('/rpc/set_research_consent')) { profile = { ...profile, research_enabled: body.enabled, consent_revision: ++revision }; return json(profile); }
    if (u.pathname.endsWith('/rpc/record_interactions')) return json(body.events.length);
    if (u.pathname.endsWith('/rpc/save_project')) {
      const row = projects.get(body.project);
      if ((row?.revision ?? 0) !== body.expected) return json({ code: '40001', message: 'revision_conflict' }, 409);
      projects.set(body.project, { id: body.project, title: body.name, snapshot: body.document, revision: body.expected+1, thumbnail: body.thumbnail, updated_at: new Date().toISOString() });
      return json(body.expected+1);
    }
    if (u.pathname === '/rest/v1/projects') {
      const id = u.searchParams.get('id')?.replace('eq.', '');
      if (req.method() === 'DELETE') { projects.delete(id); return json(null); }
      return json(id ? projects.get(id) : [...projects.values()]);
    }
    if (u.pathname === '/rest/v1/datasets') return json(req.method() === 'POST' ? null : [], req.method() === 'POST' ? 201 : 200);
    if (u.pathname.startsWith('/storage/v1/object/')) {
      const path = u.pathname.replace('/object/authenticated/', '/object/');
      if (req.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: uploads.get(path) });
      const form = await new Response(req.postDataBuffer(), { headers: { 'Content-Type': req.headers()['content-type'] } }).formData();
      uploads.set(path, await form.get('').text()); return json({ Key: path });
    }
    errors.push(`Unhandled mock request: ${req.method()} ${u.pathname}`); return json({ message: 'Unhandled audit fixture request' }, 500);
  });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.waitForLoadState('networkidle');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('local-audit-password');
  await page.locator('#auth-submit').click();
  await page.waitForFunction(() => document.querySelector('#dataset') && !document.querySelector('#dataset').disabled);
  return { context, page, projects, uploads, errors, requests, user, close: () => context.close() };
}

export async function openAuditSession(options) {
  const browser = await chromium.launch({ headless: true });
  try { const session = await newSession(browser, options); return { ...session, browser, close: async () => { await session.close(); await browser.close(); } }; }
  catch (error) { await browser.close(); throw error; }
}

export async function selectDataset(page, id, fields = []) {
  const first = !(await page.locator('#dataset').inputValue());
  await page.locator('#dataset').selectOption(id);
  const name = page.getByLabel('Project name', { exact: true });
  if (first) await name.waitFor();
  if (await name.isVisible()) await name.press('Enter');
  await page.locator('.dataset-table').waitFor();
  for (const field of fields) {
    const button=page.getByRole('button', { name: `Select column ${field}`, exact: true });
    if (!await button.count()) await page.getByLabel('Find a dataset field', {exact:true}).fill(field);
    await button.click();
    await page.getByLabel('Find a dataset field', {exact:true}).fill('');
  }
  if (fields.length) await page.waitForFunction(() => document.querySelector('#cards .card-row[aria-busy="false"]'));
}

export async function findCard(page, method, title) {
  // Search and group changes are debounced; do not inspect the previous page.
  await page.waitForTimeout(400);
  for (let i = 0; i < 30; i++) {
    let card = page.locator(`#cards .card[data-method="${method}"]`);
    if (title) card = card.filter({ has: page.locator('h3', { hasText: title }) });
    card = card.first();
    if (await card.count()) { await card.scrollIntoViewIfNeeded(); await card.locator('.card-top').hover(); return card; }
    // The total remains "…" until further pages are requested. Waiting for a
    // final total here would deadlock this audit rather than test navigation.
    if (await page.locator('#cards-next').isDisabled()) break;
    const before = await page.locator('#cards-page').textContent(); await page.locator('#cards-next').click();
    await page.waitForFunction(before => document.querySelector('#cards-page').textContent !== before, before);
    await page.waitForFunction(() => { const n=Number(document.querySelector('#cards-page').textContent.split('/')[0]); return document.querySelector(`.card-row[data-page="${n}"][aria-busy="false"]`); });
  }
  throw new Error(`Card unavailable: ${method} ${title ?? ''}`);
}

export async function applyCard(page, card) {
  const history = await page.locator('.history-item').count();
  await card.locator('.card-top').hover(); await card.locator('.apply-button').click();
  await page.waitForFunction(n => document.querySelectorAll('.history-item').length > n, history);
  await page.waitForFunction(() => document.querySelector('#cards .card-row[aria-busy="false"]'));
}
