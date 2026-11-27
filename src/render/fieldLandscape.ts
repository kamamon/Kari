// 狩場の外側だけを作る景観。戦闘・当たり・採取・地図の座標は変更しない。
// 同じ格子を内側と外側へ分け、継ぎ目を共有する。外側を平らな草地として延長しない。
import { BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Quaternion, Vector3, DoubleSide } from 'three';
import { SeededRng } from '../core/seededRng';
import { AreaShape, type Pt } from '../game/areaShape';
import { reliefAt, type ReliefDef } from '../game/relief';
import type { FieldAreaDef } from '../data/schemas';
import { sectorAt, type SceneryArea, type SceneryGate, type Geology } from '../data/fieldScenery';
import { assembleSceneryMeshes, crownAsset, deadwoodAsset, outcropAsset, plantAsset, trunkAsset, type SceneryInstance } from './sceneryAssets';
import { imageLambert, imageFile, MATERIAL_DIR, type ImageSurface } from './materialImages';
import { loadEnvTexture } from './envArt';
import { RepeatWrapping, type Texture } from 'three';
import { patchNoise } from './noise';
import { valueNoise3 } from './rockGeo';
import { SKY_LOOKS, type SkyLook } from './sky';

export type LandscapeStyle='meadow'|'forest'|'wetland'|'coast'|'alpine'|'canyon'|'cave'|'thermal'|'crystal';
type TreeStyle='broadleaf'|'pine'|'swamp'|'none';
type WaterStyle='none'|'sea'|'marsh'|'stream';
interface ProfileSeed {
  style:LandscapeStyle; floor:ImageSurface; floorColor:number; land:number; rock:number; foliage:number;
  tree:TreeStyle; trees:number; stones:number; cover:number; ridge:number; peak:number; wall:number;
  water:WaterStyle; waterColor:number; fog:number; sky:SkyLook; basinBackdrop?:boolean;
}
const SKY=(zenith:number,horizon:number,coverage=.52,sun=0xffefd1):SkyLook=>({zenith,horizon,sun,cloudLit:0xe4e7df,cloudShade:0x8999a0,coverage});
const BASE:Record<LandscapeStyle,ProfileSeed>={
  meadow:{style:'meadow',floor:'grass',floorColor:0x8a9561,land:0x728451,rock:0x77766a,foliage:0x4d693c,tree:'broadleaf',trees:55,stones:50,cover:1,ridge:12,peak:31,wall:4.5,water:'none',waterColor:0x607d80,fog:.0112,sky:SKY_LOOKS.basin,basinBackdrop:true},
  forest:{style:'forest',floor:'moss',floorColor:0x606b48,land:0x465a39,rock:0x62685a,foliage:0x405d38,tree:'broadleaf',trees:126,stones:32,cover:.86,ridge:7.5,peak:23,wall:3.1,water:'none',waterColor:0x536f65,fog:.015,sky:SKY(0x729397,0xa0b4a1,.42)},
  wetland:{style:'wetland',floor:'earth',floorColor:0x77795a,land:0x67734c,rock:0x717268,foliage:0x54663c,tree:'swamp',trees:76,stones:24,cover:.72,ridge:7,peak:17,wall:2.9,water:'marsh',waterColor:0x627e75,fog:.0136,sky:SKY(0x809ba5,0xa8bbae,.48)},
  coast:{style:'coast',floor:'earth',floorColor:0xc8c1a6,land:0xb4ae91,rock:0x8c9292,foliage:0x536f55,tree:'none',trees:0,stones:47,cover:.12,ridge:13,peak:24,wall:2.9,water:'sea',waterColor:0x518991,fog:.0098,sky:SKY(0x6f9fbf,0xb6ced0,.63)},
  alpine:{style:'alpine',floor:'cliff',floorColor:0xd1dce0,land:0xc1d5dc,rock:0x778d99,foliage:0x4b6261,tree:'pine',trees:28,stones:62,cover:.02,ridge:23,peak:54,wall:5.4,water:'none',waterColor:0x6c9dab,fog:.0105,sky:SKY(0x81a6c9,0xc0d1db,.58,0xfff5e3)},
  canyon:{style:'canyon',floor:'cliff',floorColor:0x938779,land:0x8b8574,rock:0x777364,foliage:0x5f7048,tree:'pine',trees:23,stones:74,cover:.24,ridge:23,peak:39,wall:5.7,water:'none',waterColor:0x647e79,fog:.0118,sky:SKY(0x8497a4,0xb4b9ac,.49)},
  cave:{style:'cave',floor:'cliff',floorColor:0x6a6660,land:0x62635e,rock:0x555c5b,foliage:0x59694c,tree:'none',trees:0,stones:88,cover:0,ridge:29,peak:44,wall:6.0,water:'none',waterColor:0x657a7b,fog:.015,sky:SKY(0x70838c,0x9ea9aa,.38,0xd5e7dc)},
  thermal:{style:'thermal',floor:'cliff',floorColor:0x837264,land:0x826f5e,rock:0x6b6057,foliage:0x706d49,tree:'none',trees:0,stones:85,cover:.10,ridge:18,peak:38,wall:5.3,water:'none',waterColor:0x74847c,fog:.013,sky:SKY(0x8e999c,0xb7b9ae,.40,0xffe5bd)},
  crystal:{style:'crystal',floor:'cliff',floorColor:0x818b8a,land:0x7b8684,rock:0x65777e,foliage:0x667858,tree:'none',trees:0,stones:78,cover:.08,ridge:15,peak:33,wall:4.8,water:'none',waterColor:0x66949a,fog:.0108,sky:SKY(0x809cac,0xb3c2c0,.57)}
};
// 登録簿の20地域それぞれの色・外形・植生。原作のマップ形状・絵は使用しない。
const REGIONS:Record<string,[LandscapeStyle,Partial<ProfileSeed>]>={
 'field.basin':['meadow',{}],
 'field.wetland':['wetland',{land:0x667a4b,trees:88}],
 'field.coast':['coast',{}],
 'field.ashmine':['cave',{floorColor:0x817362,rock:0x6c6155,sky:SKY(0x808c90,0xaba99d,.43)}],
 'field.icegorge':['alpine',{}],
 'field.mistforest':['forest',{trees:138,tree:'broadleaf'}],
 'field.emberplateau':['thermal',{floorColor:0x928674,cover:.26,tree:'pine',trees:14,ridge:13}],
 'field.raincliff':['canyon',{floorColor:0x7d8678,land:0x72816e,foliage:0x4c6650,trees:38,fog:.0145,sky:SKY(0x7a929d,0xa9bab5,.31)}],
 'field.copperterrace':['wetland',{floorColor:0x88806a,rock:0x827964,land:0x7d8a57,trees:52,ridge:11}],
 'field.dryriver':['canyon',{floorColor:0xb0a084,land:0xa49b83,ridge:14,peak:27,tree:'none',trees:0,water:'marsh',waterColor:0x7c9896}],
 'field.leadcloud':['meadow',{floor:'grass',floorColor:0x929e86,land:0x88997f,rock:0x8c9592,tree:'pine',trees:48,ridge:8,peak:37,wall:3.4,fog:.0136,sky:SKY(0x859da9,0xb4c5c5,.36),basinBackdrop:false}],
 'field.sunkenroot':['wetland',{floorColor:0x5e6d51,land:0x536748,foliage:0x415c40,trees:106,fog:.016}],
 'field.glassplain':['crystal',{land:0x929c99,rock:0x6a7e87,ridge:9,peak:27}],
 'field.ashcocoon':['forest',{floorColor:0x797e70,land:0x737f6b,foliage:0x62705d,trees:94,rock:0x84887c,fog:.0165}],
 'field.coldcopper':['cave',{floorColor:0x7f857e,rock:0x73847e,land:0x76827a,sky:SKY(0x76919a,0xa5b8b7,.42)}],
 'field.echohall':['canyon',{floorColor:0x988c79,rock:0x797267,tree:'none',trees:0,stones:92,cover:.05}],
 'field.heavyfog':['forest',{land:0x61745e,rock:0x76877b,trees:82,tree:'pine',water:'marsh',fog:.018,sky:SKY(0x849a9f,0xa6b8b2,.30)}],
 'field.buriedheat':['thermal',{floorColor:0x9b8570,land:0x8a7661,rock:0x715e50,stones:92}],
 'field.ruststar':['crystal',{floorColor:0xa0927d,land:0x8e8a75,rock:0x877765,tree:'pine',trees:20,cover:.18}],
 'field.deepveil':['forest',{floorColor:0x526047,land:0x465b43,foliage:0x364f35,trees:146,water:'marsh',fog:.0165}]
};
export interface LandscapeProfile extends ProfileSeed {fieldId:string;areaId:string;seed:number;viewAngle:number;plan?:SceneryArea}
export const FIELD_LANDSCAPE_IDS=Object.keys(REGIONS);
export function landscapeProfile(fieldId:string,area:Pick<FieldAreaDef,'id'|'name'|'kind'|'size'>,plan?:SceneryArea):LandscapeProfile{
 const [style,over]=REGIONS[fieldId]??['meadow',{}];
 let seed=2166136261;for(const s of fieldId+':'+area.id)seed=Math.imul(seed^s.charCodeAt(0),16777619)>>>0;
 const rng=new SeededRng(seed),p:LandscapeProfile={...BASE[style],...over,fieldId,areaId:area.id,seed,viewAngle:rng.next()*Math.PI*2,plan};
 if(plan){p.seed=plan.featureSeed;p.water=plan.water;p.viewAngle=plan.seaAngle;if(plan.vegetation==='none'){p.trees=0;p.tree='none';}else if(plan.vegetation==='pine')p.tree='pine';else if(plan.vegetation==='wetland')p.tree='swamp';if(plan.landmark==='overlook'||plan.landmark==='high_plateau')p.wall=Math.max(2.8,p.wall*.82);if(plan.landmark==='crystal_outcrop'||plan.landmark==='crystal_nest')p.stones=Math.max(65,p.stones);}
 // 広い原は低い尾根と眺望、谷・沢・坑口は奥へ重なる高い地形、巣は囲まれた景色。
 if(area.size==='wide'||/草原|台地|高原|広盆|浜/.test(area.name)){p.ridge*=.77;p.wall=Math.max(2.8,p.wall*.87);p.peak*=1.13;p.trees=Math.round(p.trees*.78);}
 if(area.kind==='path'||/谷|峡|回廊|坑口|洞/.test(area.name)){p.ridge*=1.27;p.wall=Math.max(p.wall,style==='coast'?3.3:4.5);}
 if(area.kind==='nest'){p.ridge*=1.18;p.wall=Math.max(4.4,p.wall);p.cover*=.35;}
 if(area.kind==='camp'){p.ridge*=.95;p.cover=Math.max(p.cover,style==='alpine'?.025:.10);}
 if(fieldId==='field.basin'){
  // 盆地内でも、原・岩場・涸れ沢・崩れ谷・晶窪の植生と山並みを分ける。
  if(area.id==='a5'){p.land=0x928b6a;p.rock=0x817968;p.trees=26;p.ridge=13;}
  if(area.id==='a6'||area.kind==='nest'){p.land=0x78847a;p.rock=0x66777a;p.trees=20;p.stones=75;p.ridge*=1.2;}
  if(area.id==='a8'){p.trees=20;p.ridge=24;p.peak=41;p.rock=0x777368;}
 }
 return p;
}
export interface LandscapeInput{
 bounds:{minX:number;maxX:number;minZ:number;maxZ:number};shape?:readonly Pt[];relief?:ReliefDef;
 gates?:readonly {x:number;z:number;marker?:boolean;to?:string}[]; profile:LandscapeProfile;
}
type Gate={x:number;z:number;nx:number;nz:number;bend:number;width:number;anchor?:SceneryGate};
const smooth=(a:number,b:number,v:number)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const mix=(x:number,z:number,k:number)=>Math.sin(x*k+z*k*.61);
const OUTER=[12,20,32,47,65,87,114,145,178];
function gridAxis(a:number,b:number,step:number):number[]{
 const lo=a-6,hi=b+6,n=Math.ceil((hi-lo)/step);
 return [...OUTER.slice().reverse().map(x=>a-x),...Array.from({length:n+1},(_,i)=>lerp(lo,hi,i/n)),...OUTER.map(x=>b+x)];
}
/** 外側の正確な距離。AreaShape の遠方セルは -8 を返すため、景観だけ距離を測り直す。 */
function outsideOf(s:AreaShape,points:readonly Pt[],x:number,z:number):number{
 const d=s.signedDistance(x,z);if(d>=0)return 0;if(d> -7.999)return -d;
 let best=Infinity;
 for(let i=0;i<points.length;i++){
  const a=points[i]!,b=points[(i+1)%points.length]!,dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz;
  const t=l?Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l)):0;
  const ex=x-a[0]-dx*t,ez=z-a[1]-dz*t;best=Math.min(best,ex*ex+ez*ez);
 }
 return Math.sqrt(best);
}
function upperIndex(a:readonly number[],x:number):number{
 let l=0,r=a.length-1;while(r-l>1){const m=(l+r)>>1;if(a[m]!<=x)l=m;else r=m;}return l;
}
export interface LandscapeSurface{
 near:BufferGeometry;outer:BufferGeometry;water:BufferGeometry|null;
 outline:AreaShape;distance:(x:number,z:number)=>number;height:(x:number,z:number)=>number;gates:Gate[];
 metrics:{nearTriangles:number;outerTriangles:number;outerMin:number;outerMax:number;sharedVertices:number};
}
export function buildLandscapeSurface(input:LandscapeInput):LandscapeSurface{
 const b=input.bounds,p=input.profile,points=input.shape&&input.shape.length>=3?input.shape:[[b.minX,b.minZ],[b.maxX,b.minZ],[b.maxX,b.maxZ],[b.minX,b.maxZ]] as Pt[];
 const outline=new AreaShape(points),distance=(x:number,z:number)=>outsideOf(outline,points,x,z);
 const x0=(b.minX+b.maxX)*.5,z0=(b.minZ+b.maxZ)*.5,rng=new SeededRng(p.seed^0x31a22b);
 const noise=patchNoise(p.seed),noise2=valueNoise3(p.seed^871);
 const gates=(input.gates??[]).map(g=>{const n=outline.outwardAt(g.x,g.z),anchor=p.plan?.gates.find(a=>a.toAreaId===g.to);return{x:g.x,z:g.z,nx:n.x,nz:n.z,bend:anchor?.bendM??(rng.next()<.5?-4:4),width:anchor?.widthM??4.9,anchor};});
 const xs=gridAxis(b.minX,b.maxX,input.relief?2:3),zs=gridAxis(b.minZ,b.maxZ,input.relief?2:3),nx=xs.length,nz=zs.length,N=nx*nz;
 const ds=new Float32Array(N),ys=new Float32Array(N),locked=new Uint8Array(N);
 const ni:number[]=[],oi:number[]=[];
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)ds[j*nx+i]=distance(xs[i]!,zs[j]!);
 const tri=(a:number,b:number,c:number)=>{
  // A triangle that crosses a concave boundary is locked even when its corners lie outside.
  const ax=xs[a%nx]!,az=zs[Math.floor(a/nx)]!,bx=xs[b%nx]!,bz=zs[Math.floor(b/nx)]!,cx=xs[c%nx]!,cz=zs[Math.floor(c/nx)]!;
  const min=Math.min(ds[a]!,ds[b]!,ds[c]!);const close=min<=1.65||(min<7&&[[.5,.5,0],[.5,0,.5],[0,.5,.5],[1/3,1/3,1/3]].some(([u,v,w])=>distance(ax*u+bx*v+cx*w,az*u+bz*v+cz*w)<.35));
  if(close){ni.push(a,b,c);locked[a]=locked[b]=locked[c]=1;}else oi.push(a,b,c);};
 for(let j=0;j<nz-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,bb=a+1,c=a+nx,d=c+1;tri(a,c,bb);tri(bb,c,d);}
 const waterY=p.plan?.waterY??-1.4;
 const gateBlend=(x:number,z:number):number=>{
  let v=0;
  for(const g of gates){const dx=x-g.x,dz=z-g.z,a=dx*g.nx+dz*g.nz,side=Math.abs(dx*g.nz-dz*g.nx-g.bend*smooth(5,21,a));
   if(a>=-1&&a<25)v=Math.max(v,(1-smooth(g.width*.52,g.width*.52+3.2,side))*(1-smooth(18,25,a)));
  }
  return v;
 };
 let outerMin=Infinity,outerMax=-Infinity;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i,x=xs[i]!,z=zs[j]!,d=ds[k]!,base=reliefAt(input.relief,x,z);
  if(locked[k]||d<=3.2){ys[k]=base;continue;}
  const a=Math.atan2(z-z0,x-x0),open=smooth(.14,.94,Math.cos(a-p.viewAngle)),n=noise(x*.62+47,z*.62-93),broad=noise2(x*.013,2.7,z*.013),crag=noise2(x*.065,9.4,z*.065);
  const sector=sectorAt(p.plan,a),ridge=(.50+.85*n)*p.ridge*sector.ridgeScale*(1-.68*open)*smooth(3.2,17,d);
  const range=p.peak*sector.peakScale*(.13+.77*broad)*smooth(15,83,d);
  const erosion=(Math.sin((x*.65+z*.35)*.09+crag*2.5)*.5+.5)*smooth(8,45,d);
  let height=ridge+range+crag*3.3*smooth(8,24,d)-2*open*smooth(5,28,d)-sector.dropM*smooth(7,28,d)*(1-.72*smooth(45,110,d))-erosion*(p.plan?.geology==='strata'||p.plan?.geology==='layered'?3:1.3);
  if(p.water==='sea'){
   const seaward=smooth(-.22,.48,Math.cos(a-p.viewAngle));
   height=lerp(height,-4.4-2.5*broad,seaward*smooth(3.2,19,d));
  }else if(p.water==='marsh'||p.water==='stream'){
   const channel=p.water==='stream' ? (1-smooth(2.5,9,Math.abs((x-x0)*Math.sin(p.viewAngle)-(z-z0)*Math.cos(p.viewAngle)-Math.sin(d*.085)*7)))*smooth(6,18,d) : smooth(.45,.75,noise2(x*.038,0.5,z*.038))*(.48+.52*open);
   height=lerp(height,waterY-1.6-2*crag,channel*smooth(4,17,d));
  }
  // 出口の先は岩・樹林へ折れる緩やかな道。手前の15mを遮らず、遠くで地形へ溶かす。
  height=lerp(height,.28+Math.min(2.0,d*.065),gateBlend(x,z));
  ys[k]=base+height*smooth(3.2,7.5,d);
  outerMin=Math.min(outerMin,ys[k]!);outerMax=Math.max(outerMax,ys[k]!);
 }
 const land=new Color(p.land),rock=new Color(p.rock),fog=new Color(p.sky.horizon),temp=new Color();
 const geo=(indices:number[],type:'near'|'outer'|'water'):BufferGeometry=>{
  const verts:number[]=[],uv:number[]=[],cols:number[]=[],weights:number[]=[],index:number[]=[],remap=new Map<number,number>();
  for(const k of indices){let m=remap.get(k);if(m===undefined){
   m=verts.length/3;remap.set(k,m);const i=k%nx,j=Math.floor(k/nx),x=xs[i]!,z=zs[j]!,y=type==='water'?waterY:ys[k]!;
   verts.push(x,y,z);uv.push(x/(type==='water'?12:9),-z/(type==='water'?12:9));
   if(type==='outer'){
    const lx=Math.max(0,i-1),rx=Math.min(nx-1,i+1),lz=Math.max(0,j-1),rz=Math.min(nz-1,j+1);
    const slope=Math.hypot((ys[j*nx+rx]!-ys[j*nx+lx]!)/(xs[rx]!-xs[lx]!||1),(ys[rz*nx+i]!-ys[lz*nx+i]!)/(zs[rz]!-zs[lz]!||1));
    const blend=Math.max(0,Math.min(1,slope*.58+noise(x+18,z+37)*.47-(p.style==='forest'?.21:0)));
    temp.copy(land).lerp(rock,blend).multiplyScalar(.83+noise(x,z)*.33);
    weights.push(Math.max(0,Math.min(1,blend*.85+(p.style==='alpine'?.22:0))));
    if(p.water!=='none'&&y<waterY+.55)temp.lerp(rock,.42);
    temp.lerp(fog,smooth(123,190,ds[k]!)*.54);
    cols.push(temp.r,temp.g,temp.b);
   }
  }index.push(m);}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(verts,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));if(type==='outer'){g.setAttribute('color',new Float32BufferAttribute(cols,3));g.setAttribute('sceneryBlend',new Float32BufferAttribute(weights,1));}g.setIndex(index);g.computeVertexNormals();g.computeBoundingSphere();return g;
 };
 const wp:number[]=[],wu:number[]=[],wi:number[]=[];
 // Clip submerged triangles to the waterline instead of displaying the whole triangle above land.
 if(p.water!=='none')for(let i=0;i<oi.length;i+=3){
  const ks=[oi[i]!,oi[i+1]!,oi[i+2]!];if(Math.min(...ks.map(k=>ds[k]!))<=4.2)continue;
  const a=ks.map(k=>({x:xs[k%nx]!,z:zs[Math.floor(k/nx)]!,y:ys[k]!})),poly:{x:number;z:number;y:number}[]=[];
  for(let j=0;j<3;j++){const v=a[j]!,u=a[(j+1)%3]!,iv=v.y<=waterY,iu=u.y<=waterY;if(iv)poly.push(v);if(iv!==iu){const t=(waterY-v.y)/(u.y-v.y);poly.push({x:lerp(v.x,u.x,t),z:lerp(v.z,u.z,t),y:waterY});}}
  if(poly.length<3||poly.some(v=>distance(v.x,v.z)<4.12))continue;const k=wp.length/3;for(const v of poly){wp.push(v.x,waterY+.006,v.z);wu.push(v.x/12,-v.z/12);}for(let j=1;j+1<poly.length;j++)wi.push(k,k+j,k+j+1);
 }
 const near=geo(ni,'near'),outer=geo(oi,'outer'),water=wi.length?new BufferGeometry():null;
 if(water){water.setAttribute('position',new Float32BufferAttribute(wp,3));water.setAttribute('uv',new Float32BufferAttribute(wu,2));water.setIndex(wi);water.computeVertexNormals();}
 const height=(x:number,z:number):number=>{
  const i=upperIndex(xs,x),j=upperIndex(zs,z),a=j*nx+i,bb=a+1,c=a+nx,d=c+1;
  const u=Math.max(0,Math.min(1,(x-xs[i]!)/(xs[i+1]!-xs[i]!))),v=Math.max(0,Math.min(1,(z-zs[j]!)/(zs[j+1]!-zs[j]!)));
  return u+v<=1?ys[a]!+(ys[bb]!-ys[a]!)*u+(ys[c]!-ys[a]!)*v:ys[d]!+(ys[c]!-ys[d]!)*(1-u)+(ys[bb]!-ys[d]!)*(1-v);
 };
 return{near,outer,water,outline,distance,height,gates,metrics:{nearTriangles:ni.length/3,outerTriangles:oi.length/3,outerMin,outerMax,sharedVertices:[...new Set(oi)].filter(i=>locked[i]).length}};
}

