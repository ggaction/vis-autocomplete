"""Guest UI + real auth-client transport, without accounts or production writes."""
import argparse, base64, json, time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect
from saved_project import READ_ACCOUNT_PROJECT
expect.set_options(timeout=60000)

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:5205')
args = parser.parse_args()
out = Path('output/guest-testing'); out.mkdir(parents=True, exist_ok=True)
guest = {'id': '11111111-1111-4111-8111-111111111111', 'is_anonymous': True, 'email': ''}
member = {'id': '22222222-2222-4222-8222-222222222222', 'is_anonymous': False, 'email': 'member@example.org'}
users = {u['id']: dict(u, aud='authenticated', role='authenticated', app_metadata={}, user_metadata={}, identities=[], created_at='2026-10-26T10:00:00Z') for u in [guest, member]}
profiles, projects, uploads, events, requests = {}, {}, {}, [], []
guest_starts = 0
expires = int(time.time()) + 3600
def token(user):
    payload = base64.urlsafe_b64encode(json.dumps({'sub': user['id'], 'is_anonymous': user['is_anonymous'], 'role': 'authenticated', 'exp': expires}).encode()).decode().rstrip('=')
    return 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.signature'
def session(user):
    return dict(access_token=token(user), refresh_token=user['id'], expires_in=3600, token_type='bearer', user=user)
