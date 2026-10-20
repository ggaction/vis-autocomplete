import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { createInitialChartRecommender, profileDataset } from '../src/index.js';
import { recommendationParameters, valuesFor, activeControls, buildRecommendationCall } from './parameters.js';
import { programCode, renderCode, resetCodeView, displayedCode } from './code-view.js';
import { initializeCodeToolbar } from './code-toolbar.js';
import { initializePanelLayout } from './panel-layout.js';
import { initializeChartDownloads } from './chart-download.js';
import { transferChart, cancelChartTransfer } from './chart-transfer.js';
import { fitChartViewport } from './chart-viewport.js';
import { createPreviewInteraction } from './preview-interaction.js';
import { createPointerMotion } from './pointer-motion.js';
import { defaultCanvasOptions } from './plot-setup.js';
import { selectionAxes, selectionData } from './selection-setup.js';
import { renderDataTable } from './data-table.js';
import { createHistory, historyLabel, historyPreview } from './history.js';
import { createHistoryView } from './history-view.js';
import { OPTION_GROUPS, FOLLOWUP_RECOMMENDATION_OPTIONS } from './option-groups.js';
import { createCalculationClient } from './calculation-client.js';
import { createLRU } from '../src/cache.js';
import { actionTitle } from '../src/action-labels.js';
import { normalizeSearchQuery } from '../src/action-search.js';
import { importDataset, parseCSV } from '../src/data-import.js';
import { reviewDatasetImport } from './import-dialog.js';
import { createProject, parseProject, validateProject, restoreSession, runnableCode, createDraftStore } from './project.js';
export { parseCSV } from '../src/data-import.js';

const $ = id => document.getElementById(id);
const elements = Object.fromEntries(['current', 'preview', 'cards', 'notice',
  'current-note', 'preview-note', 'preview-name', 'options-note', 'step-description'].map(id => [id, $(id)]));
initializeCodeToolbar({ panel: $('code-content').closest('.code-panel'),
  decrease: $('code-font-decrease'), increase: $('code-font-increase'), copy: $('code-copy'), status: $('code-tools-status'),
  source: () => displayedCode($('code-content')), onError: message => notice(message, true) });
const sales = Array.from({ length: 36 }, (_, i) => ({
  Month: `${2023 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-01`,
  Sales: Math.round(100 + i * 3 + Math.sin(i / 2) * 24),
  Cost: Math.round(55 + i * 1.5 + Math.cos(i / 3) * 10),
  Orders: 30 + i * 2, Region: ['North', 'South', 'West'][i % 3],
}));

const state = { initialEngine: null, rows: [], name: '', program: null, base: null,
  phase: 'initial', cards: [], active: null, context: {}, generation: 0, steps: 0, setupCalls: [], calls: [], codeCard: null,
  committing: false, view: null, guideCall: null, galleryRows: [], galleryObserver: null,
  selection: { x: '', y: '', color: '' }, profile: null, selectionAxes: null, tableView: null, baseCalls: [], plotData: 'dataset',
  optionGroup: 'encoding', searchQuery: '', datasetId: null };
let cars;
const datasets = new Map();
const datasetBases = createLRU(4);
const drafts = createDraftStore();
let sourceVersion = null, savingDraft = Promise.resolve(), restoringProject = false;
const history = createHistory();
const recommendationCache = new WeakMap();
const calculations = createCalculationClient();
const galleryCache = new WeakMap();
const recentGalleries = createLRU(8, view => { galleryCache.delete(view); recommendationCache.delete(view); });
let mountedGallery = null;
let svgId = 0;
const renderedCharts = new WeakMap();
const chartTemplates = new WeakMap();
const chartDownloads = initializeChartDownloads({ host: $('chart-exports'),
  getCurrent: () => state.phase === 'initial' ? null : { program: renderedCharts.get(elements.current)?.program, name: state.name },
  isBusy: () => state.committing, onError: message => notice(message, true) });
let historyInspection = null;
const historyView = createHistoryView($('history'), {
  renderChart, meta: $('history-meta'),
  onPreview: snapshot => { historyInspection = snapshot; showPreview(null); },
  onLeave: () => { historyInspection = null; showPreview(state.active); },
  onJump: index => restoreHistory(index),
});
const parameterIntents = new WeakMap(), cardElements = new WeakMap();
const rangeIntents = new WeakMap();
let pointerChoice = null, pointerCard = null, pointerInGallery = false;
const tick = () => new Promise(resolve => requestAnimationFrame(resolve));

function historySnapshot(currentNote = elements['current-note'].textContent) {
  return { program: state.program, view: state.view, phase: state.phase, selectionAxes: state.selectionAxes,
    ...structuredClone({ setupCalls: state.setupCalls, calls: state.calls, context: state.context,
      steps: state.steps, guideCall: state.guideCall, selection: state.selection, plotData: state.plotData,
      optionGroup: state.optionGroup }), currentNote };
}

function updateHistoryButtons() {
  chartDownloads.refresh();
  for (const id of ['dataset', 'upload', 'open-project', 'edit-schema', 'reset', 'toggle-history', 'toggle-code']) $(id).disabled = state.committing;
  $('undo').disabled = state.committing || !history.canUndo;
  $('redo').disabled = state.committing || !history.canRedo;
  for (const group of OPTION_GROUPS) $(`group-${group.id}`).disabled = state.committing;
  $('action-search').disabled = state.committing;
  historyView.update(history, state.committing);
}

function updateOptionGroups() {
  const initial = state.phase === 'initial';
  $('option-groups').hidden = initial;
  $('action-search-control').hidden = initial;
  $('clear-search').hidden = !state.searchQuery;
  $('action-search').placeholder = `Search ${state.optionGroup}…`;
  $('action-search').setAttribute('aria-label', `Search ${state.optionGroup} actions`);
  $('action-search-control').title = `Searches the ${state.optionGroup} group. Change tabs to search another group.`;
  const section = elements.cards.closest('.options-section');
  if (initial) {
    delete section.dataset.optionGroup;
    section.style.removeProperty('--group-accent'); section.style.removeProperty('--group-rgb');
    elements.cards.removeAttribute('role'); elements.cards.removeAttribute('aria-labelledby');
    delete elements.cards.dataset.optionGroup;
  } else {
    const group = OPTION_GROUPS.find(group => group.id === state.optionGroup);
    section.dataset.optionGroup = group.id;
    section.style.setProperty('--group-accent', group.color); section.style.setProperty('--group-rgb', group.rgb);
    elements.cards.dataset.optionGroup = group.id;
    elements.cards.setAttribute('role', 'tabpanel'); elements.cards.setAttribute('aria-labelledby', `group-${group.id}`);
  }
  for (const group of OPTION_GROUPS) {
    const button = $(`group-${group.id}`), selected = group.id === state.optionGroup;
    button.style.setProperty('--group-accent', group.color); button.style.setProperty('--group-rgb', group.rgb);
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
  }
}

for (const [index, group] of OPTION_GROUPS.entries()) {
  const button = $(`group-${group.id}`);
  button.addEventListener('click', () => {
    if (state.committing || state.phase === 'initial' || state.optionGroup === group.id) return;
    clearTimeout(searchTimer); state.searchQuery = normalizeSearchQuery($('action-search').value);
    state.optionGroup = group.id; state.codeCard = null; state.active = null;
    showPreview(null);
    updateCards().catch(error => notice(error.message, true));
  });
  button.addEventListener('keydown', event => {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2
      : event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : null;
    if (next === null) return;
    event.preventDefault();
    const target = $(`group-${OPTION_GROUPS[next].id}`); target.focus(); target.click();
  });
}

let searchTimer;
function searchActions() {
  clearTimeout(searchTimer);
  if (state.committing || state.phase === 'initial') return;
  const query = normalizeSearchQuery($('action-search').value);
  if (state.searchQuery === query) return;
  state.searchQuery = query; state.codeCard = null; state.active = null;
  showPreview(null);
  updateCards().catch(error => notice(error.message, true));
}
$('action-search').addEventListener('input', event => {
  clearTimeout(searchTimer);
  if (!event.isComposing) searchTimer = setTimeout(searchActions, 150);
});
$('action-search').addEventListener('compositionend', searchActions);
$('action-search').addEventListener('search', searchActions);
$('action-search').addEventListener('keydown', event => {
  if (event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); $('action-search').value = ''; searchActions(); }
  else if (event.key === 'Enter') { event.preventDefault(); searchActions(); }
});

