"""Keep typed drafts and every +/- click while typography work is pending.

Run: python test/browser/typography-click-queue.py
Uses an isolated DOM and native ggaction programs; no account/server required.
"""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

HARNESS = r'''
import { chart } from 'ggaction';
import { createTypographyToolbar } from './web/chart-typography.js';
import { prepareTypography, chartTextItems } from './src/chart-typography.js';
window.setup = (initial = 12, mixed = false) => {
  const view = chart().createCanvas({plot:{width:2000,height:2000},margin:500})
    .createData({id:'d',values:[{x:1,y:2},{x:2,y:3}]})
    .createScatterPlot({id:'p',data:'d',x:'x',y:'y'})
    .editAxes({x:{labels:{fontSize:initial},title:{fontSize:initial}},
      y:{labels:{fontSize:initial},title:{fontSize:mixed ? initial+5 : initial}}});
  const state = {phase:'recommendations',view,committing:false};
  const initialItems = chartTextItems(view);
  let resolve, reject, active = 0;
  window.audit = {calls:[],errors:[],maxActive:0,initial:initialItems.map(t=>t.fontSize)};
  const toolbar = createTypographyToolbar(document.querySelector('#toolbar'), document.querySelector('#chart'), {
    read:()=>state, onError:message=>audit.errors.push(message),
    async apply(options) {
      state.committing=true; audit.calls.push(options); audit.maxActive=Math.max(audit.maxActive,++active); toolbar.refresh();
      // Manually released worker result: arbitrarily many clicks may arrive first.
      try {
        await new Promise((done,failed)=>{resolve=done;reject=failed});
        state.view=prepareTypography(state.view,state.view,options).view;
      } finally { active--; state.committing=false; toolbar.refresh(); }
    }
  });
  window.finish = error=>error ? reject(new Error(error)) : resolve();
  window.busy = kind=>{state.loading=false;state.resizing=false;state.committing=false;if(kind)state[kind]=true;toolbar.refresh();};
  window.sizes = ()=>chartTextItems(state.view).map(t=>t.fontSize);
  toolbar.refresh();
};
'''

with tempfile.TemporaryDirectory() as directory:
    bundle = Path(directory) / 'toolbar.js'
    subprocess.run(['node', '--input-type=module', '-e',
        'import {build} from "esbuild"; await build({stdin:{contents:' + json.dumps(HARNESS) +
        ',resolveDir:process.cwd()},bundle:true,platform:"browser",format:"esm",outfile:' + json.dumps(str(bundle)) + '});'], check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for initial, mixed, first, steps in [
            (12, False, 1, [1]*30+[-1]*10),
            (12, True, -1, [-1,1,1]*8),
            (6, False, 1, [-1,-1,1]),
            (96, False, -1, [1,1,-1]),
        ]:
            page = browser.new_page()
            page.set_content('<div id="toolbar"></div><div id="chart"></div>')
            page.add_script_tag(path=str(bundle), type='module')
            page.wait_for_function("typeof window.setup === 'function'")
            page.evaluate('([size,mixed])=>setup(size,mixed)', [initial, mixed])
            plus = page.get_by_role('button', name='Increase selected font sizes', exact=True)
            minus = page.get_by_role('button', name='Decrease selected font sizes', exact=True)
            (plus if first > 0 else minus).click()
            page.wait_for_function('audit.calls.length===1')
            expect(page.locator('#chart-font-size')).to_be_disabled()
            for delta in steps:
                button = plus if delta > 0 else minus
                expect(button).to_be_enabled()
                button.click(timeout=1500)
            assert page.evaluate('audit.calls.length') == 1
            page.evaluate('finish()')
            page.wait_for_function('audit.calls.length===2')
            assert page.evaluate('audit.calls[1].deltas') == steps
            # More clicks may arrive even during the second render.
            plus.click(); minus.click(); plus.click()
            page.evaluate('finish()')
            page.wait_for_function('audit.calls.length===3')
            page.evaluate('finish()')
            expect(page.locator('#chart-font-size')).to_be_enabled()
            report = page.evaluate('({ ...audit, sizes:sizes() })')
            expected = report['initial']
            for delta in [first, *steps, 1, -1, 1]:
                expected = [max(6, min(96, size+delta)) for size in expected]
            assert report['sizes'] == expected, report
            assert report['maxActive'] == 1 and not report['errors'], report
            # Unrelated work must still block edits; only typography owns this queue.
            for kind in ['loading', 'resizing', 'committing']:
                page.evaluate('busy', kind)
                expect(plus).to_be_disabled(); expect(minus).to_be_disabled()
            print('PASS queued clicks:', initial, 'mixed:', mixed, 'final:', sorted(set(expected)), flush=True)
            page.close()
        # Drive refresh/commit boundaries explicitly so this regression does
        # not rely on a particular machine losing the race between fill/Enter.
        for outcome in ['accepted', 'failed', 'escape', 'scope']:
            page = browser.new_page()
            page.clock.install()
            page.set_content('<div id="toolbar"></div><div id="chart"></div>')
            page.add_script_tag(path=str(bundle), type='module')
            page.wait_for_function("typeof window.setup === 'function'")
            page.evaluate('setup(13)')
            size = page.locator('#chart-font-size')
            size.fill('18')
            for kind in ['loading', None, 'resizing', None]:
                page.evaluate('busy', kind)
                expect(size).to_have_value('18')
            if outcome == 'escape':
                size.press('Escape')
                expect(size).to_have_value('13')
                page.clock.run_for(500)
                assert page.evaluate('audit.calls') == []
            elif outcome == 'scope':
                # A selection update can arrive while the input retains focus.
                # The old scope's unsent draft must not populate the new one.
                page.get_by_label('Axis titles', exact=True).evaluate("node=>{node.checked=false;node.dispatchEvent(new Event('change'))}")
                expect(size).to_have_value('13')
                size.press('Enter'); page.clock.run_for(500)
                assert page.evaluate('audit.calls') == []
            else:
                size.press('Enter'); size.press('Tab')
                page.clock.run_for(200)
                assert page.evaluate('audit.calls.length') == 1
                assert page.evaluate('audit.calls[0].fontSize') == 18
                expect(size).to_have_value('18')
                expect(size).to_be_disabled()
                page.evaluate('finish', 'Test failure' if outcome == 'failed' else None)
                expect(size).to_be_enabled()
                expect(size).to_have_value('13' if outcome == 'failed' else '18')
                page.clock.run_for(500)
                assert page.evaluate('audit.calls.length') == 1, 'Enter plus blur must submit once'
                expected = 13 if outcome == 'failed' else 18
                assert set(page.evaluate('sizes()')) == {expected}
                assert page.evaluate('audit.errors') == (['Test failure'] if outcome == 'failed' else [])
            print('PASS typed font-size draft:', outcome, flush=True)
            page.close()
        browser.close()
