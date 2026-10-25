import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionServer } from '../scripts/server.js';
import { chart } from 'ggaction';
test('Production serves built assets only, sets CSP, rejects abuse, and exports without retaining data',async()=>{
 const server=await createProductionServer({env:{NODE_ENV:'production',PRIVATE_SECRET:'never'},verifyToken:async token=>token==='verified-test-token'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{
  let result=await fetch(url);assert.equal(result.status,200);assert.match(result.headers.get('content-security-policy'),/script-src 'self' 'sha256-/);
  assert.ok(result.headers.get('strict-transport-security'));assert.match(await result.text(),/assets\/entry.js/);
  result=await fetch(url+'/api/config');assert.ok(!(await result.text()).includes('never'));
  for(const path of ['/.env','/.git/config','/package.json','/web/app.js','/vendor/ggaction/AGENTS.md']) assert.ok((await fetch(url+path)).status>=400,path);
  result=await fetch(url+'/api/export/png',{method:'POST',headers:{Origin:'https://outside.example'},body:'{}'});assert.equal(result.status,403);
  for (const authorization of [undefined, 'Bearer invalid']) {
    result=await fetch(url+'/api/export/png',{method:'POST',headers:authorization?{Authorization:authorization}:{},body:'{}'});assert.equal(result.status,401);
  }
  const headers={Authorization:'Bearer verified-test-token'};
  const program=chart().createCanvas({plot:{width:100,height:100}}).createData({id:'d',values:[{x:1,y:2},{x:3,y:4}]}).createScatterPlot({id:'p',data:'d',x:{field:'x'},y:{field:'y'}}).createGuides();
  for(const format of ['png','svg','pdf']){
    result=await fetch(url+`/api/export/${format}`,{method:'POST',headers,body:JSON.stringify({graphicSpec:program.graphicSpec})});
    assert.equal(result.status,200,format);const bytes=new Uint8Array(await result.arrayBuffer());assert.ok(bytes.length>100,format);
  }
  result=await fetch(url+'/api/export/png',{method:'POST',headers,body:JSON.stringify({graphicSpec:{order:['c'],objects:{c:{type:'canvas',properties:{width:1e9,height:1e9}}}}})});assert.equal(result.status,413);
 }finally{await new Promise(r=>server.close(r));}
});
