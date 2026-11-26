// 灯継ぎの里：家具、畜産、専用採集区画の正本。描画と保存が同じ寸法を使う。
export const FURNITURE={
 bed:{name:'寝台',w:1.50,d:2.15,h:1.05,cost:0},desk:{name:'文机',w:1.45,d:.78,h:.85,cost:0},
 chest:{name:'収納箱',w:1.30,d:.64,h:.72,cost:0},rack:{name:'装備展示台',w:1.35,d:1.05,h:1.85,cost:0},
 shelf:{name:'資料棚',w:1.30,d:.48,h:1.80,cost:0},chair:{name:'腰掛け',w:.48,d:.48,h:.82,cost:0},
 rug:{name:'敷物',w:1.8,d:1.2,h:.02,cost:0},lamp:{name:'青銅の灯',w:.40,d:.40,h:1.38,cost:0},
 screen:{name:'衝立',w:1.45,d:.27,h:1.50,cost:0},planter:{name:'植木鉢',w:.42,d:.42,h:.72,cost:0},
 bench:{name:'長椅子',w:1.24,d:.43,h:.48,cost:0},table:{name:'丸卓',w:.94,d:.94,h:.72,cost:0}
} as const;
export type FurnitureKind=keyof typeof FURNITURE;
export type FurniturePlacement={id:string;kind:FurnitureKind;x:number;z:number;yaw:number;finish:0|1|2};
export const ROOM_BOUNDS={minX:-3.8,maxX:3.8,minZ:-3.25,maxZ:3.25};
export const ROOM_ENTRY={x:0,z:2.35};
export const FURNITURE_MAX=24;
export function defaultFurniture(layout:'left'|'right'='left'):FurniturePlacement[]{
 const sign=layout==='right'?-1:1;
 return [
 {id:'bed',kind:'bed',x:-2.55*sign,z:-1.65,yaw:0,finish:0},
 {id:'desk',kind:'desk',x:2.5*sign,z:-2.45,yaw:0,finish:0},
 {id:'chest',kind:'chest',x:-2.5*sign,z:2.30,yaw:0,finish:0},
 {id:'rack',kind:'rack',x:2.6*sign,z:.5,yaw:0,finish:0},
 {id:'rug',kind:'rug',x:0,z:-.3,yaw:0,finish:0},
 {id:'lamp',kind:'lamp',x:-.85*sign,z:-2.75,yaw:0,finish:0}
 ];
}
type XZ={x:number;z:number};
const validKind=(v:unknown):v is FurnitureKind=>typeof v==='string'&&Object.prototype.hasOwnProperty.call(FURNITURE,v);
const number=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const solid=(p:FurniturePlacement)=>p.kind!=='rug';
function axes(p:FurniturePlacement):[XZ,XZ]{const c=Math.cos(p.yaw),s=Math.sin(p.yaw);return [{x:c,z:-s},{x:s,z:c}]}
function extent(p:FurniturePlacement,axis:XZ,margin=0):number{
 const [a,b]=axes(p),d=FURNITURE[p.kind];
 return (d.w/2+margin)*Math.abs(a.x*axis.x+a.z*axis.z)+(d.d/2+margin)*Math.abs(b.x*axis.x+b.z*axis.z);
}
export function furnitureOverlap(a:FurniturePlacement,b:FurniturePlacement):boolean{
 if(!solid(a)||!solid(b))return false;
 return [...axes(a),...axes(b)].every(u=>Math.abs((a.x-b.x)*u.x+(a.z-b.z)*u.z)<extent(a,u,.035)+extent(b,u,.035));
}
export function furnitureBlocks(p:FurniturePlacement,x:number,z:number,r=.25):boolean{
 if(!solid(p))return false;
 const [a,b]=axes(p),dx=x-p.x,dz=z-p.z,d=FURNITURE[p.kind];
 const u=Math.abs(dx*a.x+dz*a.z),v=Math.abs(dx*b.x+dz*b.z);
 return Math.hypot(Math.max(0,u-d.w/2),Math.max(0,v-d.d/2))<r;
}
export function furnitureErrors(raw:unknown):string[]{
 if(!Array.isArray(raw)||raw.length>FURNITURE_MAX)return ['家具は24点までです'];
 const rows:FurniturePlacement[]=[];const ids=new Set<string>();
 for(const v of raw){
  if(!v||typeof v!=='object'||Array.isArray(v))return ['家具データの形式が不正です'];
  const p=v as Record<string,unknown>;
  if(typeof p.id!=='string'||!/^[a-zA-Z0-9_-]{1,40}$/.test(p.id)||ids.has(p.id)||!validKind(p.kind)||!number(p.x)||!number(p.z)||!number(p.yaw)||p.yaw<0||p.yaw>=Math.PI*2+.000001||![0,1,2].includes(p.finish as number))return ['家具の識別子・位置・角度が不正です'];
  ids.add(p.id);const item=p as FurniturePlacement;
  const hx=extent(item,{x:1,z:0}),hz=extent(item,{x:0,z:1});
  if(item.x-hx<ROOM_BOUNDS.minX||item.x+hx>ROOM_BOUNDS.maxX||item.z-hz<ROOM_BOUNDS.minZ||item.z+hz>ROOM_BOUNDS.maxZ)return [FURNITURE[item.kind].name+'が壁にはみ出しています'];
  // 扉の前に歩ける空間を残す。回転を含めて判定。
  for(const z of [2.05,2.35,2.70,3.0])if(furnitureBlocks(item,0,z,.60))return ['入口を塞がないでください'];
  if(rows.some(o=>furnitureOverlap(o,item)))return [FURNITURE[item.kind].name+'が他の家具と重なっています'];
  rows.push(item);
 }
 // 入口から各家具のそばに到達可能であることを粗いグリッドで確認（配置時のみ）。
 const step=.25,nx=29,nz=25,start={x:14,z:21},seen=new Set<number>(),queue=[start];
 const free=(ix:number,iz:number)=>ix>=0&&ix<nx&&iz>=0&&iz<nz&&!rows.some(p=>furnitureBlocks(p,-3.5+ix*step,-3+iz*step,.24));
 if(!free(start.x,start.z))return ['入口から移動できません'];
 while(queue.length){const a=queue.pop()!,key=a.x+a.z*nx;if(seen.has(key)||!free(a.x,a.z))continue;seen.add(key);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])queue.push({x:a.x+dx!,z:a.z+dz!});}
 if(seen.size<50||!Array.from(seen).some(i=>Math.floor(i/nx)<8))return ['部屋の奥への通路を確保してください'];
 return [];
}
export const roomFurniture=(s:{furniture?:FurniturePlacement[];roomLayout?:'left'|'right'}):FurniturePlacement[]=>s.furniture??defaultFurniture(s.roomLayout);
export const ANIMALS={
 goat:{name:'ヤマツノ山羊',description:'岩場を歩く小型の山羊。毛を刈り取らず、換毛期の抜け毛を集める。',price:180,feed:'mat.gather.flatnagi_leaf',product:'mat.hub.yamatsuno_wool',yield:2},
 hen:{name:'アシハネ鶏',description:'沢辺の草の実をついばむ小型の鳥。巣箱から卵を集める。',price:100,feed:'mat.gather.dewbreak_fruit',product:'mat.hub.ashihane_egg',yield:2},
 ox:{name:'コブヤギ荷獣',description:'里の荷運びを支える短角の家畜。自然に落ちた角質を集める。',price:350,feed:'mat.gather.flatnagi_leaf',product:'mat.hub.packbeast_sheath',yield:1}
} as const;
export type AnimalKind=keyof typeof ANIMALS;
export type AnimalState={count:number;fedCycle:number|null;lastHarvest:number};
export type Livestock=Partial<Record<AnimalKind,AnimalState>>;
export function livestockErrors(raw:unknown):string[]{
 if(raw===undefined)return [];
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return ['家畜の保存形式が不正です'];
 for(const [k,a] of Object.entries(raw)){
  if(!Object.prototype.hasOwnProperty.call(ANIMALS,k)||!a||typeof a!=='object')return ['家畜の種類が不正です'];
  const v=a as Record<string,unknown>;
  if(!Number.isInteger(v.count)||Number(v.count)<1||Number(v.count)>3||!(v.fedCycle===null||(Number.isSafeInteger(v.fedCycle)&&Number(v.fedCycle)>=0))||!Number.isSafeInteger(v.lastHarvest)||Number(v.lastHarvest)<-1)return ['家畜の数・給餌記録が不正です'];
 }
 return [];
}
export type ZoneId='mine'|'pond'|'home';
export interface ZoneRect {x0:number;x1:number;z0:number;z1:number;level:number}
export interface ZoneNode {id:string;name:string;x:number;z:number;level:number}
export interface GatherZone {id:'mine'|'pond';name:string;spawn:XZ;bounds:ZoneRect;regions:ZoneRect[];nodes:ZoneNode[]}
export const ZONES:Record<'mine'|'pond',GatherZone>={
 mine:{id:'mine',name:'灰層の坑道',spawn:{x:0,z:7},bounds:{x0:-17,x1:13,z0:-20,z1:10,level:1},regions:[
  {x0:-2.1,x1:2.1,z0:-11,z1:9,level:1},{x0:-6,x1:6,z0:-16,z1:-8,level:1},
  {x0:5,x1:12,z0:-15,z1:-9,level:2},{x0:-11,x1:-5,z0:-15,z1:-11,level:3},{x0:-16,x1:-10,z0:-19,z1:-10,level:3},
  {x0:-16,x1:-9,z0:-20,z1:-17,level:4}],nodes:[
  {id:'near',name:'風礫鉄の鉱脈',x:-4.65,z:-10.2,level:1},{id:'wall',name:'層灰石の岩壁',x:4.8,z:-14.2,level:1},
  {id:'branch',name:'支坑の露出鉱',x:10,z:-12,level:2},{id:'deep',name:'深層の晶脈',x:-13.5,z:-12,level:3},{id:'vein',name:'最深部の晶脈',x:-13.5,z:-18.6,level:4}]},
 pond:{id:'pond',name:'沢鏡の養魚池',spawn:{x:0,z:8.2},bounds:{x0:-12,x1:12,z0:-14,z1:10,level:1},regions:[
  {x0:-11,x1:11,z0:3,z1:10,level:1},{x0:-11,x1:-7,z0:-8,z1:4,level:1},{x0:7,x1:11,z0:-8,z1:4,level:1},
  {x0:-11,x1:11,z0:-13,z1:-8,level:1},{x0:-1.6,x1:1.6,z0:-1,z1:4,level:2},
  {x0:-9,x1:9,z0:-8.8,z1:-7.5,level:3},{x0:6,x1:9,z0:-7.8,z1:-3,level:4}],nodes:[
  {id:'bank',name:'浅瀬の釣り場',x:-8.1,z:-1.5,level:1},{id:'deepbank',name:'沢の流入口',x:8.4,z:-5.1,level:1},
  {id:'pier',name:'木桟橋',x:0,z:-.2,level:2},{id:'rear',name:'養魚いけす',x:0,z:-9.5,level:3},{id:'large',name:'大型魚の入り江',x:7.8,z:-4.1,level:4}]}
};
export function zoneContains(zone:GatherZone,x:number,z:number,level:number):boolean{
 return zone.regions.some(r=>level>=r.level&&x>=r.x0&&x<=r.x1&&z>=r.z0&&z<=r.z1);
}
export function zoneWalkable(zone:GatherZone,x:number,z:number,level:number,r=.26):boolean{
 return [[0,0],[r,0],[-r,0],[0,r],[0,-r],[r*.71,r*.71],[-r*.71,r*.71],[r*.71,-r*.71],[-r*.71,-r*.71]].every(([a,b])=>zoneContains(zone,x+a!,z+b!,level));
}
export function zoneNodeNear(zone:GatherZone,x:number,z:number,level:number):ZoneNode|undefined{
 return zone.nodes.filter(n=>n.level<=level&&Math.hypot(n.x-x,n.z-z)<1.45).sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
}
