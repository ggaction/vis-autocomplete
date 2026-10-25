import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { publicConfig } from './cloud-config.js';
import { createTokenVerifier } from './cloud-auth.js';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
export async function createProductionServer({ env=process.env, directory='output/deploy', verifyToken }={}) {
  const root=resolve(directory,'public'), config=publicConfig(env), build=JSON.parse(await readFile(resolve(directory,'build.json'),'utf8'));
  if(config.release==='development')config.release=build.commit;
  const authOrigin=config.supabaseUrl ? new URL(config.supabaseUrl).origin : '';
  const authorized = verifyToken ?? createTokenVerifier(config);
  let exporting=false;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' ${build.scriptHashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${authOrigin}; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    if(env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains');
    res.setHeader('Cache-Control','no-store');
    const reply=(code,body)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
    try {
      const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      if(pathname==='/api/config') { if(req.method!=='GET')return reply(405,{}); return reply(200,config); }
      if(pathname==='/healthz')return reply(200,{ok:true,release:config.release});
      if(pathname.startsWith('/api/export/')) {
        if(req.method!=='POST')return reply(405,{});
        if(req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)return reply(403,{});
        const token = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization ?? '')?.[1];
        if (!token || !await authorized(token)) return reply(401,{error:'Sign in to export your visualization.'});
        if(exporting)return reply(429,{error:'Another export is running. Try again shortly.'});
        const format=pathname.slice('/api/export/'.length);
        if(!['png','pdf','svg'].includes(format))return reply(400,{});
        exporting=true;
        try {
          let length=0;const chunks=[];
          for await(const chunk of req){length+=chunk.length;if(length>24*1024*1024)return reply(413,{error:'Chart too large.'});chunks.push(chunk);}
          const spec=JSON.parse(Buffer.concat(chunks).toString()).graphicSpec;
          if(!Array.isArray(spec?.order)||spec.order.length>100000||!spec.objects)return reply(400,{error:'Invalid chart.'});
          for(const object of Object.values(spec.objects)) if(object.type==='canvas') {
            const {width,height}=object.properties??{};
            if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||width*height>16e6||width>16000||height>16000)return reply(413,{error:'Export dimensions too large.'});
          }
          const result=await new Promise((resolve,reject)=>{
            const worker=new Worker(new URL('./export-worker.js',import.meta.url),{workerData:{format,spec},resourceLimits:{maxOldGenerationSizeMb:192}});
            const timer=setTimeout(()=>{worker.terminate();reject(new Error('Export timed out.'));},15000);
            worker.once('message',data=>{clearTimeout(timer);resolve(data);worker.terminate();});
            worker.once('error',error=>{clearTimeout(timer);reject(error);});
            worker.once('exit',code=>{clearTimeout(timer);if(code)reject(new Error('Export stopped.'));});
          });
          if(result.error)return reply(400,{error:result.error});
          res.writeHead(200,{'Content-Type':result.contentType,'Content-Disposition':`attachment; filename="visualization.${format}"`});res.end(Buffer.from(result.buffer));
        } finally{exporting=false;}return;
      }
      if(!['GET','HEAD'].includes(req.method))return reply(405,{});
      const path=resolve(root,`.${pathname==='/'?'/index.html':pathname}`);
      if(!path.startsWith(root+sep)||pathname.split('/').some(part=>part.startsWith('.')))return reply(404,{});
      if(!(await stat(path)).isFile())return reply(404,{});
      const body=await readFile(path);res.writeHead(200,{'Content-Type':`${types[extname(path)]??'application/octet-stream'}; charset=utf-8`});res.end(req.method==='HEAD'?undefined:body);
    }catch{if(!res.headersSent)reply(400,{error:'Request could not be completed.'});else res.end();}
  });
  server.requestTimeout=20000;server.headersTimeout=15000;
  return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  (await createProductionServer()).listen(Number(process.env.PORT??5174),'0.0.0.0',()=>console.log('Visualization Autocomplete server ready'));
}
