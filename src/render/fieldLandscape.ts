// 狩場の外側だけを作る景観。戦闘・当たり・採取・地図の座標は変更しない。
// 同じ格子を内側と外側へ分け、継ぎ目を共有する。外側を平らな草地として延長しない。
import { BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, DoubleSide } from 'three';
import { SeededRng } from '../core/seededRng';
import { AreaShape, type Pt } from '../game/areaShape';
import { reliefAt, type ReliefDef } from '../game/relief';
import type { FieldAreaDef } from '../data/schemas';
import { imageLambert, projectSurfaceUV, type ImageSurface } from './materialImages';
import { patchNoise } from './noise';
import { valueNoise3 } from './rockGeo';
import { SKY_LOOKS, type SkyLook } from './sky';
// v0.78.0（Claude。docs/spec.md の 21.7、D-178）: 木と岩の形・外側の地面の絵は、別のファイルが作る（ここは、置く場所と大きさ）
import { ExteriorFlora, ROCK_SLOPE_MAX, placeExteriorRock } from './exteriorFlora';
import { OUTER_TILE, outerGroundMaterial, outerPaint, outerSteep, paintsOuter } from './exteriorGround';
import { mergeRocks, rockArtMaterial, type RockPlacement } from './rockArt';

export type LandscapeStyle='meadow'|'forest'|'wetland'|'coast'|'alpine'|'canyon'|'cave'|'thermal'|'crystal';
type TreeStyle='broadleaf'|'pine'|'swamp'|'none';
type WaterStyle='none'|'sea'|'marsh';
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
 'field.whitefrost':['alpine',{floor:'frost_snow',floorColor:0xe2edf2,land:0xd3e4ed,rock:0x90b4ce,foliage:0x809b9e,trees:46,stones:80,cover:.025,ridge:27,peak:61,wall:6.6,fog:.0145,sky:SKY(0x88afcf,0xd2e5ef,.48,0xe6faff)}],
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
export interface LandscapeProfile extends ProfileSeed {fieldId:string;areaId:string;seed:number;viewAngle:number}
export const FIELD_LANDSCAPE_IDS=Object.keys(REGIONS);
export function landscapeProfile(fieldId:string,area:Pick<FieldAreaDef,'id'|'name'|'kind'|'size'>):LandscapeProfile{
 const [style,over]=REGIONS[fieldId]??['meadow',{}];
 let seed=2166136261;for(const s of fieldId+':'+area.id)seed=Math.imul(seed^s.charCodeAt(0),16777619)>>>0;
 const rng=new SeededRng(seed),p={...BASE[style],...over,fieldId,areaId:area.id,seed,viewAngle:rng.next()*Math.PI*2};
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
 if(fieldId==='field.whitefrost'){
  if(area.id==='a3'||area.id==='a7'){p.floor='frost_ice';p.floorColor=0xb2d7ee;p.land=0xd5e7ef;p.water='marsh';p.waterColor=0x6296b4;p.trees=22;}
  if(area.id==='a4'){p.floor='frost_ice';p.floorColor=0x90c1df;p.rock=0x5e8eae;p.wall=9;p.ridge=37;p.trees=0;p.tree='none';p.fog=.018;}
  if(area.id==='a6'){p.ridge=36;p.peak=77;p.trees=20;p.fog=.019;p.sky=SKY(0x9fbfda,0xdceaf3,.32,0xe5f6ff);}
  if(area.kind==='nest'){p.wall=8;p.floorColor=0xc1dce9;p.rock=0x7eadd1;p.trees=0;p.tree='none';}
 }
 return p;
}
export interface LandscapeInput{
 bounds:{minX:number;maxX:number;minZ:number;maxZ:number};shape?:readonly Pt[];relief?:ReliefDef;
 gates?:readonly {x:number;z:number;marker?:boolean}[]; profile:LandscapeProfile;
}
type Gate={x:number;z:number;nx:number;nz:number;bend:number};
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
 const gates=(input.gates??[]).map(g=>{const n=outline.outwardAt(g.x,g.z);return{x:g.x,z:g.z,nx:n.x,nz:n.z,bend:rng.next()<.5?-1:1};});
 const xs=gridAxis(b.minX,b.maxX,input.relief?2:3),zs=gridAxis(b.minZ,b.maxZ,input.relief?2:3),nx=xs.length,nz=zs.length,N=nx*nz;
 const ds=new Float32Array(N),ys=new Float32Array(N),locked=new Uint8Array(N);
 const ni:number[]=[],oi:number[]=[];
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)ds[j*nx+i]=distance(xs[i]!,zs[j]!);
 const tri=(a:number,b:number,c:number)=>{if(Math.min(ds[a]!,ds[b]!,ds[c]!)<=1.65){ni.push(a,b,c);locked[a]=locked[b]=locked[c]=1;}else oi.push(a,b,c);};
 for(let j=0;j<nz-1;j++)for(let i=0;i<nx-1;i++){const a=j*nx+i,bb=a+1,c=a+nx,d=c+1;tri(a,c,bb);tri(bb,c,d);}
 const waterY=-1.4;
 const gateBlend=(x:number,z:number):number=>{
  let v=0;
  for(const g of gates){const dx=x-g.x,dz=z-g.z,a=dx*g.nx+dz*g.nz,side=Math.abs(dx*g.nz-dz*g.nx-g.bend*4*smooth(5,21,a));
   if(a>=-1&&a<25)v=Math.max(v,(1-smooth(2.6,6.2,side))*(1-smooth(18,25,a)));
  }
  return v;
 };
 let outerMin=Infinity,outerMax=-Infinity;
 for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
  const k=j*nx+i,x=xs[i]!,z=zs[j]!,d=ds[k]!,base=reliefAt(input.relief,x,z);
  if(locked[k]||d<=3.2){ys[k]=base;continue;}
  const a=Math.atan2(z-z0,x-x0),open=smooth(.14,.94,Math.cos(a-p.viewAngle)),n=noise(x*.62+47,z*.62-93),broad=noise2(x*.013,2.7,z*.013),crag=noise2(x*.065,9.4,z*.065);
  const ridge=(.50+.85*n)*p.ridge*(1-.63*open)*smooth(3.2,17,d);
  const range=p.peak*(.13+.77*broad)*smooth(15,83,d);
  let height=ridge+range+crag*3.3*smooth(8,24,d)-2*open*smooth(5,28,d);
  if(p.water==='sea'){
   const seaward=smooth(-.22,.48,Math.cos(a-p.viewAngle));
   height=lerp(height,-4.4-2.5*broad,seaward*smooth(3.2,19,d));
  }else if(p.water==='marsh'){
   const channel=smooth(.45,.75,noise2(x*.038,0.5,z*.038))*(.48+.52*open);
   height=lerp(height,-3.0-2*crag,channel*smooth(4,17,d));
  }
  // 出口の先は岩・樹林へ折れる緩やかな道。手前の15mを遮らず、遠くで地形へ溶かす。
  height=lerp(height,.28+Math.min(2.0,d*.065),gateBlend(x,z));
  ys[k]=base+height*smooth(3.2,7.5,d);
  outerMin=Math.min(outerMin,ys[k]!);outerMax=Math.max(outerMax,ys[k]!);
 }
 const land=new Color(p.land),rock=new Color(p.rock),fog=new Color(p.sky.horizon),temp=new Color();
 // v0.78.0: 盆地の外側は、内側と同じ地面の絵を貼る（色は、絵に掛ける倍率。src/render/exteriorGround.ts）
 const paint=paintsOuter(p)?outerPaint(p,BASE.meadow.land):null,tile=paint?OUTER_TILE:9;
 const geo=(indices:number[],type:'near'|'outer'|'water'):BufferGeometry=>{
  const verts:number[]=[],uv:number[]=[],cols:number[]=[],steeps:number[]=[],index:number[]=[],remap=new Map<number,number>();
  for(const k of indices){let m=remap.get(k);if(m===undefined){
   m=verts.length/3;remap.set(k,m);const i=k%nx,j=Math.floor(k/nx),x=xs[i]!,z=zs[j]!,y=type==='water'?waterY:ys[k]!;
   verts.push(x,y,z);uv.push(x/(type==='water'?12:tile),-z/(type==='water'?12:tile));
   if(type==='outer'){
    const lx=Math.max(0,i-1),rx=Math.min(nx-1,i+1),lz=Math.max(0,j-1),rz=Math.min(nz-1,j+1);
    const slope=Math.hypot((ys[j*nx+rx]!-ys[j*nx+lx]!)/(xs[rx]!-xs[lx]!||1),(ys[rz*nx+i]!-ys[lz*nx+i]!)/(zs[rz]!-zs[lz]!||1));
    const blend=Math.max(0,Math.min(1,slope*.58+noise(x+18,z+37)*.47-(p.style==='forest'?.21:0)));
    if(paint){paint(temp,noise(x,z),blend,smooth(123,190,ds[k]!)*.54);steeps.push(outerSteep(slope));}
    else{
     temp.copy(land).lerp(rock,blend).multiplyScalar(.77+noise(x,z)*.42);
     if(p.water!=='none'&&y<waterY+.55)temp.lerp(rock,.42);
     temp.lerp(fog,smooth(123,190,ds[k]!)*.54);
    }
    cols.push(temp.r,temp.g,temp.b);
   }
  }index.push(m);}
  const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(verts,3));g.setAttribute('uv',new Float32BufferAttribute(uv,2));if(type==='outer')g.setAttribute('color',new Float32BufferAttribute(cols,3));if(type==='outer'&&paint)g.setAttribute('aSteep',new Float32BufferAttribute(steeps,1));g.setIndex(index);g.computeVertexNormals();g.computeBoundingSphere();return g;
 };
 const wi:number[]=[];
 if(p.water!=='none')for(let i=0;i<oi.length;i+=3){
  const a=oi[i]!,bb=oi[i+1]!,c=oi[i+2]!;
  if(Math.min(ds[a]!,ds[bb]!,ds[c]!)>4.2&&Math.min(ys[a]!,ys[bb]!,ys[c]!)<waterY+.02)wi.push(a,bb,c);
 }
 const near=geo(ni,'near'),outer=geo(oi,'outer'),water=wi.length?geo(wi,'water'):null;
 const height=(x:number,z:number):number=>{
  const i=upperIndex(xs,x),j=upperIndex(zs,z),a=j*nx+i,bb=a+1,c=a+nx,d=c+1;
  const u=Math.max(0,Math.min(1,(x-xs[i]!)/(xs[i+1]!-xs[i]!))),v=Math.max(0,Math.min(1,(z-zs[j]!)/(zs[j+1]!-zs[j]!)));
  return u+v<=1?ys[a]!+(ys[bb]!-ys[a]!)*u+(ys[c]!-ys[a]!)*v:ys[d]!+(ys[c]!-ys[d]!)*(1-u)+(ys[bb]!-ys[d]!)*(1-v);
 };
 return{near,outer,water,outline,distance,height,gates,metrics:{nearTriangles:ni.length/3,outerTriangles:oi.length/3,outerMin,outerMax,sharedVertices:[...new Set(oi)].filter(i=>locked[i]).length}};
}