function mountDataTable() {
  state.tableView?.destroy?.();
  renderedCharts.delete(elements.current);
  chartDownloads.refresh();
  state.tableView = renderDataTable(elements.current, { rows: state.rows, profile: state.profile, selection: state.selection, controlsHost: $('selection-controls'),
    onSchemaEdit: editSchema,
    onChange: changes => {
      state.selection = { ...state.selection, ...changes };
      refreshSelection().catch(error => notice(error.message, true));
    } });
}

async function restoreHistory(direction) {
  if (state.committing) return;
  clearSearch();
  historyView.clear({ restore: false }); historyInspection = null;
  const snapshot = typeof direction === 'number' ? history.jump(direction) : history[direction]();
  if (!snapshot) { showPreview(state.active); return; }
  state.committing = true; updateHistoryButtons();
  pointerMotion.reset(); cancelChartTransfer();
  saveGallery();
  const { program, view, selectionAxes: axes, currentNote, ...metadata } = snapshot;
  Object.assign(state, structuredClone(metadata), { program, view, selectionAxes: axes, active: null, codeCard: null });
  resetCodeView($('code-content'));
  elements.current.dataset.steps = state.steps;
  elements.current.dataset.traceCount = view.trace.children.length;
  elements.current.dataset.lastMethod = state.calls.at(-1)?.method ?? '';
  elements['current-note'].textContent = currentNote;
  elements['current-note'].title = currentNote;
  try {
    if (state.phase === 'initial') mountDataTable();
    else {
      elements.current.classList.remove('data-view'); state.tableView?.destroy?.(); state.tableView = null;
      $('selection-controls').hidden = true;
      renderChart(elements.current, view, 'Current visualization');
    }
    showPreview(null);
    await updateCards();
  } catch (error) { notice(error.message, true); }
  finally { state.committing = false; updateHistoryButtons(); updateGalleryNavigation(); scheduleSave(); }
}

function notice(message = '', isError = false) {
  elements.notice.textContent = message;
  elements.notice.classList.toggle('error', isError);
}

function placeholder(host, message) {
  renderedCharts.delete(host);
  if (host === elements.current) chartDownloads.refresh();
  const wrapper = document.createElement('div'); wrapper.className = 'empty-state';
  const text = document.createElement('p'); text.textContent = message;
  wrapper.append(text); host.replaceChildren(wrapper);
}

