// Original authored procedural scenery meshes. Units are normalized; existing image surfaces supply bark, leaf and rock detail.
import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SeededRng } from '../core/seededRng';
import type { Geology } from '../data/fieldScenery';
import { valueNoise3 } from './rockGeo';
export const SCENERY_ASSET_IDS={
 broadleaf:Array.from({length:6},(_,i)=>'scenery.tree.broadleaf.'+(i+1)),
 pine:Array.from({length:4},(_,i)=>'scenery.tree.pine.'+(i+1)),
 swamp:Array.from({length:4},(_,i)=>'scenery.tree.swamp.'+(i+1)),
 deadwood:Array.from({length:4},(_,i)=>'scenery.deadwood.'+(i+1)),
 outcrop:Array.from({length:8},(_,i)=>'scenery.outcrop.'+(i+1)),
 understory:['fern','shrub','drygrass','reed','snowgrass'].flatMap(k=>Array.from({length:3},(_,i)=>'scenery.plant.'+k+'.'+(i+1)))
};
type Tree='broadleaf'|'pine'|'swamp'|'none';
function irregular(seed:number,detail:0|1,stretch=1):BufferGeometry{
 const g=new IcosahedronGeometry(1,detail),p=g.getAttribute('position'),noise=valueNoise3(seed);
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),f=.76+noise(x*3.6,y*3.6,z*3.6)*.40;p.setXYZ(i,x*f,y*f*stretch,z*f);}
 g.computeVertexNormals();
 return g;
}
function merged(parts:BufferGeometry[]):BufferGeometry{
 const result=mergeGeometries(parts.map(p=>p.index?p.toNonIndexed():p),false);
 if(!result)throw Error('scenery asset incompatible geometry');
 for(const p of parts)p.dispose();return result;
}
/** Flared roots + tapering asymmetric trunk. Branches use the same kit scaled down. */
export function trunkAsset(seed:number):BufferGeometry{
 const g=new CylinderGeometry(.55,1,1,7,4),p=g.getAttribute('position');
 for(let i=0;i<p.count;i++){const y=p.getY(i),t=y+.5,k=1+Math.max(0,.23-t)*2.4;p.setXYZ(i,p.getX(i)*k+Math.sin(t*2.9+seed%4)*.13*t,y,p.getZ(i)*k+.14*t*t);}
 g.computeVertexNormals();return g;
}
/** Six broadleaf, four conifer and four wetland crown variants; leaf lobes replace spherical crowns.
 *  Distant crown is a single irregular mesh. Mid and near are clumps with varied silhouette.
 */
