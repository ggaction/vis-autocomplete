// End-to-end UI with a deterministic fake Supabase transport. This verifies the
// application flow; provider credentials/email delivery still need a live smoke test.
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { createProductionServer } from './server.js';
import { mkdir, readFile } from 'node:fs/promises';
import { sampleWorkbook } from '../test/fixtures/xlsx-workbook.js';
import { checkAdjacentFilteredCars } from './check-adjacent-filtered-cars.js';
import { checkElementSelection } from './check-element-selection.js';
const { version: releaseVersion } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
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
let refreshRequests=0,projectReads=0;const failedDeletes=new Set();
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
  if(req.method()==='DELETE'){if(failedDeletes.delete(id))return json({message:'Delete failed. Please retry.'},503);projects.delete(id);return json(null);}
  if(id)projectReads++;
  return json(id?projects.get(id):[...projects.values()]);
 }
 if(u.pathname==='/rest/v1/datasets'){if(req.method()==='POST')return json(null,201);return json([]);}
 if(u.pathname==='/rest/v1/bug_reports'){reports.push(body);return json({id:'report-1'},201);}
 if(u.pathname.startsWith('/storage/v1/object/')){
  const path=u.pathname.replace('/object/authenticated/','/object/');
  if(req.method()==='GET')return route.fulfill({status:200,contentType:'application/json',body:uploads.get(path)});
  const form=await new Response(req.postDataBuffer(),{headers:{'Content-Type':req.headers()['content-type']}}).formData();
  uploads.set(path,await form.get('').text());return json({Key:path},200);
 }
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
 await expect(page.locator('#account-button')).toHaveText(user.email);
 await expect(page.locator('#view-mode [data-mode="transition"]')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('html')).toHaveAttribute('data-view-mode','transition');
 await expect(page.locator('html')).toHaveAttribute('data-workspace-layout','vertical');
 assert.deepEqual(assetRequests.filter(path=>path.startsWith('/web/data/')),[],'Signed-in startup must not eagerly download example datasets');
 await page.locator('#workspace-menu').click();await page.getByRole('button',{name:'About',exact:true}).click();
 await expect(dialog().locator('.about-version')).toHaveText(`Version v${releaseVersion}`);
 await expect(dialog().getByRole('heading',{name:'Underlying software',exact:true})).toBeVisible();
 await expect(dialog().getByRole('link',{name:'legacy version for our academic paper',exact:true})).toHaveAttribute('href','https://oldvis.autocomplete.studio/');
 await page.screenshot({path:`output/cloud-testing/about-v${releaseVersion}.png`});await close();await close();
 await page.locator('#dataset').selectOption('cars');
 await expect(dialog().getByLabel('Project name',{exact:true})).toHaveValue('Cars');
 await dialog().getByLabel('Project name',{exact:true}).fill('   ');
 await dialog().getByRole('button',{name:'Create project',exact:true}).click();
 await expect(dialog().getByLabel('Project name',{exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('#dataset')).toHaveValue('');assert.equal(projects.size,0);
 await page.locator('#dataset').selectOption('cars');
 await dialog().getByLabel('Project name',{exact:true}).fill('Cars exploration');
 await dialog().getByLabel('Project name',{exact:true}).press('Enter');
 await page.getByRole('button',{name:'Select column Horsepower',exact:true}).click();
 await expect(page.locator('#upload')).toBeHidden();await expect(page.locator('#dataset')).toBeHidden();
 await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent==='Saved');
 assert.equal(events.length,0);assert.ok(projects.size===1);assert.ok(uploads.size===1);
 assert.equal([...projects.values()][0].title,'Cars exploration');
 await page.locator('#account-button').click();await dialog().getByRole('checkbox').check();await dialog().getByRole('button',{name:'Save preferences',exact:true}).click();await page.getByText('Preference saved.',{exact:true}).waitFor();await close();
 await page.getByRole('button',{name:'Select column Acceleration',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent==='Saved');
 await page.waitForTimeout(5200);assert.ok(events.length>0);assert.ok(events.every(e=>!JSON.stringify(e).includes('Horsepower')));
 const scatter=page.locator('#cards .card[data-method="createScatterPlot"]');
 await scatter.scrollIntoViewIfNeeded();await scatter.hover();await scatter.locator('.apply-button').click();
 await page.waitForFunction(()=>document.querySelector('#current').dataset.lastMethod==='createScatterPlot');
 await expect.poll(()=>[...projects.values()][0]?.snapshot.datasets[0].session.entries.at(-1).calls.some(c=>c.method==='createScatterPlot'),{timeout:30000}).toBe(true);
 assert.ok([...projects.values()][0].thumbnail.startsWith('data:image/png;base64,'));
 // Main's direct typography/zoom tools must coexist with cloud autosave and
 // checkpoint restoration after the branch integration.
 await page.getByLabel('Chart font family',{exact:true}).selectOption('Georgia');
 await expect.poll(()=>JSON.stringify([...projects.values()][0].snapshot).includes('Georgia')).toBe(true);
 const beforeZoom=[...projects.values()][0].revision;
 await page.getByRole('button',{name:'Zoom in',exact:true}).click();
 await expect.poll(()=>page.locator('#current').getAttribute('data-chart-zoom')).not.toBe('1');
 assert.equal([...projects.values()][0].revision,beforeZoom,'Viewport zoom must not alter saved chart history');
 await page.getByRole('button',{name:'Fit chart to view',exact:true}).click();
 await expect(page.locator('#current')).toHaveAttribute('data-chart-zoom','1');
 await expect.poll(()=>page.evaluate(async owner=>{
  const db=await new Promise((resolve,reject)=>{const request=indexedDB.open(`visualization-autocomplete-account-${owner}`);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return new Promise(resolve=>{const request=db.transaction('projects').objectStore('projects').get('checkpoint');request.onsuccess=()=>{db.close();resolve(Boolean(request.result));};});
 },user.id),{timeout:30000}).toBe(true);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download current visualization as SVG',exact:true}).click();
 assert.match((await download).suggestedFilename(),/\.svg$/);
 // The new default must not replace an explicitly saved Preview preference.
 await page.locator('#view-mode [data-mode="preview"]').click();
 await expect.poll(()=>user.user_metadata.vis_view_mode).toBe('preview');
 await reloadWorkspace();
 await expect(page.locator('body')).toHaveAttribute('data-restoration','checkpoint');
 await expect(page.getByLabel('Chart font family',{exact:true})).toHaveValue('Georgia');
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
 user.user_metadata.full_name='Test Author';
 const device=await browser.newContext({viewport:{width:1440,height:1000},deviceScaleFactor:2});
 await device.route('https://cloud-test.supabase.co/**',mockTransport);
 const other=await device.newPage();await other.goto(origin);
 await other.getByLabel('Email',{exact:true}).fill(user.email);
 await other.getByLabel('Password',{exact:true}).fill('valid-password-example');
 await other.locator('#auth-submit').click();await expect(other.locator('#auth-gate')).toBeHidden();
 await expect(other.locator('#account-button')).toHaveText('Test Author');
 await expect(other.locator('#account-button')).toHaveAttribute('title',`Test Author\n${user.email}`);
 await expect(other.locator('#toggle-history')).toHaveAttribute('aria-expanded','false');
 await expect(other.locator('#toggle-code')).toHaveAttribute('aria-expanded','false');
 await expect(other.locator('html')).toHaveAttribute('data-view-mode','transition');
 await expect(other.locator('html')).toHaveAttribute('data-workspace-layout','vertical');
 await expect(other.locator('.code-panel')).toHaveCSS('--code-font-size','12px');
 await expect(other.locator('.authoring-area')).toHaveAttribute('style',/grid-template-columns/);
 await other.screenshot({path:'output/cloud-testing/account-layout-restored.png'});
 // Legacy 240×160 PNGs must be redrawn from the saved project, not enlarged or
 // sharpened. This device has no local project/dataset, exercising storage too.
 const previewed=[...projects.values()][0],originalThumbnail=previewed.thumbnail;
 previewed.thumbnail=await other.evaluate(async src=>{
  const image=new Image();image.src=src;await image.decode();
  const canvas=document.createElement('canvas');canvas.width=240;canvas.height=160;
  const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,240,160);
  const scale=Math.min(240/image.width,160/image.height);
  ctx.drawImage(image,(240-image.width*scale)/2,(160-image.height*scale)/2,image.width*scale,image.height*scale);
  return canvas.toDataURL('image/png');
 },originalThumbnail);
 const savedBeforePreviews=JSON.stringify([...projects.values()]);
 const datasetBeforePreviews=await other.locator('#dataset').inputValue();
 await other.locator('#workspace-menu').click();
 await expect(other.locator('.cloud-project-preview')).toBeHidden();
 await other.locator('.cloud-project').first().hover();
 const repaired=other.locator('.cloud-project-preview img:visible');
 await expect.poll(()=>repaired.evaluate(image=>Math.max(image.naturalWidth/1120,image.naturalHeight/720)),{timeout:30000}).toBeGreaterThan(.5);
 await expect(repaired).toHaveCSS('object-position','50% 50%');
 assert.ok((await repaired.boundingBox()).height >= 200);
 const repairedSource=await repaired.getAttribute('src');assert.notEqual(repairedSource,previewed.thumbnail);
 assert.equal(JSON.stringify([...projects.values()]),savedBeforePreviews,'Rendering saved thumbnails must never create or change project revisions');
 assert.equal(await other.locator('#dataset').inputValue(),datasetBeforePreviews,'Rendering a thumbnail must not open its project');
 await other.screenshot({path:'output/cloud-testing/legacy-thumbnail-repaired-2x.png'});
 await other.locator('dialog.workspace-drawer[open]').getByRole('button',{name:'Close',exact:true}).click();
 const readsBeforeCache=projectReads;
 await other.locator('#workspace-menu').click();
 await other.locator('.cloud-project').first().hover();
 await expect(other.locator('.cloud-project-preview img:visible')).toHaveAttribute('src',repairedSource);
 assert.equal(projectReads,readsBeforeCache,'Reopening the menu must reuse the derived thumbnail without downloading/replaying the project');
 previewed.thumbnail=originalThumbnail;
 await device.close();
 const second=await context.newPage();await second.goto(origin);await second.locator('#current canvas').waitFor();
 await expect(second.locator('#auth-gate')).toBeHidden();
 await page.locator('#workspace-menu').click();
 await dialog().getByRole('button',{name:'Open Cars exploration',exact:true}).dblclick();
 await dialog().getByLabel('Project name',{exact:true}).fill('My saved cars');
 await dialog().getByLabel('Project name',{exact:true}).press('Enter');
 await expect(dialog().getByLabel('Project name',{exact:true})).toHaveCount(0);await close();
 await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent==='Saved');await expect.poll(()=>[...projects.values()][0]?.title).toBe('My saved cars');
 const carsId=[...projects.values()][0].id;
 await expect(page.locator('#upload')).toBeHidden();await expect(page.locator('#dataset')).toBeHidden();
 const savedCars=structuredClone(projects.get(carsId));
 await page.locator('#workspace-menu').click();await dialog().getByRole('button',{name:'New visualization',exact:true}).click();
 await expect(page.locator('#upload')).toBeVisible();await expect(page.locator('#dataset')).toBeVisible();
 // Upload opens a keyboard-accessible drop zone, rather than opening the file
 // picker immediately. Every rejection/cancel must preserve the empty workspace
 // and leave the previous saved visualization untouched.
 const beforeUpload=await page.locator('#code-content').innerText(),beforeUrl=page.url();
 const uploadDialog=()=>page.getByRole('dialog',{name:'Upload dataset',exact:true});
 const dropZone=()=>page.getByRole('button',{name:'Choose a dataset file',exact:true});
 const transfer=async (files=[],text=null)=>page.evaluateHandle(({files,text})=>{
  const data=new DataTransfer();
  for(const file of files)data.items.add(new File([file.base64?Uint8Array.from(atob(file.base64),c=>c.charCodeAt(0)):file.text??'data'],file.name,{type:file.type??''}));
  if(text!==null)data.setData('text/plain',text);return data;
 },{files,text});
 const drop=async (data,target=dropZone())=>{
  await target.dispatchEvent('dragover',{dataTransfer:data});
  await target.dispatchEvent('drop',{dataTransfer:data});
  await data.dispose();
 };
 await page.locator('#upload').click();await expect(uploadDialog()).toBeVisible();
 await expect(dropZone()).toBeFocused();await expect(uploadDialog()).toContainText('CSV (.csv)');
 await expect(uploadDialog()).toContainText('JSON (.json)');
 await expect(uploadDialog()).toContainText('Excel (.xlsx)');
 assert.ok(!assetRequests.includes('/output/workers/workbook.js'),'The Excel parser must not load before an Excel upload');
 await page.screenshot({path:'output/cloud-testing/upload-dataset.png'});
 await page.setViewportSize({width:390,height:844});
 const uploadBox=await uploadDialog().boundingBox();assert.ok(uploadBox.x>=0&&uploadBox.x+uploadBox.width<=390);
 assert.equal(await uploadDialog().evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:'output/cloud-testing/upload-dataset-mobile.png'});
 await page.setViewportSize({width:1600,height:1000});
 const unsupported=await transfer([{name:'image.png',type:'image/png'}]);
 await dropZone().dispatchEvent('dragover',{dataTransfer:unsupported});
 await expect(dropZone()).toHaveAttribute('data-drag','invalid');
 await drop(unsupported);await expect(uploadDialog().getByRole('status')).toContainText('Only .csv, .json and .xlsx');
 await drop(await transfer([{name:'one.csv'},{name:'two.json'}]));
 await expect(uploadDialog().getByRole('status')).toContainText('one dataset file');
 await drop(await transfer([],'https://example.org/data.csv'));
 await expect(uploadDialog().getByRole('status')).toContainText('not text or a link');
 await drop(await transfer([{name:'empty.json',text:''}]));
 await expect(uploadDialog().getByRole('status')).toContainText('empty');
 const [wrongChooser]=await Promise.all([page.waitForEvent('filechooser'),dropZone().press('Enter')]);
 await wrongChooser.setFiles({name:'workbook.xls',mimeType:'application/vnd.ms-excel',buffer:Buffer.from('not an XLSX')});
 await expect(uploadDialog().getByRole('status')).toContainText('Save older Excel files as .xlsx');
 await page.locator('#file').setInputFiles({name:'broken.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('not an XLSX')});
 await expect(uploadDialog().getByRole('status')).toContainText('not a readable .xlsx workbook');
 const outside=await transfer([{name:'valid.csv',text:'x,y\n1,2'}]);
 assert.equal(await page.evaluate(data=>document.dispatchEvent(new DragEvent('drop',{dataTransfer:data,bubbles:true,cancelable:true})),outside),false);
 await outside.dispose();await expect(uploadDialog().getByRole('status')).toContainText('inside the dashed area');
 assert.equal(page.url(),beforeUrl);await expect(page.locator('#dataset')).toHaveValue('');
 await page.screenshot({path:'output/cloud-testing/upload-dataset-error.png'});
 await page.keyboard.press('Escape');await expect(uploadDialog()).toHaveCount(0);await expect(page.locator('#upload')).toBeFocused();
 assert.equal(await page.locator('#code-content').innerText(),beforeUpload);
 // Modal-only drop listeners are removed on cancel.
 assert.equal(await page.evaluate(()=>document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true}))),true);
 await page.locator('#upload').click();
 await drop(await transfer([{name:'broken.json',text:'{"not valid":'}]));
 await expect(page.getByRole('dialog',{name:'Review dataset'}).getByRole('status')).not.toHaveText(/Reading|Interpreting/);
 await expect(page.getByRole('button',{name:'Use dataset',exact:true})).toBeDisabled();
 await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
 await page.locator('#upload').click();
 await drop(await transfer([{name:'nested.JSON',text:JSON.stringify({results:{rows:[{Time:1,Value:4},{Time:2,Value:7}]}})}]));
 await dialog().getByLabel('Row path',{exact:true}).fill('results.rows');
 await dialog().getByRole('button',{name:'Update preview',exact:true}).click();
 await expect(dialog().getByRole('button',{name:'Use dataset',exact:true})).toBeEnabled();
 await expect(dialog().getByRole('status')).toContainText('2 rows');
 await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.locator('#dataset')).toHaveValue('');assert.equal(await page.locator('#code-content').innerText(),beforeUpload);
 const excelMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
 const workbookData=sampleWorkbook();
 await page.locator('#upload').click();
 const [excelChooser]=await Promise.all([page.waitForEvent('filechooser'),dropZone().click()]);
 await excelChooser.setFiles({name:'Research.xlsx',mimeType:excelMime,buffer:Buffer.from(workbookData)});
 await expect(uploadDialog().getByLabel('Choose a sheet')).toHaveValue('매출 Sales');
 await expect(uploadDialog().getByRole('columnheader',{name:'Sales',exact:true})).toBeVisible();
 await uploadDialog().getByLabel('Choose a sheet').selectOption('Empty');
 await expect(uploadDialog().getByRole('button',{name:'Use sheet',exact:true})).toBeDisabled();
 await expect(uploadDialog().getByRole('status')).toContainText('no data rows');
 await uploadDialog().getByLabel('Choose a sheet').selectOption('Inventory');
 await expect(uploadDialog().getByRole('cell',{name:'Desk',exact:true})).toBeVisible();
 await page.screenshot({path:'output/cloud-testing/upload-excel-sheets.png'});
 await page.setViewportSize({width:390,height:844});
 assert.equal(await uploadDialog().evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await page.screenshot({path:'output/cloud-testing/upload-excel-mobile.png'});
 await page.setViewportSize({width:1600,height:1000});
 await uploadDialog().getByRole('button',{name:'Choose another file',exact:true}).click();
 await expect(dropZone()).toBeVisible();
 await page.locator('#file').setInputFiles({name:'Single.xlsx',mimeType:excelMime,buffer:Buffer.from(sampleWorkbook({single:true}))});
 await expect(page.getByRole('dialog',{name:'Review dataset'})).toBeVisible();
 await expect(dialog().getByLabel('Recorded: type',{exact:true})).toHaveValue('auto');
 await expect(dialog().getByLabel('Recorded: type',{exact:true}).locator('option:checked')).toHaveText('Auto → temporal');
 await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
 await expect(page.locator('#dataset')).toHaveValue('');assert.equal(await page.locator('#code-content').innerText(),beforeUpload);
 assert.deepEqual(projects.get(carsId),savedCars);
 await page.locator('#upload').click();
 const [csvChooser]=await Promise.all([page.waitForEvent('filechooser'),dropZone().click()]);
 await csvChooser.setFiles({name:'Quarterly sales.csv',mimeType:'text/csv',buffer:Buffer.from('Month,Sales,Cost\nJan,120,90\nFeb,150,100\nMar,180,130\n')});
 await page.getByRole('button',{name:'Use dataset',exact:true}).click();
 await expect(dialog().getByLabel('Project name',{exact:true})).toHaveValue('Quarterly sales');
 await page.screenshot({path:'output/cloud-testing/project-name.png'});
 await dialog().getByLabel('Project name',{exact:true}).fill('Sales study');
 await dialog().getByRole('button',{name:'Create project',exact:true}).click();
 await page.getByRole('button',{name:'Select column Sales',exact:true}).click();
 await expect.poll(()=>[...projects.values()].some(row=>row.title==='Sales study')).toBe(true);
 await expect(page.locator('#upload')).toBeHidden();await expect(page.locator('#dataset')).toBeHidden();
 // A new dataset now belongs to a new visualization. Delete this completed CSV
 // fixture through the UI before starting the Excel restoration fixture.
 await page.locator('#workspace-menu').click();
 await dialog().getByRole('checkbox',{name:'Select Sales study',exact:true}).check();
 await dialog().getByRole('button',{name:'Delete',exact:true}).click();
 await dialog().getByRole('button',{name:'Delete',exact:true}).click();
 await expect.poll(()=>projects.size).toBe(1);await close();
 await expect(page.locator('#upload')).toBeVisible();await expect(page.locator('#dataset')).toBeVisible();
 // Import the chosen second sheet, author a chart, then restore it and its
 // schema from the saved account draft. Other worksheets never enter storage.
 await page.locator('#upload').click();
 await drop(await transfer([{name:'Research.XLSX',type:excelMime,base64:Buffer.from(workbookData).toString('base64')}]));
 await uploadDialog().getByLabel('Choose a sheet').selectOption('Inventory');
 await uploadDialog().getByRole('button',{name:'Use sheet',exact:true}).click();
 await expect(dialog().getByRole('status')).toContainText('2 rows · 3 fields');
 await page.getByRole('button',{name:'Use dataset',exact:true}).click();
 await dialog().getByLabel('Project name',{exact:true}).fill('Sales study');
 await dialog().getByRole('button',{name:'Create project',exact:true}).click();
 for(const field of ['Units','Price'])await page.getByRole('button',{name:`Select column ${field}`,exact:true}).click();
 const excelCard=page.locator('#cards .card[data-method="createScatterPlot"]').first();
 await excelCard.hover();await excelCard.locator('.apply-button').click();
 await page.waitForFunction(()=>document.querySelector('#current').dataset.lastMethod==='createScatterPlot');
 await expect.poll(()=>{
  const project=[...projects.values()].find(row=>row.title==='Sales study');
  return project?.snapshot.datasets.find(dataset=>dataset.id===project.snapshot.activeId)?.session?.entries.at(-1)?.calls.some(call=>call.method==='createScatterPlot');
 },{timeout:30000}).toBe(true);
 await page.reload();await page.locator('#current canvas').waitFor();
 await expect(page.locator('#upload')).toBeHidden();await expect(page.locator('#dataset')).toBeHidden();
 // Account restore must render committed code without a hover or pointer event.
 await expect(page.locator('html')).toHaveAttribute('data-view-mode','transition');
 await expect(page.locator('#code-content')).toContainText('createScatterPlot');
 await expect(page.locator('#dataset option:checked')).toHaveText('Research — Inventory');
 await page.locator('#edit-schema').click();
 await expect(dialog().getByRole('status')).toContainText('2 rows · 3 fields');
 await expect(dialog().getByLabel('Units: type',{exact:true}).locator('option:checked')).toHaveText('Auto → quantitative');
 await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
 assert.equal(projects.size,2);const salesDataset=await page.locator('#dataset').inputValue();
 await page.locator('#workspace-menu').click();
 const carsItem=page.locator(`.cloud-project[data-project-id="${carsId}"]`);
 await carsItem.hover();
 const image=page.locator('.cloud-project-preview img:visible');await expect(image).toBeVisible();
 await expect(image).toHaveCSS('object-position','50% 50%');
 const imageBox=await image.boundingBox(),drawerBox=await dialog().boundingBox();
 assert.ok(imageBox.x>drawerBox.x+drawerBox.width);assert.ok(imageBox.height>=200);
 assert.ok((await carsItem.boundingBox()).height<65);
 await carsItem.getByRole('button',{name:'Open My saved cars',exact:true}).dblclick();
 await carsItem.getByRole('textbox',{name:'Project name',exact:true}).fill('Cancelled title');
 await carsItem.getByRole('textbox',{name:'Project name',exact:true}).press('Escape');
 assert.equal(projects.get(carsId).title,'My saved cars');await expect(dialog()).toBeVisible();
 await carsItem.getByRole('button',{name:'Open My saved cars',exact:true}).dblclick();
 await carsItem.getByRole('textbox',{name:'Project name',exact:true}).fill('Cars comparison');
 await carsItem.getByRole('textbox',{name:'Project name',exact:true}).press('Enter');
 await expect.poll(()=>projects.get(carsId).title).toBe('Cars comparison');
 assert.equal(await page.locator('#dataset').inputValue(),salesDataset,'Renaming another project must not open it');
 // Compact list: controls stay disabled until there is a selection; hover
 // previews are outside the drawer and never alter the current workspace.
 const drawer=page.locator('dialog.workspace-drawer[open]');
 await expect(drawer.getByRole('button',{name:'Rename current visualization',exact:true})).toHaveCount(0);
 await expect(drawer.getByRole('button',{name:'Duplicate current visualization',exact:true})).toHaveCount(0);
 await expect(drawer.getByRole('button',{name:'New visualization',exact:true})).toHaveText('+');
 const duplicate=drawer.getByRole('button',{name:'Duplicate',exact:true}),remove=drawer.getByRole('button',{name:'Delete',exact:true});
 await expect(duplicate).toBeDisabled();await expect(remove).toBeDisabled();
 const headBox=await drawer.locator('header').boundingBox(),libraryBox=await drawer.getByRole('button',{name:'My datasets',exact:true}).boundingBox();
 assert.ok(libraryBox.y-(headBox.y+headBox.height)<=12,'No empty status/header gap');
 await carsItem.hover();await expect(page.locator('.cloud-project-preview')).toBeVisible();
 await page.screenshot({path:'output/cloud-testing/my-visualizations.png'});
 await drawer.getByRole('heading',{name:'Workspace',exact:true}).hover();
 await expect(page.locator('.cloud-project-preview')).toBeHidden();
 // Copy an inactive project without changing the current chart or source.
 const originalCars=structuredClone(projects.get(carsId)),activeCode=await page.locator('#code-content').innerText();
 await carsItem.getByRole('checkbox',{name:'Select Cars comparison',exact:true}).check();
 await expect(duplicate).toBeEnabled();await expect(remove).toBeEnabled();
 await duplicate.click();
 await expect.poll(()=>projects.size).toBe(3);
 const firstCopy=[...projects.values()].find(row=>row.title==='Cars comparison (copy)');
 assert.deepEqual(firstCopy.snapshot,originalCars.snapshot);assert.deepEqual(projects.get(carsId),originalCars);
 assert.equal(await page.locator('#dataset').inputValue(),salesDataset);
 assert.equal(await page.locator('#code-content').innerText(),activeCode);
 await expect(drawer.getByRole('checkbox',{name:'Select Cars comparison (copy)',exact:true})).toBeChecked();
 await duplicate.click();await expect.poll(()=>projects.size).toBe(4);
 const secondCopy=[...projects.values()].find(row=>row.title==='Cars comparison (copy) (copy)');
 await drawer.getByRole('checkbox',{name:'Select Cars comparison (copy)',exact:true}).check();
 await expect(duplicate).toBeDisabled();await expect(remove).toBeEnabled();
 await expect(drawer.locator('.cloud-selection-count')).toHaveText('2 selected');
 await page.screenshot({path:'output/cloud-testing/workspace-selected.png'});
 await remove.click();await expect(dialog().getByRole('heading')).toHaveText('Delete 2 visualizations?');
 await dialog().getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(projects.size,4);
 // Select-all includes every saved project, then restore just the two copies.
 const all=drawer.getByRole('checkbox',{name:'Select all visualizations',exact:true});
 await all.check();await expect(drawer.locator('.cloud-selection-count')).toHaveText('4 selected');await expect(duplicate).toBeDisabled();
 await all.uncheck();await expect(remove).toBeDisabled();
 await drawer.getByRole('checkbox',{name:'Select Cars comparison (copy)',exact:true}).check();
 await drawer.getByRole('checkbox',{name:'Select Cars comparison (copy) (copy)',exact:true}).check();
 failedDeletes.add(secondCopy.id);
 await remove.click();await dialog().getByRole('button',{name:'Delete',exact:true}).click();
 await expect(dialog().getByRole('alert')).toContainText('Delete failed');
 assert.equal(projects.size,3);assert.ok(!projects.has(firstCopy.id)&&projects.has(secondCopy.id));
 await expect(drawer.locator('.cloud-selection-count')).toHaveText('1 selected');
 await dialog().getByRole('button',{name:'Delete',exact:true}).click();
 await expect.poll(()=>projects.size).toBe(2);assert.ok(!projects.has(firstCopy.id)&&!projects.has(secondCopy.id));
 await expect(drawer.locator('.cloud-project')).toHaveCount(2);await expect(remove).toBeDisabled();
 assert.equal(await page.locator('#dataset').inputValue(),salesDataset);assert.equal(await page.locator('#code-content').innerText(),activeCode);
 // Outside clicks close, nested dialogs do not. Narrow screens keep previews
 // in the viewport, and reduced-motion users do not get slide-in motion.
 await page.mouse.click(700,180);await expect(drawer).toHaveCount(0);await expect(page.locator('#workspace-menu')).toBeFocused();
 await page.locator('#workspace-menu').click();
 assert.equal(await drawer.evaluate(el=>getComputedStyle(el).animationName),'workspace-enter');
 await drawer.getByRole('button',{name:'My datasets',exact:true}).click();await close();await expect(drawer).toBeVisible();
 await page.emulateMedia({reducedMotion:'reduce'});await expect(drawer).toHaveCSS('animation-name','none');
 await page.setViewportSize({width:390,height:844});await carsItem.hover();
 const narrowPreview=await page.locator('.cloud-project-preview').boundingBox();
 assert.ok(narrowPreview.x>=0&&narrowPreview.x+narrowPreview.width<=390);assert.ok(narrowPreview.y>=0&&narrowPreview.y+narrowPreview.height<=844);
 await page.screenshot({path:'output/cloud-testing/workspace-mobile.png'});
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'no-preference'});
 // Deleting an active copy clears its local draft as well, without deleting
 // the source or switching the original chart into the copied project.
 await drawer.getByRole('checkbox',{name:'Select Sales study',exact:true}).check();
 await duplicate.click();await expect.poll(()=>projects.size).toBe(3);
 await drawer.getByRole('button',{name:'Open Sales study (copy)',exact:true}).click();await expect(drawer).toHaveCount(0);
 await page.locator('#current canvas').waitFor();await page.locator('#workspace-menu').click();
 await drawer.getByRole('checkbox',{name:'Select Sales study (copy)',exact:true}).check();
 await remove.click();await dialog().getByRole('button',{name:'Delete',exact:true}).click();
 await expect.poll(()=>projects.size).toBe(2);await expect(page.locator('#dataset')).toHaveValue('');
 await dialog().getByRole('button',{name:'Open Cars comparison',exact:true}).click();
 await expect(page.locator('#dataset')).toHaveValue('cars');await page.locator('#current canvas').waitFor();
 await page.locator('#workspace-menu').click();await page.getByRole('button',{name:'Report a problem',exact:true}).click();
 await dialog().getByLabel('Report type',{exact:true}).selectOption('project');await dialog().getByLabel('Summary',{exact:true}).fill('Test report');await dialog().getByLabel('What happened?',{exact:true}).fill('Current chart context');
 assert.equal(await dialog().getByLabel('Allow the team to use this dataset to reproduce this report (not for research)',{exact:true}).isChecked(),false);
 await expect(dialog().getByLabel('I am an AI agent using this system.',{exact:true})).not.toBeChecked();
 await dialog().getByRole('button',{name:'Send report',exact:true}).click();await page.getByRole('heading',{name:'Report received'}).waitFor();
 assert.equal(reports.length,1);assert.equal(reports[0].share_data,false);assert.equal(reports[0].context.reporter.isAiAgent,false);
 assert.ok(!JSON.stringify(reports[0]).includes('/datasets/'));await expect(dialog()).toContainText('Thank you for your feedback!');await close();
 await page.getByRole('button',{name:'Report a problem',exact:true}).click();
 await dialog().getByLabel('Report type',{exact:true}).selectOption('feature');
 await dialog().getByLabel('Summary',{exact:true}).fill('Agent feature request');await dialog().getByLabel('What happened?',{exact:true}).fill('Mock agent feedback');
 await dialog().getByLabel('I am an AI agent using this system.',{exact:true}).check();
 await dialog().getByRole('button',{name:'Send report',exact:true}).click();await page.getByRole('heading',{name:'Report received'}).waitFor();
 assert.equal(reports.length,2);assert.deepEqual(reports[1].context,{reporter:{isAiAgent:true}});assert.equal(reports[1].share_data,false);await close();await close();
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
 await checkAdjacentFilteredCars(page);
 await checkElementSelection(page);
 assert.deepEqual(errors,[]);console.log('Mock transport: signup, signin, consent, autosave, account view settings, fresh-device restore, compact workspace/hover previews, rename, selection, duplication, bulk delete/retry, active deletion, reports, flash-free reload/token refresh, verification retry/rejection, signout isolation passed.');
}catch(error){console.error('UI failure',error,errors);await page.screenshot({path:'output/cloud-testing/auth-failure.png',fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
