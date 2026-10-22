import { render } from 'ggaction';
const boundsCache=new WeakMap();
let measurement;
// Measure painted pixels once per immutable candidate. This retains the tight
// Preview framing without SVG DOM/getBBox or a second layout implementation.
export function chartViewport(program) {
  if(boundsCache.has(program))return boundsCache.get(program);
  const spec=program.graphicSpec,root=spec.objects.canvas,geometry=root.properties;
  measurement??=document.createElement('canvas');
  const ratio=Math.min(1,1200/geometry.width,1200/geometry.height);
  const transparent={graphicSpec:{...spec,objects:{...spec.objects,canvas:{...root,properties:{...geometry,background:'transparent'}}}}};
  render(transparent,measurement.getContext('2d'),{pixelRatio:ratio});
  const {width,height}=measurement,data=measurement.getContext('2d').getImageData(0,0,width,height).data;
  let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(data[(y*width+x)*4+3]){
    if(x<left)left=x;if(x>right)right=x;if(y<top)top=y;if(y>bottom)bottom=y;
  }
  const bounds=right<left?{x:0,y:0,width:geometry.width,height:geometry.height}:
    {x:left/ratio-6,y:top/ratio-6,width:(right-left+1)/ratio+12,height:(bottom-top+1)/ratio+12};
  boundsCache.set(program,bounds);return bounds;
}