function renderChart(host, program, label) {
  const previous = renderedCharts.get(host);
  if (previous?.program === program && previous.label === label && host.firstChild) return;
  if (!program) return placeholder(host, label);
  const pending = program.semanticSpec.layers.some(layer => ['point', 'line', 'bar', 'area'].includes(layer.mark?.type) &&
    !['polar', 'parallel'].includes(program.semanticSpec.coordinates.find(c => c.id === layer.coordinate)?.type) &&
    (!layer.encoding?.x || !layer.encoding?.y));
  if (pending) return placeholder(host, 'This step is ready. Set both position variables to display the chart.');
  const namespace = `view-${++svgId}`;
  if (!chartTemplates.has(program)) {
    const template = document.createElement('template');
    template.innerHTML = program.svg ?? renderToSVG(program, { resourceNamespace: 'view-template' });
    chartTemplates.set(program, template.content);
  }
  host.replaceChildren(chartTemplates.get(program).cloneNode(true));
  {
    // Worker SVGs share geometry; every mounted copy retains unique references.
    const ids = new Map([...host.querySelectorAll('[id]')].map(node => [node.id, `${namespace}-${node.id}`]));
    for (const node of host.querySelectorAll('[id], [clip-path], [mask], [filter], [fill^="url("], [stroke^="url("], [href]')) for (const attribute of [...node.attributes]) {
      let value = attribute.value;
      if (attribute.name === 'id') value = ids.get(value) ?? value;
      else {
        if ((attribute.name === 'href' || attribute.name === 'xlink:href') && ids.has(value.slice(1))) value = `#${ids.get(value.slice(1))}`;
        value = value.replace(/url\(#([^)]*)\)/g, (match, id) => ids.has(id) ? `url(#${ids.get(id)})` : match);
      }
      if (value !== attribute.value) node.setAttribute(attribute.name, value);
    }
  }
  renderedCharts.set(host, { program, label });
  if (host === elements.current) chartDownloads.refresh();
  const svg = host.querySelector('svg');
  if (svg) {
    if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`);
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', label);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    if (host.classList.contains('chart-view')) fitChartViewport(svg, program);
  }
}

function makeBase(rows = state.rows) {
  // Dataset setup and shared typography precede authoring; gallery actions stay single calls.
  const canvas = defaultCanvasOptions();
  const theme = { theme: { base: 'light', tokens: {
      background: '#ffffff', fontFamily: 'Arial', axisLabelFontFamily: 'Arial',
      axisTitleFontFamily: 'Arial', mark: '#4c78a8',
  } } };
  const calls = [{ method: 'createCanvas', args: canvas }, { method: 'applyTheme', args: theme },
    { method: 'createData', args: { id: 'dataset', values: '__LOADED_DATA__' } }];
  return { program: chart().createCanvas(canvas).applyTheme(theme).createData({ id: 'dataset', values: rows }), calls };
}

function focus(program, preferred = {}) {
  if (!program.semanticSpec.layers.length) return preferred.data ? { data: preferred.data } : { data: 'dataset' };
  const layers = program.semanticSpec.layers;
  const old = layers.find(layer => layer.id === preferred.target);
  const root = layers.find(layer => layer.id === 'plot');
  const nonempty = layers.find(layer => program.semanticSpec.datasets.find(d => d.id === layer.data)?.values?.length);
  return { target: (old ?? root ?? nonempty ?? layers[0]).id };
}

function inspectingCode(focusTarget = document.activeElement) {
  const panel = $('code-content').closest('.code-panel');
  return panel.dataset.collapsed !== 'true' && (panel.matches(':hover') || panel.contains(focusTarget));
}

function showCode(card = null, { settleApplied = false } = {}) {
  if (historyInspection) {
    const snapshot = historyInspection;
    const code = value => programCode([...value.setupCalls, ...value.calls,
      ...(value.phase === 'initial' ? value.selectionAxes?.calls ?? [] : []),
      ...(value.guideCall ? [value.guideCall] : [])], state.name, state.rows.length);
    renderCode($('code-content'), code(state), code(snapshot), { setupCallCount: snapshot.setupCalls.length });
    $('code-mode').textContent = `History #${snapshot.steps}`;
    $('code-content').dataset.previewMethod = '';
    return;
  }
  if (!card && state.codeCard?.base === state.program && state.codeCard.prepared &&
    inspectingCode()) card = state.codeCard;
  const current = programCode([...state.setupCalls, ...state.calls,
    ...(state.phase === 'initial' ? state.selectionAxes?.calls ?? [] : []),
    ...(state.guideCall ? [state.guideCall] : [])], state.name, state.rows.length);
  const call = card?.prepared?.recommendation;
  if (call) state.codeCard = card;
  const proposed = call ? programCode([...state.setupCalls, ...state.calls,
    ...(card.prepared.prerequisiteCalls ?? []),
    { method: call.method, args: call.args }, ...(card.prepared.postActionCalls ?? []),
    card.prepared.guideCall], state.name, state.rows.length) : null;
  const setupCallCount = state.setupCalls.length + (!call && state.phase === 'initial' ? state.selectionAxes?.calls.length ?? 0 : 0);
  renderCode($('code-content'), current, proposed, { setupCallCount, settleApplied });
  $('code-mode').textContent = proposed ? 'Preview changes' : 'Current';
  $('code-content').dataset.previewMethod = call?.method ?? '';
}

function showPreview(card, { showCodeChange = true } = {}) {
  if (historyInspection) {
    renderChart(elements.preview, historyPreview(historyInspection), `History #${historyInspection.steps}`);
    $('preview-heading').textContent = 'History preview';
    elements['preview-name'].textContent = `#${historyInspection.steps} ${historyLabel(historyInspection)}`;
    elements['preview-note'].textContent = ''; elements['preview-note'].title = '';
    showCode(); return;
  }
  $('preview-heading').textContent = 'Preview';
  if (!card && state.phase === 'initial') state.codeCard = null;
  showCode(showCodeChange ? card : null);
  if (!card) {
    if (state.phase === 'initial' && state.selectionAxes) renderChart(elements.preview, state.selectionAxes.program, 'Selected axes');
    else placeholder(elements.preview, 'Select an option to preview it.');
    elements['preview-name'].textContent = ''; elements['preview-note'].textContent = ''; elements['preview-note'].title = '';
    return;
  }
  elements['preview-name'].textContent = card.title;
  if (card.prepared || card.unchanged) {
    renderChart(elements.preview, card.prepared?.preview ?? card.view, card.title);
    elements['preview-note'].textContent = '';
    elements['preview-note'].title = '';
  } else {
    placeholder(elements.preview, card.error || 'Choose valid parameters for this option.');
    elements['preview-note'].textContent = '';
  }
}

function setCardExpanded(card, expanded) {
  card.element.classList.toggle('expanded', expanded);
  // Keep the controls mounted so CSS can animate both opening and closing.
  // Inert removes collapsed controls from pointer and keyboard interaction.
  card.controlsElement.inert = !expanded;
  card.controlsElement.setAttribute('aria-hidden', String(!expanded));
  card.button.setAttribute('aria-expanded', String(expanded));
}

function selectCard(card, showCodeChange = true, expand = true) {
  if (card.disabled || card.base !== state.program) return;
  // Restoring a gallery also selects its default card, without user input.
  // Only an interactive option choice releases the history position marker.
  if (expand) historyView.release();
  state.active = card;
  for (const item of state.cards) {
    item.element.classList.toggle('selected', item === card);
    setCardExpanded(item, item === card && expand);
  }
  showPreview(card, { showCodeChange });
  // A canceled hover may have left a newer pinned value waiting for execution.
  card.preparePromise = prepareCard(card, card.values);
}

async function prepareCard(card, values = card.values, { interactive = true } = {}) {
  values = card.normalizeValues?.(values) ?? values;
  // A preview must not move its own hit targets or clamp the controls' scroll
  // position. Only a clicked (pinned) choice changes the editor's structure.
  for (const { definition, element } of card.controlElements) {
    element.hidden = definition.when ? !definition.when(card.values) : false;
  }
  for (const button of card.parameterButtons) button.classList.toggle('previewing', card.interaction.owner === button);
  const request = card.request = (card.request ?? 0) + 1;
  try {
    for (const control of activeControls(card.resolveControls?.(values) ?? card.controls, values)) {
      const value = values[control.key];
      if (control.type === 'number' && (!Number.isFinite(value) || value < control.min || value > control.max)) {
        throw new Error(`${control.label} must be between ${control.min} and ${control.max}.`);
      }
      if (control.type === 'multiselect' && value.length < control.minimum) {
        throw new Error(`Choose at least ${control.minimum} dimensions.`);
      }
    }
    const action = buildRecommendationCall(card, values);
    if (card.methodElement) card.methodElement.textContent = `${action.method}(…)`;
    const setupCalls = card.setup?.(values) ?? [];
    const signature = JSON.stringify([action, setupCalls]);
    if (!card.prepared || card.preparedSignature !== signature) {
      card.apply.disabled = true;
      const prepared = await calculations.prepare(card.base, card.view, card.guideCall,
        action, setupCalls, { interactive: interactive && state.active === card });
      if (!prepared || request !== card.request || card.base !== state.program || card.view !== state.view) return;
      card.prepared = prepared;
      card.preparedSignature = signature;
    }
    card.error = ''; card.unchanged = false; card.apply.disabled = false;
    card.errorElement.textContent = '';
    card.errorElement.classList.remove('unchanged');
    renderChart(card.thumbnail, card.prepared.preview, card.title);
  } catch (error) {
    if (request !== card.request || card.base !== state.program || card.view !== state.view) return;
    card.prepared = null; card.unchanged = error.reason === 'no-change';
    card.error = card.unchanged ? 'This setting already matches the current chart.' : error.message;
    card.errorElement.textContent = card.error; card.errorElement.classList.toggle('unchanged', card.unchanged); card.apply.disabled = true;
    if (card.unchanged) renderChart(card.thumbnail, card.view, card.title);
  }
  if (state.active === card) showPreview(card, {
    showCodeChange: pointerInGallery || card.element.contains(document.activeElement),
  });
}

function pinValues(card, values, changedKey, rebuild = true) {
  card.values = card.normalizeValues?.(values, changedKey) ?? values;
  const controls = card.resolveControls?.(card.values) ?? card.controls;
  if (rebuild) {
    const focusKey = document.activeElement?.closest('[data-parameter]')?.dataset.parameter;
    card.controls = controls; card.controlElements = []; card.parameterButtons = []; card.controlRefreshers = [];
    card.controlsElement.replaceChildren();
    for (const definition of controls) addControl(card, definition);
    card.controlsElement.append(card.errorElement);
    if (card.noticeElement) card.controlsElement.append(card.noticeElement);
    if (focusKey) {
      const field = [...card.controlsElement.querySelectorAll('[data-parameter]')].find(e => e.dataset.parameter === focusKey);
      (field?.querySelector('[aria-pressed="true"]') ?? field?.querySelector('input, button'))?.focus({ preventScroll: true });
    }
  } else {
    const flatten = list => list.flatMap(c => c.type === 'group' ? flatten(c.controls) : [c]);
    for (const update of card.controlRefreshers ?? []) update(flatten(controls));
  }
  card.interaction.reset();
}

function addControl(card, definition, parent = card.controlsElement) {
  const label = document.createElement('div'); label.className = 'control';
  label.dataset.parameter = definition.key;
  const span = document.createElement('span'); span.textContent = definition.label;
  const fieldCount = definition.choices?.filter(choice => choice.fieldType).length;
  if (fieldCount) span.textContent += ` · ${fieldCount} variables`;
  label.append(span);
  if (definition.type === 'group') {
    for (const child of definition.controls) addControl(card, child, label);
  } else if (['select', 'multiselect', 'color'].includes(definition.type)) {
    const choices = document.createElement('div'); choices.className = 'parameter-options';
    choices.setAttribute('role', 'group');
    choices.setAttribute('aria-label', `${card.title}: ${definition.label}`);
    // Keep native buttons inside the card so the existing pointer/focus preview
    // route also handles the dropdown (native select options cannot hover-preview).
    const overflow = definition.choices.some(choice => choice.featured === false);
    let more, moreOptions;
    if (overflow) {
      more = document.createElement('details'); more.className = 'palette-more';
      const summary = document.createElement('summary');
      const extra = definition.choices.find(choice => choice.featured === false && String(choice.value) === String(card.values[definition.key]));
      summary.textContent = extra ? `More · ${extra.label}` : 'More';
      summary.setAttribute('aria-label', `${card.title}: More palettes`);
      moreOptions = document.createElement('div'); moreOptions.className = 'palette-more-options';
      more.append(summary, moreOptions);
      more.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); more.open = false; summary.focus(); }
      });
    }
    const buttons = [];
    const selected = value => definition.type === 'multiselect'
      ? card.values[definition.key].includes(value) : String(card.values[definition.key]) === String(value);
    const refresh = () => {
      buttons.forEach(({ button, value }) => {
        button.setAttribute('aria-pressed', String(selected(value)));
      });
      const colorInput = label.querySelector('input[type="color"]');
      if (colorInput) colorInput.value = card.values[definition.key];
    };
    for (const choice of definition.choices) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'parameter-choice';
      button.textContent = choice.label; button.dataset.value = choice.value; button.disabled = Boolean(choice.disabled);
      if (definition.type === 'color') {
        button.classList.add('color-swatch'); button.style.background = choice.value;
        button.setAttribute('aria-label', `Color ${choice.value}`);
      }
      button.title = choice.reason ?? 'Hover to preview. Click to keep this value.';
      if (choice.reason) button.setAttribute('aria-label', `${choice.label}: ${choice.reason}`);
      if (choice.missing) button.title += ` ${choice.missing} of ${state.rows.length} original rows have a missing value in this column.`;
      buttons.push({ button, value: choice.value }); card.parameterButtons.push(button);
      const draft = () => {
        if (definition.type !== 'multiselect') {
          const values = { ...card.values, [definition.key]: choice.value };
          return card.normalizeValues?.(values, definition.key) ?? values;
        }
        const previous = card.values[definition.key];
        const next = selected(choice.value) ? previous.filter(v => v !== choice.value) : [...previous, choice.value];
        return { ...card.values, [definition.key]: next.length >= definition.minimum ? next : previous };
      };
      parameterIntents.set(button, { card, draft });
      button.addEventListener('focus', () => card.interaction.focus(button, draft(), button.matches(':focus-visible')));
      button.addEventListener('blur', () => card.interaction.blur(button));
      button.addEventListener('click', () => {
        pinValues(card, draft(), definition.key);
      });
      (choice.featured === false ? moreOptions : choices).append(button);
    }
    if (more) choices.append(more);
    refresh(); label.append(choices);
    const reasons = [...new Set(definition.choices.filter(choice => choice.disabled && choice.reason).map(choice => choice.reason))];
    if (reasons.length) {
      const help = document.createElement('p'); help.className = 'parameter-help'; help.textContent = reasons.join(' ');
      label.append(help);
    }
    if (definition.type === 'color') {
      const input = document.createElement('input'); input.type = 'color'; input.value = card.values[definition.key];
      input.setAttribute('aria-label', `${card.title}: Custom color`);
      input.addEventListener('input', () => { pinValues(card, { ...card.values, [definition.key]: input.value }, definition.key, false); refresh(); });
      label.append(input);
    }
  } else if (definition.type === 'number') {
    label.classList.add('slider-control');
    const inputs = document.createElement('div'); inputs.className = 'number-control';
    const range = document.createElement('input'); range.type = 'range';
    // Keep an exact default instead of allowing the browser to snap it to a
    // different value from the native call. Pointer/keyboard steps are explicit.
    range.min = definition.min; range.max = definition.max; range.step = 'any';
    range.value = card.values[definition.key];
    range.setAttribute('aria-label', `${card.title}: ${definition.label} slider`);
    range.title = 'Move to preview. Click to fix the value; click again to resume. Enter or Space also toggles.';
    const valueLabel = document.createElement('output'); valueLabel.className = 'slider-value';
    span.classList.add('slider-label'); span.append(valueLabel);
    let locked = false;
    const refresh = () => {
      range.dataset.locked = String(locked);
      valueLabel.textContent = `${range.value}${locked ? ' · Fixed' : ''}`;
      range.setAttribute('aria-valuetext', `${range.value}, ${locked ? 'fixed' : 'following pointer'}. Press Enter or Space to ${locked ? 'resume' : 'fix'}.`);
    };
    const updateValue = value => {
      range.value = value;
      const next = Number(range.value);
      refresh();
      if (card.values[definition.key] === next) return;
      pinValues(card, { ...card.values, [definition.key]: next }, definition.key, false);
    };
    const followPointer = event => {
      if (locked || event.pointerType === 'touch') return;
      const bounds = range.getBoundingClientRect();
      const thumbRadius = 6;
      const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left - thumbRadius) / Math.max(1, bounds.width - 2 * thumbRadius)));
      const min = Number(range.min), max = Number(range.max), step = definition.step || 1;
      updateValue(Math.max(min, Math.min(max, Number((min + Math.round(fraction * (max - min) / step) * step).toPrecision(12)))));
    };
    // The whole bounded parameter group is the hit area, including its label
    // and padding. Map values against the track so widening it adds tolerance
    // without changing the scale or taking input from neighboring controls.
    rangeIntents.set(label, followPointer);
    label.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch') return;
      event.preventDefault(); // A click toggles fixing; it must not start a native drag.
      range.focus({ preventScroll: true });
    });
    label.addEventListener('click', event => {
      if (event.pointerType === 'touch') return;
      if (!locked) followPointer(event);
      locked = !locked;
      refresh();
    });
    range.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); locked = !locked; refresh();
      } else if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        event.preventDefault(); locked = true;
        const sign = ['ArrowLeft', 'ArrowDown', 'PageDown'].includes(event.key) ? -1 : 1;
        updateValue(event.key === 'Home' ? Number(range.min) : event.key === 'End' ? Number(range.max)
          : Number(range.value) + sign * (definition.step || 1) * (event.key.startsWith('Page') ? 10 : 1));
      }
    });
    range.addEventListener('input', () => {
      // Arrow keys and touch retain the native range interaction and fix its result.
      locked = true; updateValue(range.value);
    });
    refresh();
    card.controlRefreshers ??= [];
    card.controlRefreshers.push(controls => {
      const next = controls.find(c => c.key === definition.key);
      if (next) { range.min = next.min; range.max = next.max; range.value = card.values[definition.key]; refresh(); }
    });
    inputs.append(range); label.append(inputs);
  } else {
    const input = document.createElement('input');
    input.type = definition.type;
    input.value = card.values[definition.key];
    input.setAttribute('aria-label', `${card.title}: ${definition.label}`);
    input.addEventListener('input', () => pinValues(card, { ...card.values, [definition.key]: input.value }, definition.key, false));
    label.append(input);
  }
  parent.append(label); card.controlElements.push({ definition, element: label });
}

