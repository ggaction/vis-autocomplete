// Test-only inspection of actual Canvas paint calls (never loaded by the app).
{
  for(const key of ['width','height']){
    const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,key);
    Object.defineProperty(HTMLCanvasElement.prototype,key,{...descriptor,set(value){this.__drawings=[];descriptor.set.call(this,value);}});
  }
  const p=CanvasRenderingContext2D.prototype;
  const wrap=(name,observe)=>{const original=p[name];p[name]=function(...args){observe.call(this,args);return original.apply(this,args);};};
  const point=(ctx,x,y)=>{const p=new DOMPoint(x,y).matrixTransform(ctx.getTransform());return {x:p.x,y:p.y};};
  const record=(ctx,item)=>(ctx.canvas.__drawings??=[]).push(item);
  wrap('clearRect',function(){this.canvas.__drawings=[];});
  wrap('fillText',function([text,x,y]){record(this,{type:'text',text,font:this.font,...point(this,x,y)});});
  wrap('beginPath',function(){this.__path=[];});
  wrap('moveTo',function([x,y]){(this.__path??=[]).push(point(this,x,y));});
  wrap('lineTo',function([x,y]){(this.__path??=[]).push(point(this,x,y));});
  wrap('stroke',function(){if(this.__path?.length===2)record(this,{type:'line',points:this.__path,stroke:this.strokeStyle});});
  wrap('drawImage',function([source,...a]){
    const items=source.__drawings??[];let sx=0,sy=0,sw=source.width,sh=source.height,dx,dy,dw=sw,dh=sh;
    if(a.length===8)[sx,sy,sw,sh,dx,dy,dw,dh]=a;else if(a.length===4)[dx,dy,dw,dh]=a;else [dx,dy]=a;
    const map=v=>point(this,dx+(v.x-sx)*dw/sw,dy+(v.y-sy)*dh/sh);
    for(const item of items)record(this,item.points?{...item,points:item.points.map(map)}:{...item,...map(item)});
  });
}