/** 斜面の一番低い側まで根を埋める。木の根元・露岩に共通。 */
function groundedBase(s:LandscapeSurface,x:number,z:number,r:number):number{let y=s.height(x,z);for(let i=0;i<8;i++){const a=i*Math.PI/4;y=Math.min(y,s.height(x+Math.cos(a)*r,z+Math.sin(a)*r));}return y;}
function isGateClear(s:LandscapeSurface,x:number,z:number,r:number):boolean{
 return s.gates.every(g=>{const dx=x-g.x,dz=z-g.z,a=dx*g.nx+dz*g.nz,side=Math.abs(dx*g.nz-dz*g.nx-g.bend*4*smooth(5,21,a));return !(a> -2&&a<24&&side<5.3+r);});
}
function trailGeometry(s:LandscapeSurface):BufferGeometry{
 const pos:number[]=[],uv:number[]=[],idx:number[]=[];
 for(const g of s.gates){
  let prev=-1;
  for(let a=4.2;a<=24;a+=1.5){
   const bend=g.bend*4*smooth(5,21,a),w=lerp(2.45,.16,smooth(6,24,a))*(.94+.08*Math.sin(a*1.7+g.x));
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
  const h=(17+p.peak*(.42+f*.85)+f2*11)*(1-.42*open)*(1-.67*sea);
  for(const [rad,y,t] of [[r-12,-12,0],[r,h,1],[r+23,-14,0]] as const){
   vertices.push(xc+x*rad,y,zc+z*rad);c.copy(sky).lerp(shade,t*(layer?.16:.27)*(.7+f*.5));colors.push(c.r,c.g,c.b);
  }
  if(i<N)for(let j=0;j<2;j++){const a=i*3+j,b=a+3;idx.push(a,b,a+1,a+1,b,b+1);}
 }
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(vertices,3));g.setAttribute('color',new Float32BufferAttribute(colors,3));g.setIndex(idx);g.computeVertexNormals();
 const m=new Mesh(g,new MeshBasicMaterial({vertexColors:true,side:DoubleSide,fog:false}));m.name='field-distant-ridge-'+layer;m.userData.noMerge=true;return m;
}
export function buildLandscapeExterior(input:LandscapeInput,s:LandscapeSurface):Group{
 const p=input.profile,b=input.bounds,rng=new SeededRng(p.seed^0xa142c),noise=patchNoise(p.seed^8873),group=new Group();group.name='field-natural-exterior';
 const surface=paintsOuter(p)?outerGroundMaterial():imageLambert(p.fieldId==='field.whitefrost'?'frost_snow':p.style==='forest'?'moss':p.style==='meadow'?'grass':p.style==='wetland'?'earth':'cliff',{color:0xffffff,vertexColors:true},{gain:1.12});
 const ground=new Mesh(s.outer,surface);ground.name='field-exterior-relief';ground.userData.noMerge=true;group.add(ground);
 if(s.water){const water=new Mesh(s.water,imageLambert('water',{color:p.waterColor,transparent:true,opacity:.92,side:DoubleSide},{raw:true,gain:.93}));water.name='field-exterior-water';water.userData.noMerge=true;group.add(water);}
 const trail=trailGeometry(s);
 if(trail.getIndex()!.count){const path=new Mesh(trail,imageLambert('earth',{color:p.style==='alpine'?0xc9d4d4:0x948571,side:DoubleSide},{gain:1.1}));path.name='field-exit-continuation';path.userData.noMerge=true;group.add(path);}else trail.dispose();
 group.add(distantRidge(input,0),distantRidge(input,1));
 const rocks:RockPlacement[]=[],treeSites:{x:number;z:number}[]=[];
 const flora=p.tree==='none'?null:new ExteriorFlora({seed:p.seed,tree:p.tree,foliage:p.foliage,dense:p.trees>90});
 const w=b.maxX-b.minX,d=b.maxZ-b.minZ;
 // 地形に追従する不規則な樹林。描画専用の大きな物は境界の外だけ。
 for(let i=0,tries=0;flora&&i<p.trees&&tries<p.trees*45;tries++){
  const x=b.minX-78+rng.next()*(w+156),z=b.minZ-78+rng.next()*(d+156),dist=s.distance(x,z);
  const near=dist<37,rad=p.tree==='pine'?2.4:3.4;
  if(dist<4.4+rad||dist>99||!isGateClear(s,x,z,rad)||rng.next()>.32+.68*noise(x,z)||treeSites.some(t=>Math.hypot(x-t.x,z-t.z)<(near?4.0:5.7)))continue;
  const y=s.height(x,z);if(p.water!=='none'&&y<-.9)continue;
  const h=(p.tree==='pine'?8:p.tree==='swamp'?7.3:10)*(0.65+rng.next()*.9)*(near?1:1.12);
  const shade=.78+rng.next()*.35,yaw=rng.next()*6.283;treeSites.push({x,z});i++;
  // v0.78.0: 1 本の形（幹・枝・葉のかたまり・葉の板。針葉樹は傘の段）は src/render/exteriorFlora.ts
  flora.tree(rng,{x,z,ground:y,root:groundedBase(s,x,z,h*.06),h,yaw,shade});
 }
 // v0.78.0: 岩は、エリアの中の岩と同じ図（依頼 10）を、斜面へ傾けて、根元を地面より下へ埋める（それまでは、いびつな球を斜面に置いていて、下の側が浮いて見えた）
 // 狩場ごとの岩の色（景観の定義の rock）は、盆地の岩の色からの倍率にして、少しだけ効かせる（図の色は、どの狩場も同じ。氷の素材には掛けない）
 const frost=p.fieldId==='field.whitefrost',base=new Color(BASE.meadow.rock),want=new Color(p.rock);
 const hue=[want.r/base.r,want.g/base.g,want.b/base.b].map(v=>frost?1:Math.max(.78,Math.min(1.3,1+(v-1)*.5)));
 const crag=p.style==='canyon'||p.style==='cave'||p.style==='alpine';let steep=0;
 for(let i=0,tries=0;i<p.stones&&tries<p.stones*25;tries++){
  const x=b.minX-63+rng.next()*(w+126),z=b.minZ-63+rng.next()*(d+126),dist=s.distance(x,z),rad=1.6+rng.next()*4.8;
  if(dist<3.7+rad||dist>88||!isGateClear(s,x,z,rad))continue;
  const y=s.height(x,z);if(p.water!=='none'&&y<-2.8)continue;
  const h=rad*(crag?1.1+rng.next()*1.4:.48+rng.next()*.75),k=.84+rng.next()*.26;
  const rock=placeExteriorRock(rng,s.height,{x,z,rad,h,dist,tall:crag&&h>rad*1.9,tint:[hue[0]!*k,hue[1]!*k,hue[2]!*k]});
  // 急な斜面（35° より急）には置かない（試す回数の 8 割まで。それでも足りなければ置く）
  if(rock.slope>ROCK_SLOPE_MAX){if(tries<p.stones*20)continue;steep++;}
  rocks.push(rock);i++;
 }
 flora?.addTo(group);
 if(rocks.length){
  const geo=mergeRocks(rocks);
  // 白霧氷谷は、エリアの中の岩と同じ氷の素材
  const stone=new Mesh(frost?projectSurfaceUV(geo,4):geo,frost?imageLambert('frost_ice',{color:0xa6bfd3,vertexColors:true},{gain:1.06}):rockArtMaterial());
  stone.name='field-exterior-rocks';stone.userData.noMerge=true;stone.userData.rocks=rocks.map(r=>({id:r.id,x:r.x,y:r.y??0,z:r.z,lod:r.lod??1}));group.add(stone);
 }
 group.userData.landscape={fieldId:p.fieldId,areaId:p.areaId,style:p.style,trees:treeSites.length,rocks:rocks.length,steepRocks:steep,water:!!s.water,gates:s.gates.length,...s.metrics};
 return group;
}
