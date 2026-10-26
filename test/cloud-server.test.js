import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionServer } from '../scripts/server.js';
import { chart } from 'ggaction';
test('Embedding uses a fixed presentation allowlist without trusting the requesting site', async () => {
 const server = await createProductionServer({ env: {} });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const origin = `http://127.0.0.1:${server.address().port}`;
 try {
  for (const path of ['/', '/privacy.html', '/?frameOrigin=https://outside.example']) {
   const response = await fetch(origin + path, { headers: { Origin: 'https://outside.example', Referer: 'https://outside.example/' } });
   assert.equal(response.status, 200);
   const directives = response.headers.get('content-security-policy').split(';').map(value => value.trim());
   assert.deepEqual(directives.filter(value => value.startsWith('frame-ancestors ')), [
    'frame-ancestors https://hyeonword.com http://127.0.0.1:5173 http://127.0.0.1:5174',
   ]);
   assert.equal(response.headers.get('x-frame-options'), null, 'A legacy DENY/SAMEORIGIN header must not contradict the allowlist');
   assert.equal(response.headers.get('access-control-allow-origin'), null, 'Embedding does not grant cross-origin API access');
   for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'self'"]) assert.ok(directives.includes(directive));
  }
 } finally { await new Promise(resolve => server.close(resolve)); }
});
test('link crawlers receive public sharing metadata and the full PNG without signing in or running JavaScript', async () => {
 const server = await createProductionServer({ env: {}, verifyToken: async () => false });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const origin = `http://127.0.0.1:${server.address().port}`;
 try {
  const headers = { 'User-Agent': 'facebookexternalhit/1.1; kakaotalk-scrap/1.0' };
  const response = await fetch(origin, { headers });
  assert.equal(response.status, 200);
  const html = await response.text(), head = html.split('</head>')[0];
  const entries = [...head.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)].map(match => [match[1], match[2]]);
  const tags = Object.fromEntries(entries);
  for (const key of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image']) {
   assert.equal(entries.filter(([name]) => name === key).length, 1, `${key} must be present exactly once in the initial head`);
   assert.ok(tags[key]);
  }
  assert.equal(tags['og:type'], 'website');
  assert.equal(tags['og:url'], 'https://vis.autocomplete.studio/');
  assert.equal(tags['twitter:card'], 'summary_large_image');
  assert.equal(tags['twitter:image'], tags['og:image']);
  assert.equal(tags.description, tags['og:description']);
  const imageUrl = new URL(tags['og:image']);
  assert.equal(imageUrl.origin, new URL(tags['og:url']).origin);
  const image = await fetch(origin + imageUrl.pathname, { headers });
  assert.equal(image.status, 200);
  assert.ok(image.headers.get('content-type').startsWith('image/png'));
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.equal(bytes.subarray(1, 8).toString(), 'PNG\r\n\x1a\n');
  assert.equal(bytes.readUInt32BE(16), Number(tags['og:image:width']));
  assert.equal(bytes.readUInt32BE(20), Number(tags['og:image:height']));
  assert.ok(bytes.length < 1024 * 1024, 'Keep the share image lightweight');
 } finally { await new Promise(resolve => server.close(resolve)); }
});
test('Production serves built assets only, sets CSP, rejects abuse, and exports without retaining data',async()=>{
 const server=await createProductionServer({env:{NODE_ENV:'production',PRIVATE_SECRET:'never'},verifyToken:async token=>token==='verified-test-token'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{
  let result=await fetch(url);assert.equal(result.status,200);assert.match(result.headers.get('content-security-policy'),/script-src 'self' 'sha256-/);
  assert.ok(result.headers.get('strict-transport-security'));assert.match(await result.text(),/assets\/entry.js/);
  result=await fetch(url+'/api/config');assert.ok(!(await result.text()).includes('never'));
  assert.equal(result.headers.get('cache-control'),'no-store');
  result=await fetch(url+'/assets/entry.js',{headers:{'Accept-Encoding':'gzip'}});
  assert.equal(result.headers.get('content-encoding'),'gzip');
  const etag=result.headers.get('etag');assert.ok(etag);
  assert.equal((await fetch(url+'/assets/entry.js',{headers:{'If-None-Match':etag}})).status,304);
  assert.equal((await fetch(url+'/data/model-manifest.json')).headers.get('cache-control'),'no-store');
  for(const worker of ['import','calculation','workbook'])assert.equal((await fetch(url+`/output/workers/${worker}.js`)).status,200);
  result=await fetch(url+'/output/workers/source.json');assert.match((await result.json()).runtimeHash,/^[a-f0-9]{64}$/);
  for (const [path, type] of [['favicon.svg', 'image/svg+xml'], ['favicon.png', 'image/png'], ['apple-touch-icon.png', 'image/png']]) {
    result=await fetch(url+'/web/icons/'+path); assert.equal(result.status,200); assert.ok(result.headers.get('content-type').startsWith(type));
    assert.ok((await result.arrayBuffer()).byteLength>100);
  }
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
