// Role-aware native recipes. Extra inputs remain explicit card parameters;
// retrieval still sees only the fields selected in the data table.
import { binnedFieldSetup } from './plot-aggregation.js';
import { getPlotDefinitions, defaultValues } from './plot-catalog.js';
const cat = f => ['nominal', 'ordinal'].includes(f?.type);
const choose = (key, label, fields, value = fields[0]?.name) => ({key,label,type:'select',value,choices:fields.map(f=>({value:f.name,label:f.name}))});
export function rolePlotDefinitions(profile, selection, rows, { availableProfile = profile } = {}) {
  const all=availableProfile.fields.filter(f=>f.usable), fields=new Map(all.map(f=>[f.name,f]));
  const x=fields.get(selection.x), y=fields.get(selection.y), color=fields.get(selection.color);
  const q=all.filter(f=>f.type==='quantitative'), definitions=getPlotDefinitions({...availableProfile,id:profile.id});
  const unused = name => { while(all.some(f=>f.name===name))name+=' (derived)'; return name; };
  const countField=unused('__count');
  const out=[]; const add=(method,controls,build,setup=()=>[])=>{const original=definitions.find(d=>d.method===method);out.push({...original,requirement:null,controls,build:v=>({id:'plot',data:profile.id,...build(v)}),setup,selection:{...selection}}); if(profile.rowCount>50000&&['createRugPlot','createParallelCoordinates','createPolarScatterPlot','createRadarPlot'].includes(method))out.at(-1).requirement=`This chart needs ${profile.rowCount.toLocaleString('en-US')} observation marks (limit 50,000). Choose an aggregated distribution or count chart.`;};
  const pos=f=>({field:f.name,fieldType:f.type,...(f.order?.length?{scale:{domain:f.order}}:{})});
  if (!y) {
    if(x?.type==='quantitative') for(const method of ['createHistogram','createDensityPlot','createECDFPlot','createRugPlot']) {
      const d=definitions.find(d=>d.method===method),defaults={...defaultValues(d),field:x.name,color:color?.name??'',group:color?.name??''};
      if(color&&!cat(color))continue;
      const controls=d.controls.filter(c=>!['field','color'].includes(c.key) && !(c.key==='group' && (color || method!=='createECDFPlot')));
      for (const control of controls) if (control.key==='weight') control.choices=control.choices.filter(choice=>!choice.value||choice.value!==x.name&&choice.value!==color?.name&&rows.every(r=>Number.isFinite(r[choice.value])&&r[choice.value]>=0)&&rows.some(r=>r[choice.value]>0));
      if(method==='createDensityPlot')controls.push(
        {key:'kernel',label:'Kernel',type:'select',value:'gaussian',choices:['gaussian','epanechnikov','uniform','triangular'].map(value=>({value,label:value}))},
        {key:'normalization',label:'Density',type:'select',value:'unit',choices:[{value:'unit',label:'Normalized density'},{value:'count',label:'Count weighted density'}]});
      add(method,controls,v=>({ ...d.build({...defaults,...v}), ...(method === 'createDensityPlot' ? { steps: Math.max(2, Math.min(100, Math.floor(10000 / (color?.distinct || 1)))), ...(color ? { color: pos(color) } : {}) } : {}), ...(method === 'createECDFPlot' ? { guides: { axes: { x: { title: { text: x.name } }, y: { title: { text: 'Cumulative probability' } } } } } : {}) }));
    }
    if(cat(x)) {
      const setup=()=>[{method:'createSummaryData',args:{id:`${profile.id}-counts`,source:profile.id,groupBy:[...new Set([x.name,color?.name].filter(Boolean))],aggregates:[{op:'count',as:countField}]}}];
      if(!color||cat(color))add('createBarPlot',[],()=>({data:`${profile.id}-counts`,x:pos(x),y:{field:countField},...(color?{color:pos(color)}:{}),guides:{axes:{y:{title:{text:'Count'}}}}}),setup);
    }
  }
  if(!y && x?.type==='temporal' && (!color||cat(color))) {
    const as=unused(`${x.name} (calendar)`), calendar=`${profile.id}-calendar`, counts=`${profile.id}-event-counts`;
    const controls=[{key:'timeUnit',label:'Calendar interval (UTC)',type:'select',value:'day',choices:['year','quarter','month','week','day','hour'].map(value=>({value,label:value}))}];
    const setup=v=>[{method:'createTimeUnitData',args:{id:calendar,source:profile.id,field:x.name,as,unit:v.timeUnit,timeZone:'UTC',...(v.timeUnit==='week'?{weekStartsOn:1}:{})}},
      {method:'createSummaryData',args:{id:counts,source:calendar,groupBy:[as,...(color?[color.name]:[])],aggregates:[{op:'count',as:countField}]}}];
    for(const method of ['createBarPlot','createLinePlot','createAreaPlot']) add(method,controls,v=>({data:counts,x:{field:as,fieldType:'temporal',temporalUnit:'timestamp'},y:{field:countField},...(color?{color:pos(color)}:{}),guides:{axes:{x:{title:{text:x.name}},y:{title:{text:'Count'}}}}}),setup);
  }
  const category=cat(x)?x:cat(y)?y:null, value=cat(x)?y:cat(y)?x:null;
  if(category&&(!value||value.type==='quantitative')&&(!color||color.name===category.name)) {
    for(const method of ['createPiePlot','createRosePlot','createRadialBarPlot']) { add(method,[],()=>({category:category.name,...(value?{value:value.name,aggregate:'sum'}:{aggregate:'count'})})); if(value && rows.some(row=>row[value.name]<0))out.at(-1).requirement='Radial magnitude and shares require non-negative values. Use a bar or dot chart for signed measures.'; }
    const others=q.filter(f=>f.name!==value?.name);
    if(value&&others.length)add('createDumbbellPlot',[choose('end','End value',others),{key:'aggregate',label:'Aggregation',type:'select',value:'mean',choices:['mean','median','sum','min','max'].map(value=>({value,label:value}))}],v=>({data:`${profile.id}-end-values`,category:category.name,start:value.name,end:v.end,summary:v.aggregate,orientation:cat(x)?'vertical':'horizontal'}),v=>[{method:'filterData',args:{id:`${profile.id}-end-values`,source:profile.id,field:v.end,noneOf:[null],nulls:'exclude'}}]);
  }
  if(x?.type==='quantitative'&&y?.type==='quantitative') {
    add('createPolarScatterPlot',[],()=>({theta:x.name,radius:y.name,...(color?{color:pos(color)}:{})}));
    if(color&&!cat(color)) {
      let as = `${color.name} (polar color bin)`; while(all.some(f=>f.name===as))as+=' (bin)';
      const plan=binnedFieldSetup({source:profile.id,rows,field:color.name,as,role:'polar-color',type:color.type,reserved:all.map(f=>f.name)});
      add('createPolarLinePlot',[{key:'colorBins',label:'Color bins (maximum)',type:'number',value:3,min:2,max:6,step:1}],v=>({data:plan(v.colorBins).data,theta:x.name,radius:y.name,groupBy:[as],color:{field:as,fieldType:'ordinal',scale:{domain:plan(v.colorBins).domain,palette:'blues'}}}),v=>plan(v.colorBins).calls);
      out.at(-1).colorBinField=as;
    } else add('createPolarLinePlot',[],()=>({theta:x.name,radius:y.name,...(color?{color:pos(color),groupBy:[color.name]}:{})}));
    const selected=[x.name,y.name];const dimensions={key:'dimensions',label:'Dimensions',type:'multiselect',choices:q.map(f=>({value:f.name,label:f.name})),value:selected,minimum:2};
    add('createParallelCoordinates',[dimensions],v=>({dimensions:v.dimensions,...(color?{color:pos(color)}:{}),line:{opacity:.5}}));
    const ids=all.filter(f=>f.distinct===profile.rowCount&&cat(f));
    if(q.length>=3&&ids.length&&(!color||cat(color)))add('createRadarPlot',[{...dimensions,minimum:3,value:[...new Set([...selected,...q.map(f=>f.name)])].slice(0,3)},choose('identity','Series identity',ids)],v=>({wide:{fields:v.dimensions},groupBy:v.identity,...(color?{color:pos(color)}:{}),line:{opacity:.5},
      guides:{axes:{theta:{title:{text:'Dimension'},ticksAndLabels:{values:v.dimensions,labels:{format:'auto',fontFamily:'Arial',fontSize:11}}},radius:{title:{text:'Value'}}}}}));
  }
  if(x&&y&&y.type==='quantitative'&&!color) {
    const lower=q.filter(f=>/lower|low|ci0|lo(?:wer)?bound/i.test(f.name)&&f.name!==y.name),upper=q.filter(f=>/upper|high|ci1|up(?:per)?bound/i.test(f.name)&&f.name!==y.name);
    if(lower.length&&upper.length)add('createIntervalPlot',[{...choose('lower','Lower bound',q.filter(f=>f.name!==y.name),lower[0].name),distinctFrom:'upper'},{...choose('upper','Upper bound',q.filter(f=>f.name!==y.name),upper[0].name),distinctFrom:'lower'}],v=>({data:`${profile.id}-bounds-upper`,x:pos(x),y:{center:y.name,lower:v.lower,upper:v.upper}}),v=>[
      {method:'filterData',args:{id:`${profile.id}-bounds-lower`,source:profile.id,field:v.lower,noneOf:[null],nulls:'exclude'}},
      {method:'filterData',args:{id:`${profile.id}-bounds-upper`,source:`${profile.id}-bounds-lower`,field:v.upper,noneOf:[null],nulls:'exclude'}}]);
  }
  if(cat(x)&&cat(y)&&!color)add('createHeatmap',[],()=>({data:`${profile.id}-cell-counts`,x:pos(x),y:pos(y),color:{field:countField,fieldType:'quantitative',scale:{palette:'blues'}},guides:{legend:{title:'Count'}}}),()=>[{method:'createSummaryData',args:{id:`${profile.id}-cell-counts`,source:profile.id,groupBy:[x.name,y.name],aggregates:[{op:'count',as:countField}]}}]);
  return out;
}