async function createCard(spec, index) {
  const card = { ...spec, base: state.program, disabled: Boolean(spec.requirement),
    view: state.view, guideCall: state.guideCall,
    values: structuredClone(spec.values ?? valuesFor(spec.controls)), prepared: null, error: '', controls: spec.controls, controlElements: [], parameterButtons: [] };
  card.values = card.normalizeValues?.(card.values) ?? card.values;
  card.controls = card.resolveControls?.(card.values) ?? card.controls;
  card.interaction = createPreviewInteraction({ readPinned: () => card.values,
    render: values => { if (!state.committing && card.element.isConnected && card.base === state.program) card.preparePromise = prepareCard(card, values); },
    requestFrame: requestAnimationFrame, cancelFrame: cancelAnimationFrame });
  if (state.phase === 'initial' && !card.disabled) {
    // Corpus role transfer proposes parameters; the real library decides whether
    // they execute. A fallback changes defaults only, never the corpus score.
    for (const values of [card.values, card.fallbackValues].filter(Boolean)) {
      try {
        const action = buildRecommendationCall(card, values), setupCalls = card.setup?.(values) ?? [];
        card.prepared = await calculations.prepare(card.base, card.view, card.guideCall, action, setupCalls);
        card.preparedSignature = JSON.stringify([action, setupCalls]);
        card.values = structuredClone(values); card.error = '';
        card.defaultSource = card.selection ? 'selected-variables' : values === card.fallbackValues ? 'compatible-default' : 'neighbor-roles';
        break;
      } catch (error) { card.error = error.message; }
    }
    card.controls = card.controls.map(control => ({ ...control, value: structuredClone(card.values[control.key]) }));
    if (!card.prepared && !card.controls.length) card.disabled = true;
  }
  const element = document.createElement('article'); element.className = 'card';
  element.dataset.method = card.method; element.dataset.controlCount = card.controls.length;
  element.dataset.position = index + 1;
  if (card.scoreKind) {
    element.dataset.scoreKind = card.scoreKind; element.dataset.score = card.score;
    element.dataset.evidenceStatus = card.evidenceStatus; element.dataset.defaultSource = card.defaultSource ?? '';
    element.title = `${card.evidence?.length ?? 0} similar source datasets support this plot. ${card.parameterEvidence?.exemplarChartIds?.length ?? 0} chart examples supplied parameter roles.`;
  }
  if (index < 2) element.classList.add(index === 0 ? 'primary' : 'secondary');
  card.element = element; cardElements.set(element, card);
  const button = document.createElement('button'); button.type = 'button'; button.className = 'card-top';
  button.setAttribute('aria-label', `Preview ${card.title}`); button.setAttribute('aria-expanded', 'false');
  card.button = button;
  const title = document.createElement('div'); title.className = 'card-title';
  const heading = document.createElement('h3'); heading.textContent = card.title; title.append(heading);
  const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = card.rank ?? String(index + 1).padStart(2, '0'); title.prepend(rank);
  const method = document.createElement('p'); card.methodElement = method; method.className = 'method-name'; method.textContent = `${card.method}(…)`;
  const thumbnail = document.createElement('div'); thumbnail.className = 'thumbnail'; card.thumbnail = thumbnail;
  button.append(title, method, thumbnail);
  card.controlsElement = document.createElement('div'); card.controlsElement.className = 'card-controls';
  setCardExpanded(card, false);
  for (const definition of card.controls) addControl(card, definition);
  const error = document.createElement('p'); error.className = 'card-error'; error.setAttribute('role', 'status'); card.errorElement = error;
  const apply = document.createElement('button'); apply.type = 'button'; apply.className = 'apply-button';
  apply.textContent = 'Apply';
  apply.setAttribute('aria-label', state.phase === 'initial' ? `Use this chart: ${card.title}` : `Apply action: ${card.title}`);
  card.apply = apply;
  apply.addEventListener('click', () => commit(card));
  card.controlsElement.append(error);
  if (card.original?.notice || card.notice) {
    const explanation = document.createElement('p'); explanation.className = 'card-notice';
    explanation.textContent = card.original?.notice ?? card.notice;
    card.noticeElement = explanation;
    card.controlsElement.append(explanation);
  }
  element.append(button, apply, card.controlsElement);
  if (card.score !== undefined) {
    const score = document.createElement('p'); score.className = 'score-description';
    score.textContent = `${card.scoreKind ? 'Similar-data score' : 'Co-occurrence score'} ${card.score.toFixed(4)}`;
    if (card.original?.hierarchy?.promoted) score.title = `Co-occurrence of ${card.original.hierarchy.sourceMethod}; shown through ${card.original.sourceMethod ?? card.method}.`;
    element.append(score);
  }
  if (!card.disabled) {
    if (card.prepared) renderChart(card.thumbnail, card.prepared.preview, card.title);
    else await prepareCard(card, card.values, { interactive: false });
    if (!card.prepared && !card.controls.length) card.disabled = true;
  }
  if (card.disabled) {
    element.classList.add('disabled'); button.disabled = true; apply.hidden = true;
    thumbnail.className = 'unavailable'; thumbnail.textContent = card.requirement || card.error;
  } else {
    if (!card.prepared) {
      card.thumbnail.classList.add('needs-adjustment');
      card.thumbnail.textContent = card.error || 'Open this card to adjust its parameters.';
    }
    button.addEventListener('click', () => selectCard(card));
    // Keep the active accordion open across the gaps between cards. Selecting
    // another card or leaving the gallery owns collapse, not moving children.
    element.addEventListener('focusin', event => {
      if (event.target.matches(':focus-visible') && (state.active !== card || !card.element.classList.contains('expanded'))) selectCard(card);
    });
    element.addEventListener('focusout', event => {
      if (!element.contains(event.relatedTarget) && !pointerInGallery) {
        setCardExpanded(card, false);
        const inspecting = inspectingCode(event.relatedTarget);
        if (state.phase === 'initial' && !inspecting) state.active = null;
        showPreview(state.active, { showCodeChange: inspecting });
      }
    });
  }
  return card;
}

