import { readFile, readdir, mkdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProgramSource, summarizeData } from '../src/corpus.js';
import { ggactionSource } from './ggaction-source.js';
import { trainCooccurrenceModel } from '../src/model.js';
import { prepareInitialRecord, buildInitialIndex, evaluateInitialIndex, FINGERPRINT_VERSION } from './initial-corpus.js';
import { PROFILE_VERSION } from '../src/dataset-profile.js';
import { actionEvidenceCollector } from './action-evidence.js';
import { parameterEvidenceCollector } from './parameter-evidence.js';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const CORPUS_ROOT = resolve(process.env.CHART_CORPUS_DIR ?? join(ROOT, '.cache/chart-datasets'));
const digest = buffer => createHash('sha256').update(buffer).digest('hex');

export async function trainCorpus({ corpusRoot = CORPUS_ROOT, outputRoot = join(ROOT, 'data') } = {}) {
  const chartRoot = join(corpusRoot, 'charts');
  const entries = (await readdir(chartRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (!entries.length) throw new Error('No charts found; run npm run corpus:update first.');
  const ggactionPackage = JSON.parse(await readFile(join(ROOT, 'node_modules/ggaction/package.json'), 'utf8'));
  let commit;
  try { commit = execFileSync('git', ['-C', corpusRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { commit = 'local-directory'; }
  const observations = [];
  const initialRecords = [], profileCache = new Map();
  const cachePath = corpusRoot === CORPUS_ROOT ? join(ROOT, '.cache', `initial-profiles-${digest(corpusRoot).slice(0, 12)}.json`)
    : join(outputRoot, '.initial-profile-cache.json');
  try {
    const cache = JSON.parse(await readFile(cachePath, 'utf8'));
    if (cache.profileVersion === PROFILE_VERSION && cache.fingerprintVersion === FINGERPRINT_VERSION) {
      for (const [key, value] of cache.entries) profileCache.set(key, value);
    }
  } catch (error) { if (error.code !== 'ENOENT') console.log('Rebuilding the initial-profile cache.'); }
  const reports = [];
  const actionFrequency = Object.create(null);
  const actionEvidence = actionEvidenceCollector();
  const parameterEvidence = parameterEvidenceCollector();
  let programCount = 0;
  let dataBytes = 0;
  for (const [index, id] of entries.entries()) {
    const folder = join(chartRoot, id);
    const metadata = JSON.parse(await readFile(join(folder, 'metadata.json'), 'utf8'));
    if (metadata.id !== id || metadata.status !== 'completed') {
      throw new Error(`Cannot silently skip ${id}: expected matching completed metadata.`);
    }
    const files = (await readdir(folder)).filter(name => /^G\d+\.gg\.mjs$/.test(name)).sort();
    const declared = metadata.stages.map(stage => stage.code).sort();
    if (!files.includes('G1.gg.mjs') || JSON.stringify(files) !== JSON.stringify(declared)) {
      throw new Error(`Stage inventory mismatch for ${id}.`);
    }
    const features = new Set();
    const chartMethods = new Set();
    let dynamicOptions = 0;
    let temporal = false;
    const stages = [];
    const unknownMethods = new Set();
    for (const filename of files) {
      const bytes = await readFile(join(folder, filename));
      const expected = metadata.files[filename]?.sha256;
      if (!expected || digest(bytes) !== expected) throw new Error(`Source SHA-256 mismatch: ${id}/${filename}`);
      const parsed = parseProgramSource(bytes.toString('utf8'));
      actionEvidence.add(parsed);
      parameterEvidence.add(id, parsed);
      stages.push(parsed);
      for (const feature of parsed.features) features.add(feature);
      for (const name of Object.keys(parsed.methods)) chartMethods.add(name);
      for (const name of parsed.unknownMethods) unknownMethods.add(name);
      dynamicOptions += parsed.dynamicOptions;
      temporal ||= parsed.temporal;
      programCount++;
    }
    const bytes = await readFile(join(folder, 'data.json'));
    if (digest(bytes) !== metadata.files['data.json']?.sha256) throw new Error(`Data SHA-256 mismatch: ${id}`);
    const rows = JSON.parse(bytes.toString('utf8'));
    const data = summarizeData(rows);
    if (!data.tables) throw new Error(`No tabular data arrays found: ${id}`);
    dataBytes += bytes.length;
    const sources = {};
    for (const name of ['source.vl.json', 'resolved-source.vl.json']) {
      if (!metadata.files[name]) continue;
      let source;
      try { source = await readFile(join(folder, name)); }
      catch { throw new Error(`Missing ${id}/${name}; run npm run corpus:update to include source specifications.`); }
      if (digest(source) !== metadata.files[name].sha256) throw new Error(`Source SHA-256 mismatch: ${id}/${name}`);
      sources[name] = JSON.parse(source.toString('utf8'));
    }
    initialRecords.push(prepareInitialRecord({ id, dataHash: metadata.files['data.json'].sha256, data: rows, stages,
      source: sources['resolved-source.vl.json'] ?? sources['source.vl.json'], originalSource: sources['source.vl.json'] }, profileCache));
    features.add(temporal || data.isoTemporal ? 'data.time-series' : 'data.tabular');
    for (const name of chartMethods) actionFrequency[name] = (actionFrequency[name] ?? 0) + 1;
    observations.push({ id, features: [...features].sort() });
    reports.push({ id, programs: files.length, features: features.size, data: { ...data, bytes: bytes.length },
      dynamicOptions, unknownMethods: [...unknownMethods].sort() });
    if ((index + 1) % 200 === 0) console.log(`Read all stages + data: ${index + 1}/${entries.length} charts`);
  }
  const provenance = {
    repository: 'https://github.com/ggaction/chart-datasets', commit,
    ggactionVersion: ggactionPackage.version, ggactionSource: ggactionSource(), trainingUnit: 'one-chart-id',
    stagePolicy: 'union-of-every-accepted-stage-deduplicated-per-chart',
    extraction: 'static-public-ggaction-source-semantics-v5',
    chartCount: entries.length, programCount, dataFiles: entries.length, dataBytes,
  };
  const model = trainCooccurrenceModel(observations, provenance);
  model.actionEvidence = actionEvidence.finish(actionFrequency, provenance);
  model.parameterDefaults = parameterEvidence.finish(provenance);
  console.log('Building initial-chart index and source-family holdout evaluation…');
  const initial = buildInitialIndex(initialRecords, provenance);
  initial.model.parameterDefaults = model.parameterDefaults;
  const evaluation = evaluateInitialIndex(initial.model);
  initial.model.neighborCount = evaluation.neighborCount;
  if (evaluation.weightKernel) initial.model.weightKernel = evaluation.weightKernel;
  initial.model.evaluation = evaluation.skipped ? evaluation : { protocol: evaluation.protocol, test: evaluation.test };
  const report = {
    ...provenance, allChartsUsed: observations.length === entries.length,
    skippedCharts: [], featureCount: Object.keys(model.featureCounts).length,
    pairCount: Object.keys(model.pairCounts).length,
    dynamicOptionPrograms: reports.filter(r => r.dynamicOptions > 0).length,
    unknownMethods: [...new Set(reports.flatMap(r => r.unknownMethods))].sort(),
    actionFrequency: Object.fromEntries(Object.entries(actionFrequency).sort((a, b) => b[1] - a[1])),
    charts: reports,
    limitations: [
      'Static source extraction reads all accepted variants; it does not execute the corpus programs.',
      'A union across alternative granularities may expose design details hidden by a higher-level call.',
      'Dynamic options and unsupported recommendation methods are reported, not inferred with an LLM.',
      'Co-occurrence is design plausibility, not a guarantee of visual quality or user intent.',
    ],
  };
  await mkdir(outputRoot, { recursive: true });
  await mkdir(dirname(cachePath), { recursive: true });
  // Cache descriptors only; source code and data bytes are still SHA-verified on every run.
  await writeFile(`${cachePath}.tmp`, JSON.stringify({ profileVersion: PROFILE_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION, entries: [...profileCache] }));
  await rename(`${cachePath}.tmp`, cachePath);
  // Publish one self-contained model only after EVERY chart and file passed.
  for (const [name, value] of [['corpus-report.json', report], ['observations.json', observations], ['model.json', model],
    ['initial-model.json', initial.model], ['initial-corpus-report.json', initial.report], ['initial-evaluation.json', evaluation],
    ['action-evidence.json', model.actionEvidence], ['parameter-defaults.json', model.parameterDefaults]]) {
    const path = join(outputRoot, name);
    await writeFile(`${path}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
    await rename(`${path}.tmp`, path);
  }
  console.log(`Trained on ${entries.length} charts / ${programCount} programs / ${entries.length} data files.`);
  console.log(`Features: ${report.featureCount}; pairs: ${report.pairCount}; skipped charts: 0.`);
  console.log(`Initial index: ${initial.report.canonicalDatasets} datasets / ${initial.report.sourceFamilies} source families; k=${initial.model.neighborCount}; unresolved charts=${initial.report.unresolved.length}.`);
  return { model, report, initialModel: initial.model, initialReport: initial.report, initialEvaluation: evaluation };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await trainCorpus();
}
