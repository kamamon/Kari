// ヤマツノ山羊・アシハネ鶏・コブヤギ荷獣の立体。胴、首、頭、四肢を別の回転支点で動かす。
// 各種は最大3頭分をインスタンス化し、近い動物だけを描く。
import { BufferGeometry, Color, Group, InstancedMesh, Matrix4, Mesh, MeshLambertMaterial, Quaternion, Vector3, Euler } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CraftKit, craftMaterials } from './hubCraft';
import type { AnimalKind, Livestock } from '../data/hubEstate';
import type { MapDef } from '../data/schemas';
import { groundAt } from '../game/world';
type V=readonly [number,number,number];
type Part={geo:BufferGeometry;at:V;phase:number;motion:'body'|'head'|'leg'|'tail'};
const KINDS:AnimalKind[]=['goat','hen','ox'];
export const PENS:Record<AnimalKind,{x:number;z:number;w:number;d:number}>={goat:{x:3.2,z:30.3,w:3.2,d:2.7},hen:{x:-1.1,z:32.6,w:2.3,d:2.3},ox:{x:4.0,z:36.5,w:4.2,d:3.0}};
function packed(kit:CraftKit):BufferGeometry{
 const group=kit.build('animal-piece'),pieces:BufferGeometry[]=[];
 group.traverse(o=>{if(o instanceof Mesh){const g=o.geometry;g.deleteAttribute('uv');pieces.push(g);}});
 const merged=mergeGeometries(pieces)!;for(const g of pieces)g.dispose();return merged;
}
function buildParts(kind:AnimalKind,mats:ReturnType<typeof craftMaterials>):Part[]{
 const out:Part[]=[];const piece=(at:V,motion:Part['motion'],phase:number,fn:(k:CraftKit)=>void)=>{const k=new CraftKit(mats);fn(k);out.push({at,phase,motion,geo:packed(k)});};
 if(kind==='hen'){
  piece([0,.36,0],'body',0,k=>{
   k.sphere('plain',[0,.04,0],[.21,.24,.29],0xaf8b59,2);
   for(const s of [-1,1]){k.sphere('plain',[s*.16,.055,-.015],[.095,.16,.24],0x816c4b,2,[0,0,s*.17]);for(let i=0;i<5;i++)k.sphere('plain',[s*.20,.025-i*.013,-.055-i*.017],[.035,.055,.13],i%2?0x98794f:0x716647,1);}
   for(let i=0;i<4;i++)k.sphere('plain',[(i-1.5)*.055,.15,-.25],[.052,.13,.22],0x75634d,1,[-.55,0,0]);
  });
  piece([0,.59,.20],'head',0,k=>{
   k.sphere('plain',[0,0,0],[.105,.135,.12],0xc7a16b,2);k.sphere('plain',[0,-.12,-.035],[.10,.16,.10],0xaf8b59,2,[.32,0,0]);
   k.cyl('plain',[0,-.005,.15],.0,.072,.14,0xd19c45,[Math.PI/2,0,0],5);
   for(const s of [-1,1]){k.sphere('plain',[s*.095,.02,.065],[.025,.025,.024],0x1d211b,1);k.sphere('plain',[s*.105,.032,.068],[.010,.010,.010],0xe3d7b3,0);}
   for(let i=0;i<3;i++)k.sphere('plain',[0,.13+i*.011,-.065+i*.048],[.03,.051,.038],0xad6240,1);
  });
  for(const s of [-1,1])piece([s*.09,.23,0],'leg',s===1?0:Math.PI,k=>{
   k.beam('plain',[0,0,0],[0,-.175,.008],.035,0xa68a48,true);for(let i=-1;i<=1;i++)k.beam('plain',[0,-.19,.01],[i*.06,-.21,.11],.021,0xa68a48,true);
  });
 }else{
  const ox=kind==='ox',scale=ox?1.26:1,col=ox?0x665544:0xb4aa8f,face=ox?0x806e53:0x948f7c,leg=.48*scale,bodyY=.88*scale;
  piece([0,bodyY,0],'body',0,k=>{
   k.sphere('plain',[0,0,0],[.33*scale,.38*scale,.68*scale],col,2);
   k.sphere('plain',[0,.03,-.43*scale],[.35*scale,.35*scale,.31*scale],col,2);
   k.sphere('plain',[0,.16,.43*scale],[.30*scale,.37*scale,.28*scale],ox?0x77624d:0xbeb29a,2);
   for(let i=0;i<9;i++){
    const a=i*2.39996,zz=(i%5-2)*.22*scale;
    k.sphere('plain',[Math.sin(a)*.30*scale,.13*scale+Math.cos(a)*.18*scale,zz],[.085*scale,.12*scale,.15*scale],i%2?col:face,1);
   }
   if(ox){for(const s of [-1,1]){k.box('plain',[s*.33*scale,.05,-.03],[.16,.35,.46],0x998463,[0,0,0],.03);k.beam('plain',[s*.34,.29,.19],[s*.34,-.12,-.18],.06,0x554332);}}
  });
  piece([0,bodyY+.14*scale,.48*scale],'head',0,k=>{
   k.sphere('plain',[0,.17*scale,.12*scale],[.19*scale,.35*scale,.24*scale],col,2,[-.5,0,0]);
   k.sphere('plain',[0,.37*scale,.30*scale],[.20*scale,.22*scale,.25*scale],face,2,[.2,0,0]);
   k.sphere('plain',[0,.26*scale,.49*scale],[.14*scale,.12*scale,.17*scale],face,2);
   k.sphere('plain',[0,.25*scale,.59*scale],[.10*scale,.068*scale,.055*scale],0x473e34,2);
   for(const s of [-1,1]){
    k.sphere('plain',[s*.20*scale,.38*scale,.27*scale],[.035*scale,.045*scale,.039*scale],0x1d201b,1);
    k.sphere('plain',[s*.21*scale,.39*scale,.28*scale],[.013,.013,.013],0xe8d6a3,0);
    k.sphere('plain',[s*.23*scale,.43*scale,.13*scale],[.15*scale,.056*scale,.082*scale],face,2,[0,0,s*.24]);
    // 固定した短角を3節の滑らかな円柱で曲げる。
    const a:V=[s*.105*scale,.54*scale,.14*scale],b:V=[s*.15*scale,.68*scale,.06*scale],d:V=[s*(ox?.25:.17)*scale,.77*scale,-.045*scale];
    k.beam('plain',a,b,.095*scale,0xb9ae91,true);k.beam('plain',b,d,.060*scale,0x8e8876,true);k.sphere('plain',d,[.024,.035,.024],0x777365,1);
   }
   if(!ox)k.sphere('plain',[0,.15*scale,.44*scale],[.072,.15,.055],0xc2b59a,1,[.24,0,0]);
   k.cyl('plain',[0,.02,.06],.14,.16,.07,0x816446, [0,0,0],16);k.sphere('plain',[0,-.04,.23],[.045,.052,.04],0xb69a52,1);
  });
  for(const s of [-1,1])for(const f of [-1,1]){
   piece([s*.22*scale,leg+.26*scale,f*.43*scale],'leg',(s===f?0:Math.PI),k=>{
    k.sphere('plain',[0,-.10*scale,0],[.14*scale,.22*scale,.15*scale],col,2);
    k.beam('plain',[0,-.24*scale,0],[0,-.54*scale,f*.035],.11*scale,face,true);
    k.box('plain',[0,-.66*scale,.035],[.115*scale,.11*scale,.17*scale],0x49453b,[0,0,0],.018);
   });
  }
  piece([0,bodyY+.14*scale,-.67*scale],'tail',0,k=>{k.beam('plain',[0,0,0],[0,.12*scale,-.17*scale],.075*scale,col,true);k.sphere('plain',[0,.13*scale,-.18*scale],[.06,.07,.09],face,1);});
 }
 return out;
}
class HerdVisual{
 readonly group=new Group();private meshes:InstancedMesh[]=[];private parts:Part[];private count=1;
 constructor(private kind:AnimalKind,private y:number,material:MeshLambertMaterial,mats:ReturnType<typeof craftMaterials>){
  this.group.name='hub-livestock:'+kind;this.parts=buildParts(kind,mats);
  for(const p of this.parts){const m=new InstancedMesh(p.geo,material,3);m.frustumCulled=false;m.count=1;this.group.add(m);this.meshes.push(m);}
 }
 set(stock:Livestock){this.count=Math.max(1,stock[this.kind]?.count??0);for(const m of this.meshes)m.count=this.count;}
 update(time:number,listener:Vector3){
  const pen=PENS[this.kind];this.group.visible=Math.hypot(listener.x-pen.x,listener.z-pen.z)<25&&Math.abs(listener.y-this.y)<10;
  if(!this.group.visible)return;
  const mat=new Matrix4(),q=new Quaternion(),e=new Euler(),pos=new Vector3(),scale=new Vector3(1,1,1);
  for(let i=0;i<this.count;i++){
   const a=time*(this.kind==='hen'?.46:.24)+i*2.094,rx=pen.w*.24,rz=pen.d*.22;
   const x=pen.x+rx*Math.cos(a),z=pen.z+rz*Math.sin(a),yaw=Math.atan2(-rx*Math.sin(a),rz*Math.cos(a));
   const idle=.5+.5*Math.sin(time*.55+i*1.7),phase=time*(this.kind==='hen'?6.6:4.2)+i*1.8;
   for(const [j,p] of this.parts.entries()){
    const yy=p.at[1]+(this.kind==='hen'?.012:.018)*Math.sin(phase*2);
    const rx=p.motion==='head'?(this.kind==='hen'?.6: .35)*Math.max(0,Math.sin(time*.9+i)):p.motion==='leg'?.25*Math.sin(phase+p.phase)*idle:0;
    const rz=p.motion==='tail'?.32*Math.sin(time*2.2+i):0;
    pos.set(x+p.at[0]*Math.cos(yaw)+p.at[2]*Math.sin(yaw),this.y+yy,z-p.at[0]*Math.sin(yaw)+p.at[2]*Math.cos(yaw));
    q.setFromEuler(e.set(rx,yaw,rz,'YXZ'));mat.compose(pos,q,scale);this.meshes[j]!.setMatrixAt(i,mat);
   }
  }
  for(const m of this.meshes)m.instanceMatrix.needsUpdate=true;
 }
}
export class HubLivestock{
 readonly group=new Group();private herds:HerdVisual[]=[];
 constructor(map:MapDef){
  this.group.name='hub-livestock';
  const mats=craftMaterials(),batch=new CraftKit(mats),animMat=new MeshLambertMaterial({vertexColors:true,color:0xffffff});
  for(const kind of KINDS){
   const p=PENS[kind],y=groundAt(map.platforms,p.x,p.z),w=p.w,d=p.d;
   const k=new CraftKit(mats,[p.x,y,p.z]);
   // 低い囲いは居住景観。通路からはみ出さない寸法。
   k.box('stone',[0,.02,0],[w,.04,d],0x8b9271);
   for(const side of [-1,1]){
    for(const x of [-w/2,0,w/2]){k.box('wood',[x,.42,side*d/2],[.12,.84,.12],0x715739);k.box('stone',[x,.07,side*d/2],[.21,.14,.21],0x8d897b);}
    for(const h of [.3,.63]){k.box('wood',[0,h,side*d/2],[w+.13,.11,.10],0x8b6e49);k.box('wood',[side*w/2,h,0],[.10,.11,d],0x8b6e49);}
   }
   k.box('wood',[w*.25,.23,-d*.34],[.7,.36,.42],0x886b46,[0,0,0],.024);
   k.box('plain',[w*.25,.42,-d*.34],[.54,.035,.30],kind==='hen'?0xbe9f63:0x74854d);
   if(kind==='hen'){k.box('wood',[-.64,.36,-.66],[.56,.58,.51],0x806648,[0,0,0],.025);k.box('plain',[-.64,.35,-.39],[.36,.32,.02],0x4d3d2d);k.box('roof',[-.64,.70,-.66],[.66,.12,.59],0x7c7a66,[.18,0,0]);}
   batch.append(k);
   const herd=new HerdVisual(kind,y,animMat,mats);this.herds.push(herd);this.group.add(herd.group);
  }
  this.group.add(batch.build('hub-animal-enclosures'));
 }
 set(stock:Livestock){for(const h of this.herds)h.set(stock);}
 update(time:number,listener:Vector3){for(const h of this.herds)h.update(time,listener);}
}
