import { createProject } from '../../web/project.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const rows=Array.from({length:60},(_,i)=>({MPG:i%20+10,Power:i*3+50,Origin:['USA','Japan','Europe'][i%3]}));
const setupCalls=[{method:'createCanvas',args:{plot:{width:113,height:280},margin:{left:90,right:140,top:12,bottom:190}}},
  {method:'createData',args:{id:'dataset',values:'__LOADED_DATA__'}}];
const calls=[{method:'createScatterPlot',args:{id:'plot',data:'dataset',x:'MPG',y:'Power',color:'Origin'}},
  {method:'encodeShape',args:{target:'plot',field:'Origin',fieldType:'nominal'}},
  {method:'encodeSize',args:{target:'plot',field:'MPG'}},
  {method:'facet',args:{field:'Origin',data:'dataset',columns:3,spacing:'plot',gap:28,guides:{axes:'outer',legend:'shared'}}}];
const snapshot={setupCalls,calls,guideCall:{method:'createGuides',args:{legend:{target:'plot',channels:['color','shape','size'],count:3}}},
  steps:4,phase:'recommendations',selection:{x:'MPG',y:'Power',color:'Origin'},currentNote:'Facet',context:{},plotData:'dataset',optionGroup:'encoding'};
const record={id:'centering',name:'Facet centering regression',imported:{rows,rawRows:rows,fieldTypes:{},metadata:{conversions:[]}},session:{entries:[snapshot],index:0}};
mkdirSync('output/centered-resize',{recursive:true});
writeFileSync('output/centered-resize/legacy.visauto',JSON.stringify(createProject([record],record.id)));