function currentGalleryPage() {
  if (!state.galleryRows.length) return 0;
  const left = elements.cards.getBoundingClientRect().left;
  return state.galleryRows.reduce((best, row, index, rows) =>
    Math.abs(row.getBoundingClientRect().left - left) < Math.abs(rows[best].getBoundingClientRect().left - left) ? index : best, 0);
}

function updateGalleryNavigation() {
  const page = currentGalleryPage(), count = state.galleryRows.length;
  const pending = mountedGallery?.phase === 'recommendations' && !mountedGallery.pagination.complete;
  $('cards-page').textContent = `${page + 1} / ${pending ? '…' : Math.max(1, count)}`;
  $('cards-prev').disabled = page === 0 || state.committing || mountedGallery?.loading;
  $('cards-next').disabled = page >= count - 1 || state.committing || mountedGallery?.loading;
  $('cards-prev').closest('nav').hidden = count <= 1;
}

async function goToGalleryPage(index) {
  const deck = mountedGallery, generation = state.generation;
  if (deck?.loading || state.committing) return;
  if (deck?.phase === 'recommendations' && !deck.pages.has(index)) {
    deck.loading = true; updateGalleryNavigation(); notice('Preparing options…');
    try { await deck.renderPage(index); }
    catch (error) {
      if (generation === state.generation) notice(error.message, true);
      return;
    } finally {
      deck.loading = false;
      if (mountedGallery === deck) updateGalleryNavigation();
    }
    if (generation !== state.generation || mountedGallery !== deck) return;
    notice();
  }
  const row = state.galleryRows[Math.max(0, Math.min(state.galleryRows.length - 1, index))];
  if (!row) return;
  elements.cards.scrollTo({ left: elements.cards.scrollLeft + row.getBoundingClientRect().left - elements.cards.getBoundingClientRect().left,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

$('cards-prev').addEventListener('click', () => goToGalleryPage(currentGalleryPage() - 1));
$('cards-next').addEventListener('click', () => goToGalleryPage(currentGalleryPage() + 1));
elements.cards.addEventListener('scroll', updateGalleryNavigation, { passive: true });
elements.cards.addEventListener('keydown', event => {
  if (event.target !== elements.cards) return;
  const delta = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
  if (delta) { event.preventDefault(); goToGalleryPage(currentGalleryPage() + delta); }
});

function saveGallery() {
  if (!mountedGallery || mountedGallery.phase !== 'recommendations') return;
  const deck = mountedGallery;
  deck.scrollLeft = elements.cards.scrollLeft;
  for (const card of deck.cards) { setCardExpanded(card, false); card.interaction.reset(); }
  if (!galleryCache.has(deck.view)) galleryCache.set(deck.view, new Map());
  const cache = galleryCache.get(deck.view), key = JSON.stringify([deck.group, deck.searchQuery]);
  cache.delete(key); cache.set(key, deck);
  if (cache.size > 8) cache.delete(cache.keys().next().value);
  for (const row of deck.rows) row.remove();
  mountedGallery = null;
}

function recommendationResponse(program = state.program, view = state.view, guideCall = state.guideCall, context = state.context, group = state.optionGroup, page = 0, searchQuery = state.searchQuery) {
  recentGalleries.set(view, true);
  if (!recommendationCache.has(view)) recommendationCache.set(view, new Map());
  const cache = recommendationCache.get(view), key = JSON.stringify([context, group, page, searchQuery]);
  if (!cache.has(key)) {
    cache.set(key, calculations.recommend(program, view, guideCall, { ...context, fieldTypes: datasets.get(state.datasetId)?.imported.fieldTypes,
      ...FOLLOWUP_RECOMMENDATION_OPTIONS }, group, page, searchQuery)
      .catch(error => { cache.delete(key); throw error; }));
    if (cache.size > 32) cache.delete(cache.keys().next().value);
  }
  return cache.get(key);
}

function recommendationSpecs({ result, profile }) {
  return result.recommendations.map((recommendation, i) => ({
    ...recommendationParameters(recommendation, profile), original: recommendation,
    method: recommendation.method, title: actionTitle(recommendation),
    description: recommendation.args.field ? `Variable: ${recommendation.args.field}` : '',
    rank: String(i + 1).padStart(2, '0'), score: recommendation.score,
  }));
}

async function updateCards() {
  saveGallery();
  if (state.phase === 'recommendations') recentGalleries.set(state.view, true);
  pointerMotion.reset();
  pointerChoice = null; pointerCard = null; pointerInGallery = false;
  const generation = ++state.generation;
  state.galleryObserver?.disconnect(); state.galleryRows = [];
  state.active = null; state.cards = []; elements.cards.replaceChildren();
  elements.cards.scrollTop = 0; elements.cards.scrollLeft = 0;
  document.body.dataset.phase = state.phase;
  updateOptionGroups();
  elements.cards.dataset.searchQuery = state.searchQuery;
  updateGalleryNavigation();
  elements['step-description'].textContent = state.phase === 'initial'
    ? 'Choose a chart for the selected variables.'
    : 'Hover parameters to preview · click to keep · apply when ready.';
  elements['options-note'].textContent = state.phase === 'initial' ? 'ggaction plot functions' : '';
  if (state.phase === 'initial') {
    showPreview(null);
    if (!state.selection.x) {
      elements.cards.dataset.selectedFields = '[]';
      elements.cards.dataset.queryFieldCount = '0';
      elements['step-description'].textContent = 'Select X to see chart options; add Y and Color to compare variables.';
      notice(); return;
    }
    const data = state.program.semanticSpec.datasets.find(dataset => dataset.id === state.plotData);
    if (!data?.values.length) {
      elements['step-description'].textContent = 'No rows have values for all selected variables.';
      notice(); return;
    }
  }
  notice('Preparing options…'); await tick();
  if (generation !== state.generation) return;
  try {
    const restored = state.phase === 'recommendations' ? galleryCache.get(state.view)?.get(JSON.stringify([state.optionGroup, state.searchQuery])) : null;
    let specs = restored?.specs, pageCount = restored?.pageCount, pagination = restored?.pagination;
    if (restored) {
      state.cards = restored.cards; state.galleryRows = restored.rows;
      elements.cards.append(...restored.rows); elements.cards.scrollLeft = restored.scrollLeft ?? 0;
    } else if (state.phase === 'initial') {
      const profile = { ...state.profile, id: state.plotData };
      const result = state.initialEngine.recommend(state.rows, profile, { selection: state.selection });
      specs = result.recommendations;
      elements.cards.dataset.ranking = 'selected-columns-similar-dataset-chart-frequency';
      elements.cards.dataset.neighborCount = result.neighbors.length;
      elements.cards.dataset.selectedFields = JSON.stringify(result.selectedFields);
      elements.cards.dataset.queryFieldCount = result.query.fields.length;
      elements.cards.dataset.chartEligibility = JSON.stringify(result.diagnostics.chartEligibility);
      elements.cards.dataset.chartPreparationFailures = '[]';
    } else {
      elements.cards.dataset.ranking = 'paper-cooccurrence-with-appearance-revisions';
      state.context = focus(state.program, state.context);
      const response = await recommendationResponse();
      if (generation !== state.generation) return;
      specs = recommendationSpecs(response);
      pagination = response.pagination;
      pageCount = response.pagination.pageCount;
      if (!specs.length) elements['step-description'].textContent = emptyActionsMessage();
    }
    // The worker's pageCount is an upper bound until native validation finishes.
    // Mount known pages and one loading destination, never a queue of empty pages.
    const count = pagination ? (pagination.complete ? pagination.pageCount : pagination.pageRanges.length + 1)
      : pageCount ?? Math.ceil(specs.length / 5), pages = restored?.pages ?? new Set();
    for (let page = 0; !restored && page < count; page++) {
      const row = document.createElement('div'); row.className = 'card-row';
      row.dataset.page = page + 1; row.setAttribute('aria-busy', 'true');
      state.galleryRows.push(row); elements.cards.append(row);
    }
    // Keep the cached deck and mounted gallery on the same row list. Copying a
    // restored list loses pages appended later when the user switches groups.
    const rows = state.galleryRows;
    const deck = restored ?? { view: state.view, program: state.program, guideCall: state.guideCall,
      context: structuredClone(state.context), phase: state.phase, group: state.optionGroup, searchQuery: state.searchQuery,
      specs, pages, rows, cards: state.cards, pageCount: count, pagination };
    mountedGallery = deck;
    const restoredCard = restored && state.cards.find(card => !card.disabled);
    if (restoredCard) selectCard(restoredCard, false, false);
    let rendering = Promise.resolve();
    const renderPage = requested => {
      // Keep page construction ordered even if a fast scroll observes several
      // pages together. Native-invalid plots move behind all usable choices.
      rendering = rendering.catch(() => {}).then(async () => {
        for (let page = 0; page <= requested; page++) {
          if (pages.has(page)) continue;
          if (generation !== state.generation) return;
          if (deck.phase === 'recommendations' && page > 0) {
            const response = await recommendationResponse(deck.program, deck.view, deck.guideCall, deck.context, deck.group, page, deck.searchQuery);
            if (generation !== state.generation) return;
            specs = deck.specs = recommendationSpecs(response);
            deck.pagination = response.pagination;
            deck.pageCount = response.pagination.complete ? response.pagination.pageCount : response.pagination.pageRanges.length + 1;
            for (const removed of rows.splice(deck.pageCount)) removed.remove();
            while (rows.length < deck.pageCount) {
              const row = document.createElement('div'); row.className = 'card-row';
              row.dataset.page = rows.length + 1; row.setAttribute('aria-busy', 'true');
              rows.push(row); elements.cards.append(row);
              state.galleryObserver?.observe(row);
            }
            state.galleryRows = rows;
            updateGalleryNavigation();
          }
          if (!rows[page]) return;
          // Build a complete row before revealing it. Incremental flex children
          // otherwise make the first cards visibly shift as later cards arrive.
          const fragment = document.createDocumentFragment();
          const range = deck.pagination?.pageRanges?.[page] ?? { start: page * 5, end: Math.min(specs.length, page * 5 + 5) };
          for (let index = range.start; index < range.end; index++) {
            if (generation !== state.generation) return;
            const spec = specs[index], card = await createCard(spec, index);
            if (generation !== state.generation) return;
            if (state.phase === 'initial' && card.disabled && !spec.requirement) {
              const failures = JSON.parse(elements.cards.dataset.chartPreparationFailures || '[]');
              failures.push({ method: spec.method, reason: card.error || 'No compatible parameters for this dataset.' });
              elements.cards.dataset.chartPreparationFailures = JSON.stringify(failures);
              spec.requirement = card.error || 'No compatible parameters for this dataset.';
              specs.splice(index, 1); specs.push(spec); index--; continue;
            }
            state.cards.push(card); fragment.append(card.element);
            if (state.phase !== 'initial' && !state.active && !card.disabled) selectCard(card, false, false);
            if (state.phase === 'initial') await tick();
          }
          if (generation !== state.generation) return;
          // Reserve all five positions, including their normal flex weights,
          // so a short result list or final page keeps the same card widths.
          for (let slot = fragment.childElementCount; slot < 5; slot++) {
            const space = document.createElement('div'); space.className = 'card-space';
            const index = page * 5 + slot;
            if (index < 2) space.classList.add(index === 0 ? 'primary' : 'secondary');
            space.setAttribute('aria-hidden', 'true'); fragment.append(space);
          }
          rows[page].append(fragment);
          rows[page].setAttribute('aria-busy', 'false');
          pages.add(page);
        }
      });
      return rendering;
    };
    deck.renderPage = renderPage;
    await renderPage(0);
    if (generation !== state.generation) return;
    // Execute only pages the user opens, never adjacent/offscreen pages.
    state.galleryObserver = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        renderPage(Number(entry.target.dataset.page) - 1).catch(error => {
          if (generation === state.generation) notice(error.message, true);
        });
      }
    }, { root: elements.cards, rootMargin: '0px', threshold: 0.5 });
    rows.forEach(row => state.galleryObserver.observe(row));
    updateGalleryNavigation();
    if (generation !== state.generation) return;
    notice();
    if (!state.cards.some(card => !card.disabled)) {
      showPreview(null);
      elements['step-description'].textContent = state.phase === 'initial'
        ? 'These charts need an adjustment. Open a card for its parameters and the specific reason.'
        : deck.pagination?.newActionsExhausted
          ? 'All available actions in this group have been used. Browse the next page or search to edit them.'
          : emptyActionsMessage();
    }
  } catch (error) { if (generation === state.generation) notice(error.message, true); }
}

