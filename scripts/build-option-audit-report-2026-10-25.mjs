// Rebuild the human-readable report from curated findings and retained audit evidence.
// Generated screenshots, snapshots and HTML stay in ignored output/.
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('../', import.meta.url).pathname);
const out = path.join(root, 'output/option-audit-2026-10-25');
const docs = path.join(root, 'docs/audits');
const stem = 'option-audit-2026-10-25';
const read = async file => JSON.parse(await fs.readFile(path.join(out, file), 'utf8'));
const optional = async file => { try { return await read(file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
const native = await read('parameters/coverage.json');
const live = await Promise.all((await fs.readdir(path.join(out, 'live'))).filter(f => /^\d\d-.*\.json$/.test(f)).sort().map(f => read(`live/${f}`)));
const compositions = [...await read('compositions/results.json'), ...await optional('compositions/new-data/results.json'), ...await optional('compositions/remaining/results.json')];
const compSummary = compositions.map(s => {
  const p = s.cards.flatMap(c => c.probes ?? []), changed = p.filter(p => p.key !== '__default' && !p.harnessError && !p.skipped);
  return { id:s.id, status:s.status, cards:s.cards.length, controlInstances:s.cards.reduce((n,c)=>n+(c.controls?.length??0),0),
    changedValueChecks:changed.length, ready:changed.filter(p=>p.state==='ready').length, invalid:changed.filter(p=>p.state==='invalid').length,
    harnessErrors:p.filter(p=>p.harnessError).length, skipped:p.filter(p=>p.skipped).length };
});
const compCoverage = { summary:compSummary, total:Object.fromEntries(['cards','controlInstances','changedValueChecks','ready','invalid','harnessErrors','skipped'].map(k=>[k,compSummary.reduce((n,s)=>n+s[k],0)])) };
await fs.writeFile(path.join(out,'compositions/coverage-summary.json'),JSON.stringify(compCoverage,null,2)+'\n');
const fashionReplay = await optional('compositions/fashion-replay-results.json');
const replay = [...await optional('compositions/replay-results.json'), ...(Array.isArray(fashionReplay) ? fashionReplay : [fashionReplay])];
const semantics = await read('semantics/results.json');
const oracles = await read('semantics/oracles.json');
const reproductions = await read('reproductions/results.json');
const editors = await read('composition-editors/summary.json');
const probes = live.flatMap(s => s.steps.flatMap(c => c.probes ?? []));
const actual = xs => xs.filter(p => !p.harnessError && !p.driverError && !p.skipped && p.state);
const counts = native.counts;
const completedLive = live.filter(s => s.status === 'completed');
const coverage = {
  generatedAt: new Date().toISOString(), native: counts,
  live: { scenarios: live.length, completed: completedLive.length, datasets: new Set(live.map(s => s.dataset)).size,
    cardSteps: live.reduce((n,s) => n+s.steps.length,0), appliedSteps: live.flatMap(s=>s.steps).filter(s=>s.applied).length,
    parameterProbes: actual(probes).length, driverInterruptedProbes: probes.filter(p=>p.harnessError).length,
    reloads: live.filter(s=>s.reload).length, pageErrors: live.reduce((n,s)=>n+s.pageErrors.length,0),
    incomplete: live.filter(s=>s.status!=='completed').map(s=>({id:s.id,error:s.error?.split('\n')[0]})) },
  composition: { scenarios: compositions.length, datasets: new Set(compositions.map(s=>s.dataset)).size,
    cardContexts: compCoverage.total.cards, parameterProbes: compCoverage.total.changedValueChecks,
    ready: compCoverage.total.ready, invalid: compCoverage.total.invalid,
    harnessErrors: compCoverage.total.harnessErrors, dynamicSkipped: compCoverage.total.skipped,
    replayPassed: replay.filter(s=>s.status==='passed').length, statuses: compositions.map(s=>({id:s.id,status:s.status})) },
  semantics: { selections: semantics.length, roots: semantics.filter(s=>s.stages.length).length,
    appliedStates: semantics.reduce((n,s)=>n+s.stages.length,0), oracles:oracles.length, passed:oracles.filter(s=>s.pass).length },
  independentUIReproductions: reproductions,
  compositionEditors: editors,
};
await fs.writeFile(path.join(out,'coverage-summary.json'), JSON.stringify(coverage,null,2)+'\n');

const cell = value => String(value ?? '').replaceAll('|','\\|').replaceAll('\n',' ');
const table = (headers, rows) => `| ${headers.join(' | ')} |\n| ${headers.map(()=> '---').join(' | ')} |\n${rows.map(r=>`| ${r.map(cell).join(' | ')} |`).join('\n')}\n`;
const totals = [
 ['새 데이터 / 전체 예제','10 / 19'], ['Native 검사 데이터셋 / 차트 계열',`${counts.datasets} / ${counts.plotFamiliesRendered}`],
 ['Native 파라미터 trial 기록',counts.parameterTrialRecords], ['양쪽 렌더러로 생성한 trial',counts.renderedBothSVGAndCanvas],
 ['관찰한 공개 action method / 파라미터 control ID',`${counts.uniqueMethods} / ${counts.uniqueMethodControlIds}`],
 ['기본 후보 persistence round-trip / 불일치',`${counts.defaultPersistenceRoundtrips} / ${counts.roundtripDifferences}`],
 ['실제 UI 파라미터 probe / 별도 composition probe',`${coverage.live.parameterProbes} / ${coverage.composition.parameterProbes}`],
 ['실제 UI 적용한 액션 / 저장 후 reload 시나리오',`${coverage.live.appliedSteps} / ${coverage.live.reloads}`],
 ['별도 중첩 composition 완성·undo/redo·reload',coverage.composition.replayPassed],
 ['후속 composition 편집 함수 / 값 변형',`${editors.uniqueMethods.length} / ${editors.checks}`],
 ['독립 수치 oracle 통과',`${coverage.semantics.passed} / ${coverage.semantics.oracles}`],
];
let md = `# 감사 범위와 분모 — 2026-10-25\n\n생성: ${coverage.generatedAt}. [메인 보고서](${stem}.md). 아래 수치는 서로 겹칠 수 있으므로 합쳐서 독립 테스트 수라고 부르지 않는다.\n\n${table(['항목','기록'],totals)}\n`;
md += `## Native 파라미터 검사\n\n${counts.runs}개 run 중 완료 ${counts.completed}, 부분 기록 ${counts.partial}, 초기 후보 부재 ${counts.unavailable}. ${counts.cardContexts}개 카드 맥락에서 ${counts.parameterTrialRecords}개 trial을 기록했다. 같은 native 호출로 정규화된 ${counts.identicalCallVariants}개 변형은 중복 렌더링하지 않았다. 유효한 no-change ${counts.unchangedAccepted}개를 구분했다.\n\n예상 입력 검증 거부 ${counts.expectedInputRejections}건과 이전 드라이버 배치 오류 ${counts.driverArrangementProbes}건은 발견한 버그 개수에 포함하지 않는다. 예상 밖 예외 ${counts.unexpectedExceptionInstances}회는 method/message 기준 ${counts.unexpectedMethodMessageFamilies}묶음이다. 이는 재현된 독립 결함 개수가 아니다. 같은 구조 문제의 반복, 아직 별도 최소 재현하지 않은 관찰도 포함된다. 메인 보고서의 재현 묶음이 우선이다.\n\n${native.limits.map(s=>`- ${s}`).join('\n')}\n\n`;
md += `## 실행한 차트 계열\n\n${native.renderedPlotFamilies.map(cell).join(', ')}\n\n`;
md += `## 실제 브라우저 검사\n\n초기/후속 옵션 시나리오 ${coverage.live.scenarios}개 중 ${coverage.live.completed}개가 apply·저장·reload까지 완료했다. ${coverage.live.parameterProbes}개 값 조작을 기록했고 pageerror는 ${coverage.live.pageErrors}개다. ${coverage.live.driverInterruptedProbes}개 probe의 자동화 중단은 정상 제품 결과로 세지 않는다.\n\n${table(['미완료 시나리오','원인'],coverage.live.incomplete.map(x=>[x.id,x.error]))}\nWine Radar는 고유 행 ID 없는 그룹 요약 경로가 없어 초기 후보가 없었고, Glass Radar는 별도 UI 및 native 검사에서 생성했다. Unemployment Area는 초기 Apply 후 추천 준비 대기를 초과했다. 이후 전체 sweep 종료 뒤 별도 기본값 세션에서 49.193초로 재현해 메인 A14의 성능 문제로 확정했다. 구체적 병목 함수는 미확정이다. 원시 live 기록 중 함수명/검색 그룹을 잘못 지정한 후속 카드 부재도 제품 결함으로 세지 않았다.\n\nComposition은 ${coverage.composition.datasets}개 데이터셋 / ${coverage.composition.cardContexts}개 카드 맥락 / ${coverage.composition.parameterProbes}개 probe를 기록했다. 일부 최초 시나리오의 드라이버 중단 후 ${coverage.composition.replayPassed}개 저장된 composition을 별도로 이어서 3패널 구성·공통 제목·Undo/Redo·reload까지 확인했다. 전체 상세와 샘플링 정책은 [조합 보고서](${stem}-compositions.md)에 있다.\n\n`;
md += `## 공개 API 대비 관찰 범위\n\n현재 public method ${native.catalogCoverage.publicMethodCount}개 중 native 카드 감사에서 ${native.catalogCoverage.observedPublicMethods}개를 관찰했다. 데이터 준비, persistence, 제거, facade의 세부 primitive 등은 모두 독립 추천 카드가 아니다. Overlay/adjacent/Layer는 별도의 composition UI 감사에 있으므로 이 native 카드 숫자에 없다는 이유로 미검사라고 판단하면 안 된다. 반대로 모든 공개 API를 검사했다고 말할 수도 없다.\n\n${native.catalogCoverage.note ?? ''}\n\n${table(['관찰하지 않은 direct recommendation','alias / 경로'],native.catalogCoverage.unobservedDirectRecommendationMethods.map(x=>typeof x==='string'?[x,native.catalogCoverage.unobserved.find(r=>r.method===x)?.reason??native.catalogCoverage.unobserved.find(r=>r.method===x)?.via??'']:[x.method,x.via??x.reason??'']))}\n전체 역할별 미관찰 목록·비활성 선택지·control별 값은 [원시 coverage.json](../../output/option-audit-2026-10-25/parameters/coverage.json)에 있다.\n\n`;
md += `## 실행 예산·조건부 값의 한계\n\n카드당 최대 trial 예산으로 ${counts.budgetSkipped}개 생성 후보를 건너뛰었다. ${native.skipped.length ? native.skipped.map(x=>`${x.file} / ${x.method}: ${x.count}`).join('; ') + '.' : ''} 느린 상태에는 별도 wall-clock cap을 두었고 부분 기록을 유지했다. 초기 무효값의 모든 교차조합, 모든 실수값, 모든 가능한 액션 순열을 검사하지 않았다.\n\ncontrol의 observedValues에는 inactive 상태로 보존된 값이 포함될 수 있다. 초기 일부 기록에 activeKeys가 없어 exact active-control coverage를 주장하지 않는다. 조건부 control의 표시를 직접 확인한 브라우저 검사와 이후 activeKeys 기록을 별도로 참고해야 한다.\n\n`;
md += `## 액션별 파라미터 기록\n\n아래 시도 수는 해당 action의 여러 차트 맥락을 합한 값이며, 반복·예상 거부를 포함한다.\n\n${table(['Action','맥락','control ID','시도','예상 밖 예외'],native.methods.map(m=>[m.method,m.contexts.length,m.controls.length,m.attempts,m.unexpected]))}\n`;
md += `## 예외 관찰 부록\n\n아래는 자동 검사에서 분리한 method/message 묶음이다. 모든 행을 독립적인 확정 버그로 세지 않는다. 재현·설명은 메인 및 세부 보고서를 참고한다.\n\n${table(['Action','관찰 메시지','분류','횟수','맥락'],native.unexpected.map(e=>[e.method,e.message,e.findingGroup??'',e.instances,e.contexts.join(', ')]))}\n`;
await fs.writeFile(path.join(docs,`${stem}-coverage.md`),md.trimEnd()+'\n');

const pages = new Map([
 [`${stem}.md`,'report.html'], [`${stem}-coverage.md`,'coverage.html'], [`${stem}-parameters.md`,'parameters.html'],
 [`${stem}-compositions.md`,'compositions.html'], [`${stem}-semantics.md`,'semantics.html'],
 [`${stem}-composition-editors.md`,'composition-editors.html'], [`${stem}-area-readiness.md`,'area-readiness.html'],
]);
const esc = s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function href(url) {
 if (/^(https?:|#)/.test(url)) return url;
 if(pages.has(url))return pages.get(url);
 return path.relative(out,path.resolve(docs,url)).split(path.sep).join('/');
}
function inline(s) {
 const tokens=[];
 s=s.replace(/`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g,(match,code,label,url)=>{
  const html=code!==undefined?`<code>${esc(code)}</code>`:`<a href="${esc(href(url))}">${esc(label)}</a>`;
  return `\u0000${tokens.push(html)-1}\u0000`;
 });
 return esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\u0000(\d+)\u0000/g,(_,n)=>tokens[Number(n)]);
}
// Small renderer for this report's controlled Markdown subset; no arbitrary HTML.
function markdown(source) {
 const lines=source.split('\n'), html=[];let i=0,finding=false;
 const close=()=>{if(finding){html.push('</article>');finding=false;}};
 while(i<lines.length){const line=lines[i];if(!line.trim()){i++;continue;}
  if(line.startsWith('```')){const block=[];i++;while(i<lines.length&&!lines[i].startsWith('```'))block.push(lines[i++]);i++;html.push(`<pre><code>${esc(block.join('\n'))}</code></pre>`);continue;}
  const heading=line.match(/^(#{1,4})\s+(.*)/);
  if(heading){close();const [,marks,title]=heading,issue=title.match(/^([ACS]\d+)\s+·\s+(P\d)/);
   if(issue){html.push(`<article class="finding" data-priority="${issue[2]}" id="${issue[1]}">`);finding=true;}
   html.push(`<h${marks.length}>${inline(title)}</h${marks.length}>`);i++;continue;}
  if(line.startsWith('|')&&lines[i+1]?.match(/^\|[\s:|-]+\|$/)){
   const cells=s=>s.slice(1,-1).split(/(?<!\\)\|/).map(x=>x.trim().replaceAll('\\|','|'));
   html.push('<div class="table-scroll"><table><thead><tr>'+cells(line).map(x=>`<th>${inline(x)}</th>`).join('')+'</tr></thead><tbody>');i+=2;
   while(lines[i]?.startsWith('|')){html.push('<tr>'+cells(lines[i++]).map(x=>`<td>${inline(x)}</td>`).join('')+'</tr>');}
   html.push('</tbody></table></div>');continue;}
  if(/^[-*] |^\d+\. /.test(line)){const ordered=/^\d/.test(line),tag=ordered?'ol':'ul';html.push(`<${tag}>`);
   while(i<lines.length&&(/^[-*] |^\d+\. /.test(lines[i])))html.push(`<li>${inline(lines[i++].replace(/^[-*] |^\d+\. /,''))}</li>`);
   html.push(`</${tag}>`);continue;}
  const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(#{1,4} |\||```|[-*] |\d+\. )/.test(lines[i]))paragraph.push(lines[i++]);
  html.push(`<p>${inline(paragraph.join(' '))}</p>`);
 }
 close();return html.join('\n');
}
const css=`:root{color-scheme:light;font:16px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#243244;background:#f4f6f9}*{box-sizing:border-box}body{margin:0}header{background:#102c4a;color:#fff;padding:42px max(24px,calc((100vw - 1160px)/2));}header p{color:#c4d8eb;margin:5px 0}header h1{font-size:31px;line-height:1.35;margin:0 0 12px}nav{position:sticky;top:0;background:#ffffffed;border-bottom:1px solid #d9e0ea;padding:10px 24px;display:flex;gap:20px;flex-wrap:wrap;z-index:2}nav a{font-size:14px;font-weight:600}main{max-width:1160px;margin:28px auto;padding:0 24px 70px}a{color:#0861a8;text-underline-offset:3px}h1,h2,h3,h4{line-height:1.45;scroll-margin-top:80px}main>h1{font-size:27px}h2{font-size:23px;margin-top:40px;border-bottom:1px solid #d9e0ea;padding-bottom:10px}h3{font-size:20px;margin:0 0 18px}p{margin:12px 0}li{margin:8px 0}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:26px}.stat{background:white;border:1px solid #d9e0ea;border-radius:10px;padding:16px}.stat strong{display:block;font-size:27px;color:#102c4a}.stat span{font-size:13px;color:#617084}.finding{background:#fff;border:1px solid #d9e0ea;border-left:4px solid #c48c2c;border-radius:8px;padding:22px 26px;margin:24px 0}.finding[data-priority=P1]{border-left-color:#c44e43}.finding[hidden]{display:none}.table-scroll{overflow:auto;margin:18px 0}table{border-collapse:collapse;width:100%;font-size:14px;background:#fff}th,td{padding:10px 13px;text-align:left;border:1px solid #dce3eb;vertical-align:top}th{background:#eaf0f6;white-space:nowrap}code{background:#edf1f6;border-radius:4px;padding:2px 5px;font:13px/1.6 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere}pre{overflow:auto;background:#eaf0f6;padding:18px;border-radius:7px}pre code{white-space:pre}input,select{font:inherit;padding:8px 12px;border:1px solid #bcc9d8;border-radius:6px}input{min-width:260px}.filters{display:flex;gap:12px;flex-wrap:wrap;background:white;padding:16px;border:1px solid #d9e0ea;border-radius:8px}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.gallery a{display:block;background:white;border:1px solid #d9e0ea;border-radius:8px;padding:10px;font-size:13px}.gallery img{width:100%;height:190px;object-fit:contain}summary{cursor:pointer;font-weight:600;padding:14px 0}small{color:#617084}@media(max-width:700px){.stats{grid-template-columns:repeat(2,1fr)}.gallery{grid-template-columns:repeat(2,1fr)}header h1{font-size:24px}.finding{padding:17px}nav{gap:10px}main{padding:0 14px 50px}}@media print{nav,.filters{display:none}body{background:white}.finding{break-inside:avoid}.stats{grid-template-columns:repeat(4,1fr)}}`;
const num=n=>Number(n).toLocaleString('en-US');
const gallery=[['semantics/fashion-scatter-default.png','Fashion · 498개 점과 색상 검증'],['semantics/glass-pcp-default.png','Glass · 9차원 PCP'],['semantics/income-area-default.png','Income · 구간 순서와 집계'],['semantics/temp-polar-default.png','Temperature · 음수 포함 Polar'],['live/19-createRaincloudPlot-penguins-chart.png','Penguins · Raincloud'],['compositions/iris-distributions-nested.png','Iris · Box overlay + 중첩 concat']];
for(const [file,destination] of pages){
 const source=await fs.readFile(path.join(docs,file),'utf8'),isMain=destination==='report.html';
 const stats=isMain?`<div class="stats"><div class="stat"><strong>10 / 19</strong><span>추가 / 전체 예제 데이터셋</span></div><div class="stat"><strong>${counts.plotFamiliesRendered}</strong><span>생성한 차트 계열</span></div><div class="stat"><strong>${num(counts.parameterTrialRecords)}</strong><span>Native 파라미터 trial 기록</span></div><div class="stat"><strong>${(source.match(/^### [ACS]\d+ ·/gm)??[]).length}</strong><span>문제 재현 묶음 · 중복 예외 제외</span></div></div><div class="filters"><label>문제 검색 <input id="query" type="search" placeholder="Radar, facet, color, 결측…"></label><label>우선순위 <select id="severity"><option value="">전체</option><option>P1</option><option>P2</option></select></label></div>`:'';
 const pictures=isMain?`<details><summary>검사한 차트와 조합 — 결과 예시</summary><div class="gallery">${gallery.map(([url,label])=>`<a href="${url}"><img src="${url}" loading="lazy" alt="${label}">${label}</a>`).join('')}</div></details>`:'';
 const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VisAutocomplete · Option audit · 2026-10-25</title><style>${css}</style><header><p>VISUALIZATION AUTOCOMPLETE · LOCAL AUDIT</p><h1>새 데이터셋과 옵션 카드 심층 검증</h1><p>2026-10-25 · 데이터 추가 완료 · 발견한 제품 버그는 보고만 · 배포 없음</p></header><nav><a href="report.html">결과·재현 방법</a><a href="coverage.html">검사 범위·미검사 항목</a><a href="parameters.html">파라미터 상세</a><a href="compositions.html">Overlay·facet·concat</a><a href="semantics.html">의미·수치 검증</a><a href="composition-editors.html">후속 편집</a><a href="area-readiness.html">추천 지연</a></nav><main>${stats}${pictures}${markdown(source)}<small>생성된 증거와 보고서 HTML은 Git에서 제외됩니다. Curated Markdown과 감사 스크립트는 저장소에 보관됩니다.</small></main><script>const filter=()=>{const q=document.querySelector('#query')?.value.toLowerCase()||'',p=document.querySelector('#severity')?.value||'';document.querySelectorAll('.finding').forEach(x=>x.hidden=Boolean((p&&x.dataset.priority!==p)||(q&&!x.textContent.toLowerCase().includes(q))));};document.querySelector('#query')?.addEventListener('input',filter);document.querySelector('#severity')?.addEventListener('change',filter);</script></html>`;
 await fs.writeFile(path.join(out,destination),html);
}
console.log(JSON.stringify({report:path.join(out,'report.html'),counts:coverage},null,2));
