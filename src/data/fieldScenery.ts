// 描画専用。狩場の物理データは変更しない。
import type { FieldDef } from './schemas';
export const GEOLOGIES=['layered','mudbank','sea_stack','strata','glacial','mossrock','thermal','terrace','gravelbank','shale'] as const;
export type Geology=typeof GEOLOGIES[number];
export type Vegetation='woodland'|'pine'|'wetland'|'sparse'|'none';
export type SceneryWater='none'|'sea'|'marsh'|'stream';
export interface ScenerySector {azimuthDeg:number;mode:'ridge'|'slope'|'escarpment'|'valley'|'vista'|'sea';ridgeScale:number;peakScale:number;dropM:number;vegetation:number}
export interface SceneryGate {toAreaId:string;anchorKey:string;geology:Geology;vegetation:Vegetation;widthM:number;bendM:number;colorVariation:number}
export interface SceneryArea {fieldId:string;areaId:string;name:string;theme:string;landmark:string;geology:Geology;vegetation:Vegetation;water:SceneryWater;waterY:number;seaAngle:number;sectors:ScenerySector[];gates:SceneryGate[];featureSeed:number}
export interface SceneryDocument {schemaVersion:number;areas:SceneryArea[]}
export const sceneryKey=(fieldId:string,areaId:string):string=>fieldId+'/'+areaId;
export function assembleScenery(docs:SceneryDocument[],fields:Map<string,FieldDef>,errors:string[]):Map<string,SceneryArea>{
 const result=new Map<string,SceneryArea>();
 for(const d of docs){
  if(d.schemaVersion!==1||!Array.isArray(d.areas)){errors.push('field scenery: schema/areas invalid');continue;}
  for(const a of d.areas){
   const key=sceneryKey(a.fieldId,a.areaId),field=fields.get(a.fieldId),area=field?.areas.find(x=>x.id===a.areaId);
   if(!area||result.has(key)){errors.push('field scenery: unknown/duplicate '+key);continue;}
   result.set(key,a);
   if(!a.theme||!a.landmark||!GEOLOGIES.includes(a.geology)||!['woodland','pine','wetland','sparse','none'].includes(a.vegetation)||!['none','sea','marsh','stream'].includes(a.water)||!Number.isInteger(a.featureSeed)||!Number.isFinite(a.seaAngle)||!Number.isFinite(a.waterY)||a.waterY < -12||a.waterY>3)errors.push('field scenery: invalid profile '+key);
   if(!Array.isArray(a.sectors)||a.sectors.length!==8||a.sectors.some((s,i)=>s.azimuthDeg!==i*45||!['ridge','slope','escarpment','valley','vista','sea'].includes(s.mode)||!Number.isFinite(s.ridgeScale)||s.ridgeScale<0||s.ridgeScale>3||!Number.isFinite(s.peakScale)||s.peakScale<0||s.peakScale>3||!Number.isFinite(s.dropM)||s.dropM<0||s.dropM>15||!Number.isFinite(s.vegetation)||s.vegetation<0||s.vegetation>2))errors.push('field scenery: invalid sectors '+key);
   const gates=a.gates??[];
   if(gates.length!==area.exits.length||new Set(gates.map(g=>g.toAreaId)).size!==gates.length||area.exits.some(e=>!gates.some(g=>g.toAreaId===e.to)))errors.push('field scenery: incomplete exits '+key);
   for(const g of gates)if(g.anchorKey!==a.fieldId+':'+[a.areaId,g.toAreaId].sort().join('-')||!GEOLOGIES.includes(g.geology)||!Number.isFinite(g.widthM)||g.widthM<3||g.widthM>6||!Number.isFinite(g.bendM)||Math.abs(g.bendM)>8||!Number.isFinite(g.colorVariation)||g.colorVariation<.7||g.colorVariation>1.3)errors.push('field scenery: invalid anchor '+key+' '+g.toAreaId);
  }
 }
 for(const field of fields.values())for(const a of field.areas){
  const key=sceneryKey(field.id,a.id),v=result.get(key);
  if(!v){errors.push('field scenery: missing '+key);continue;}
  for(const g of v.gates??[]){const back=result.get(sceneryKey(field.id,g.toAreaId))?.gates.find(x=>x.toAreaId===a.id);
   if(!back||back.anchorKey!==g.anchorKey||back.geology!==g.geology||back.vegetation!==g.vegetation||back.widthM!==g.widthM||back.bendM!==g.bendM||back.colorVariation!==g.colorVariation)errors.push('field scenery: mismatched reciprocal anchor '+key+' '+g.toAreaId);
  }
 }
 return result;
}
export function sectorAt(a:SceneryArea|undefined,angle:number):{ridgeScale:number;peakScale:number;dropM:number;vegetation:number}{
 if(!a)return{ridgeScale:1,peakScale:1,dropM:0,vegetation:1};
 const i=((angle*4/Math.PI)%8+8)%8,k=Math.floor(i),t=i-k,u=t*t*(3-2*t),p=a.sectors[k]!,q=a.sectors[(k+1)%8]!;
 return {ridgeScale:p.ridgeScale+(q.ridgeScale-p.ridgeScale)*u,peakScale:p.peakScale+(q.peakScale-p.peakScale)*u,dropM:p.dropM+(q.dropM-p.dropM)*u,vegetation:p.vegetation+(q.vegetation-p.vegetation)*u};
}
