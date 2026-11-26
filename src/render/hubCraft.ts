// 原創のゲーム用3D工芸モデル。単なる板絵でなく、屋根・柱・瓦・石積・金具・建具・布を立体化。
// 近景を細かくしつつマテリアルごとに結合。テクスチャは決定的な256pxの材質合成で、外部ファイル不要。
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Euler, Float32BufferAttribute, Group, IcosahedronGeometry, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshStandardMaterial, Quaternion, RepeatWrapping, SRGBColorSpace, SphereGeometry, TorusGeometry, Vector2, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FURNITURE, type FurniturePlacement } from '../data/hubEstate';
import type { HubDef, MapDef } from '../data/schemas';
import { groundAt } from '../game/world';
type V=readonly [number,number,number];
type Surface='wood'|'stone'|'roof'|'metal'|'cloth'|'plain'|'light';
const SURFACES:Surface[]=['wood','stone','roof','metal','cloth','plain','light'];
const c={wood:0x886748,trim:0x513d2c,stone:0x9d9c8d,roof:0x777c70,bronze:0xb59a59,cloth:0xc6b18e,red:0x8d4736,green:0x657d4e,light:0xe1ad61,wall:0xd5c7a7,dark:0x332a23,iron:0x515756};
const hash=(x:number,y:number)=>{let n=Math.imul(x+137,1597334677)^Math.imul(y+349,3812015801);n=Math.imul(n^(n>>>15),2246822519);return ((n^(n>>>13))>>>0)/4294967295;};
const pixels=new Map<Surface,{albedo:Uint8Array;normal:Uint8Array}>();
function materialPixels(kind:Surface){
 const prev=pixels.get(kind);if(prev)return prev;
 const n=256,height=new Float32Array(n*n),albedo=new Uint8Array(n*n*4),normal=new Uint8Array(n*n*4);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const u=x/n*Math.PI*2,v=y/n*Math.PI*2;let a=0;
  if(kind==='wood')a=.11*Math.sin(u*3+Math.sin(v*2)*.9)+.08*Math.sin(u*33+Math.sin(v)*1.8)+.045*Math.sin(u*73+v*2);
  else if(kind==='stone')a=.075*Math.sin(u*9+v*3)+.05*Math.sin(u*17-v*11)+.04*Math.cos(u*31+v*12);
  else if(kind==='roof')a=.08*Math.sin(u*8)+.075*Math.cos(v*7)+.035*Math.sin(u*46+v*2);
  else if(kind==='cloth')a=.065*Math.cos(u*64)*Math.cos(v*64)+.035*Math.sin(u*8+v*8);
  else if(kind==='metal')a=.04*Math.sin(u*11+v*13)+.07*Math.cos(u*3-v*6);
  const i=y*n+x;const g=Math.round(255*Math.max(.45,Math.min(1,.80+a+.085*(hash(x,y)-.5))));
  height[i]=a;albedo.set([g,g,g,255],i*4);
 }
 const get=(x:number,y:number)=>height[((y+n)%n)*n+(x+n)%n]!;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const strength=kind==='cloth'?1.3:kind==='metal'?.85:2.0,dx=(get(x+1,y)-get(x-1,y))*strength,dy=(get(x,y+1)-get(x,y-1))*strength,m=1/Math.hypot(dx,dy,1);
  normal.set([Math.round(127.5*(-dx*m+1)),Math.round(127.5*(-dy*m+1)),Math.round(127.5*(m+1)),255],(y*n+x)*4);
 }
 const result={albedo,normal};pixels.set(kind,result);return result;
}
function mapFor(kind:Surface,isNormal=false):DataTexture{
 const p=materialPixels(kind),t=new DataTexture(isNormal?p.normal:p.albedo,256,256);
 if(!isNormal)t.colorSpace=SRGBColorSpace;
 t.wrapS=t.wrapT=RepeatWrapping;t.magFilter=LinearFilter;t.minFilter=LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}
