import { accountSession } from './session.js';
import { RESEARCH_NOTICE, CONSENT_VERSION } from './privacy.js';

function element(tag, text, className) {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
}
function button(text, action) {
  const node = element('button', text); node.type = 'button'; node.addEventListener('click', () => Promise.resolve().then(action).catch(showError)); return node;
}
let statusNode;
function showError(error) { statusNode = document.querySelector('dialog[open]:last-of-type .account-status') ?? statusNode; if (statusNode) { statusNode.textContent = error.message || 'Please try again.'; statusNode.setAttribute('role', 'alert'); } }
function dialog(title) {
  const box = element('dialog', '', 'account-dialog'), header = element('header');
  header.append(element('h2', title), button('Close', () => box.close())); box.append(header);
  box.addEventListener('close', () => box.remove()); document.body.append(box);
  const status = element('p', '', 'account-status'); status.setAttribute('role', 'status');
  box.append(status); statusNode = status; return { box, status, open: () => box.showModal() };
}
function input(label, type = 'text', value = '') {
  const wrapper = element('label'), field = element('input'); field.type = type; field.value = value;
  wrapper.append(element('span', label), field); return { wrapper, field };
}
export async function initializeAccountMenu({ snapshot, restore, newVisualization, useDataset, thumbnail, busy, switchAccount }) {
  const header = document.querySelector('.app-header');
  const menuButton = button('☰', () => openMenu()); menuButton.id = 'workspace-menu'; menuButton.setAttribute('aria-label', 'Open workspace menu');
  menuButton.disabled = true; header.prepend(menuButton);
  const accountButton = button('Account', () => settings()); accountButton.id = 'account-button';
  accountButton.disabled = true; header.append(accountButton);
  const cloudStatus = element('span', '', 'cloud-status'); cloudStatus.id = 'cloud-status'; cloudStatus.setAttribute('role', 'status'); header.append(cloudStatus);
  const session = await accountSession(), account = session.account;
  let lastUser, greeted = new Set();
  const update = async state => {
    if (!state.user || (lastUser && lastUser !== state.user.id)) return;
    if (state.identityChanged || lastUser !== (state.user?.id ?? null)) {
      lastUser = state.user?.id ?? null; await switchAccount(state.user);
    }
    if (state.user && (!state.profile || state.profile.consent_version !== CONSENT_VERSION) && !greeted.has(state.user.id)) {
      greeted.add(state.user.id); consentDialog();
    }
  };
  session.subscribe(update);
  session.onStatus(text => { cloudStatus.textContent = text; });
  await update(session.state);
  menuButton.disabled = false; accountButton.disabled = false;
  function requireAccount() {
    if (!account.user) { location.reload(); return false; }
    return true;
  }
  function consentDialog() {
    const d = dialog('Help improve visualization authoring'), choice = input('Share interaction history for research', 'checkbox');
    choice.field.checked = true; d.box.append(element('p', RESEARCH_NOTICE), choice.wrapper,
      button('Continue', async () => { await account.consent(choice.field.checked); d.box.close(); })); d.open();
  }
  function settings() {
    if (!requireAccount()) return;
    const d = dialog('Settings'), choice = input('Share interaction history for research', 'checkbox');
    choice.field.checked = account.profile?.research_enabled === true;
    d.box.append(element('p', account.user.email), element('p', RESEARCH_NOTICE), choice.wrapper,
      button('Save preferences', async () => { await account.consent(choice.field.checked); d.status.textContent = 'Preference saved.'; }),
      button('Sign out', async () => { await account.signOut(); d.box.close(); })); d.open();
  }
  function about() {
    const d = dialog('About Visualization Autocomplete');
    d.box.append(element('p', 'Build visualizations through stepwise recommendations powered by ggaction.'),
      element('h3', 'Contributors'), element('p', 'Hyeon Jeon · Sungbok Shin · Jinwook Seo · Niklas Elmqvist'), element('h3', 'Research and software'));
    for (const [title, href] of [
      ['ggaction documentation', 'https://ggaction.github.io/ggaction/'],
      ['ggaction source', 'https://github.com/ggaction/ggaction'],
      ['Visualization Autocomplete: Visualization Authoring via Stepwise Design Recommendations', 'https://arxiv.org/abs/2607.15608'],
      ['ggaction: A Grammar of Graphical Actions', 'https://arxiv.org/abs/2609.14353'],
      ['Visualization Autocomplete source', 'https://github.com/ggaction/vis-autocomplete']]) {
      const a = element('a', title); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; d.box.append(a);
    }
    d.box.append(element('h3', 'Your data'), element('p', RESEARCH_NOTICE));
    const privacy = element('a', 'Privacy and data use'); privacy.href = '/privacy.html'; privacy.target = '_blank'; privacy.rel = 'noopener noreferrer';
    d.box.append(privacy); d.open();
  }
  function report() {
    if (!requireAccount()) return;
    const d = dialog('Report a problem or suggest a feature');
    const kind = element('select'); kind.setAttribute('aria-label', 'Report type');
    for (const [value, text] of [['general','General problem'],['project','Current visualization'],['feature','Feature request']]) {
      const option = element('option', text); option.value = value; kind.append(option);
    }
    const title = input('Summary'), body = element('textarea'), data = input('Allow the team to use this dataset to reproduce this report (not for research)', 'checkbox');
    title.field.required = true; title.field.maxLength = 160; body.required = true; body.maxLength = 10000; body.setAttribute('aria-label', 'What happened?');
    const contextNote = element('p', 'Includes chart code, field names, and settings. Dataset rows are included only if you check the box below.'); contextNote.hidden = true;
    data.wrapper.hidden = true; kind.addEventListener('change', () => { data.wrapper.hidden = kind.value !== 'project'; contextNote.hidden = data.wrapper.hidden; });
    d.box.append(kind, title.wrapper, element('p','Describe what happened and what you expected.'), body, contextNote, data.wrapper,
      button('Send report', async () => {
        if (!title.field.reportValidity() || !body.reportValidity()) return;
        // Freeze this exact moment, independent of later edits in the editor.
        const project = kind.value === 'project' ? snapshot() : null;
        if (kind.value === 'project' && !project) throw new Error('Create a visualization first.');
        const result = await account.report({kind:kind.value,title:title.field.value,description:body.value,project,shareData:kind.value === 'project' && data.field.checked});
        d.box.replaceChildren(element('h2','Report received'),element('p', `Reference: ${result.id}`),button('Close',()=>d.box.close()));
      })); d.open();
  }
  async function dataLibrary() {
    if (!requireAccount()) return;
    const d = dialog('My datasets'); d.open();
    for (const row of await account.datasets()) d.box.append(button(row.name, async () => {
      if (busy()) return;
      const imported = await account.loadDataset(row); await account.newProject(row.name); await useDataset({id:crypto.randomUUID(),name:row.name,imported}); d.box.close();
    }));
  }
  async function openMenu() {
    const d = dialog('Workspace'); d.box.classList.add('workspace-drawer'); d.open();
    d.box.append(button('New visualization', async () => { if (busy()) return; await account.newProject?.(); await newVisualization(); d.box.close(); }),
      button('My datasets', dataLibrary));
    const list = element('div', '', 'cloud-projects'); d.box.append(element('h3','My visualizations'), list);
    if (account.user) {
      for (const row of await account.list()) {
        const item = element('div', '', 'cloud-project');
        const open = button(row.title, async () => { if (busy()) return; const project = await account.open(row.id); await restore(project); d.box.close(); });
        if (row.thumbnail?.startsWith('data:image/png;base64,')) { const img = element('img'); img.src = row.thumbnail; img.alt = ''; open.prepend(img); }
        item.append(open, element('small', new Date(row.updated_at).toLocaleString()), button('Delete', async () => {
          const confirm = dialog('Delete visualization?'); confirm.box.append(element('p', row.title), button('Delete visualization', async () => {
            const active = account.current?.id === row.id; await account.remove(row.id); if (active) await newVisualization(); item.remove(); confirm.box.close();
          })); confirm.open();
        })); list.append(item);
      }
      if (!list.children.length) list.append(element('p', 'Your saved visualizations will appear here.'));
      d.box.append(button('Rename current visualization', () => {
        if (!snapshot()) throw new Error('Create a visualization first.');
        const r = dialog('Rename visualization'), name = input('Name','text',account.current?.title ?? 'Untitled visualization');
        r.box.append(name.wrapper,button('Save name',async()=>{await account.rename(name.field.value); const p=snapshot(); if(p)await account.save(p,thumbnail());r.box.close();d.box.close();}));r.open();
      }), button('Duplicate current visualization', async () => { const p=snapshot(); if(!p)return; await account.newProject(`${account.current?.title ?? 'Visualization'} (copy)`);await account.save(p,thumbnail());d.box.close(); }));
    }
    const bottom = element('footer'); bottom.append(button('Report a problem', report), button('Settings', settings), button('About', about)); d.box.append(bottom);
  }
  return { save: (project) => account.user ? account.save(project, thumbnail()) : Promise.resolve(), record: (type, payload) => account.record?.(type, payload),
    get user() { return account.user; }, settings, about, newProject: () => account.newProject?.(), ready: true };
}