function emptyActionsMessage() {
  return state.searchQuery ? `No matching ${state.optionGroup} actions for “${state.searchQuery}”.`
    : `No applicable ${state.optionGroup} actions for this chart yet.`;
}

async function commit(card) {
  if (state.committing || card.base !== state.program) return;
  const datasetId = state.datasetId;
  clearTimeout(searchTimer); state.searchQuery = normalizeSearchQuery($('action-search').value);
  // Apply always uses the pinned settings, never a queued hover from a control
  // the pointer has already left on its way to this button.
  state.committing = true;
  historyView.release();
  historyView.clear({ restore: false }); historyInspection = null;
  card.request = (card.request ?? 0) + 1;
  card.interaction.reset();
  updateHistoryButtons();
  elements.cards.inert = true;
  elements.cards.setAttribute('aria-busy', 'true');
  elements.current.setAttribute('aria-busy', 'true');
  try {
    const action = buildRecommendationCall(card, card.values);
    const setup = card.setup?.(card.values) ?? [];
    const pinned = await calculations.prepare(card.base, card.view, card.guideCall, action, setup);
    const recommendation = pinned.recommendation;
    const prerequisiteCalls = pinned.prerequisiteCalls ?? [];
    const postActionCalls = pinned.postActionCalls ?? [];
    const previousCount = state.program.trace.children.length;
    const committed = await calculations.materialize(card.base, card.view, card.guideCall, action, setup);
    if (state.datasetId !== datasetId || state.program !== card.base) {
      throw new Error('The chart changed before this action finished. Preview it again.');
    }
    const next = committed.program, view = committed.view;
    if (next.trace.children.length !== previousCount + 1 + prerequisiteCalls.length + postActionCalls.length ||
        view.trace.children.length !== next.trace.children.length + 1 || view.trace.children.at(-1).op !== 'createGuides') {
      throw new Error('Expected one selected action followed by one final createGuides call.');
    }
    saveGallery();
    state.program = next; state.view = view; state.guideCall = committed.guideCall;
    state.codeCard = null;
    state.calls.push(...prerequisiteCalls.map(call => structuredClone(call)),
      { method: recommendation.method, args: structuredClone(recommendation.args) },
      ...postActionCalls.map(call => structuredClone(call)));
    state.steps++; state.phase = 'recommendations';
    clearSearch();
    state.context = focus(state.program, card.original?.nextContext ?? {});
    history.push(historySnapshot(card.title));
    scheduleSave();
    const committedProgram = state.program;
    // Invalidate an initial gallery that may still be filling, and remove the
    // entire old set before the chart starts moving. No stale cards remain clickable.
    state.generation++;
    state.galleryObserver?.disconnect();
    state.active = null; state.cards = [];
    elements.cards.replaceChildren();
    elements.cards.scrollTop = 0; elements.cards.scrollLeft = 0;
    elements['options-note'].textContent = '';
    elements['step-description'].textContent = 'Preparing next actions…';
    showCode(null, { settleApplied: true });
    // Compute the complete next recommendation set while the chart flies.
    const warming = recommendationResponse();
    warming.catch(() => {});
    renderChart(elements.preview, view, card.title);
    await transferChart(elements.preview, elements.current,
      host => renderChart(host, view, card.title));
    if (state.program !== committedProgram) return;
    elements.current.classList.remove('data-view'); state.tableView?.destroy?.(); state.tableView = null;
    $('selection-controls').hidden = true;
    elements.current.dataset.traceCount = view.trace.children.length;
    elements.current.dataset.steps = state.steps;
    elements.current.dataset.lastMethod = card.method;
    renderChart(elements.current, view, 'Current visualization');
    elements['current-note'].textContent = card.title;
    elements['current-note'].title = elements['current-note'].textContent;
    await updateCards();
  } catch (error) { notice(error.message, true); }
  finally {
    state.committing = false;
    elements.cards.inert = false;
    elements.cards.removeAttribute('aria-busy');
    elements.current.removeAttribute('aria-busy');
    updateHistoryButtons(); updateGalleryNavigation();
  }
}