export function craftMaterials():Record<Surface,MeshStandardMaterial>{
 return Object.fromEntries(SURFACES.map(k=>[k,new MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:k==='metal'?.53:.88,metalness:k==='metal'?.37:0,...(['plain','light'].includes(k)?{}:{map:mapFor(k),normalMap:mapFor(k,true),normalScale:new Vector2(.65,.65)}),...(k==='light'?{emissive:0xd98b3c,emissiveIntensity:.42}:{})})])) as Record<Surface,MeshStandardMaterial>;
}
export class CraftKit{
 private bags=new Map<Surface,BufferGeometry[]>();
 constructor(private materials:ReturnType<typeof craftMaterials>,private origin:V=[0,0,0],private angle=0){}
 private add(surface:Surface,geometry:BufferGeometry,color:number,p:V,rotation:V=[0,0,0]){
  const g=geometry.index?geometry.toNonIndexed():geometry;if(g!==geometry)geometry.dispose();
  g.rotateX(rotation[0]);g.rotateY(rotation[1]);g.rotateZ(rotation[2]);g.translate(...p);g.rotateY(this.angle);g.translate(...this.origin);
  const attr=g.getAttribute('position'),a=new Float32Array(attr.count*3),cc=new Color(color),uv=new Float32Array(attr.count*2),norm=g.getAttribute('normal');
  for(let i=0;i<attr.count;i++){
   a.set([cc.r,cc.g,cc.b],i*3);
   const x=attr.getX(i),y=attr.getY(i),z=attr.getZ(i),nx=Math.abs(norm.getX(i)),ny=Math.abs(norm.getY(i)),nz=Math.abs(norm.getZ(i));
   uv[i*2]=(nx>ny&&nx>nz?z:x)/1.25;uv[i*2+1]=(ny>nx&&ny>nz?z:y)/1.25;
  }
  g.setAttribute('color',new Float32BufferAttribute(a,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));
  for(const name of Object.keys(g.attributes))if(!['position','normal','uv','color'].includes(name))g.deleteAttribute(name);
  const arr=this.bags.get(surface)??[];arr.push(g);this.bags.set(surface,arr);
 }
 box(surface:Surface,p:V,s:V,color:number,rotation:V=[0,0,0],bevel=0){
  this.add(surface,bevel>0?new RoundedBoxGeometry(s[0],s[1],s[2],1,Math.min(bevel,...s.map(a=>a*.22))):new BoxGeometry(...s),color,p,rotation);
 }
 sphere(surface:Surface,p:V,s:V,color:number,detail=1,rotation:V=[0,0,0]){
  const g=detail>=2?new SphereGeometry(1,16,10):new IcosahedronGeometry(1,detail);g.scale(...s);this.add(surface,g,color,p,rotation);
 }
 cyl(surface:Surface,p:V,rt:number,rb:number,h:number,color:number,rotation:V=[0,0,0],segments=10){
  this.add(surface,new CylinderGeometry(rt,rb,h,segments),color,p,rotation);
 }
 torus(surface:Surface,p:V,r:number,t:number,color:number,rotation:V=[0,0,0]){
  this.add(surface,new TorusGeometry(r,t,6,14),color,p,rotation);
 }
 beam(surface:Surface,a:V,b:V,width:number,color:number,round=false){
  const u=new Vector3(...a),v=new Vector3(...b).sub(u),l=v.length();
  if(l<.001)return;
  const g=round?new CylinderGeometry(width*.5,width*.5,l,8):new BoxGeometry(width,l,width);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),v.normalize()));
  this.add(surface,g,color,[(a[0]+b[0])*.5,(a[1]+b[1])*.5,(a[2]+b[2])*.5]);
 }
 tri(surface:Surface,a:V,b:V,d:V,color:number){
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute([...a,...b,...d,...a,...d,...b],3));g.computeVertexNormals();this.add(surface,g,color,[0,0,0]);
 }
 append(other:CraftKit){for(const [surface,parts] of other.bags){const dest=this.bags.get(surface)??[];dest.push(...parts);this.bags.set(surface,dest);}other.bags.clear();}
 build(name:string):Group{
  const g=new Group();g.name=name;let tris=0;
  for(const [surface,parts] of this.bags){if(!parts.length)continue;const geo=mergeGeometries(parts);for(const p of parts)p.dispose();if(!geo)throw Error('工芸モデルの属性不一致');
   const m=new Mesh(geo,this.materials[surface]);m.name=name+':'+surface;m.castShadow=false;m.receiveShadow=true;m.userData.noMerge=true;g.add(m);tris+=geo.getAttribute('position').count/3;
  }this.bags.clear();g.userData.triangles=tris;return g;
 }
}
export function lantern(k:CraftKit,x:number,y:number,z:number,s=1){
 k.box('metal',[x,y+.08*s,z],[.32*s,.16*s,.32*s],c.bronze,[0,0,0],.025*s);
 k.box('light',[x,y+.32*s,z],[.235*s,.34*s,.235*s],c.light,[0,0,0],.02*s);
 for(const a of [-1,1])for(const b of [-1,1])k.box('metal',[x+a*.13*s,y+.32*s,z+b*.13*s],[.032*s,.39*s,.032*s],c.bronze);
 k.cyl('metal',[x,y+.55*s,z],.075*s,.24*s,.15*s,c.bronze,[0,0,0],4);
 k.torus('metal',[x,y+.70*s,z],.057*s,.013*s,c.bronze);
}
function timbers(k:CraftKit,w:number,d:number,h:number,y0=0){
 for(const x of [-w/2,w/2])for(const z of [-d/2,d/2]){
  k.box('stone',[x,y0+.13,z],[.37,.26,.37],c.stone,[0,0,0],.04);
  k.box('wood',[x,y0+h/2,z],[.22,h,.22],c.trim,[0,0,0],.012);
 }
 for(const z of [-d/2,d/2]){
  k.box('wood',[0,y0+h,z],[w+.18,.22,.24],c.trim);
  for(let i=1;i<Math.floor(w/1.3);i++){const x=-w/2+w*i/Math.floor(w/1.3);k.box('wood',[x,y0+h*.5,z],[.11,h,.09],c.trim);}
 }
 for(const x of [-w/2,w/2])k.box('wood',[x,y0+h,0],[.24,.22,d],c.trim);
}
function roof(k:CraftKit,w:number,d:number,eave:number,rise:number,center=0,cloth=false){
 const span=d/2+.16,slope=Math.atan2(rise,span),len=Math.hypot(span,rise);
 for(const sign of [-1,1]){
  k.box(cloth?'cloth':'roof',[0,eave+rise*.5,center+sign*span*.5],[w+.38,.09,len+.15],cloth?c.cloth:c.roof,[sign*slope,0,0]);
  // 実際の段差のある瓦／布の縫い目。数百の独立立体をバッチ化。
  const cols=Math.max(2,Math.round(w/.46)),rows=Math.max(2,Math.round(len/.42));
  for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
   const t=(j+.5)/rows,xx=-w/2+(i+.5)*w/cols,zz=center+sign*span*t,yy=eave+rise*(1-t)+.075;
   const shade=cloth?(i%3===1?c.red:c.cloth):[0x73776c,0x858477,0x676f65,0x7a8070][(i*17+j*7)%4]!;
   k.box(cloth?'cloth':'roof',[xx,yy,zz],[w/cols-.014,cloth?.018:.045,len/rows+.028],shade,[sign*slope,0,0]);
  }
  k.box('wood',[0,eave+.015,center+sign*span],[w+.55,.15,.16],c.trim);
  for(let x=-w/2+.15;x<w/2;x+=.64)k.beam('wood',[x,eave,center+sign*span],[x,eave+rise-.03,center],.09,c.trim);
  for(const x of [-w/2,w/2])k.tri('wood',[x,eave,center],[x,eave,center+sign*span],[x,eave+rise,center],c.wood);
 }
 k.cyl('roof',[0,eave+rise+.075,center],.11,.11,w+.48,c.roof,[0,0,Math.PI/2],12);
}
function window(k:CraftKit,x:number,y:number,z:number,w:number,h:number,yaw=0){
 const loc=(a:number,b:number,f:number):V=>[x+Math.cos(yaw)*a+Math.sin(yaw)*f,y+b,z-Math.sin(yaw)*a+Math.cos(yaw)*f];
 k.box('wood',loc(0,0,0),[w+.18,h+.18,.13],c.trim,[0,yaw,0],.016);
 k.box('light',loc(0,0,.076),[w-.08,h-.08,.025],0xc7b48d,[0,yaw,0]);
 for(let i=1;i<4;i++)k.box('wood',loc(w*(i/4-.5),0,.10),[.038,h,.035],c.trim,[0,yaw,0]);
 for(let j=1;j<3;j++)k.box('wood',loc(0,h*(j/3-.5),.10),[w,.038,.035],c.trim,[0,yaw,0]);
 k.box('wood',loc(0,-h/2-.09,.16),[w+.25,.09,.30],c.wood,[0,yaw,0]);
}
function door(k:CraftKit,x:number,y:number,z:number,w:number,h:number){
 k.box('wood',[x,y+h/2,z],[w+.16,h+.14,.14],c.trim,[0,0,0],.025);
 const cols=6;for(let i=0;i<cols;i++)k.box('wood',[x+(i+.5-cols/2)*w/cols,y+h/2,z+.084],[w/cols-.014,h-.08,.044],i%2?c.wood:0x9a7953);
 for(const yy of [y+.28,y+h-.25]){k.box('metal',[x,yy,z+.12],[w,.07,.026],c.iron);for(const xx of [-1,1])k.sphere('metal',[x+xx*w*.36,yy,z+.145],[.033,.033,.022],c.bronze,0);}
 k.torus('metal',[x+w*.28,y+h*.50,z+.18],.084,.016,c.bronze);
}
function plinth(k:CraftKit,w:number,d:number,h=.40){
 k.box('stone',[0,h/2,0],[w,h,d],c.stone);
 for(const side of [-1,1]){
  for(let i=0;i<Math.ceil(w/.55);i++){const n=Math.ceil(w/.55),x=(i+.5-n/2)*w/n;k.box('stone',[x,h*.52,side*d*.5],[w/n-.035,h*.8,.085],i%3?c.stone:0x85877b);}
  for(let i=0;i<Math.ceil(d/.55);i++){const n=Math.ceil(d/.55),z=(i+.5-n/2)*d/n;k.box('stone',[side*w*.5,h*.52,z],[.085,h*.8,d/n-.035],i%3?c.stone:0x85877b);}
 }
}
function chest(k:CraftKit,x:number,y:number,z:number,w=1.3,d=.64,h=.68){
 k.box('wood',[x,y+h*.45,z],[w,h*.86,d],c.wood,[0,0,0],.035);
 k.box('wood',[x,y+h*.91,z],[w+.07,h*.18,d+.06],c.trim,[0,0,0],.035);
 for(let i=0;i<6;i++)k.box('wood',[x+(i-2.5)*w/6,y+h*.44,z+d/2+.012],[w/6-.02,h*.72,.028],i%2?c.wood:0x92734e);
 for(const dx of [-w*.34,w*.34]){
  k.box('metal',[x+dx,y+h*.45,z+d*.5+.04],[.084,h*.82,.04],c.bronze);
  k.box('metal',[x+dx,y+h+.008,z],[.084,.03,d+.08],c.bronze);
  for(const dy of [.14,.44])k.sphere('metal',[x+dx,y+h*dy,z+d*.5+.067],[.023,.023,.020],c.bronze,0);
 }k.box('metal',[x,y+h*.70,z+d/2+.052],[.16,.19,.045],c.bronze,[0,0,0],.012);k.cyl('metal',[x,y+h*.67,z+d/2+.085],.026,.026,.023,c.dark,[Math.PI/2,0,0]);
}
function solidHouse(k:CraftKit,w:number,d:number,h:number,rise:number,style:'workshop'|'inn'|'house'|'hall'|'storehouse'|'mill'){
 const base=.4;plinth(k,w,d,base);k.box('plain',[0,(h+base)/2,0],[w-.08,h-base,d-.08],style==='workshop'||style==='storehouse'?0xa49a82:c.wall);
 timbers(k,w,d,h-base,base);roof(k,w,d,h,rise);
 for(const zz of [-d/2,d/2])for(let i=0;i<Math.floor(w/.42);i++){
  const n=Math.floor(w/.42),xx=(i+.5-n/2)*w/n;k.box('wood',[xx,.71,zz+.025*Math.sign(zz)],[w/n-.018,.60,.045],i%3?c.wood:0x997956);
 }
 door(k,0,base,d/2+.07,style==='hall'?1.9:1.05,style==='hall'?2.28:1.85);
 const high=style==='inn';for(const x of [-w*.31,w*.31]){window(k,x,high?1.55:1.7,d/2+.07,.72,.64);if(high)window(k,x,3.35,d/2+.07,.82,.77);}
 if(high)window(k,0,3.35,d/2+.07,.82,.77);
 for(const sign of [-1,1])window(k,sign*(w/2+.07),high?3.35:1.8,0,.78,.70,sign*Math.PI/2);
 window(k,0,h*.63,-d/2-.07,.76,.64,Math.PI);
 if(style==='workshop'||style==='inn'||style==='house'){
  const x=style==='house'?-w*.30:w*.30,z=-d*.30,top=style==='inn'?7.5:style==='house'?5.3:5.35;
  k.box('stone',[x,(top+2.4)/2,z],[.64,top-2.4,.64],0x8b8a7e);
  for(let y=2.8;y<top-.1;y+=.31)k.box('stone',[x,y,z],[.67,.065,.67],0x676961);
  k.box('stone',[x,top-.1,z],[.84,.16,.84],c.stone,[0,0,0],.025);
  k.box('plain',[x,top-.012,z],[.49,.024,.49],c.dark);
 }
 const lx=style==='hall'?1.65:.87;
 k.beam('wood',[lx,2.27,d/2],[lx,2.27,d/2+.40],.09,c.trim);lantern(k,lx,1.61,d/2+.4,.90);
 if(style==='inn'||style==='hall'){
  const depth=style==='hall'?1.9:1.4,zd=d/2+depth*.5;
  k.box('wood',[0,.31,zd],[w,.14,depth],c.wood);
  for(let i=0;i<Math.floor(w/.34);i++){const n=Math.floor(w/.34);k.box('wood',[(i+.5-n/2)*w/n,.393,zd],[w/n-.017,.035,depth],i%2?c.wood:0xa18459);}
  for(const x of [-w*.45,-w*.16,w*.16,w*.45]){k.box('wood',[x,1.44,d/2+depth-.15],[.15,2.25,.16],c.trim);k.beam('wood',[x,2.1,d/2+depth-.15],[x,2.72,d/2+.22],.09,c.trim);}
  k.box('roof',[0,2.82,d/2+depth*.5],[w+.25,.12,depth+.16],c.roof,[.19,0,0]);
 }
 if(style==='workshop'){
  // 炉の奥の口は正面の壁から奥まった立体に。金属製の槌印を庇に吊るす。
  k.box('stone',[-w*.26,1.05,d/2+.10],[1.55,1.58,.28],c.stone,[0,0,0],.03);
  k.box('plain',[-w*.26,.84,d/2+.257],[1.05,.92,.055],c.dark);
  for(let i=0;i<9;i++){const a=i*Math.PI/8;k.box('stone',[-w*.26+.64*Math.cos(a),1.16+.64*Math.sin(a),d/2+.29],[.26,.22,.22],i%2?c.stone:0x8b8b79,[0,0,a-Math.PI/2],.014);}
  k.box('light',[-w*.26,.48,d/2+.29],[.87,.13,.10],0xe99039);k.box('metal',[-w*.26,.57,d/2+.32],[.94,.045,.07],c.iron);
  k.box('wood',[1.9,2.25,d/2+.26],[.7,.48,.08],c.trim,[0,0,0],.018);
  k.box('metal',[1.9,2.31,d/2+.32],[.46,.12,.05],c.bronze,[0,0,.32]);k.box('metal',[1.92,2.15,d/2+.32],[.085,.34,.05],c.bronze,[0,0,.32]);
 }
}
function shop(k:CraftKit){
 const w=5.6,d=3.4,h=3.2;
 plinth(k,w,d,.18);timbers(k,w,d,h);roof(k,w,d,h,1.06);
 k.box('wood',[0,1.58,-d/2+.12],[w-.16,2.8,.16],c.wood);
 for(const x of [-w/2,w/2])k.box('wood',[x,1.56,-.42],[.14,2.75,2.5],c.wood);
 // 奥の棚・甕・布包み、前のカウンター、庇の布。
 for(const y of [.7,1.42,2.14]){
  k.box('wood',[0,y,-1.26],[w-.35,.11,.72],c.trim);
  for(let i=0;i<8;i++){const x=(i-3.5)*.57;
   if(i%3===0){k.sphere('plain',[x,y+.25,-1.27],[.19,.24,.19],i%2?0x7f8d7e:0x92774f);k.cyl('plain',[x,y+.47,-1.27],.12,.13,.08,0x605747);}
   else{k.box('cloth',[x,y+.18,-1.23],[.39,.27,.43],i%2?c.cloth:c.green,[0,.1,0],.035);k.box('wood',[x,y+.19,-1.0],[.42,.05,.035],c.trim);}
  }
 }
 k.box('wood',[0,.53,1.93],[3.9,.92,.64],c.wood,[0,0,0],.025);
 k.box('wood',[0,1.02,1.94],[4.15,.15,.83],c.trim,[0,0,0],.035);
 for(let i=0;i<10;i++)k.box('wood',[(i-4.5)*.37,.52,2.263],[.34,.77,.038],i%2?c.wood:0xa18156);
 for(const x of [-2.62,2.62])k.box('wood',[x,1.25,3.27],[.15,2.5,.15],c.trim);
 for(let i=0;i<13;i++)k.box('cloth',[(i-6)*.43,2.77,2.48],[.425,.05,2.03],i%3===1?c.red:c.cloth,[.27,0,0]);
 k.box('wood',[0,2.51,3.45],[5.75,.12,.13],c.trim);
 for(let i=0;i<12;i++)k.box('cloth',[(i-5.5)*.45,2.38,3.44],[.44,.25,.035],i%3===1?c.red:c.cloth);
 for(const x of [-2.05,2.05])lantern(k,x,1.74,1.8,.82);
}
function board(k:CraftKit,rank:number){
 const hue=[0x78977b,0x7096ae,0xb9a164,0x9980ad][Math.max(0,Math.min(3,rank-1))]!;
 for(const x of [-1.1,1.1]){
  k.box('stone',[x,.12,0],[.42,.24,.43],c.stone,[0,0,0],.025);
  k.box('wood',[x,1.43,0],[.21,2.86,.23],c.trim,[0,0,0],.02);
  k.beam('wood',[x,.32,-.02],[x*.55,.55,-.68],.11,c.wood);
 }
 k.box('wood',[0,1.54,0],[2.05,1.71,.17],c.wood,[0,0,0],.024);
 for(let i=0;i<7;i++)k.box('wood',[(i-3)*.28,1.54,.098],[.265,1.61,.026],i%2?0x9a7752:c.wood);
 for(let i=0;i<6;i++){
  const x=(i%3-1)*.62,y=1.12+Math.floor(i/3)*.65;
  k.box('cloth',[x,y,.132],[.47,.53,.012],0xe5d7b5,[0,0,((i%3)-1)*.04],.004);
  for(let j=0;j<4;j++)k.box('plain',[x-.02,y+.14-j*.085,.142],[.32-j*.018,.008,.003],0x9a8b6f);
  k.sphere('metal',[x,y+.23,.155],[.018,.018,.012],c.bronze,0);
 }
 roof(k,2.55,.84,2.80,.48);
 k.box('cloth',[0,2.67,.48],[1.20,.24,.055],hue);
 for(const x of [-1.26,1.26])lantern(k,x,1.92,.36,.68);
}
function tentChest(k:CraftKit){
 for(const x of [-1.48,1.48])for(const z of [-1.48,1.48]){
  k.box('wood',[x,1.33,z],[.17,2.65,.17],c.trim,[0,0,0],.014);k.box('stone',[x,.09,z],[.32,.18,.32],c.stone);
 }
 for(let i=0;i<4;i++){
  const a=i*Math.PI/2,v=i%2===0;
  const pa=(t:number):V=>[Math.cos(a)*t+Math.sin(a)*1.78,2.74,-Math.sin(a)*t+Math.cos(a)*1.78];
  k.tri('cloth',pa(-1.78),pa(1.78),[0,3.83,0],v?c.cloth:0xb1a081);
  for(let j=0;j<8;j++){const p=pa(-1.56+j*.45);k.box('cloth',[p[0],2.59,p[2]],[v?.43:.05,.27,v?.05:.43],j%2?c.green:c.cloth);}
  k.beam('wood',pa(-1.78),pa(1.78),.10,c.wood);
 }
 chest(k,0,0,.38,1.72,.92,.96);
 for(const x of [-.85,.85])k.box('wood',[x,1.07,-.72],[.14,1.5,.16],c.trim);
 k.box('wood',[0,1.5,-.72],[1.86,.18,.16],c.trim);
 for(let i=0;i<5;i++)k.box('wood',[(i-2)*.34,1.35,-.61],[.11,.29,.18],c.wood);
}
export function buildCraftVillage(hub:HubDef,map:MapDef):Group{
 const materials=craftMaterials(),batch=new CraftKit(materials);
 const add=(x:number,z:number,yaw:number,fn:(k:CraftKit)=>void,offset=0)=>{
  const k=new CraftKit(materials,[x,groundAt(map.platforms,x,z)+offset,z],yaw);fn(k);batch.append(k);
 };
 for(const f of hub.facilities){
  const b=f.building;
  add(b.x,b.z,b.yaw,k=>{
   if(f.kind==='workshop')solidHouse(k,6.2,4.6,2.9,1.6,'workshop');
   else if(f.kind==='shop')shop(k);else if(f.kind==='quest')board(k,Number(f.questRankId?.split('.').at(-1)??1));else tentChest(k);
  });
 }
 // 旧建物の位置・建物の当たり・煙源の高さを維持。箱による本体を専用の梁・瓦・建具へ差し替える。
 for(const f of hub.scenery??[]){
  if(f.kind==='inn')add(f.x,f.z,f.yaw,k=>solidHouse(k,8,5.5,4.3,2.1,'inn'));
  if(f.kind==='house')add(f.x,f.z,f.yaw,k=>solidHouse(k,5.5,4.5,2.9,1.6,'house'));
  if(f.kind==='hall')add(f.x,f.z,f.yaw,k=>solidHouse(k,10,7,3.2,2.6,'hall'));
  if(f.kind==='storehouse')add(f.x,f.z,f.yaw,k=>solidHouse(k,5,4,3.2,1.5,'storehouse'));
 }
 const g=batch.build('hub-crafted-buildings');g.userData.facilities=hub.facilities.length;g.userData.buildings=hub.facilities.length+(hub.scenery??[]).filter(s=>['inn','house','hall','storehouse'].includes(s.kind)).length;return g;
}
export function furnitureModel(p:FurniturePlacement,materials:ReturnType<typeof craftMaterials>):Group{
 const k=new CraftKit(materials),f=FURNITURE[p.kind],wood=p.finish===1?0xa48258:p.finish===2?0x534a3d:c.wood,cloth=p.finish===1?c.green:p.finish===2?c.red:c.cloth;
 function legs(w:number,d:number,h:number){for(const x of [-w/2+.09,w/2-.09])for(const z of [-d/2+.08,d/2-.08])k.box('wood',[x,h/2,z],[.10,h,.10],wood,[0,0,0],.014);}
 switch(p.kind){
 case 'bed':
  legs(f.w,f.d,.40);k.box('wood',[0,.39,0],[f.w,.16,f.d],wood,[0,0,0],.025);
  k.box('cloth',[0,.57,0],[f.w-.12,.23,f.d-.13],0xdfd4bb,[0,0,0],.08);
  k.box('cloth',[0,.72,.37],[f.w-.09,.095,f.d*.58],cloth,[0,0,0],.035);
  for(let x=-.58;x<=.58;x+=.14)k.box('cloth',[x,.775,.42],[.014,.012,1.05],0xbba589);
  k.box('cloth',[0,.78,-.72],[.91,.18,.45],0xeee3ce,[0,0,0],.06);
  k.box('wood',[0,.75,-f.d/2+.065],[f.w,.62,.13],wood,[0,0,0],.035);break;
 case 'desk':case 'table':case 'bench':case 'chair':{
  const ht=p.kind==='bench'?.42:p.kind==='chair'?.43:f.h-.09;legs(f.w,f.d,ht);
  if(p.kind==='table')k.cyl('wood',[0,ht+.055,0],f.w*.5,f.w*.5,.11,wood,[0,0,0],24);
  else k.box('wood',[0,ht+.06,0],[f.w,.12,f.d],wood,[0,0,0],.026);
  if(p.kind==='chair'){for(const x of [-.17,.17])k.box('wood',[x,.62,-.19],[.065,.37,.065],wood);k.box('wood',[0,.76,-.19],[.44,.15,.07],wood,[0,0,0],.017);}
  if(p.kind==='desk'){k.box('wood',[.31,ht-.10,0],[.61,.20,f.d-.08],wood,[0,0,0],.018);k.torus('metal',[.31,ht-.10,f.d*.5-.02],.044,.009,c.bronze);k.box('cloth',[-.29,ht+.13,-.03],[.40,.023,.31],0xe7d8b5);k.cyl('plain',[.45,ht+.18,-.21],.06,.07,.12,0x4d5149);}
  break;
 }
 case 'chest':chest(k,0,0,0,f.w,f.d,f.h-.02);break;
 case 'rack':case 'shelf':{
  for(const x of [-f.w/2+.05,f.w/2-.05])k.box('wood',[x,f.h/2,0],[.10,f.h,f.d],wood,[0,0,0],.014);
  for(const y of p.kind==='shelf'?[.16,.62,1.07,1.52,1.77]:[.14,1.65,1.80])k.box('wood',[0,y,0],[f.w,.095,f.d],wood,[0,0,0],.02);
  k.box('wood',[0,f.h/2,-f.d/2+.04],[f.w-.1,f.h-.12,.07],c.trim);
  if(p.kind==='shelf')for(let i=0;i<12;i++){const x=(i%4-1.5)*.26,y=.22+Math.floor(i/4)*.46;k.box('cloth',[x,y+.12,0],[.22,.24,.30],i%3===0?c.red:i%3===1?c.cloth:c.green,[0,0,0],.014);}
  break;
 }
 case 'rug':k.box('cloth',[0,.012,0],[f.w,.018,f.d],cloth,[0,0,0],.004);for(let i=0;i<8;i++){const x=(i-3.5)*f.w/9;k.box('cloth',[x,.025,0],[.027,.008,f.d-.08],0xb59a63);}break;
 case 'lamp':k.cyl('metal',[0,.07,0],.18,.2,.14,c.bronze);k.cyl('wood',[0,.54,0],.052,.07,.92,wood);lantern(k,0,1.02,0,.49);break;
 case 'screen':for(const x of [-.66,0,.66])k.box('wood',[x,.75,0],[.055,1.5,.13],wood);k.box('cloth',[0,.81,0],[1.32,1.14,.046],cloth);for(const x of [-.66,.66])k.box('wood',[x,.055,0],[.12,.11,.25],wood);break;
 case 'planter':k.cyl('plain',[0,.19,0],.19,.14,.38,0x9b7258,[0,0,0],16);k.cyl('plain',[0,.382,0],.18,.18,.025,0x584839);for(let i=0;i<7;i++){const a=i*2.4;k.beam('wood',[0,.38,0],[Math.cos(a)*.1,.61,Math.sin(a)*.1],.025,0x668047,true);k.sphere('plain',[Math.cos(a)*.11,.65,Math.sin(a)*.11],[.08,.035,.13],i%2?0x749557:0x4c7b40,1,[.35,a,0]);}break;
 }
 const g=k.build('furniture:'+p.id);g.position.set(p.x,0,p.z);g.rotation.y=p.yaw;g.userData.furniture=p.id;return g;
}