export function crownAsset(tree:Tree,variant:number,near:boolean):BufferGeometry{
 const seed=variant*811+(tree==='pine'?311:tree==='swamp'?719:101),rng=new SeededRng(seed);
 if(!near)return irregular(seed,0,tree==='pine'?1.15:.83);
 const pieces:BufferGeometry[]=[];
 if(tree==='pine'){
  for(let i=0;i<4;i++){
   const g=new ConeGeometry(1-i*.17,.68+i*.06,7,1);g.translate((rng.next()-.5)*.18,-.52+i*.34,(rng.next()-.5)*.18);g.rotateY(variant*.9+i*.45);pieces.push(g);
  }
 }else{
  for(let i=0;i<5;i++){
   const a=i*2.399+variant*.61,r=i===0?0:.44+rng.next()*.15,scale=.57+rng.next()*.16;
   const g=irregular(seed+i*79,0,tree==='swamp'?.73:1);
   g.scale(scale*(.93+rng.next()*.2),scale*(.67+rng.next()*.40),scale);
   g.translate(Math.cos(a)*r,i===0?.38:(rng.next()-.5)*.40,Math.sin(a)*r);pieces.push(g);
  }
 }
 return merged(pieces);
}
/** Original cutout atlas: 6 broadleaf, 4 conifer, 4 wetland cells. Crossed planes give natural, perforated silhouettes. */
export function leafCardAsset(tree:Tree,variant:number,near:boolean):BufferGeometry{
 const id=tree==='pine'?6+variant%4:tree==='swamp'?10+variant%4:variant%6;
 const col=id%4,row=Math.floor(id/4),margin=1.5/1024,u0=col*.25+margin,u1=(col+1)*.25-margin,v0=1-(row+1)*.25+margin,v1=1-row*.25-margin;
 const pos:number[]=[],uv:number[]=[];
 for(let k=0;k<(near?3:2);k++){
  const a=k*Math.PI/(near?3:2)+variant*.49,c=Math.cos(a),s=Math.sin(a),w=tree==='pine'?.91:1.08,h=tree==='pine'?1.27:.92;
  const points=[[-c*w,-h,-s*w],[c*w,-h,s*w],[c*w,h,s*w],[-c*w,h,-s*w]],us=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]];
  for(const i of [0,1,2,0,2,3]){pos.push(...points[i]!);uv.push(...us[i]!);}
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
/** Region-specific erosion and bedding shapes; eight reusable strata variants. */
export function outcropAsset(geology:Geology,variant:number):BufferGeometry{
 const g=irregular(variant*199+GEO_SEED[geology],1),p=g.getAttribute('position');
 for(let i=0;i<p.count;i++){
  let x=p.getX(i),y=p.getY(i),z=p.getZ(i);
  if(['strata','layered','terrace','shale','thermal','gravelbank'].includes(geology)){const step=variant%2?.23:.32;y=Math.round(y/step)*step*.72+y*.28;x+=y*(.1+(variant%4)*.10);z*=.72+variant%3*.12;}
  else if(geology==='sea_stack'||geology==='glacial'){x*=.68+.22*Math.abs(y);z+=y*.17;}
  else if(geology==='mudbank'){y*=.67;x+=z*.18;}
  p.setXYZ(i,x,y,z);
 }
 g.computeVertexNormals();return g;
}
const GEO_SEED:Record<Geology,number>={layered:101,mudbank:203,sea_stack:307,strata:401,glacial:503,mossrock:607,thermal:701,terrace:809,gravelbank:907,shale:1009};
/** Each set is generated with three leaf arrangements; material uses existing leaf detail. */
export function plantAsset(kind:'fern'|'shrub'|'drygrass'|'reed'|'snowgrass',variant:number):BufferGeometry{
 const pos:number[]=[],uv:number[]=[],rng=new SeededRng(variant*91+kind.length*883),n=kind==='fern'?7:kind==='reed'?5:kind==='shrub'?6:4;
 for(let i=0;i<n;i++){
  const a=i/n*Math.PI*2+rng.next()*.35,h=.48+rng.next()*.48,w=kind==='reed'?.075:kind==='drygrass'||kind==='snowgrass'?.10:.21,r=kind==='reed'?.24:.56;
  const x=Math.cos(a)*r,z=Math.sin(a)*r,dx=-Math.sin(a)*w,dz=Math.cos(a)*w;
  const bx=x*.1,bz=z*.1,mx=x*.60,mz=z*.60;
  const vs=[[bx,0,bz],[mx-dx,h*.55,mz-dz],[mx+dx,h*.55,mz+dz],[x,h,z]];
  for(const t of [[0,1,2],[1,3,2]])for(const j of t){pos.push(...vs[j]!);uv.push(j===1?0:j===2?1:.5,j===0?0:j===3?1:.55);}
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(pos,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));g.computeVertexNormals();return g;
}
/** Fallen/log variant: tapered rough cylinder, exposed root end. */
export function deadwoodAsset(variant:number):BufferGeometry{
 const g=trunkAsset(variant+91);g.scale(.38,1,.42);g.rotateZ(Math.PI/2);return g;
}
export interface SceneryInstance{x:number;y:number;z:number;sx:number;sy:number;sz:number;yaw:number;shade:number;lean?:number}
export function assembleSceneryMeshes(items:readonly SceneryInstance[],geometry:(i:number)=>BufferGeometry):BufferGeometry|null{
 if(!items.length)return null;
 const gs:BufferGeometry[]=[],m=new Matrix4(),q=new Quaternion(),rot=new Quaternion(),at=new Vector3(),scale=new Vector3(),up=new Vector3(0,1,0),side=new Vector3(0,0,1),col=new Color();
 for(let i=0;i<items.length;i++){const a=items[i]!,g=geometry(i);q.setFromAxisAngle(up,a.yaw);if(a.lean)q.multiply(rot.setFromAxisAngle(side,a.lean));
  m.compose(at.set(a.x,a.y,a.z),q,scale.set(a.sx,a.sy,a.sz));g.applyMatrix4(m);
  const p=g.getAttribute('position'),c=new Float32Array(p.count*3);col.setScalar(a.shade);for(let j=0;j<p.count;j++){c[j*3]=col.r;c[j*3+1]=col.g;c[j*3+2]=col.b;}g.setAttribute('color',new Float32BufferAttribute(c,3));gs.push(g);
 }
 return merged(gs);
}