async function refreshSelection() {
  historyView.clear({ restore: false }); historyInspection = null;
  const setup = selectionData(state.base, state.profile, state.rows, state.selection);
  state.program = setup.program; state.view = setup.program; state.plotData = setup.data;
  state.setupCalls = [...state.baseCalls, ...setup.calls];
  state.selectionAxes = selectionAxes(state.program, state.profile, state.rows, state.selection);
  state.codeCard = null; state.active = null;
  state.tableView?.update(state.selection);
  elements.current.dataset.traceCount = state.program.trace.children.length;
  // An edited selection starts a new chart branch. Merely visiting History 0
  // uses restoreHistory, so later snapshots remain available until this edit.
  history.reset(historySnapshot());
  updateHistoryButtons();
  showPreview(null);
  scheduleSave();
  await updateCards();
}

function clearSearch() {
  clearTimeout(searchTimer); state.searchQuery = ''; $('action-search').value = '';
  $('clear-search').hidden = true;
}
$('clear-search').addEventListener('click', () => {
  $('action-search').value = ''; searchActions(); $('action-search').focus();
});

function liveSession() {
  return { entries: history.entries, index: history.index };
}
function rememberDataset() {
  const record = datasets.get(state.datasetId);
  if (record && history.entries.length) record.session = liveSession();
}
function projectSnapshot() {
  rememberDataset();
  return createProject([...datasets.values()], state.datasetId, sourceVersion);
}
function flushSave() {
  if (restoringProject || !state.datasetId) return;
  $('draft-status').textContent = 'Saving draft…';
  // Start durable writes without a debounce gap: a dataset switch followed by
  // reload must not restore the previously selected dataset.
  try {
    const project = projectSnapshot();
    savingDraft = drafts.write(project).then(() => {
      $('draft-status').textContent = 'Draft saved on this device';
    }).catch(error => { $('draft-status').textContent = 'Draft not saved. Use Save project.'; $('draft-status').title = error.message; });
  } catch (error) { $('draft-status').textContent = 'Draft not saved. Use Save project.'; $('draft-status').title = error.message; }
  return savingDraft;
}
function scheduleSave() { return flushSave(); }
addEventListener('pagehide', flushSave);
function updateDatasetOptions() {
  const selected = state.datasetId;
  $('dataset').replaceChildren(...[...datasets.values()].map(record => {
    const option = document.createElement('option'); option.value = record.id; option.textContent = record.name; return option;
  }));
  $('dataset').value = selected;
}

async function showSnapshot(snapshot) {
  historyView.clear({ restore: false }); historyInspection = null;
  pointerMotion.reset(); cancelChartTransfer(); saveGallery();
  state.generation++; state.galleryObserver?.disconnect();
  const { program, view, selectionAxes: axes, currentNote, ...metadata } = snapshot;
  Object.assign(state, structuredClone(metadata), { program, view, selectionAxes: axes, active: null, codeCard: null });
  resetCodeView($('code-content'));
  elements.current.dataset.steps = state.steps;
  elements.current.dataset.traceCount = view.trace.children.length;
  elements.current.dataset.lastMethod = state.calls.at(-1)?.method ?? '';
  elements['current-note'].textContent = currentNote ?? '';
  elements['current-note'].title = currentNote ?? '';
  if (state.phase === 'initial') mountDataTable();
  else {
    state.tableView?.destroy?.(); state.tableView = null;
    elements.current.classList.remove('data-view'); $('selection-controls').hidden = true;
    renderChart(elements.current, view, 'Current visualization');
  }
  updateHistoryButtons(); showPreview(null); scheduleSave(); await updateCards();
}

async function activateDataset(record, { selection = { x: '', y: '', color: '' }, restore = true } = {}) {
  // Do all input/native construction checks before replacing a working session.
  const rows = record.imported.rows;
  let cached = datasetBases.get(record.imported);
  if (!cached) {
    const base = makeBase(rows);
    cached = datasetBases.set(record.imported, { base,
      profile: profileDataset(base.program, 'dataset', record.imported.fieldTypes ?? {}) });
  }
  const { base, profile } = cached;
  if (!profile.fields.some(field => field.usable)) throw new Error('No usable columns. Review data types before loading this table.');
  const session = restore ? record.session : null;
  rememberDataset(); cancelChartTransfer(); state.tableView?.destroy?.();
  datasets.set(record.id, record);
  state.generation++;
  state.datasetId = record.id; state.rows = rows; state.name = record.name;
  state.base = base.program; state.program = base.program; state.view = base.program; state.guideCall = null;
  state.baseCalls = base.calls; state.setupCalls = base.calls; state.profile = profile;
  state.selection = Object.fromEntries(Object.entries(selection).map(([role, name]) =>
    [role, profile.fields.some(field => field.name === name && field.usable) ? name : '']));
  state.phase = 'initial'; state.steps = 0; state.context = {}; state.calls = [];
  state.optionGroup = 'encoding'; clearSearch();
  state.codeCard = null; resetCodeView($('code-content')); updateDatasetOptions();
  if (session) {
    const current = history.restore(session.entries, session.index);
    await showSnapshot(current);
  } else {
    elements.current.dataset.steps = 0; elements.current.dataset.traceCount = state.base.trace.children.length;
    elements.current.dataset.lastMethod = '';
    mountDataTable(); elements['current-note'].textContent = ''; elements['current-note'].title = '';
    await refreshSelection();
  }
  scheduleSave();
}

async function editSchema() {
  if (state.committing) return;
  const record = datasets.get(state.datasetId); if (!record) return;
  const imported = await reviewDatasetImport(record.imported, { reuse: true });
  if (!imported) return;
  // A new interpretation is a new revision; the original chart/session remains selectable.
  await activateDataset({ id: crypto.randomUUID(), name: `${record.name} · revised types`, imported }, { selection: state.selection, restore: false });
}

