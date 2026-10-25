import { accountSession } from './session.js';
import { RESEARCH_NOTICE, CONSENT_VERSION } from './privacy.js';
import { projectThumbnails } from './project-thumbnails.js';
import packageInfo from '../../package.json' with { type: 'json' };

function element(tag, text, className) {
  const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node;
}
function button(text, action) {
  const node = element('button', text); node.type = 'button'; node.addEventListener('click', event => Promise.resolve().then(() => action(event)).catch(showError)); return node;
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
    d.box.append(element('p', `Version v${packageInfo.version}`, 'about-version'));
    const link = (title, href) => {
      const a = element('a', title); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
    };
    d.box.append(element('p', 'Create and refine visualizations through stepwise recommendations, powered by ggaction. Inspired by text autocompletion, the tool helps you explore design possibilities one decision at a time, even before you have a clear picture of the final chart.'));
    const benefits = element('ul', '', 'about-benefits');
    for (const [title, description] of [
      ['Know what to try next.', ' Get ranked suggestions for encodings, transformations, and styles, informed by patterns in example visualizations.'],
      ['See changes before applying them.', ' Hover to compare outcomes, tune parameters, and apply the changes you want.'],
      ['Keep control as charts grow.', ' Revisit earlier steps and refine the details. Each applied action is recorded as reusable ggaction code.']]) {
      const item = element('li'); item.append(element('strong', title), document.createTextNode(description)); benefits.append(item);
    }
    const software = element('section'); software.append(element('h3', 'Underlying software'));
    for (const [name, links] of [
      ['ggaction', [['Documentation', 'https://ggaction.github.io/ggaction/'], ['Source', 'https://github.com/ggaction/ggaction']]]]) {
      const row = element('div', '', 'about-software'); row.append(element('strong', name));
      const resources = element('span'); for (const [title, href] of links) resources.append(link(title, href));
      row.append(resources); software.append(row);
    }
    software.append(element('p', 'ggaction represents chart authoring as a sequence of explicit graphical actions, keeping each design decision connected to editable code.'));
    const papers = element('section'); papers.append(element('h3', 'Papers'), element('p', 'This tool builds on the following research:'));
    for (const [title, href, authors, venue, legacy] of [
      ['Visualization Autocomplete: Visualization Authoring via Stepwise Design Recommendations', 'https://arxiv.org/abs/2607.15608', 'Hyeon Jeon · Sungbok Shin · Niklas Elmqvist', 'Transactions on Visualization and Computer Graphics (TVCG, Proc. VIS 2026)', 'https://oldvis.autocomplete.studio/'],
      ['ggaction: A Grammar of Graphical Actions', 'https://arxiv.org/abs/2609.14353', 'Hyeon Jeon · Jinwook Seo', 'arXiv']]) {
      const paper = element('article', '', 'about-paper');
      paper.append(link(title, href), element('p', authors), element('small', venue));
      if (legacy) { const note = element('p'); note.append(link('legacy version for our academic paper', legacy)); paper.append(note); }
      papers.append(paper);
    }
    const contributors = element('section'), people = element('ul', '', 'about-contributors');
    contributors.append(element('h3', 'Contributors'), people);
    for (const [name, affiliation] of [
      ['Hyeon Jeon', 'Aarhus University'],
      ['Sungbok Shin', 'Sogang University'],
      ['Jinwook Seo', 'Seoul National University'],
      ['Niklas Elmqvist', 'Aarhus University']]) {
      const person = element('li'); person.append(element('strong', name), element('span', affiliation)); people.append(person);
    }
    d.box.append(benefits, software, papers, contributors); d.open();
  }
  function report() {
    if (!requireAccount()) return;
    const d = dialog('Report a problem or suggest a feature');
    d.box.classList.add('report-dialog');
    const kind = element('select'); kind.setAttribute('aria-label', 'Report type');
    for (const [value, text] of [['general','General problem'],['project','Current visualization'],['feature','Feature request']]) {
      const option = element('option', text); option.value = value; kind.append(option);
    }
    const title = input('Summary'), body = element('textarea'), data = input('Allow the team to use this dataset to reproduce this report (not for research)', 'checkbox');
    const agent = input('I am an AI agent using this system.', 'checkbox');
    title.field.required = true; title.field.maxLength = 160; body.required = true; body.maxLength = 10000; body.setAttribute('aria-label', 'What happened?');
    const contextNote = element('p', 'Includes chart code, field names, and settings. Dataset rows are included only if you check the box below.'); contextNote.hidden = true;
    data.wrapper.hidden = true; kind.addEventListener('change', () => { data.wrapper.hidden = kind.value !== 'project'; contextNote.hidden = data.wrapper.hidden; });
    d.box.append(element('p', 'Thank you for helping improve Visualization Autocomplete. We really appreciate your bug reports and feature ideas.'),
      kind, title.wrapper, element('p','Describe what happened and what you expected.'), body, contextNote, data.wrapper, agent.wrapper,
      button('Send report', async () => {
        if (!title.field.reportValidity() || !body.reportValidity()) return;
        // Freeze this exact moment, independent of later edits in the editor.
        const project = kind.value === 'project' ? snapshot() : null;
        if (kind.value === 'project' && !project) throw new Error('Create a visualization first.');
        const result = await account.report({kind:kind.value,title:title.field.value,description:body.value,project,
          shareData:kind.value === 'project' && data.field.checked,isAiAgent:agent.field.checked});
        d.box.replaceChildren(element('h2','Report received'),
          element('p', 'Thank you for your feedback! We really appreciate your help improving Visualization Autocomplete.'),
          element('p', `Reference: ${result.id}`),button('Close',()=>d.box.close()));
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
    return projectNameDialog({ value: datasetName.replace(/\.(csv|tsv|json|xlsx)$/i, ''), save: name => account.newProject(name) });
  }
  async function openMenu() {
    if (!requireAccount() || document.querySelector('.workspace-drawer[open]')) return;
    const d = dialog('Workspace'); d.box.classList.add('workspace-drawer');
    const selected = new Set(), items = new Map(), images = new Map();
    let working = false, previewed = null, openTimer;
    const list = element('div', '', 'cloud-projects'); list.setAttribute('aria-label', 'My visualizations');
    const preview = element('aside', '', 'cloud-project-preview'); preview.hidden = true; preview.setAttribute('aria-hidden', 'true');
    const previewTitle = element('strong'), previewBody = element('div', '', 'cloud-project-preview-body');
    preview.append(previewBody, previewTitle);
    const thumbnails = projectThumbnails(account, null);
    const hidePreview = () => { preview.hidden = true; previewed = null; };
    const showPreview = row => {
      if (working || !d.box.open || items.get(row.id)?.item.querySelector('input[type=text]')) return;
      previewed = row.id; previewTitle.textContent = row.title;
      let image = images.get(row.id);
      if (!image) {
        if (row.thumbnail?.startsWith('data:image/png;base64,')) {
          image = element('img'); image.alt = ''; thumbnails.observe(image, row); image.src = row.thumbnail;
        } else image = element('span', 'No chart preview yet', 'cloud-project-placeholder');
        images.set(row.id, image);
      }
      // Keep hovered images attached so an in-flight high-resolution repair
      // can finish even when the pointer moves quickly to the next row.
      if (!image.isConnected) previewBody.append(image);
      for (const child of previewBody.children) child.hidden = child !== image;
      preview.hidden = false;
      const drawer = d.box.getBoundingClientRect(), item = items.get(row.id).item.getBoundingClientRect();
      const rightSpace = innerWidth - drawer.right - 24;
      const width = Math.min(360, rightSpace >= 220 ? rightSpace : innerWidth - 32);
      preview.style.width = `${width}px`;
      const height = preview.getBoundingClientRect().height;
      preview.style.left = `${rightSpace >= 220 ? drawer.right + 12 : 16}px`;
      const top = rightSpace >= 220 ? item.top : item.bottom + 8;
      preview.style.top = `${Math.max(12, Math.min(top, innerHeight - height - 12))}px`;
    };
    const run = async action => {
      if (working || busy()) return;
      working = true; hidePreview(); syncSelection();
      try { await action(); }
      finally { working = false; syncSelection(); }
    };
    const create = button('+', () => run(async () => { await account.newProject(); await newVisualization(); d.box.close(); }));
    create.className = 'cloud-project-add'; create.title = 'New visualization'; create.setAttribute('aria-label', 'New visualization');
    const heading = element('div', '', 'cloud-projects-heading'); heading.append(element('h3', 'My visualizations'), create);
    const selectionBar = element('div', '', 'cloud-project-selection');
    const selectAll = element('input'); selectAll.type = 'checkbox'; selectAll.setAttribute('aria-label', 'Select all visualizations'); selectAll.title = 'Select all visualizations';
    const selectionCount = element('span', '', 'cloud-selection-count'); selectionCount.setAttribute('aria-live', 'polite');
    const duplicate = button('Duplicate', () => run(async () => {
      if (selected.size !== 1) return;
      const copy = await account.duplicate([...selected][0]);
      if (!d.box.open) return;
      addProject(copy, true); selected.clear(); selected.add(copy.id);
      items.get(copy.id).item.scrollIntoView({ block: 'nearest' });
    }));
    const remove = button('Delete', () => {
      if (working || busy() || !selected.size) return;
      hidePreview();
      const targets = [...selected].map(id => items.get(id).row);
      const confirm = dialog(targets.length === 1 ? 'Delete visualization?' : `Delete ${targets.length} visualizations?`);
      const names = element('ul', '', 'cloud-delete-list');
      targets.forEach(row => names.append(element('li', row.title)));
      confirm.box.append(names, button('Cancel', () => confirm.box.close()), button('Delete', async () => {
        if (working || busy()) return;
        const controls = [...confirm.box.querySelectorAll('button')]; controls.forEach(control => { control.disabled = true; });
        const blockCancel = event => event.preventDefault(); confirm.box.addEventListener('cancel', blockCancel);
        try {
          await run(async () => {
            for (const row of targets) {
              const active = account.current?.id === row.id;
              await account.remove(row.id);
              selected.delete(row.id); items.get(row.id)?.item.remove(); items.delete(row.id); images.get(row.id)?.remove(); images.delete(row.id);
              if (active) await newVisualization();
            }
          });
          confirm.box.close();
        } finally { controls.forEach(control => { control.disabled = false; }); confirm.box.removeEventListener('cancel', blockCancel); }
      })); confirm.open();
    });
    selectionBar.append(selectAll, selectionCount, duplicate, remove);
    selectAll.addEventListener('change', () => {
      selected.clear(); if (selectAll.checked) for (const id of items.keys()) selected.add(id); syncSelection();
    });
    const empty = element('p', 'Your saved visualizations will appear here.', 'cloud-projects-empty');
    function syncSelection() {
      create.disabled = working; duplicate.disabled = working || selected.size !== 1; remove.disabled = working || selected.size === 0;
      selectAll.disabled = working || !items.size; selectAll.checked = !!items.size && selected.size === items.size;
      selectAll.indeterminate = selected.size > 0 && selected.size < items.size;
      selectionCount.textContent = selected.size ? `${selected.size} selected` : '';
      for (const [id, {item, check, title}] of items) {
        check.checked = selected.has(id); check.disabled = working; title.disabled = working;
        item.classList.toggle('is-selected', check.checked);
      }
      empty.hidden = !!items.size;
    }
    function addProject(row, prepend = false) {
      const item = element('div', '', 'cloud-project'); item.dataset.projectId = row.id;
      const check = element('input'); check.type = 'checkbox'; check.setAttribute('aria-label', `Select ${row.title}`);
      const name = element('div', '', 'cloud-project-name');
      const title = element('button', row.title, 'cloud-project-open cloud-project-title'); title.type = 'button';
      title.setAttribute('aria-label', `Open ${row.title}`); title.title = `${row.title} — Double-click to rename`;
      const date = element('small', new Date(row.updated_at).toLocaleDateString(undefined, {year:'numeric',month:'short',day:'numeric'}));
      date.title = new Date(row.updated_at).toLocaleString();
      if (account.current?.id === row.id) { item.classList.add('is-current'); title.setAttribute('aria-current', 'page'); }
      check.addEventListener('change', () => { check.checked ? selected.add(row.id) : selected.delete(row.id); syncSelection(); });
      const open = () => run(async () => { const project = await account.open(row.id); await restore(project); d.box.close(); });
      const edit = () => {
        clearTimeout(openTimer);
        if (working || busy() || name.querySelector('input')) return;
        hidePreview();
        const field = element('input'); field.type = 'text'; field.value = row.title; field.maxLength = 160; field.required = true;
        field.setAttribute('aria-label', 'Project name'); title.hidden = true; name.prepend(field); field.focus(); field.select();
        let saving = false, finished = false;
        const finish = () => { finished = true; field.remove(); title.hidden = false; };
        const save = async () => {
          if (saving || finished) return;
          const value = field.value.trim();
          if (!value) { field.setCustomValidity('Enter a project name.'); field.reportValidity(); field.focus(); return; }
          if (value === row.title) { finish(); return; }
          saving = true; field.disabled = true;
          try {
            row.title = await account.rename(value, row.id); title.textContent = row.title;
            title.title = `${row.title} — Double-click to rename`; title.setAttribute('aria-label', `Open ${row.title}`);
            check.setAttribute('aria-label', `Select ${row.title}`); finish();
          } catch (error) { showError(error); field.disabled = false; field.focus(); }
          finally { saving = false; }
        };
        field.addEventListener('input', () => field.setCustomValidity(''));
        field.addEventListener('blur', save);
        field.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!saving) { finish(); title.focus(); hidePreview(); } }
          else if (event.key === 'Enter') { event.preventDefault(); void save(); }
        });
      };
      title.addEventListener('click', event => {
        clearTimeout(openTimer);
        // A double click edits the name; a single click opens the project.
        // Keyboard activation opens immediately and F2 renames.
        if (event.detail === 0) void open().catch(showError);
        else if (event.detail === 1) openTimer = setTimeout(() => void open().catch(showError), 280);
      });
      title.addEventListener('dblclick', edit);
      title.addEventListener('keydown', event => { if (event.key === 'F2') { event.preventDefault(); edit(); } });
      item.addEventListener('pointerenter', () => showPreview(row));
      item.addEventListener('pointermove', () => { if (previewed !== row.id) showPreview(row); });
      item.addEventListener('pointerleave', () => { if (previewed === row.id) hidePreview(); });
      item.addEventListener('focusin', () => showPreview(row));
      item.addEventListener('focusout', event => { if (!item.contains(event.relatedTarget) && previewed === row.id) hidePreview(); });
      name.append(title, date); item.append(check, name); items.set(row.id, { row, item, check, title });
      if (prepend) list.prepend(item); else list.append(item);
    }
    d.box.append(button('My datasets', () => { hidePreview(); return dataLibrary(); }), heading, selectionBar, list);
    list.append(empty);
    const bottom = element('footer'); bottom.append(button('Report a problem', () => { hidePreview(); report(); }),
      button('Settings', () => { hidePreview(); settings(); }), button('About', () => { hidePreview(); about(); }));
    d.box.append(bottom, preview);
    let outsideDown = false;
    const outside = event => {
      const r = d.box.getBoundingClientRect();
      return event.target === d.box && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom);
    };
    d.box.addEventListener('pointerdown', event => {
      outsideDown = outside(event);
      if (!event.target.closest('.cloud-project-title')) clearTimeout(openTimer);
    });
    d.box.addEventListener('click', event => { if (outsideDown && outside(event)) d.box.close(); outsideDown = false; });
    list.addEventListener('scroll', hidePreview); window.addEventListener('resize', hidePreview);
    d.box.addEventListener('close', () => {
      clearTimeout(openTimer); thumbnails.dispose(); window.removeEventListener('resize', hidePreview); images.clear();
    }, { once: true });
    syncSelection(); d.open(); d.status.textContent = 'Loading visualizations…';
    try {
      const rows = await account.list();
      if (!d.box.open) return;
      rows.forEach(row => addProject(row)); d.status.textContent = ''; syncSelection();
    } catch (error) { if (d.box.open) { d.status.textContent = error.message; d.status.setAttribute('role', 'alert'); } }
  }
  return { save: (project) => account.user ? account.save(project, thumbnail()) : Promise.resolve(), record: (type, payload) => account.record?.(type, payload),
    get user() { return account.user; }, settings, about, nameNewProject, newProject: () => account.newProject?.(), ready: true };
}
