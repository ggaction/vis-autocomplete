import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createProject } from '../web/project.js';
import { importDataset } from '../src/data-import.js';
import { chart } from 'ggaction';
import { selectableMarks } from '../src/mark-picking.js';
import { mkdir } from 'node:fs/promises';

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1800,height:1100}});
const user={id:'11111111-1111-4111-8111-111111111111',aud:'authenticated',email:'test@example.org',app_metadata:{provider:'email'},user_metadata:{},identities:[],created_at:new Date().toISOString()};
const token=['eyJhbGciOiJIUzI1NiJ9',Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'test'].join('.');
await context.route('**/api/config',route=>route.fulfill({json:{supabaseUrl:'https://highlight-test.supabase.co',supabaseKey:'sb_publishable_test'}}));
await context.route('https://highlight-test.supabase.co/**',route=>{
  const path=new URL(route.request().url()).pathname;
  const value=path==='/auth/v1/token'?{access_token:token,refresh_token:'test',expires_in:3600,token_type:'bearer',user}
    :path==='/auth/v1/user'?user:path==='/rest/v1/profiles'?[{id:user.id,research_enabled:false,consent_version:'recommendation-research-v2'}]
      :path.endsWith('/rpc/save_project')?1:[];
  return route.fulfill({json:value});
});
await context.route('**/api/research',route=>route.fulfill({json:{ok:true}}));
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(60000);
const c=(method,args)=>({method,args});
const imported=importDataset(JSON.stringify(Array.from({length:200},(_,i)=>({X:i+1,Y:i%7+2,Group:['A','B','C'][i%3]}))),{format:'json',name:'Highlight'});
try {
  await page.goto(process.env.APP_URL??'http://127.0.0.1:5187');await page.waitForLoadState('networkidle');
  await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('test-password');await page.locator('#auth-submit').click();
  await page.locator('#project-file').waitFor({state:'attached'});
  await page.waitForFunction(()=>document.querySelector('#account-button')?.textContent==='test@example.org');
  await page.waitForLoadState('networkidle');
  for(const mode of ['transition','preview'])for(const kind of ['unit','facet','concat']){
    const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}})];
    if(kind==='facet')calls.push(c('facet',{field:'Group',data:'dataset',columns:3,guides:{axes:'outer',legend:'shared'}}));
    if(kind==='concat')calls.push(c('createAdjacentPlot',{id:'right',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{x:'X',y:'Y'}}}));
    const snapshot={setupCalls:[c('createCanvas',{plot:{width:314,height:314},margin:120}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})],calls,steps:calls.length,phase:'recommendations',selection:{x:'X',y:'Y',color:'Group'},context:{target:'plot',...(kind==='concat'?{childPath:['plot']}:{})},plotData:'dataset',optionGroup:'style'};
    const project=createProject([{id:'highlight',name:'Highlight',imported,session:{entries:[snapshot],index:0}}],'highlight');
    await page.locator('#project-file').setInputFiles({name:'highlight.visauto',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(project))});
    await page.waitForFunction(n=>document.querySelector('#current')?.dataset.steps===String(n)&&!document.querySelector('#reset')?.disabled,calls.length);
    await page.locator(`#view-mode [data-mode=${mode}]`).click();
    await page.waitForTimeout(700);
    await page.getByRole('button',{name:'Highlight',exact:true}).click();
    let fixture=chart().createCanvas({plot:{width:314,height:314},margin:120}).createData({id:'dataset',values:imported.rows});
    for(const call of calls)fixture=fixture[call.method](call.args);
    const picks=selectableMarks(fixture).flatMap(g=>g.items).slice(0,2);
    const panel=page.getByRole('region',{name:'Highlight selected marks'});
    for(let i=0;i<picks.length;i++){
      const b=picks[i].bounds;
      const location=await page.locator('#current canvas[data-chart]').evaluate((canvas,p)=>{
        const rect=canvas.getBoundingClientRect(),[x,y,w,h]=canvas.dataset.viewBox.split(' ').map(Number);
        return {x:rect.left+(p.x-x)/w*rect.width,y:rect.top+(p.y-y)/h*rect.height};
      },{x:(b.left+b.right)/2,y:(b.top+b.bottom)/2});
      await page.locator('#current canvas[data-chart]').click({position:await page.locator('#current canvas[data-chart]').evaluate((c,p)=>{const r=c.getBoundingClientRect();return{x:p.x-r.left,y:p.y-r.top};},location),modifiers:i?['Shift']:[]});
      await panel.getByText(`${i+1} rows selected`,{exact:true}).waitFor();
      await page.waitForTimeout(700);
    }
    await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});
    assert.equal(await page.locator('#current').getAttribute('data-steps'),String(calls.length));
    await page.getByRole('button',{name:'Highlight',exact:true}).click();
    await panel.getByRole('checkbox',{name:'Select row 1',exact:true}).check();
    await panel.getByRole('checkbox',{name:'Select row 2',exact:true}).check();
    await panel.getByRole('button',{name:'Apply highlight'}).click();
    await page.waitForFunction(n=>document.querySelector('#current')?.dataset.steps===String(n)&&!document.querySelector('#reset')?.disabled,calls.length+1);
    await page.keyboard.press('Control+z');
    await page.waitForFunction(n=>document.querySelector('#current')?.dataset.steps===String(n),calls.length);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForFunction(n=>document.querySelector('#current')?.dataset.steps===String(n),calls.length+1);
    await page.locator('#group-style').click();await page.locator('#action-search').fill('highlight');await page.locator('#action-search').press('Enter');
    await page.locator('.card').filter({hasText:'Highlight marks'}).first().hover();
    await page.getByRole('group',{name:'Highlight marks: Color',exact:true}).waitFor();
    if (mode==='transition'&&kind==='unit') {
      const highlight=page.locator('.card').filter({hasText:'Highlight marks'}).first();
      await highlight.getByRole('button',{name:'Condition',exact:true}).click();
      await page.getByRole('group',{name:'Highlight marks: Variable or channel',exact:true}).getByRole('button',{name:'X',exact:true}).click();
      await page.getByRole('group',{name:'Highlight marks: Condition',exact:true}).getByRole('button',{name:'oneOf',exact:true}).click();
      const values=page.getByRole('group',{name:'Highlight marks: Values',exact:true});
      assert.ok(await values.getByRole('button').count()<=43);
      await values.getByRole('searchbox').fill('199');
      await values.getByRole('button',{name:'199',exact:true}).click();
    }

    await page.waitForTimeout(1000);
    assert.equal(errors.length,0,errors.join('\n'));
    await mkdir('output/highlighting',{recursive:true});await page.screenshot({path:`output/highlighting/${mode}-${kind}.png`,fullPage:true});
    await page.locator('#action-search').fill('');
    console.log(`${mode}/${kind}: row selection, apply, undo, redo and card controls passed`);
  }
  assert.deepEqual(errors,[]);
}catch(error){console.error('UI ERRORS',errors);console.error((await page.locator('body').innerText()).slice(-2500));await page.screenshot({path:'/tmp/highlight-browser-error.png',fullPage:true});throw error;}finally{await browser.close();}
