import { axisGraphicIds, cartesianAxisOwners, axisTargetArgs } from '../vendor/ggaction/src/selectors/axes.js';
import { legendGraphicIds } from '../vendor/ggaction/src/materialization/guides/resources.js';
import { resolveAxisLabels } from '../vendor/ggaction/src/actions/guides/axes/labels.js';
import { mapPolarGuideValues, polarGuideNames } from '../vendor/ggaction/src/actions/guides/polar/resolve.js';
import { resolveStyledParallelAxes } from '../vendor/ggaction/src/actions/guides/axes/parallel/resolve.js';
import { describeLegendBlock } from '../vendor/ggaction/src/grammar/legendBlocks.js';
import { resolveEffectiveLegendBlockConfig } from '../vendor/ggaction/src/actions/guides/legends/blocks.js';
import { categoricalLegendLabels } from '../vendor/ggaction/src/actions/guides/legends/categorical/layout.js';
import { prepareCompositionSnapshots } from '../vendor/ggaction/src/materialization/composition.js';
import { compositionLegends } from '../vendor/ggaction/src/materialization/compositionLegends.js';
import { namespaceGraphicId } from '../vendor/ggaction/src/materialization/compositionSnapshot.js';
import { facetHeaderTextEntries, facetHeaderGraphicId } from '../vendor/ggaction/src/materialization/facetHeaders.js';
import { resolveTextGraphicEntries } from '../vendor/ggaction/src/materialization/text.js';
import { textIdentityKey } from '../vendor/ggaction/src/grammar/text.js';
import { resolvePrimitiveGraphicBounds, resolveGraphicParentOffset, resolveGraphicClipBounds } from '../vendor/ggaction/src/grammar/schemas/graphicBounds.js';
import { scopedCall } from './composition-context.js';

const categorical = scale => ['ordinal','band','point'].includes(scale?.type);
const call = (method,args) => ({method,args});
const mapped = (map,value,text) => [...(map ?? []).filter(entry => entry.value !== value), {value,label:text}];
const cache = new WeakMap();

// Resolve on demand. No DOM hitbox per tick/item and no work on pointermove.
function textGraphics(program) {
  const result = new Map(), spec=program.graphicSpec, profile=program.materializationConfigs.textMetrics;
  for (const [id,object] of Object.entries(spec.objects)) {
    if (object.type !== 'text' && !object.items?.some(item=>item.type==='text')) continue;
    const [dx,dy]=resolveGraphicParentOffset(spec,id), clip=resolveGraphicClipBounds(spec,id,{rootViewport:true});
    for (const item of object.items ?? [{...object,id}]) {
      if ((item.type??object.type)!=='text' || !item.properties.text || item.properties.opacity===0) continue;
      const local=resolvePrimitiveGraphicBounds('text',item.properties,profile);if(!local)continue;
      const bounds={left:local.left+dx,right:local.right+dx,top:local.top+dy,bottom:local.bottom+dy};
      if(clip && (bounds.right<clip.left || bounds.left>clip.right || bounds.bottom<clip.top || bounds.top>clip.bottom))continue;
      const unrotated=resolvePrimitiveGraphicBounds('text',{...item.properties,rotation:0},profile);
      result.set(item.id,{bounds,properties:item.properties,offset:{x:dx,y:dy},unrotated});
    }
  }
  return result;
}