def identity(request):
    bearer = request.headers.get('authorization', '').removeprefix('Bearer ')
    return next((u for u in users.values() if token(u) == bearer), users[guest['id']])

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1700, 'height': 1100})
    context.add_init_script("""window.authLandingWasVisible=false;function sample(){const g=document.getElementById('auth-gate');if(g&&!g.hidden)window.authLandingWasVisible=true;requestAnimationFrame(sample)}requestAnimationFrame(sample);""")
    def transport(route):
        global guest_starts
        req=route.request; url=urlparse(req.url); body=req.post_data_json if req.post_data and 'application/json' in req.headers.get('content-type','') else {}
        user=identity(req); requests.append((req.method, url.path, user['id']))
        def reply(value, status=200):
            route.fulfill(status=status, content_type='application/json', body=json.dumps(value), headers={'Access-Control-Allow-Origin': args.url, 'Access-Control-Allow-Headers': '*'})
        if req.method=='OPTIONS': return reply({})
        if url.path=='/auth/v1/signup':
            if body.get('email'): return reply({'user':users[member['id']]})
            guest_starts+=1; return reply(session(users[guest['id']]))
        if url.path=='/auth/v1/token':
            if body.get('password')=='wrong': return reply({'message':'Invalid credentials'},400)
            if body.get('refresh_token'): return reply(session(users[body['refresh_token']]))
            return reply(session(users[member['id']]))
        if url.path=='/auth/v1/user':
            if req.method=='PUT': user['user_metadata'].update(body.get('data',{}))
            return reply(user)
        if url.path in ['/auth/v1/logout','/auth/v1/recover']: return reply({})
        if url.path=='/rest/v1/profiles': return reply([profiles[user['id']]] if user['id'] in profiles else [])
        if url.path.endswith('/rpc/set_research_consent'):
            profiles[user['id']]=dict(id=user['id'],research_enabled=body['enabled'],consent_version='history-only-v1',consent_revision=profiles.get(user['id'],{}).get('consent_revision',0)+1)
            return reply(profiles[user['id']])
        if url.path.endswith('/rpc/record_interactions'):
            profile=profiles.get(user['id'],{})
            assert profile.get('research_enabled') and body['consent']==profile['consent_revision']
            events.extend(dict(e, owner=user['id']) for e in body['events']); return reply(len(body['events']))
        if url.path.endswith('/rpc/save_project'):
            assert not user['is_anonymous'], 'Guest attempted a private project upload'
            row=projects.get(body['project']); assert (row or {}).get('revision',0)==body['expected']
            projects[body['project']]=dict(id=body['project'],owner_id=user['id'],title=body['name'],snapshot=body['document'],thumbnail=body['thumbnail'],revision=body['expected']+1,updated_at='2026-10-26T10:00:00Z')
            return reply(body['expected']+1)
        if url.path=='/rest/v1/projects':
            assert not user['is_anonymous']; rows=list(projects.values()); query=parse_qs(url.query)
            if 'id' in query: rows=[r for r in rows if 'eq.'+r['id']==query['id'][0]]
            return reply(rows[0] if 'vnd.pgrst.object' in req.headers.get('accept','') else rows)
        if url.path=='/rest/v1/datasets':
            assert not user['is_anonymous']
            return reply([] if req.method=='GET' else body)
        if url.path.startswith('/storage/v1/object/'):
            assert not user['is_anonymous'], 'Guest attempted a dataset upload'
            uploads[url.path]=req.post_data; return reply({'Key':url.path})
        return reply({})
    context.route('https://cloud-test.supabase.co/**', transport)
    page=context.new_page(); page.set_default_timeout(60000); errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    def dialog(): return page.locator('dialog[open]').last
    def close(): dialog().get_by_role('button', name='Close', exact=True).click()
    try:
        page.goto(args.url); page.wait_for_load_state('networkidle')
        expect(page.get_by_role('button',name='Try without account',exact=True)).to_be_enabled()
        assert guest_starts==0 and page.locator('#dataset').count()==0
        page.screenshot(path=str(out/'landing.png'))
        page.get_by_role('button',name='Try without account',exact=True).click()
        expect(dialog().get_by_role('heading',name='Help improve visualization authoring')).to_be_visible()
        expect(dialog()).to_contain_text('guest session ID')
        assert not events and not projects and not uploads
        dialog().get_by_role('button',name='Continue',exact=True).click()
        expect(page.locator('#dataset')).to_be_enabled()
        expect(page.locator('.guest-account-buttons').get_by_role('button',name='Sign up',exact=True)).to_be_visible()
        expect(page.locator('#account-button')).to_be_hidden()
        page.locator('#workspace-menu').click(); expect(dialog()).to_contain_text('Sign in to save and manage your projects.')
        dialog().evaluate('async e => { await Promise.allSettled(e.getAnimations().map(a => a.finished)); }')
        page.screenshot(path=str(out/'workspace.png')); close()
        page.locator('#dataset').select_option('cars')
        expect(page.get_by_role('button',name='Select column Horsepower',exact=True)).to_be_visible()
        assert page.get_by_label('Project name',exact=True).count()==0
        page.get_by_role('button',name='Select column Horsepower',exact=True).click()
        page.get_by_role('button',name='Select column Acceleration',exact=True).click()
        scatter=page.locator('#cards .card[data-method="createScatterPlot"]'); scatter.hover(); scatter.locator('.apply-button').click()
        expect(page.locator('#current')).to_have_attribute('data-last-method','createScatterPlot')
        with page.expect_request('**/rpc/record_interactions'):
            page.get_by_role('button',name='Undo',exact=True).click()
        page.get_by_role('button',name='Redo',exact=True).click()
        expect(page.locator('#current')).to_have_attribute('data-steps','1')
        expect(page.locator('#current canvas')).to_be_visible()
        page.wait_for_function('async () => { const p = await '+READ_ACCOUNT_PROJECT+'; const s = p.datasets.find(d => d.id === p.activeId).session; return s?.entries[s.index]?.calls.some(c => c.method === "createScatterPlot"); }')
        assert events and all(e['owner']==guest['id'] for e in events)
        assert all('Horsepower' not in json.dumps(e) and 'rows' not in json.dumps(e) for e in events)
        assert not projects and not uploads
        page.reload(); expect(page.locator('#current canvas')).to_be_visible()
        assert not page.evaluate('window.authLandingWasVisible') and guest_starts==1
        expect(page.locator('#dataset')).to_have_value('cars')
        page.locator('.guest-account-buttons').get_by_role('button',name='Sign up',exact=True).click()
        expect(page.locator('#auth-heading')).to_have_text('Create your account')
        page.get_by_role('button',name='Back to your visualization',exact=True).click()
        expect(page.locator('#current canvas')).to_be_visible()
        page.locator('#workspace-menu').click(); page.get_by_role('button',name='Settings',exact=True).click()
        dialog().get_by_role('checkbox').uncheck(); dialog().get_by_role('button',name='Save preferences',exact=True).click()
        expect(dialog()).to_contain_text('Preference saved.'); close(); close()
        count=len(events); page.get_by_role('button',name='Undo',exact=True).click()
        page.wait_for_timeout(5200); assert len(events)==count
        page.get_by_role('button',name='Redo',exact=True).click()
        expect(page.locator('#current')).to_have_attribute('data-steps','1')
        expect(page.locator('#current canvas')).to_be_visible()
        page.locator('.guest-account-buttons').get_by_role('button',name='Sign in',exact=True).click()
        page.get_by_label('Email',exact=True).fill(member['email']); page.get_by_label('Password',exact=True).fill('wrong')
        page.locator('#auth-submit').click(); expect(page.locator('#auth-status')).to_contain_text('Could not sign in')
        page.get_by_label('Password',exact=True).fill('test-password-only'); page.locator('#auth-submit').click()
        expect(dialog().get_by_role('heading',name='Help improve visualization authoring')).to_be_visible()
        dialog().get_by_role('checkbox').uncheck(); dialog().get_by_role('button',name='Continue',exact=True).click()
        expect(page.locator('#current canvas')).to_be_visible(); expect(page.locator('#cloud-status')).to_have_text('Saved')
        assert len(projects)==1 and uploads
        assert all(row['owner_id']==member['id'] for row in projects.values())
        assert 'createScatterPlot' in json.dumps(next(iter(projects.values()))['snapshot'])
        expect(page.locator('.guest-account-buttons')).to_be_hidden()
        page.screenshot(path=str(out/'signed-in.png'))
        page.reload(); expect(page.locator('#current canvas')).to_be_visible(); assert len(projects)==1
        page.locator('#account-button').click(); dialog().get_by_role('button',name='Sign out',exact=True).click()
        expect(page.get_by_role('button',name='Try without account',exact=True)).to_be_enabled()
        assert page.locator('#dataset').count()==0 and not errors
        print('PASS: guest entry, consent, server events without uploads, chart editing, reload, workspace, cancel/failed sign-in, transfer, sign-out')
    except Exception:
        page.screenshot(path=str(out/'failure.png'),full_page=True)
        print('Browser errors:',errors)
        raise
    finally:
        browser.close()
