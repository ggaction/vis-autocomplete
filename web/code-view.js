// Uses recorded PUBLIC calls and their real arguments, never summarized trace args.
export function programCode(calls, datasetName, rows) {
  const lines = ['import { chart } from "ggaction";', '', 'const program = chart()'];
  for (const [i, call] of calls.entries()) {
    if (call.method === 'createGuides' && Object.keys(call.args ?? {}).length === 0) {
      lines.push(`  .createGuides()${i === calls.length - 1 ? ';' : ''}`);
      continue;
    }
    let args = JSON.stringify(call.args, null, 2);
    if (call.method === 'createData') args = args.replace('"__LOADED_DATA__"', 'data');
    const argumentLines = args.split('\n');
    lines.push(`  .${call.method}(${argumentLines[0]}`);
    for (const line of argumentLines.slice(1)) lines.push(`  ${line}`);
    lines[lines.length - 1] += i === calls.length - 1 ? ');' : ')';
  }
  return lines.join('\n');
}

export function codeDiff(current, proposed) {
  const before = current.split('\n'), after = proposed.split('\n');
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return [
    ...after.slice(0, prefix).map(text => ({ text, change: 'context' })),
    ...before.slice(prefix, before.length - suffix).map(text => ({ text, change: 'removed' })),
    ...after.slice(prefix, after.length - suffix).map(text => ({ text, change: 'added' })),
    ...after.slice(after.length - suffix).map(text => ({ text, change: 'context' })),
  ];
}

