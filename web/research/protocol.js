import vocabulary from './vocabulary.json' with { type: 'json' };
export const PROTOCOL = 2;
export const CONSENT = 'recommendation-research-v2';
export const EVENTS = Object.freeze(['session','context','state','slate','candidate','exposure','controls','preview','parameter','search','operation','history','navigation','error','quality','statistics','actor']);
export { vocabulary };
const tokens = new Map(vocabulary.map((word,index)=>[word,index]));
// Types are encoded once, rather than repeating long JSON keys on every sample.
// 0 number, 1 public vocabulary, 2 opaque reference, 3 list, 4 object, 5 omitted.
// The vocabulary is immutable; additions require a new codec version.
export const numericKeys = new Set(`rank score index count revision duration elapsed sequence timestamp pageCount searchLength resultCount fraction width height rows columns gap padding offset fontSize strokeWidth radius innerRadius outerRadius padAngle tension opacity maxBins step minValue maxValue reversals sampleCount samplePeriod truncated dropped bytes queueBytes sequenceGaps visibleTime exposureCount latency renderLatency durationMs cancelledCount fieldsCount rowsCount missingFraction distinctFraction histogram correlation quantiles textLength textLines labelLength selectionCount xNorm yNorm scaleX scaleY zoom scaleZoom deltaX deltaY dx dy angle rotation totalScroll totalEvents totalBytes compressedBytes checkpointEvery firstPaint commitLatency candidateCount visibleCount page queryLength queryTokens dimensionsCount objectCount marksCount legendCount facetCount layerCount compositionCount rowCount fieldCount categoryCount missingCount epoch protocol minimum maximum`.split(' '));
for (const key of ['stateRevision','removed','requestId','minimumCount','left','top','right','bottom']) numericKeys.add(key);
export const privateKeys = new Set(['field','fields','dimensions','groupBy','text','subtitle','title','labelMap','textOverrides','query','id','data','source','target','childPath','key','path','label','name','expression','domain','range','equal','oneOf','noneOf','greaterThan','lessThan','threshold','filter','values']);
const forbidden = new Set(['rows','rawRows','sourceText','sourceTable','imported','dataset','datasets','access_token','refresh_token','email','password','authorization','cookie']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createCodec({ text = false, statistics = false, aliasLimit = 24000 } = {}) {
  let aliases = new Map(), emitted = new Set(), lost = 0, aliasBytes=0;
  const ref = (value, texts, allowText=false) => {
    const source = typeof value + ':' + String(value);
    if (!aliases.has(source)) {
      if (source.length>8192 || aliasBytes+source.length*2>2*1024*1024 || aliases.size >= aliasLimit) { lost++; return [5]; }
      aliases.set(source, crypto.randomUUID());aliasBytes+=source.length*2;
    }
    const id = aliases.get(source);
    if (text && allowText && !emitted.has(id) && typeof value === 'string') { texts[id] = value.slice(0, 2048); if(value.length>2048)lost++; emitted.add(id); }
    return [2,id];
  };
  return {
    encode(input) {
      const texts = {}, before = lost; let visited = 0;
      const walk = (value, key='', sensitive=false, depth=0, numericContext=false, textContext=false) => {
        if (++visited>12000 || depth>20) { lost++; return [5]; }
        if (value == null || typeof value === 'boolean') return value ?? null;
        if (typeof value === 'string') return !sensitive && tokens.has(value) ? [1,tokens.get(value)] : ref(value,texts,textContext || /^#[0-9a-f]{3,8}$/i.test(value));
        if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value)<=1e12 && (!sensitive && (numericKeys.has(key) || numericContext) || statistics && key==='statistics') ? [0,value] : ref(value,texts,textContext);
        if (Array.isArray(value)) return [3,value.slice(0,512).map(v=>walk(v,key,sensitive,depth+1,numericContext,textContext)), Math.max(0,value.length-512)];
        if (typeof value !== 'object') return [5];
        const entries=[];
        for (const [k,original] of Object.entries(value).slice(0,512)) {
          let v=original;
          if (typeof v === 'function' || v === undefined) continue;
          if (forbidden.has(k) && !(k==='rows' && typeof v==='number')) { lost++; continue; }
          // A literal createData call must never smuggle rows through the
          // structural code log, even if a row has a column called "text".
          if(value.method==='createData' && k==='args' && v && typeof v==='object' && 'values' in v){
            const {values,...structure}=v;v=structure;lost++;
          }
          const encodedKey=tokens.has(k)?[1,tokens.get(k)]:ref(k,texts,textContext);
          // A field called "linear" is still a field, never a scale enum.
          const nextSensitive=privateKeys.has(k) && !['values','key','path'].includes(k);
          const designContext=numericContext || value.type==='number' || numericKeys.has(value.key) || /^(encode(Size|Opacity|StrokeWidth|BarWidth|Radius|PointRadius)|edit(Canvas|Title|Subtitle|[XY]?Axis|Axes|Grid|[A-Za-z]*Grid|Legend))$/.test(value.method??'');
          const freeText=textContext || ['field','fields','dimensions','groupBy','text','subtitle','title','labelMap','textOverrides','query','fontFamily','palette','curve','interpolate','strokeDash','modelVersion','corpusVersion','release','commit','runtimeHash','generation'].includes(k) ||
            ['value','before','after','choices','values'].includes(k) && (/field|dimension|mapping|groupBy|title|subtitle|text|query/i.test(value.key??'') || value.type==='text' || value.fieldType);
          entries.push([encodedKey,walk(v,k,sensitive || nextSensitive,depth+1,numericContext || designContext && ['args','defaults','values','value','before','after','samples','startValue','endValue'].includes(k),Boolean(freeText))]);
        }
        return [4,entries];
      };
      // Numeric design values are safe only with a known design parameter.
      // Filter thresholds, data domains and category codes remain references.
      const tree=walk(input);
      return {tree,...(Object.keys(texts).length?{texts}:{}),omitted:lost-before};
    },
    reset() { aliases.clear(); emitted.clear(); lost=0; aliasBytes=0; },
  };
}
export function decode(tree, texts={}) {
  if (tree==null || typeof tree==='boolean') return tree;
  const [tag,v]=tree;
  if(tag===0)return v;
  if(tag===1)return vocabulary[v];
  if(tag===2)return texts[v]??`ref:${v}`;
  if(tag===3)return v.map(x=>decode(x,texts));
  if(tag===4)return Object.fromEntries(v.map(([k,x])=>[decode(k,texts),decode(x,texts)]));
  return {omitted:true};
}
export function validTree(tree, depth=0, budget={n:0}) {
  if(++budget.n>20000 || depth>24)return false;
  if(tree===null || typeof tree==='boolean')return true;
  if(!Array.isArray(tree))return false;
  const [tag,v]=tree;
  if(tag===0)return tree.length===2 && Number.isFinite(v) && Math.abs(v)<=1e12;
  if(tag===1)return tree.length===2 && Number.isInteger(v) && v>=0 && v<vocabulary.length;
  if(tag===2)return tree.length===2 && typeof v==='string' && uuid.test(v);
  if(tag===5)return tree.length===1;
  if(tag===3)return tree.length===3 && Number.isInteger(tree[2]) && tree[2]>=0 && Array.isArray(v) && v.length<=512 && v.every(x=>validTree(x,depth+1,budget));
  if(tag===4)return tree.length===2 && Array.isArray(v) && v.length<=512 && v.every(p=>Array.isArray(p)&&p.length===2&&[1,2].includes(p[0]?.[0])&&validTree(p[0],depth+1,budget)&&validTree(p[1],depth+1,budget));
  return false;
}