type Instance={x:number;y:number;z:number;sx:number;sy:number;sz:number;yaw:number;shade:number;lean?:number};
function batch(group:Group,geo:BufferGeometry,mat:MeshLambertMaterial,items:Instance[],name:string):void{
 if(!items.length){geo.dispose();mat.dispose();return;}
 const mesh=new InstancedMesh(geo,mat,items.length),m=new Matrix4(),q=new Quaternion(),up=new Vector3(0,1,0),axis=new Vector3(0,0,1),lean=new Quaternion(),at=new Vector3(),s=new Vector3(),col=new Color();
 for(let i=0;i<items.length;i++){const a=items[i]!;q.setFromAxisAngle(up,a.yaw);if(a.lean)q.multiply(lean.setFromAxisAngle(axis,a.lean));m.compose(at.set(a.x,a.y,a.z),q,s.set(a.sx,a.sy,a.sz));mesh.setMatrixAt(i,m);mesh.setColorAt(i,col.setScalar(a.shade));}
 mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
 mesh.name=name;mesh.userData.noMerge=true;mesh.computeBoundingSphere();group.add(mesh);
}
/** 画像を貼った、輪郭の不規則な岩塊・樹冠。単なる球の並びにしない。 */
function lump(seed:number,detail:0|1|2):BufferGeometry{
 const g=new IcosahedronGeometry(1,detail),v=g.getAttribute('position'),n=valueNoise3(seed);
 for(let i=0;i<v.count;i++){const x=v.getX(i),y=v.getY(i),z=v.getZ(i),k=.76+n(x*3.3,y*3.3,z*3.3)*.40;v.setXYZ(i,x*k,y*k,z*k);}
 g.computeVertexNormals();
 // 樹冠は細かな葉群として見せ、岩の角張った法線と区別する。
 if(detail===2){const nrm=g.getAttribute('normal'),n=new Vector3(),r=new Vector3();for(let i=0;i<v.count;i++){n.fromBufferAttribute(nrm,i);r.fromBufferAttribute(v,i).normalize();n.lerp(r,.70).normalize();nrm.setXYZ(i,n.x,n.y,n.z);}}
 return g;
}
/** 斜面の一番低い側まで根を埋める。木の根元・露岩に共通。 */
function groundedBase(s:LandscapeSurface,x:number,z:number,r:number):number{let y=s.height(x,z);for(let i=0;i<8;i++){const a=i*Math.PI/4;y=Math.min(y,s.height(x+Math.cos(a)*r,z+Math.sin(a)*r));}return y;}
function isGateClear(s:LandscapeSurface,x:number,z:number,r:number):boolean{
 return s.gates.every(g=>{const dx=x-g.x,dz=z-g.z,a=dx*g.nx+dz*g.nz,side=Math.abs(dx*g.nz-dz*g.nx-g.bend*smooth(5,21,a));return !(a> -2&&a<24&&side<g.width*.5+3+r);});
}
function trailGeometry(s:LandscapeSurface):BufferGeometry{
 const pos:number[]=[],uv:number[]=[],idx:number[]=[];
 for(const g of s.gates){
  let prev=-1;
  for(let a=4.2;a<=24;a+=1.5){
   const bend=g.bend*smooth(5,21,a),w=lerp(g.width*.5,.16,smooth(6,24,a))*(.94+.08*Math.sin(a*1.7+g.x));
   const x=g.x+g.nx*a+g.nz*bend,z=g.z+g.nz*a-g.nx*bend;
   const left=[x-g.nz*w,z+g.nx*w],right=[x+g.nz*w,z-g.nx*w];
   if(s.distance(left[0]!,left[1]!)<.45||s.distance(right[0]!,right[1]!)<.45){prev=-1;continue;}
   const j=pos.length/3;
   for(const v of [left,right])pos.push(v[0]!,s.height(v[0]!,v[1]!)+.035,v[1]!);
   uv.push(0,a/5,1,a/5);
   if(prev>=0)idx.push(prev,prev+1,j,j,prev+1,j+1);
   prev=j;
  }
 }
 const geo=new BufferGeometry();geo.setAttribute('position',new Float32BufferAttribute(pos,3));geo.setAttribute('uv',new Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
/** 遠景の稜線は実際の形で2層。距離感は手前の3D地形と霧で作り、空の色とつなぐ。 */
function distantRidge(input:LandscapeInput,layer:number):Mesh{
 const p=input.profile,b=input.bounds,xc=(b.minX+b.maxX)/2,zc=(b.minZ+b.maxZ)/2,r=Math.max(b.maxX-b.minX,b.maxZ-b.minZ)/2+158+layer*42;
 const N=100,vertices:number[]=[],colors:number[]=[],idx:number[]=[],n=valueNoise3(p.seed+layer*123),sky=new Color(p.sky.horizon),shade=new Color(p.rock),c=new Color();
 for(let i=0;i<=N;i++){const a=i/N*Math.PI*2,x=Math.cos(a),z=Math.sin(a),f=n(x*3.8,layer*4.5,z*3.8),f2=n(x*7.5,layer*3.3,z*7.5);
  const open=smooth(.05,.9,Math.cos(a-p.viewAngle)),sea=p.water==='sea'?smooth(-.05,.9,Math.cos(a-p.viewAngle)):0;
  const sector=sectorAt(p.plan,a),h=(17+p.peak*sector.peakScale*(.42+f*.85)+f2*11)*(1-.42*open)*(1-sea);
  for(const [rad,y,t] of [[r-12,-12,0],[r,h,1],[r+23,-14,0]] as const){
   vertices.push(xc+x*rad,y,zc+z*rad);c.copy(sky).lerp(shade,t*(layer?.16:.27)*(.7+f*.5));colors.push(c.r,c.g,c.b);
  }
  if(i<N&&(p.water!=='sea'||sea<.76))for(let j=0;j<2;j++){const a=i*3+j,b=a+3;idx.push(a,b,a+1,a+1,b,b+1);}
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();
 const m=new Mesh(g,new MeshBasicMaterial({vertexColors:true,side:DoubleSide,fog:false}));m.name='field-distant-ridge-'+layer;m.userData.noMerge=true;return m;
}
/** Two image surfaces blended by slope and moisture. Before either image loads, use the existing color fallback. */
function landscapeMaterial(p:LandscapeProfile):MeshLambertMaterial{
 const primary:ImageSurface=p.style==='forest'?'moss':p.style==='meadow'?'grass':p.style==='wetland'?'earth':p.style==='coast'?'earth':'cliff';
 const secondary:ImageSurface=p.style==='alpine'?'earth':p.style==='coast'?'cliff':primary==='cliff'?(p.style==='thermal'?'earth':'moss'):'cliff';
 const mat=imageLambert(primary,{color:0xffffff,vertexColors:true},{gain:1.12});
 const uniforms={scenerySecond:{value:null as Texture|null},scenerySecondReady:{value:0}};
 loadEnvTexture(imageFile(secondary),t=>{t.wrapS=t.wrapT=RepeatWrapping;t.anisotropy=4;},t=>{uniforms.scenerySecond.value=t;uniforms.scenerySecondReady.value=1;},MATERIAL_DIR);
 mat.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,uniforms);
  sh.vertexShader='attribute float sceneryBlend;\nvarying float vSceneryBlend;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n vSceneryBlend = sceneryBlend;');
  sh.fragmentShader='uniform sampler2D scenerySecond;\nuniform float scenerySecondReady;\nvarying float vSceneryBlend;\n'+sh.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
   vec4 baseSample=texture2D(map,vMapUv);
   vec4 secondSample=texture2D(scenerySecond,vMapUv*.77);
   diffuseColor *= mix(baseSample,secondSample,clamp(vSceneryBlend*scenerySecondReady,0.0,1.0));
   #endif`);
 };
 mat.customProgramCacheKey=()=> 'field-scenery-v2-mix';
 return mat;
}
export function buildLandscapeExterior(input:LandscapeInput,s:LandscapeSurface):Group{
 const p=input.profile,b=input.bounds,rng=new SeededRng(p.seed^0xa142c),noise=patchNoise(p.seed^8873),group=new Group();group.name='field-natural-exterior';
 const surface=landscapeMaterial(p);
 const ground=new Mesh(s.outer,surface);ground.name='field-exterior-relief';ground.userData.noMerge=true;group.add(ground);
 if(s.water){const water=new Mesh(s.water,imageLambert('water',{color:p.waterColor,transparent:true,opacity:.92,side:DoubleSide},{raw:true,gain:.93}));water.name='field-exterior-water';water.userData.noMerge=true;group.add(water);}
 const trail=trailGeometry(s);
 if(trail.getIndex()!.count){const path=new Mesh(trail,imageLambert('earth',{color:p.style==='alpine'?0xc9d4d4:0x948571,side:DoubleSide},{gain:1.1}));path.name='field-exit-continuation';path.userData.noMerge=true;group.add(path);}else trail.dispose();
 group.add(distantRidge(input,0),distantRidge(input,1));
 const trunks:Instance[]=[],crowns:Instance[]=[],rocks:Instance[]=[],treeSites:{x:number;z:number}[]=[],plants:SceneryInstance[]=[],deadwood:SceneryInstance[]=[];
 const w=b.maxX-b.minX,d=b.maxZ-b.minZ;
 // 地形に追従する不規則な樹林。描画専用の大きな物は境界の外だけ。
 for(let i=0,tries=0;i<p.trees&&tries<p.trees*45;tries++){
  const x=b.minX-78+rng.next()*(w+156),z=b.minZ-78+rng.next()*(d+156),dist=s.distance(x,z);
  const near=dist<37,rad=p.tree==='pine'?2.4:3.4,sector=sectorAt(p.plan,Math.atan2(z-(b.minZ+b.maxZ)*.5,x-(b.minX+b.maxX)*.5));
  if(dist<4.4+rad||dist>99||!isGateClear(s,x,z,rad)||rng.next()>Math.min(1,(.32+.68*noise(x,z))*Math.max(.35,sector.vegetation))||treeSites.some(t=>Math.hypot(x-t.x,z-t.z)<(near?4.0:5.7)))continue;
  const y=s.height(x,z);if(p.water!=='none'&&y<(p.plan?.waterY??-1.4)+.4)continue;
  const h=(p.tree==='pine'?8:p.tree==='swamp'?7.3:10)*(0.65+rng.next()*.9)*(near?1:1.12),r=h*(p.tree==='pine'?.055:.071);
  const shade=.78+rng.next()*.35,yaw=rng.next()*6.283;
  if(dist<4+h*.48||!isGateClear(s,x,z,h*.48))continue;treeSites.push({x,z});i++;
  const root=groundedBase(s,x,z,r*1.2)-.24,top=y+h*.79;
  trunks.push({x,y:(root+top)/2,z,sx:r,sy:top-root,sz:r,yaw,shade});
  if(p.tree==='pine'){
   for(let j=0;j<3;j++){const cy=h*(.55+j*.18),rr=h*(.31-j*.075);crowns.push({x,y:y+cy,z,sx:rr,sy:h*(.29-j*.035),sz:rr,yaw:yaw+j*.8,shade:shade*(1+j*.04)});}
  }else{
   const rr=h*.30;
   for(let j=0;j<3;j++){
    const a=yaw+j*2.09,off=j?rr*(.68+rng.next()*.22):0,cy=y+h*(j===0?.91:.70+rng.next()*.10);
    crowns.push({x:x+Math.cos(a)*off,y:cy,z:z+Math.sin(a)*off,sx:rr*(.75+rng.next()*.38),sy:rr*(.72+rng.next()*.34),sz:rr*(.76+rng.next()*.38),yaw:a,shade:shade*(.86+rng.next()*.24)});
    if(j){const len=h*.32;trunks.push({x:x+Math.cos(a)*off*.38,y:y+h*.63,z:z+Math.sin(a)*off*.38,sx:r*.39,sy:len,sz:r*.39,yaw:-a,lean:-.48,shade});}
   }
  }
 }
 for(let i=0,tries=0;i<p.stones&&tries<p.stones*25;tries++){
  const x=b.minX-63+rng.next()*(w+126),z=b.minZ-63+rng.next()*(d+126),dist=s.distance(x,z),rad=1.6+rng.next()*4.8;
  if(dist<3.7+rad||dist>88||!isGateClear(s,x,z,rad))continue;
  const y=s.height(x,z);if(p.water!=='none'&&y<(p.plan?.waterY??-1.4)-1.4)continue;
  const h=rad*(p.style==='canyon'||p.style==='cave'||p.style==='alpine'?1.1+rng.next()*1.4:.48+rng.next()*.75);
  const base=groundedBase(s,x,z,rad*.72),sz=rad*(.56+rng.next()*.52);
  // 岩を斜面の上に置くのではなく、下の地盤に埋めた露岩にする。
  rocks.push({x,y:base+h*.04,z,sx:rad,sy:h,sz,yaw:rng.next()*6.283,shade:.74+rng.next()*.38});i++;
 }
 batch(group,trunkAsset(p.seed),imageLambert('bark',{color:p.tree==='swamp'?0x6c6149:0x6a6253,flatShading:true},{gain:1.15}),trunks,'field-exterior-trunks');
 // Near/mid crown variants use one material batch. Far crowns have a cheaper mesh.
 const crownGeo=assembleSceneryMeshes(crowns,i=>{const q=crowns[i]!,dist=s.distance(q.x,q.z);return crownAsset(p.tree,i%(p.tree==='broadleaf'?6:4),dist<43);});
 if(crownGeo){const crown=new Mesh(crownGeo,imageLambert('leaf',{color:p.foliage,vertexColors:true},{gain:1.26}));crown.name='field-exterior-canopy';crown.userData.noMerge=true;group.add(crown);}
 const geology=p.plan?.geology??(p.style==='alpine'?'glacial':p.style==='coast'?'sea_stack':p.style==='canyon'?'strata':'layered');
 batch(group,outcropAsset(geology,p.seed%8),imageLambert('cliff',{color:p.rock,flatShading:true},{gain:1.22}),rocks,'field-exterior-rocks');
 const extras=new Group();extras.name='field-exterior-ecology';
 const kind=p.style==='wetland'?'reed':p.style==='forest'?'fern':p.style==='alpine'?'snowgrass':p.style==='meadow'?'shrub':'drygrass';
 const count=p.tree==='none'?p.style==='coast'?30:18:72;
 for(let i=0,t=0;i<count&&t<count*18;t++){
  const x=b.minX-34+rng.next()*(w+68),z=b.minZ-34+rng.next()*(d+68),dist=s.distance(x,z);if(dist<2.6||dist>35||!isGateClear(s,x,z,1.2)||rng.next()>.45+.5*noise(x,z))continue;
  const y=s.height(x,z),k=.6+rng.next()*1.4;if(p.water!=='none'&&y<(p.plan?.waterY??-1.4)+.12)continue;
  plants.push({x,y:groundedBase(s,x,z,.24)-.04,z,sx:k,sy:k,sz:k,yaw:rng.next()*6.283,shade:.75+rng.next()*.4});i++;
 }
 const plantGeo=assembleSceneryMeshes(plants,i=>plantAsset(kind,i%3));if(plantGeo){const mesh=new Mesh(plantGeo,imageLambert('leaf',{color:p.style==='alpine'?0xb1b49e:p.foliage,vertexColors:true,side:DoubleSide},{gain:1.3}));mesh.name='field-understory';mesh.userData.noMerge=true;extras.add(mesh);}
 if(p.tree!=='none'&&p.plan&&(p.plan.vegetation==='wetland'||p.plan.theme==='fallen_giants'||p.plan.theme==='fungal_grove'))for(const site of treeSites.slice(0,5)){const x=site.x+1,z=site.z,dist=s.distance(x,z);if(dist<9||!isGateClear(s,x,z,4))continue;deadwood.push({x,z,y:groundedBase(s,x,z,2)+.2,sx:6,sy:1.2,sz:1.2,yaw:rng.next()*6.28,shade:.9});}
 const logs=assembleSceneryMeshes(deadwood,i=>deadwoodAsset(i%4));if(logs){const m=new Mesh(logs,imageLambert('bark',{color:0x736454,vertexColors:true},{gain:1.2}));m.name='field-deadwood';m.userData.noMerge=true;extras.add(m);}
 if(p.plan){
  const theme=p.plan.theme,features:SceneryInstance[]=[];
  const mineral=/crystal|glass_shale|copper|bronze|warm_fissures|steam/.test(theme)||/crystal/.test(p.plan.landmark);
  const cavern=/mine|copper_cavern|echo_gorge|fallen_giants/.test(theme);
  const waterfall=/waterfall|copper/.test(theme)&&p.water==='stream';
  for(let k=0,t=0;k<6&&t<160;t++){
   const a=rng.next()*Math.PI*2,x=(b.minX+b.maxX)*.5+Math.cos(a)*(w*.5+16+rng.next()*24),z=(b.minZ+b.maxZ)*.5+Math.sin(a)*(d*.5+16+rng.next()*24),dist=s.distance(x,z),radius=2+rng.next()*1.7;
   if(dist<12+radius||dist>74||!isGateClear(s,x,z,radius+1))continue;
   const y=groundedBase(s,x,z,radius*.65);features.push({x,z,y:y+.12,sx:radius,sy:(cavern?5:2.2)+rng.next()*2,sz:radius*.7,yaw:rng.next()*6.28,shade:.8+rng.next()*.25});k++;
  }
  if((mineral||cavern||waterfall)&&features.length){
   const geo=assembleSceneryMeshes(features,i=>outcropAsset(mineral?'shale':p.plan!.geology,i%8));
   if(geo){const feat=new Mesh(geo,imageLambert(mineral?'crystal':'cliff',{color:mineral?0x9b8764:p.rock,vertexColors:true,flatShading:true},{gain:1.2}));feat.name='field-landmark-'+p.plan.landmark;feat.userData.noMerge=true;extras.add(feat);}
  }
 }
 if(extras.children.length)group.add(extras);
 group.userData.landscape={fieldId:p.fieldId,areaId:p.areaId,style:p.style,theme:p.plan?.theme??p.style,landmark:p.plan?.landmark??'legacy',anchors:s.gates.map(g=>g.anchor?.anchorKey??'legacy'),plants:plants.length,trees:treeSites.length,rocks:rocks.length,water:!!s.water,gates:s.gates.length,...s.metrics};
 return group;
}
