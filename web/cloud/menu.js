import { accountSession } from './session.js';
import { RESEARCH_NOTICE, CONSENT_VERSION } from './privacy.js';
import { fitLegacyThumbnail } from './thumbnail.js';

function element(tag, text, className) {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
}
function button(text, action) {
  const node = element('button', text); node.type = 'button'; node.addEventListener('click', () => Promise.resolve().then(action).catch(showError)); return node;
}
let statusNode;
function showError(error) { statusNode = document.querySelector('dialog[open]:last-of-type .account-status') ?? statusNode; if (statusNode) { statusNode.textContent = error.message || 'Please try again.'; statusNode.setAttribute('role', 'alert'); } }
function dialog(title, { dismissible = true } = {}) {
  const box = element('dialog', '', 'account-dialog'), header = element('header');
  header.append(element('h2', title));
  if (dismissible) header.append(button('Close', () => box.close()));
  else box.addEventListener('cancel', event => event.preventDefault());
  box.append(header);
  box.addEventListener('close', () => box.remove()); document.body.append(box);
  const status = element('p', '', 'account-status'); status.setAttribute('role', 'status');
  box.append(status); statusNode = status; return { box, status, open: () => box.showModal() };
}
function input(label, type = 'text', value = '') {
  const wrapper = element('label'), field = element('input'); field.type = type; field.value = value;
  wrapper.append(element('span', label), field); return { wrapper, field };
}
function projectNameDialog({ title = 'Name your project', value = '', submit = 'Create project', save }) {
  const d = dialog(title), form = element('form'), name = input('Project name', 'text', value);
  name.field.required = true; name.field.maxLength = 160;
  name.field.addEventListener('input', () => name.field.setCustomValidity(''));
  const apply = element('button', submit); apply.type = 'submit';
  form.append(name.wrapper, apply); d.box.append(form);
  let result = null, saving = false;
  const completed = new Promise(resolve => d.box.addEventListener('close', () => resolve(result), { once: true }));
  d.box.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const value = name.field.value.trim();
    name.field.setCustomValidity(value ? '' : 'Enter a project name.');
    if (saving || !name.field.reportValidity()) return;
    saving = true; for (const control of d.box.querySelectorAll('button, input')) control.disabled = true;
    try { await save(value); result = value; d.box.close(); }
    catch (error) { d.status.textContent = error.message; d.status.setAttribute('role', 'alert'); }
    finally { saving = false; for (const control of d.box.querySelectorAll('button, input')) control.disabled = false; }
  });
  d.open(); name.field.focus(); name.field.select(); return completed;
}
export async function initializeAccountMenu({ snapshot, restore, newVisualization, useDataset, thumbnail, busy, switchAccount }) {
  const header = document.querySelector('.app-header');
  const menuButton = button('☰', () => openMenu()); menuButton.id = 'workspace-menu'; menuButton.setAttribute('aria-label', 'Open workspace menu');
  menuButton.disabled = true; header.prepend(menuButton);
  const accountButton = button('', () => settings()); accountButton.id = 'account-button';
  accountButton.disabled = true; header.append(accountButton);
  const cloudStatus = element('span', '', 'cloud-status'); cloudStatus.id = 'cloud-status'; cloudStatus.setAttribute('role', 'status'); header.append(cloudStatus);
  const session = await accountSession(), account = session.account;
  let lastUser, greeted = new Set();
  const update = async state => {
    if (!state.user || (lastUser && lastUser !== state.user.id)) return;
    const metadata = state.user.user_metadata ?? {};
    const name = [metadata.full_name, metadata.name, metadata.display_name, state.user.email, state.user.id]
      .find(value => typeof value === 'string' && value.trim())?.trim();
    accountButton.textContent = name;
    accountButton.title = state.user.email && state.user.email !== name ? `${name}\n${state.user.email}` : name;
    accountButton.setAttribute('aria-label', `Settings for ${name}`);
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
    const d = dialog('Help improve visualization authoring', { dismissible: false }), choice = input('Share interaction history for research', 'checkbox');
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
    d.box.classList.add('about-dialog');
    const link = (title, href) => {
      const a = element('a', title); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
    };
    d.box.append(element('p', 'Create and refine visualizations through stepwise recommendations, powered by ggaction.'));
    const benefits = element('ul', '', 'about-benefits');
    for (const [title, description] of [
      ['Know what to try next.', ' Discover actions suited to your current chart, informed by common visualization practices.'],
      ['See changes before applying them.', ' Compare visual previews and tune parameters.'],
      ['Keep control as charts grow.', ' Work step by step, revisit history, and reuse the generated ggaction code.']]) {
      const item = element('li'); item.append(element('strong', title), document.createTextNode(description)); benefits.append(item);
    }
    const software = element('section'); software.append(element('h3', 'Software'));
    for (const [name, links] of [
      ['Visualization Autocomplete', [['Source', 'https://github.com/ggaction/vis-autocomplete']]],
      ['ggaction', [['Documentation', 'https://ggaction.github.io/ggaction/'], ['Source', 'https://github.com/ggaction/ggaction']]]]) {
      const row = element('div', '', 'about-software'); row.append(element('strong', name));
      const resources = element('span'); for (const [title, href] of links) resources.append(link(title, href));
      row.append(resources); software.append(row);
    }
    const papers = element('section'); papers.append(element('h3', 'Papers'), element('p', 'This tool builds on the following research:'));
    for (const [title, href, authors, venue] of [
      ['Visualization Autocomplete: Visualization Authoring via Stepwise Design Recommendations', 'https://arxiv.org/abs/2607.15608', 'Hyeon Jeon · Sungbok Shin · Niklas Elmqvist', 'TVCG · VIS 2026'],
      ['ggaction: A Grammar of Graphical Actions', 'https://arxiv.org/abs/2609.14353', 'Hyeon Jeon · Jinwook Seo', 'arXiv']]) {
      const paper = element('article', '', 'about-paper');
      paper.append(link(title, href), element('p', authors), element('small', venue)); papers.append(paper);
    }
    d.box.append(benefits, software, papers, element('h3', 'Contributors'), element('p', 'Hyeon Jeon · Sungbok Shin · Jinwook Seo · Niklas Elmqvist')); d.open();
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
      const imported = await account.loadDataset(row);
      if (!await nameNewProject(row.name)) return;
      await useDataset({id:crypto.randomUUID(),name:row.name,imported}); d.box.close();
    }));
  }
  function nameNewProject(datasetName) {
    return projectNameDialog({ value: datasetName.replace(/\.(csv|tsv|json)$/i, ''), save: name => account.newProject(name) });
  }
  function editableProjectTitle(row, open) {
    const wrapper = element('div', '', 'cloud-project-name');
    const title = element('button', row.title, 'cloud-project-title'); title.type = 'button';
    title.title = 'Double-click to rename'; title.setAttribute('aria-label', `Rename ${row.title}`);
    wrapper.append(title);
    const edit = () => {
      if (busy() || wrapper.querySelector('input')) return;
      const field = element('input'); field.type = 'text'; field.value = row.title; field.maxLength = 160; field.required = true;
      field.setAttribute('aria-label', 'Project name');
      title.hidden = true; wrapper.append(field); field.focus(); field.select();
      let saving = false, finished = false;
      const finish = () => { finished = true; field.remove(); title.hidden = false; };
      const save = async () => {
        if (saving || finished) return;
        const name = field.value.trim();
        if (!name) { field.setCustomValidity('Enter a project name.'); field.reportValidity(); field.focus(); return; }
        if (name === row.title) { finish(); return; }
        saving = true; field.disabled = true;
        try {
          row.title = await account.rename(name, row.id); title.textContent = row.title;
          title.setAttribute('aria-label', `Rename ${row.title}`); open.setAttribute('aria-label', `Open ${row.title}`); finish();
        } catch (error) { showError(error); field.disabled = false; field.focus(); }
        finally { saving = false; }
      };
      field.addEventListener('input', () => field.setCustomValidity(''));
      field.addEventListener('blur', save);
      field.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving) { finish(); title.focus(); } }
        else if (event.key === 'Enter') { event.preventDefault(); void save(); }
      });
    };
    title.addEventListener('dblclick', edit);
    title.addEventListener('keydown', event => { if (['Enter', ' ', 'F2'].includes(event.key)) { event.preventDefault(); edit(); } });
    return wrapper;
  }
  async function openMenu() {
    const d = dialog('Workspace'); d.box.classList.add('workspace-drawer'); d.open();
    d.box.append(button('New visualization', async () => { if (busy()) return; await account.newProject?.(); await newVisualization(); d.box.close(); }),
      button('My datasets', dataLibrary));
    const list = element('div', '', 'cloud-projects'); d.box.append(element('h3','My visualizations'), list);
    if (account.user) {
      for (const row of await account.list()) {
        const item = element('div', '', 'cloud-project'); item.dataset.projectId = row.id;
        const open = button('', async () => { if (busy()) return; const project = await account.open(row.id); await restore(project); d.box.close(); });
        open.className = 'cloud-project-open'; open.setAttribute('aria-label', `Open ${row.title}`);
        if (row.thumbnail?.startsWith('data:image/png;base64,')) { const img = element('img'); img.alt = ''; fitLegacyThumbnail(img); img.src = row.thumbnail; open.append(img); }
        else open.append(element('span', 'Open visualization', 'cloud-project-placeholder'));
        item.append(open, editableProjectTitle(row, open), element('small', new Date(row.updated_at).toLocaleString()), button('Delete', async () => {
          const confirm = dialog('Delete visualization?'); confirm.box.append(element('p', row.title), button('Delete visualization', async () => {
            const active = account.current?.id === row.id; await account.remove(row.id); if (active) await newVisualization(); item.remove(); confirm.box.close();
          })); confirm.open();
        })); list.append(item);
      }
      if (!list.children.length) list.append(element('p', 'Your saved visualizations will appear here.'));
      d.box.append(button('Rename current visualization', async () => {
        if (!snapshot()) throw new Error('Create a visualization first.');
        const name = await projectNameDialog({ title: 'Rename visualization', value: account.current?.title ?? '', submit: 'Save name', save: value => account.rename(value) });
        if (name) d.box.close();
      }), button('Duplicate current visualization', async () => { const p=snapshot(); if(!p)return; await account.newProject(`${account.current?.title ?? 'Visualization'} (copy)`);await account.save(p,thumbnail());d.box.close(); }));
    }
    const bottom = element('footer'); bottom.append(button('Report a problem', report), button('Settings', settings), button('About', about)); d.box.append(bottom);
  }
  return { save: (project) => account.user ? account.save(project, thumbnail()) : Promise.resolve(), record: (type, payload) => account.record?.(type, payload),
    get user() { return account.user; }, settings, about, nameNewProject, newProject: () => account.newProject?.(), ready: true };
}