// The input is our generated public-call chain. Nested argument objects stay in
// their owning call; repeated calls get independent identities by position.
function sections(source) {
  const header = [], calls = [];
  for (const [index, text] of source.split('\n').entries()) {
    const match = /^  \.(\w+)\(/.exec(text);
    if (match) calls.push({ key: `${calls.length}:${match[1]}`, method: match[1], line: index + 1, lines: [] });
    if (calls.length) calls.at(-1).lines.push(text);
    else header.push({ text, line: index + 1 });
  }
  // The trailing guide is one persistent suffix, even when a new action is
  // inserted before it. Moving it alone should not highlight it as a new action.
  if (calls.at(-1)?.method === 'createGuides') calls.at(-1).key = 'trailing:createGuides';
  return { header, calls };
}

export function codeCallBlocks(current, proposed = null) {
  const before = sections(current), after = proposed ? sections(proposed) : before;
  const original = new Map(before.calls.map(call => [call.key, call]));
  // Appending a call only moves the final semicolon. That punctuation alone
  // should not mark the previous, unchanged function as an edit.
  const comparable = call => call.lines.join('\n').replace(/;$/, '');
  return { header: after.header, calls: after.calls.map(call => ({ ...call,
    change: !original.has(call.key) ? 'added'
      : comparable(original.get(call.key)) === comparable(call) ? 'context' : 'added',
  })) };
}

const codeViews = new WeakMap();

export function resetCodeView(host) {
  for (const record of codeViews.get(host)?.calls.values() ?? []) cancelSettlement(record);
  codeViews.delete(host); host.replaceChildren(); host.scrollTop = 0;
}

function codeLine(value, number, change = 'context') {
  const row = document.createElement('div'); row.className = `code-line ${change}`;
  row.dataset.change = change;
  const n = document.createElement('span'); n.className = 'line-number'; n.setAttribute('aria-hidden', 'true');
  n.textContent = number;
  const sign = document.createElement('span'); sign.className = 'diff-sign'; sign.setAttribute('aria-hidden', 'true');
  sign.textContent = change === 'added' ? '+' : ' ';
  const text = document.createElement('span'); text.className = 'code-text'; text.textContent = value || ' ';
  row.append(n, sign, text);
  return row;
}

function reconcileChildren(host, nodes) {
  let cursor = host.firstChild;
  for (const node of nodes) {
    if (cursor !== node) host.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  while (cursor) { const next = cursor.nextSibling; cursor.remove(); cursor = next; }
}

function cancelSettlement(record) {
  clearTimeout(record.settleTimer);
  record.settleTimer = null;
  record.foldAnimation?.cancel();
  record.foldAnimation = null;
  record.body.style.removeProperty('overflow');
  delete record.details.dataset.settling;
}

function settleAppliedCall(record) {
  cancelSettlement(record);
  const { details, body } = record;
  if (!body.childElementCount || !body.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    details.open = false; updateSummary(record);
    return;
  }
  details.dataset.settling = 'holding';
  record.settleTimer = setTimeout(() => {
    record.settleTimer = null;
    if (!details.isConnected || !details.open) { cancelSettlement(record); return; }
    details.dataset.settling = 'folding';
    body.style.overflow = 'hidden';
    const animation = body.animate([
      { height: `${body.getBoundingClientRect().height}px`, opacity: 1 },
      { height: '0px', opacity: 0 },
    ], { duration: 260, easing: 'cubic-bezier(.22, .61, .36, 1)', fill: 'both' });
    record.foldAnimation = animation;
    animation.onfinish = () => {
      if (record.foldAnimation !== animation) return;
      details.open = false;
      cancelSettlement(record);
      updateSummary(record);
    };
  }, 700);
}

export function renderCode(host, current, proposed = null, { setupCallCount = 0, settleApplied = false } = {}) {
  if (!codeViews.has(host)) codeViews.set(host, { calls: new Map(), header: [], signature: '' });
  const view = codeViews.get(host);
  if (view.current === current && view.proposed === proposed && view.setupCallCount === setupCallCount) return;
  const blocks = codeCallBlocks(current, proposed);
  const visibleKeys = new Set(blocks.calls.map(call => call.key));
  for (const [key, record] of view.calls) if (!visibleKeys.has(key)) cancelSettlement(record);
  const nodes = blocks.header.map((line, index) => {
    const row = view.header[index] ??= codeLine(line.text, line.line);
    row.querySelector('.code-text').textContent = line.text || ' ';
    return row;
  });
  const setupNodes = [];
  let foldedPrefix = 0;
  while (foldedPrefix < setupCallCount && blocks.calls[foldedPrefix]?.change === 'context') foldedPrefix++;
  for (const [index, call] of blocks.calls.entries()) {
    let record = view.calls.get(call.key);
    if (!record) {
      const details = document.createElement('details'); details.className = 'code-call';
      details.dataset.method = call.method;
      const summary = document.createElement('summary'); summary.className = 'code-call-summary';
      summary.setAttribute('aria-label', `${call.method} parameters`);
      const body = document.createElement('div'); body.className = 'code-arguments';
      details.append(summary, body);
      record = { details, summary, body, call: null, fingerprint: '', previewing: false };
      details.addEventListener('toggle', () => updateSummary(record));
      summary.addEventListener('click', () => cancelSettlement(record));
      view.calls.set(call.key, record);
    }
    record.call = call;
    const previewing = proposed !== null && call.change === 'added';
    // Only Apply settles a preview into committed code. Moving off a card
    // keeps the existing immediate reset, and manual disclosures stay independent.
    const settling = settleApplied && record.previewing && record.details.open && !previewing;
    if (previewing) {
      cancelSettlement(record); record.details.open = true;
    } else if (record.previewing && !settling) {
      cancelSettlement(record); record.details.open = false;
    }
    record.previewing = previewing;
    const fingerprint = JSON.stringify([call.lines, call.change, call.line]);
    if (record.fingerprint !== fingerprint) {
      record.fingerprint = fingerprint;
      record.details.dataset.change = call.change;
      record.body.replaceChildren(...call.lines.slice(1).map((text, i) => codeLine(text, call.line + i + 1, call.change)));
    }
    updateSummary(record);
    if (settling) settleAppliedCall(record);
    // Only the explicit unchanged setup prefix is folded. New prerequisites,
    // previewed actions and user-authored calls remain visible in the chain.
    if (index < foldedPrefix) setupNodes.push(record.details);
    else nodes.push(record.details);
  }
  if (setupNodes.length) {
    if (!view.setup) {
      const details = document.createElement('details'); details.className = 'code-setup';
      const summary = document.createElement('summary'); summary.className = 'code-call-summary code-setup-summary';
      summary.setAttribute('aria-label', 'Chart setup');
      summary.title = 'Expand or collapse chart setup';
      const body = document.createElement('div'); body.className = 'code-setup-body';
      details.append(summary, body); view.setup = { details, summary, body };
    }
    const { details, summary, body } = view.setup;
    const label = `  // Setup (${setupNodes.length} calls)`;
    if (summary.querySelector('.code-text')?.textContent !== label) {
      summary.replaceChildren(codeLine(label, blocks.calls[0].line));
    }
    details.dataset.callCount = setupNodes.length;
    reconcileChildren(body, setupNodes);
    nodes.splice(blocks.header.length, 0, details);
  } else if (view.setup) {
    reconcileChildren(view.setup.body, []);
  }
  // Reuse disclosure nodes so parameter updates don't steal keyboard focus.
  reconcileChildren(host, nodes);
  const signature = blocks.calls.map(call => call.key).join('|');
  if (proposed && signature !== view.signature) host.scrollTop = Math.max(0, host.scrollHeight - host.clientHeight);
  view.signature = signature;
  view.current = current; view.proposed = proposed;
  view.setupCallCount = setupCallCount;
}

function updateSummary(record) {
  const { call, details, summary } = record;
  const value = details.open || /\(\);?$/.test(call.lines[0]) ? call.lines[0]
    : `  .${call.method}(...)${call.lines.at(-1).endsWith(';') ? ';' : ''}`;
  const old = summary.firstElementChild;
  if (old?.querySelector('.code-text')?.textContent !== value || old?.dataset.change !== call.change ||
      old?.querySelector('.line-number')?.textContent !== String(call.line)) {
    summary.replaceChildren(codeLine(value, call.line, call.change));
  }
  summary.title = `${details.open ? 'Collapse' : 'Expand'} ${call.method} parameters`;
}