export function editableTextTargets(program) {
  if(cache.has(program))return cache.get(program);
  const visible=textGraphics(program), result=[];
  function visit(p, mapId=id=>id, wrap=c=>c, legendsOnly=false) {
    const items=id=>{const object=p.graphicSpec.objects[id];return object?.items??(object?[{...object,id}]:[]);};
    const add=(id,text,build,label='Text')=>{
      const graphic=visible.get(mapId(id));
      if(graphic)result.push({id:mapId(id),text,label,...graphic,build:value=>wrap(build(value))});
    };
    function legend(kind,config,legendWrap=wrap,legendMap=mapId) {
      const descriptor=describeLegendBlock(p,kind,config);
      const effective=resolveEffectiveLegendBlockConfig(p,kind,config);
      const roots=legendGraphicIds(kind);
      const addLegend=(id,text,build,label)=>{
        const graphic=visible.get(legendMap(id));if(graphic)result.push({id:legendMap(id),text,label,...graphic,build:value=>legendWrap(build(value))});
      };
      for(const id of roots.filter(id=>id.endsWith('Title')))for(const item of items(id))
        addLegend(item.id,config.title,text=>call('editLegendTitle',{target:config.target,channel:descriptor.channels[0],title:text}),'Legend title');
      if(descriptor.family!=='categorical' && !(descriptor.family==='discrete-size' && categorical(p.resolvedScales[config.scale])))return;
      const values=descriptor.family==='categorical'?effective.domain:p.resolvedScales[config.scale].domain.slice(0,effective.overflow?.maxItems);
      const labels=descriptor.family==='categorical'?categoricalLegendLabels(effective):values.map(value=>effective.labelMap?.find(e=>e.value===value)?.label??String(value));
      const shown=values.filter((_,i)=>labels[i]!=='');
      for(const id of roots.filter(id=>id.endsWith('Labels')))items(id).forEach((item,i)=>{
        if(i>=shown.length)return;const value=shown[i];
        addLegend(item.id,item.properties.text,text=>call('editLegendBlock',{target:config.target,channel:descriptor.channels[0],labelMap:mapped(effective.labelMap,value,text)}),'Legend item');
      });
    }
    if(!legendsOnly)for(const [id,key] of [['chartTitle','text'],['chartSubtitle','subtitle']]){
      if(p.titleConfig)for(const item of items(id))add(item.id,p.semanticSpec.title?.[key]??item.properties.text,text=>call('editTitle',{[key]:text}),key==='text'?'Title':'Subtitle');
    }
    if(p.compositionSpec && !p.compositionSpec.facet){
      const {children}=prepareCompositionSnapshots(p);
      for(const shared of compositionLegends(p,children)){
        // Collected legend graphics come from the representative's native source.
        visit(shared.source,id=>mapId(namespaceGraphicId(shared.id,id)),c=>wrap({...c,args:{...c.args,target:shared.targets.map(target=>{let owner=p;for(const id of target.childPath)owner=owner.children[id];return {...target,id:target.id??c.args.target,...(owner.compositionSpec?.facet?{facetSource:true}:{})};})}}),true);
      }
      if(!legendsOnly)for(const [id,child] of Object.entries(children))visit(child,
        graphic=>mapId(namespaceGraphicId(`${p.compositionSpec.id}-${id}`,graphic)),c=>wrap(scopedCall(c,[{childPath:[id]}])));
      return;
    }
    for(const [kind,config] of Object.entries(p.guideConfigs.legend??{}))legend(kind,config);
    if(legendsOnly)return;
    if(p.compositionSpec?.facet){
      const entries=facetHeaderTextEntries(p);
      items(facetHeaderGraphicId(p.compositionSpec.id)).forEach((item,i)=>{
        const entry=entries[i];if(!entry || !entry.title && entry.value===undefined)return;
        add(item.id,entry.text,text=>call('editFacetHeaders',{role:entry.role,...(entry.title?{title:{text}}:{labelMap:mapped(entry.config.labelMap,entry.value,text)})}),'Facet heading');
      });
      for(const [id,child] of Object.entries(p.children))visit(child,
        graphic=>mapId(namespaceGraphicId(`${p.compositionSpec.id}-${id}`,graphic)),c=>wrap(call('editFacetSource',{action:{method:c.method,options:c.args}})));
      return;
    }
    for(const owner of cartesianAxisOwners(p)){
      const ids=axisGraphicIds(owner.channel,owner.id), args=axisTargetArgs(owner.id,owner.channel);
      if(owner.config.title)for(const item of items(ids[3]))add(item.id,item.properties.text,text=>call(`edit${owner.channel.toUpperCase()}AxisTitle`,{...args,text}),'Axis title');
      const config=owner.config.labels;if(!config || !categorical(p.resolvedScales[config.scale]))continue;
      const resolved=resolveAxisLabels(p,owner.channel,config,owner.id);
      items(ids[2]).forEach((item,i)=>{
        const value=resolved.values[resolved.groups[i]], text=config.labelMap?.find(e=>e.value===value)?.label??String(value);
        add(item.id,text,text=>call(`edit${owner.channel.toUpperCase()}AxisLabels`,{...args,labelMap:mapped(config.labelMap,value,text)}),'Category label');
      });
    }
    for(const [channel,prefix] of [['theta','Theta'],['radius','Radial']]){
      const config=p.guideConfigs.axis?.[channel],ids=polarGuideNames(channel);
      if(config?.title)for(const item of items(ids.title))add(item.id,item.properties.text,text=>call(`edit${prefix}AxisTitle`,{text}),'Axis title');
      if(!config?.labels || !categorical(p.resolvedScales[config.labels.scale]))continue;
      const values=mapPolarGuideValues(p,config.labels).values;
      items(ids.labels).forEach((item,i)=>add(item.id,item.properties.text,text=>call(`edit${prefix}AxisLabels`,{labelMap:mapped(config.labels.labelMap,values[i],text)}),'Category label'));
    }
    const parallel=p.guideConfigs.axis?.parallel?.axes;
    if(parallel){
      const layer=p.semanticSpec.layers.find(l=>l.id===parallel.target), {axes}=resolveStyledParallelAxes(p,layer.encoding.parallel.dimensions);
      const titles=axes.filter(axis=>axis.config.title),labels=axes.filter(axis=>axis.config.labels).flatMap(axis=>axis.labels.values.map(value=>({axis,value})));
      items('parallelAxisTitles').forEach((item,i)=>add(item.id,item.properties.text,text=>call('editParallelAxis',{target:parallel.target,field:titles[i].field,title:{text}}),'Axis title'));
      items('parallelAxisLabels').forEach((item,i)=>{const {axis,value}=labels[i];if(!categorical(p.resolvedScales[axis.scale]))return;
        add(item.id,item.properties.text,text=>call('editParallelAxis',{target:parallel.target,field:axis.field,labels:{labelMap:mapped(axis.config.labels.labelMap,value,text)}}),'Category label');});
    }
    for(const layer of p.semanticSpec.layers.filter(l=>l.mark.type==='text')){
      const graphicItems=items(layer.id);if(!graphicItems.length)continue;
      const config=p.markConfigs[layer.id], annotation=['text','x','y'].every(channel=>Object.hasOwn(layer.encoding[channel]??{},'datum'));
      if(annotation){for(const item of graphicItems)add(item.id,item.properties.text,text=>call('encodeText',{target:layer.id,value:text}),'Annotation');continue;}
      const entries=resolveTextGraphicEntries(p,layer,config,{identities:true});
      entries.forEach((entry,i)=>{
        const match=Object.fromEntries(Object.entries(entry.identity).filter(([,values])=>Object.keys(values).length));
        if(!Object.keys(match).length)return;
        const key=textIdentityKey(match),occurrence=entry.occurrence;
        if(!graphicItems[i])return;
        add(graphicItems[i].id,entry.graphic.properties.text,text=>call('editTextMark',{target:layer.id,textOverrides:[
          ...(config.textOverrides??[]).filter(value=>textIdentityKey(value.match)!==key || value.occurrence!==occurrence),{match,occurrence,text}
        ]}),'Mark label');
      });
    }
  }
  visit(program);cache.set(program,result);return result;
}

export function pickEditableText(program,x,y) {
  return editableTextTargets(program).filter(({bounds:b,properties:p,offset,unrotated:u})=>{
    if(x<b.left-2 || x>b.right+2 || y<b.top-2 || y>b.bottom+2)return false;
    const angle=-(p.rotation??0),dx=x-offset.x-p.x,dy=y-offset.y-p.y;
    const localX=p.x+dx*Math.cos(angle)-dy*Math.sin(angle),localY=p.y+dx*Math.sin(angle)+dy*Math.cos(angle);
    return localX>=u.left-2 && localX<=u.right+2 && localY>=u.top-2 && localY<=u.bottom+2;
  })
    .sort((a,b)=>(a.bounds.right-a.bounds.left)*(a.bounds.bottom-a.bounds.top)-(b.bounds.right-b.bounds.left)*(b.bounds.bottom-b.bounds.top))[0];
}