async function resetVisualization() {
  if (state.committing || !state.datasetId) return;
  state.committing = true; updateHistoryButtons();
  pointerMotion.reset(); historyView.release();
  try {
    await activateDataset(datasets.get(state.datasetId), { restore: false });
    // Replace the durable draft as well, so reload cannot revive the old chart.
    await savingDraft;
  } catch (error) { notice(error.message, true); }
  finally { state.committing = false; updateHistoryButtons(); updateGalleryNavigation(); }
}
function downloadText(source, filename, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([source], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function filename(name) { return name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'visualization'; }

async function openProject(value) {
  // Validation and native replay finish before touching the current registry.
  const project = typeof value === 'string' ? parseProject(value) : validateProject(value);
  notice('Restoring project…'); await tick();
  const restored = project.datasets.map(record => ({ ...record,
    session: restoreSession(record.session, record.imported.rows) }));
  const active = restored.find(record => record.id === project.activeId);
  const check = makeBase(active.imported.rows);
  if (!profileDataset(check.program, 'dataset', active.imported.fieldTypes ?? {}).fields.some(f => f.usable)) throw new Error('The project has no usable data.');
  restoringProject = true;
  try {
    rememberDataset();
    for (const record of restored) datasets.set(record.id, record);
    // Never overwrite a freshly restored record with the previous live session.
    state.datasetId = null;
    await activateDataset(active);
  } finally { restoringProject = false; }
  scheduleSave(); notice();
}

// One physical-pointer route owns card, parameter and slider hover. In
// particular, mouseleave/pointerenter caused by animation never collapse or
// reopen the gallery. All screen positions are tracked, even outside it.
function routePointer(event) {
  if (state.committing) return;
  if ($('history').contains(event.target)) {
    if (pointerInGallery) leaveGallery();
    historyView.move(event); return;
  }
  historyView.clear();
  if (!event.target?.isConnected || !elements.cards.contains(event.target)) {
    if (pointerInGallery) leaveGallery();
    return;
  }
  pointerInGallery = true;
  const card = cardElements.get(event.target.closest('.card'));
  if (card && !card.disabled && (pointerCard !== card || !card.element.classList.contains('expanded'))) selectCard(card);
  pointerCard = card ?? null;
  card?.interaction.movePointer();
  const button = event.target.closest('.parameter-choice');
  const intent = parameterIntents.get(button);
  if (pointerChoice?.button !== button) {
    pointerChoice?.card.interaction.unhover(pointerChoice.button);
    pointerChoice = intent && !button.disabled ? { ...intent, button } : null;
    if (pointerChoice) pointerChoice.card.interaction.hover(button, pointerChoice.draft());
  }
  rangeIntents.get(event.target.closest('.slider-control'))?.(event);
}

function leaveGallery() {
  pointerChoice = null; pointerCard = null; pointerInGallery = false;
  for (const card of state.cards) {
    const focused = card.element.contains(document.activeElement) &&
      (document.activeElement.matches(':focus-visible') || document.activeElement.tagName === 'INPUT');
    if (!focused) setCardExpanded(card, false);
    card.interaction.leavePointer();
  }
  if (state.phase === 'initial' && !inspectingCode()) state.active = null;
  showPreview(state.active, { showCodeChange: false });
}

const pointerMotion = createPointerMotion({ render: routePointer,
  requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id) });
document.addEventListener('pointermove', event => pointerMotion.move(event), { passive: true });
// Flush before clicks/focus changes so they see the latest physical location.
document.addEventListener('pointerdown', () => pointerMotion.flush(), true);
document.documentElement.addEventListener('pointerleave', () => {
  pointerMotion.flush();
  if (pointerInGallery) leaveGallery();
  historyView.clear();
});

// Keep help in the header; reserve its height so switching hints never moves cards.
function updateHeaderGuidance(focusTarget = document.activeElement) {
  const inspecting = inspectingCode(focusTarget);
  elements['step-description'].hidden = inspecting;
  $('code-guidance').hidden = !inspecting;
}

// Let the user inspect the last hovered proposal in the code panel itself.
// Otherwise the new function would disappear before it could be expanded.
$('code-content').closest('.code-panel').addEventListener('mouseenter', () => {
  updateHeaderGuidance();
  if (inspectingCode() && state.codeCard?.base === state.program) showCode(state.codeCard);
});
$('code-content').closest('.code-panel').addEventListener('mouseleave', () => {
  updateHeaderGuidance();
  if (state.phase === 'initial' && !pointerInGallery) { state.active = null; showPreview(null); }
  else showCode();
});
$('code-content').closest('.code-panel').addEventListener('focusin', () => updateHeaderGuidance());
$('code-content').closest('.code-panel').addEventListener('focusout', event => {
  updateHeaderGuidance(event.relatedTarget);
  const panel = $('code-content').closest('.code-panel');
  if (!panel.contains(event.relatedTarget) && !panel.matches(':hover')) showCode();
});

let layoutGalleryPage = 0;
initializePanelLayout({
  workspace: document.querySelector('.workspace'),
  panels: {
    history: { panel: $('history').closest('.history-section'), button: $('toggle-history'),
      contents: [$('history'), $('history-meta')], label: 'history' },
    code: { panel: $('code-content').closest('.code-panel'), button: $('toggle-code'),
      contents: [$('code-content'), $('code-mode'), document.querySelector('.code-tools')],
      label: 'ggaction Code' },
  },
  beforeChange() {
    layoutGalleryPage = currentGalleryPage();
    historyView.clear();
    pointerMotion.reset();
  },
  afterChange() {
    // Resize the existing page without jumping to a neighboring recommendation.
    const row = state.galleryRows[layoutGalleryPage];
    if (row) elements.cards.scrollLeft += row.getBoundingClientRect().left - elements.cards.getBoundingClientRect().left;
    historyView.refreshLayout();
    updateGalleryNavigation();
    updateHeaderGuidance();
  },
});

$('upload').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async event => {
  if (state.committing) { event.target.value = ''; return; }
  const file = event.target.files[0]; if (!file) return;
  try {
    const imported = await reviewDatasetImport(await file.text(), {
      name: file.name, format: file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json' });
    if (imported) await activateDataset({ id: crypto.randomUUID(), name: file.name, imported });
  } catch (error) { notice(error.message, true); }
  event.target.value = '';
});
$('dataset').addEventListener('change', async event => {
  if (state.committing) { $('dataset').value = state.datasetId; return; }
  try { await activateDataset(datasets.get(event.target.value)); }
  catch (error) { $('dataset').value = state.datasetId; notice(error.message, true); }
});
$('edit-schema').addEventListener('click', () => editSchema().catch(error => notice(error.message, true)));
$('reset').addEventListener('click', resetVisualization);
$('undo').addEventListener('click', () => restoreHistory('undo'));
$('redo').addEventListener('click', () => restoreHistory('redo'));
$('save-project').addEventListener('click', () => {
  try { downloadText(JSON.stringify(projectSnapshot()), `${filename(state.name)}.visauto.json`); }
  catch (error) { notice(error.message, true); }
});
$('open-project').addEventListener('click', () => $('project-file').click());
$('project-file').addEventListener('change', async event => {
  if (state.committing) { event.target.value = ''; return; }
  const file = event.target.files[0]; if (!file) return;
  try { await openProject(await file.text()); } catch (error) { notice(error.message, true); }
  event.target.value = '';
});
$('code-export').addEventListener('click', () => {
  try {
    const snapshot = historySnapshot();
    downloadText(runnableCode(snapshot, datasets.get(state.datasetId), sourceVersion), `${filename(state.name)}-chart.mjs`, 'text/javascript');
  } catch (error) { notice(error.message, true); }
});
function enlarge(host, label) {
  const svg = host.querySelector('svg');
  if (!svg) { notice('Create or preview a chart to enlarge it.'); return; }
  $('chart-dialog-title').textContent = label;
  const copy = svg.cloneNode(true); copy.removeAttribute('width'); copy.removeAttribute('height');
  $('enlarged-chart').replaceChildren(copy); $('chart-dialog').showModal();
}
$('zoom-preview').addEventListener('click', () => enlarge(elements.preview, elements['preview-name'].textContent || 'Preview'));
const zoomCurrent = document.createElement('button'); zoomCurrent.type = 'button'; zoomCurrent.id = 'zoom-current';
zoomCurrent.textContent = 'Expand'; zoomCurrent.title = 'Enlarge current chart'; zoomCurrent.setAttribute('aria-label', 'Enlarge current chart');
zoomCurrent.addEventListener('click', () => enlarge(elements.current, 'Current visualization'));
$('chart-exports').append(zoomCurrent);

try {
  const [initialResponse, sourceResponse] = await Promise.all([fetch('/data/initial-model.json'), fetch('/output/workers/source.json'), calculations.ready]);
  if (!initialResponse.ok) throw new Error('The recommendation models are missing. Run npm run corpus:update.');
  state.initialEngine = createInitialChartRecommender(await initialResponse.json());
  if (sourceResponse.ok) sourceVersion = await sourceResponse.json();
  const examples = [
    ['cars', 'Cars', '/web/data/cars.json'], ['tips', 'Tips', '/web/data/tips.json'],
    ['iris', 'Iris', '/web/data/iris.json'], ['weather', 'Seattle weather', '/web/data/weather.json'],
    ['stocks', 'Stocks', '/web/data/stocks.json'], ['gapminder', 'Gapminder', '/web/data/gapminder.json'],
    ['barley', 'Barley', '/web/data/barley.json'], ['electricity', 'Iowa electricity', '/web/data/electricity.json'],
  ];
  for (const [id, name, url] of examples) {
    const response = await fetch(url); if (!response.ok) throw new Error(`The ${name} example dataset is missing.`);
    const rawRows = await response.json();
    const options = { format: 'rows', name,
      ...(id === 'stocks' ? { fieldOverrides: { date: { type: 'temporal', dateFormat: 'month-name' } } } : {}),
      ...(id === 'barley' ? { fieldOverrides: { year: { type: 'ordinal' } } } : {}) };
    datasets.set(id, { id, name, imported: importDataset(rawRows, options) });
  }
  datasets.set('sales', { id: 'sales', name: 'Monthly sales', imported: importDataset(sales, { format: 'rows', name: 'Monthly sales' }) });
  cars = datasets.get('cars').imported.rows;
  let draft;
  try { draft = await drafts.read(); } catch { $('draft-status').textContent = 'Use Save project to keep your work.'; }
  if (draft) {
    try { await openProject(draft); $('draft-status').textContent = 'Draft restored on this device'; }
    catch (error) { await activateDataset(datasets.get('cars')); notice(`Could not restore the draft: ${error.message}`, true); }
  } else await activateDataset(datasets.get('cars'));
} catch (error) { notice(error.message, true); }
