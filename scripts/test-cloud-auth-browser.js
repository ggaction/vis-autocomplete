// End-to-end UI with a deterministic fake Supabase transport. This verifies the
// application flow; provider credentials/email delivery still need a live smoke test.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createProductionServer } from './server.js';
import { mkdir } from 'node:fs/promises';
const server=await createProductionServer({env:{SUPABASE_URL:'https://cloud-test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'},verifyToken:value=>value===token});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1600,height:1000}});
await context.addInitScript(() => {
 window.authLandingWasVisible = false;
 const sample = () => {
  const gate = document.getElementById('auth-gate');
  if (gate && !gate.hidden && getComputedStyle(gate).display !== 'none') window.authLandingWasVisible = true;
  requestAnimationFrame(sample);
 };
 requestAnimationFrame(sample);
});
const page=await context.newPage(),errors=[],events=[],reports=[],projects=new Map(),uploads=new Map();let profile=null,revision=0;const assetRequests=[];
let refreshRequests=0;
page.on('request', req=>assetRequests.push(new URL(req.url()).pathname));
page.setDefaultTimeout(60000);
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',email:'user@example.org',app_metadata:{provider:'email',providers:['email']},user_metadata:{},identities:[],created_at:new Date().toISOString()};
const token=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'signature'].join('.');
const mockTransport = async route=>{
 const req=route.request(),u=new URL(req.url());const body=req.headers()['content-type']?.includes('application/json') ? req.postDataJSON() : {};
 const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value),headers:{'Access-Control-Allow-Origin':origin}});
 if(u.pathname==='/auth/v1/token' && body.password==='wrong-password')return json({message:'Invalid login credentials'},400);
 if(u.pathname==='/auth/v1/token'){
  if(u.searchParams.get('grant_type')==='refresh_token')refreshRequests++;
  return json({access_token:token,refresh_token:'refresh',expires_in:3600,token_type:'bearer',user});
 }
 if(u.pathname==='/auth/v1/signup')return json({user});
 if(u.pathname==='/auth/v1/user'){
  if(req.method()==='PUT' && body.data) user.user_metadata={...user.user_metadata,...body.data};
  return json(user);
 }
 if(u.pathname==='/auth/v1/logout')return json({});
 if(u.pathname==='/auth/v1/recover')return json({});
 if(u.pathname==='/rest/v1/profiles')return json(profile?[profile]:[]);
 if(u.pathname.endsWith('/rpc/set_research_consent')){profile={id:user.id,research_enabled:body.enabled,consent_version:'history-only-v1',consent_revision:++revision};return json(profile);}
 if(u.pathname.endsWith('/rpc/record_interactions')){events.push(...body.events);return json(body.events.length);}
 if(u.pathname.endsWith('/rpc/save_project')){
  const row=projects.get(body.project);if((row?.revision??0)!==body.expected)return json({code:'40001',message:'revision_conflict'},409);
  projects.set(body.project,{id:body.project,title:body.name,snapshot:body.document,revision:body.expected+1,thumbnail:body.thumbnail,updated_at:new Date().toISOString()});return json(body.expected+1);
 }
 if(u.pathname==='/rest/v1/projects'){
  const id=u.searchParams.get('id')?.replace('eq.','');
  if(req.method()==='DELETE'){projects.delete(id);return json(null);}
  return json(id?projects.get(id):[...projects.values()]);
 }
 if(u.pathname==='/rest/v1/datasets'){if(req.method()==='POST')return json(null,201);return json([]);}
 if(u.pathname==='/rest/v1/bug_reports'){reports.push(body);return json({id:'report-1'},201);}
 if(u.pathname.startsWith('/storage/v1/object/')){uploads.set(u.pathname,req.postData());return json({Key:u.pathname},200);}
 throw new Error(`Unhandled ${req.method()} ${u.pathname}`);
};
await context.route('https://cloud-test.supabase.co/**',mockTransport);
page.on('pageerror',e=>errors.push(e.message));
const dialog=()=>page.locator('dialog[open]').last();
async function close(){await dialog().getByRole('button',{name:'Close',exact:true}).click();}
async function reloadWorkspace() {
 // Hold verification to expose a slow connection deterministically. Neither
 // the login page nor private editor/data should appear while auth is unknown.
 let release;
 const barrier=new Promise(resolve=>{release=resolve;});
 const userRoute='https://cloud-test.supabase.co/auth/v1/user';
 const handler=async route=>{await barrier;await route.fallback();};
 await page.route(userRoute,handler);
 const requested=page.waitForRequest(req=>req.url()===userRoute && req.method()==='GET');
 try{
  await page.reload({waitUntil:'commit'});await requested;
  await expect(page.locator('#session-gate')).toBeVisible();
  await expect(page.locator('#auth-gate')).toBeHidden();
  assert.equal(await page.locator('#dataset').count(),0);
  await page.screenshot({path:'output/cloud-testing/restoring-session.png'});
  release();await page.locator('#current canvas').waitFor();
  await expect(page.locator('#editor-root')).not.toHaveClass(/editor-loading/);
  await expect(page.locator('#session-gate')).toBeHidden();
  assert.equal(await page.evaluate(()=>window.authLandingWasVisible),false,'Restoring a signed-in workspace must never paint the sign-in landing page');
 }finally{release();await page.unroute(userRoute,handler);}
}
try{
 await mkdir('output/cloud-testing',{recursive:true});await page.goto(origin);
 await expect(page.locator('#auth-submit')).toBeEnabled();
 await expect(page.locator('#auth-heading')).toHaveText('Sign in');
 assert.equal(await page.locator('#dataset').count(),0);
 assert.ok(!assetRequests.some(path=>/\/assets\/app-|\/data\/.*model|\/web\/data\/|\/output\/workers\//.test(path)), 'Guest must not load the editor, models, workers or datasets');
 await page.screenshot({path:'output/cloud-testing/signin-landing.png',fullPage:true});
 await page.getByRole('button',{name:'Sign up',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('valid-password-example');
 await page.getByRole('button',{name:'Create account',exact:true}).click();
 await expect(page.locator('#auth-status')).toHaveText('Check your email to confirm your account, then return here to sign in.');
 assert.equal(await page.locator('#dataset').count(),0);assert.equal(events.length,0);
 await page.screenshot({path:'output/cloud-testing/signup-landing.png',fullPage:true});
 await page.locator('#auth-switch').click();
 await page.getByLabel('Password',{exact:true}).fill('wrong-password');
 await page.locator('#auth-submit').click();await expect(page.locator('#auth-status')).toContainText('Could not sign in.');
 assert.equal(await page.locator('#dataset').count(),0);
 await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
 await page.getByRole('button',{name:'Send reset link',exact:true}).click();
 await expect(page.locator('#auth-status')).toContainText('If an account exists');
 await page.locator('#auth-switch').click();
 await page.getByLabel('Password',{exact:true}).fill('valid-password-example');
 await page.locator('#auth-submit').click();
 await page.getByRole('heading',{name:'Help improve visualization authoring',exact:true}).waitFor();
 assert.equal(await dialog().getByRole('checkbox').isChecked(),true);assert.equal(events.length,0);
 await expect(dialog().getByRole('button',{name:'Close',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');
 await expect(page.getByRole('heading',{name:'Help improve visualization authoring',exact:true})).toBeVisible();
 assert.equal(profile,null);assert.equal(events.length,0);
 await page.screenshot({path:'output/cloud-testing/consent.png'});
 await dialog().getByRole('checkbox').uncheck();await dialog().getByRole('button',{name:'Continue',exact:true}).click();
 await expect.poll(()=>profile?.research_enabled).toBe(false);
 await page.getByRole('heading',{name:'Help improve visualization authoring',exact:true}).waitFor({state:'hidden'});
 await expect(page.locator('#view-mode [data-mode="transition"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('html')).toHaveAttribute('data-view-mode','transition');
 await expect(page.locator('html')).toHaveAttribute('data-workspace-layout','vertical');
 await page.locator('#dataset').selectOption('cars');await page.getByRole('button',{name:'Select column Horsepower',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent==='Saved to your account');
 assert.equal(events.length,0);assert.ok(projects.size===1);assert.ok(uploads.size===1);
 await page.locator('#account-button').click();await dialog().getByRole('checkbox').check();await dialog().getByRole('button',{name:'Save preferences',exact:true}).click();await page.getByText('Preference saved.',{exact:true}).waitFor();await close();
 await page.getByRole('button',{name:'Select column Acceleration',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent==='Saved to your account');
 await page.waitForTimeout(5200);assert.ok(events.length>0);assert.ok(events.every(e=>!JSON.stringify(e).includes('Horsepower')));
 const scatter=page.locator('#cards .card[data-method="createScatterPlot"]');
 await scatter.scrollIntoViewIfNeeded();await scatter.hover();await scatter.locator('.apply-button').click();
 await page.waitForFunction(()=>document.querySelector('#current').dataset.lastMethod==='createScatterPlot');
 await expect.poll(()=>[...projects.values()][0]?.snapshot.datasets[0].session.entries.at(-1).calls.some(c=>c.method==='createScatterPlot'),{timeout:30000}).toBe(true);
 assert.ok([...projects.values()][0].thumbnail.startsWith('data:image/png;base64,'));
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download current visualization as SVG',exact:true}).click();
 assert.match((await download).suggestedFilename(),/\.svg$/);
 // The new default must not replace an explicitly saved Preview preference.
 await page.locator('#view-mode [data-mode="preview"]').click();
 await expect.poll(()=>user.user_metadata.vis_view_mode).toBe('preview');
 await reloadWorkspace();
 await expect(page.locator('#view-mode [data-mode="preview"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('html')).toHaveAttribute('data-view-mode','preview');
 await expect(page.locator('html')).toHaveAttribute('data-workspace-layout','horizontal');
 // View preferences belong to the account, not to the current chart/history.
 const revisionBeforeViews=[...projects.values()][0].revision;
 await page.locator('#view-mode [data-mode="transition"]').click();
 await page.locator('#workspace-layout [data-layout="horizontal"]').click();
 await page.locator('#workspace-layout [data-layout="vertical"]').click();
 await page.locator('#code-font-increase').click();
 const divider=page.locator('[data-divider="primary"]');
 await divider.focus(); await divider.press('ArrowRight');
 await page.locator('#toggle-history').click();await page.locator('#toggle-code').click();
 await expect.poll(()=>user.user_metadata.vis_panel_layout).toEqual({history:true,code:true});
 assert.equal(user.user_metadata.vis_view_mode,'transition');
 assert.equal(user.user_metadata.vis_workspace_layout.transition,'vertical');
 assert.equal(user.user_metadata.vis_code_font_size,12);
 assert.ok(user.user_metadata.vis_workspace_sizes['transition:vertical'].primary>0);
 assert.equal([...projects.values()][0].revision,revisionBeforeViews,'View settings must not create project revisions');
 await reloadWorkspace();
 await expect(page.locator('#toggle-history')).toHaveAttribute('aria-expanded','false');
 await expect(page.locator('#toggle-code')).toHaveAttribute('aria-expanded','false');
 await expect(page.locator('html')).toHaveAttribute('data-view-mode','transition');
 await expect(page.locator('html')).toHaveAttribute('data-workspace-layout','vertical');
 // Expiring an access token must refresh the existing session, not ask the
 // user to sign in or briefly paint the landing page.
 const refreshesBefore=refreshRequests;
 await page.evaluate(()=>{
  const key=Object.keys(localStorage).find(key=>/^sb-.+-auth-token$/.test(key));
  const saved=JSON.parse(localStorage.getItem(key));
  saved.expires_at=Math.floor(Date.now()/1000)-60;
  localStorage.setItem(key,JSON.stringify(saved));
 });
 await reloadWorkspace();assert.ok(refreshRequests>refreshesBefore);
 assert.equal(await page.locator('#dataset').inputValue(),'cars');
 // A verification outage is a retryable startup error, not a sign-out. Only
 // an explicitly rejected session may reveal the login form.
 const unavailable=await browser.newContext({storageState:await context.storageState()});
 await unavailable.route('https://cloud-test.supabase.co/**',mockTransport);
 const failed=await unavailable.newPage();
 const verification='https://cloud-test.supabase.co/auth/v1/user';
 await failed.route(verification,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'Session verification unavailable.'})}));
 await failed.goto(origin);
 await expect(failed.locator('#session-status')).toContainText('Session verification unavailable');
 await expect(failed.locator('#auth-gate')).toBeHidden();
 assert.equal(await failed.locator('#dataset').count(),0);
 await failed.unroute(verification);await failed.locator('#session-retry').click();
 await expect(failed.locator('#editor-root')).toBeVisible();
 await expect(failed.locator('#auth-gate')).toBeHidden();
 await failed.route(verification,route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'Invalid token'})}));
 await failed.reload();await expect(failed.locator('#auth-submit')).toBeVisible();
 assert.equal(await failed.locator('#dataset').count(),0);await unavailable.close();
 // A second device has no cookies, localStorage or IndexedDB from this one.
 const device=await browser.newContext({viewport:{width:1440,height:1000}});
 await device.route('https://cloud-test.supabase.co/**',mockTransport);
 const other=await device.newPage();await other.goto(origin);
 await other.getByLabel('Email',{exact:true}).fill(user.email);
 await other.getByLabel('Password',{exact:true}).fill('valid-password-example');
 await other.locator('#auth-submit').click();await expect(other.locator('#auth-gate')).toBeHidden();
 await expect(other.locator('#toggle-history')).toHaveAttribute('aria-expanded','false');
 await expect(other.locator('#toggle-code')).toHaveAttribute('aria-expanded','false');
 await expect(other.locator('html')).toHaveAttribute('data-view-mode','transition');
 await expect(other.locator('html')).toHaveAttribute('data-workspace-layout','vertical');
 await expect(other.locator('.code-panel')).toHaveCSS('--code-font-size','12px');
 await expect(other.locator('.authoring-area')).toHaveAttribute('style',/grid-template-columns/);
 await other.screenshot({path:'output/cloud-testing/account-layout-restored.png'});
 await device.close();
 const second=await context.newPage();await second.goto(origin);await second.locator('#current canvas').waitFor();
 await expect(second.locator('#auth-gate')).toBeHidden();
 await page.locator('#workspace-menu').click();await page.getByRole('button',{name:'Rename current visualization',exact:true}).click();await dialog().getByLabel('Name',{exact:true}).fill('My saved cars');await dialog().getByRole('button',{name:'Save name',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent==='Saved to your account');await expect.poll(()=>[...projects.values()][0]?.title).toBe('My saved cars');
 await page.locator('#workspace-menu').click();await page.getByRole('button',{name:'Report a problem',exact:true}).click();
 await dialog().getByLabel('Report type',{exact:true}).selectOption('project');await dialog().getByLabel('Summary',{exact:true}).fill('Test report');await dialog().getByLabel('What happened?',{exact:true}).fill('Current chart context');
 assert.equal(await dialog().getByRole('checkbox').isChecked(),false);await dialog().getByRole('button',{name:'Send report',exact:true}).click();await page.getByRole('heading',{name:'Report received'}).waitFor();
 assert.equal(reports.length,1);assert.equal(reports[0].share_data,false);assert.ok(!JSON.stringify(reports[0]).includes('/datasets/'));await close();await close();
 // Reload restores this account's local draft without showing a guest chart.
 await page.reload();await page.locator('#current canvas').waitFor();assert.equal(await page.locator('#dataset').inputValue(),'cars');
 await page.locator('#account-button').click();await dialog().getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.locator('#auth-submit')).toBeEnabled();
 await expect(page.locator('#auth-heading')).toHaveText('Sign in');
 assert.equal(await page.locator('#dataset').count(),0);
 await page.reload();await expect(page.locator('#auth-submit')).toBeEnabled();assert.equal(await page.locator('#dataset').count(),0);
 await expect(second.locator('#auth-submit')).toBeEnabled();assert.equal(await second.locator('#dataset').count(),0);await second.close();
 // Follow a mocked PKCE recovery callback; the editor stays locked until
 // the replacement password is accepted. No real account or email is used.
 await page.getByRole('button',{name:'Forgot password?',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(user.email);
 await page.getByRole('button',{name:'Send reset link',exact:true}).click();
 await expect(page.locator('#auth-status')).toContainText('If an account exists');
 await page.goto(origin+'/?code=mock-recovery-code');
 await expect(page.locator('#auth-heading')).toHaveText('Choose a new password');
 assert.equal(await page.locator('#dataset').count(),0);
 await page.getByLabel('Password',{exact:true}).fill('new-test-password-only');
 await page.getByRole('button',{name:'Update password',exact:true}).click();
 await page.locator('#current canvas').waitFor();
 assert.deepEqual(errors,[]);console.log('Mock transport: signup, signin, consent, autosave, account view settings, fresh-device restore, rename, reports, flash-free reload/token refresh, verification retry/rejection, signout isolation passed.');
}catch(error){console.error('UI failure',error,errors);await page.screenshot({path:'output/cloud-testing/auth-failure.png',fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
