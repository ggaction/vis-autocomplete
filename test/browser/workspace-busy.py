"""Workspace controls must reflect blocked authoring work instead of dropping clicks.

Uses the real menu with a deterministic account transport and explicit busy and
removal barriers. No remote account, wall-clock sleep or app server is needed.
"""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

HARNESS = r'''
import { initializeAccountMenu } from './web/cloud/menu.js';
window.setup = async () => {
  let busy = false, release;
  const row = {id:'project',title:'Sales study',revision:1,updated_at:'2026-10-27T00:00:00Z'};
  window.audit = {removed:[],reset:0};
  const account = {user:{id:'member',email:'test@example.invalid'},profile:{research_enabled:false},current:row,
    list:async()=>[row],remove:async id=>{audit.removed.push(id);await new Promise(resolve=>{release=resolve});account.current=null}};
  window.testSession = {account,state:{user:account.user,profile:account.profile},subscribe(){},onStatus(){}};
  const menu = await initializeAccountMenu({busy:()=>busy,thumbnail:()=>null,snapshot:()=>null,
    switchAccount:async()=>{},newVisualization:async()=>{audit.reset++}});
  window.setBusy = value=>{busy=value;menu.refreshBusy?.()};
  window.finishDelete = ()=>release();
};
'''
with tempfile.TemporaryDirectory() as directory:
    bundle = Path(directory) / 'menu.js'
    build = ('import {build} from "esbuild"; await build({stdin:{contents:' + json.dumps(HARNESS) +
             ',resolveDir:process.cwd()},bundle:true,platform:"browser",format:"esm",outfile:' + json.dumps(str(bundle)) +
             ',plugins:[{name:"account-fixture",setup(build){build.onLoad({filter:/web\\/cloud\\/session\\.js$/},()=>({contents:"export async function accountSession(){return window.testSession}",loader:"js"}))}}]});')
    subprocess.run(['node', '--input-type=module', '-e', build], check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content('<header class="app-header"></header>')
        page.add_script_tag(path=str(bundle), type='module')
        page.wait_for_function("typeof setup === 'function'")
        page.evaluate('setup()')
        page.evaluate('setBusy(true)')
        page.get_by_role('button', name='Open workspace menu', exact=True).click()
        workspace = page.locator('dialog.workspace-drawer')
        page.get_by_role('checkbox', name='Select Sales study', exact=True).check()
        for name in ['Delete', 'Duplicate', 'New visualization', 'Open Sales study']:
            expect(workspace.get_by_role('button', name=name, exact=True)).to_be_disabled()
        page.evaluate('setBusy(false)')
        workspace.get_by_role('button', name='Delete', exact=True).click()
        confirm = page.locator('dialog').filter(has=page.get_by_role('heading', name='Delete visualization?', exact=True))
        submit = confirm.get_by_role('button', name='Delete', exact=True)
        page.evaluate('setBusy(true)')
        expect(submit).to_be_disabled()
        expect(confirm.get_by_role('button', name='Cancel', exact=True)).to_be_enabled()
        assert page.evaluate('audit.removed') == []
        page.evaluate('setBusy(false)')
        submit.click()
        page.wait_for_function('audit.removed.length===1')
        expect(submit).to_be_disabled()
        expect(confirm.get_by_role('button', name='Cancel', exact=True)).to_be_disabled()
        page.evaluate('finishDelete()')
        expect(confirm).to_have_count(0)
        expect(workspace.get_by_role('checkbox', name='Select Sales study', exact=True)).to_have_count(0)
        assert page.evaluate('audit') == {'removed':['project'], 'reset':1}
        workspace.get_by_role('button', name='Close', exact=True).click()
        expect(workspace).to_have_count(0)
        page.evaluate('setBusy(true);setBusy(false)')
        print('PASS workspace and confirmation controls track authoring busy state; one delete and reset', flush=True)
        browser.close()
