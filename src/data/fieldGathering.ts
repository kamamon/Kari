import type { ActionDef, ArmorDef, Content, MaterialDef, QuestDef, RecipeDef, SkillDef, WeaponDef } from './schemas';
import { AreaShape } from '../game/areaShape';
import { reliefAt } from '../game/relief';

export const FIELD_GATHER_KINDS = ['mine','bone','plant','insect','fish'] as const;
export type FieldGatherKind = typeof FIELD_GATHER_KINDS[number];
export const FIELD_GATHER_LABEL: Record<FieldGatherKind,string> = { mine:'採掘', bone:'骨採取', plant:'植物採取', insect:'虫取り', fish:'釣り' };
export interface FieldGatherNode { id:string; areaId:string; kind:FieldGatherKind; x:number; z:number; quality:'ordinary'|'deep'; uses:number; }
export interface FieldGatherMaterial extends MaterialDef { rarity:number; sourceKind:FieldGatherKind; firstRankId:string; rarityRole:string; }
export interface FieldGatherEntry { itemId:string; weightBps:number; minCount:number; maxCount:number; }
export interface FieldGatherTable { id:string; nodeKind:FieldGatherKind; rankId:string; quality:'ordinary'|'deep'; entries:FieldGatherEntry[]; }
export interface FieldGatherPond { areaId:string; x:number; z:number; radius:number; waterY:number; depth:number; bank:{x:number;z:number}; terrainBlendM:number; }
export interface FieldGatherCatalog {
  schemaVersion:number; fieldId:string; pond:FieldGatherPond; nodes:FieldGatherNode[]; materials:FieldGatherMaterial[]; tables:FieldGatherTable[];
  weapons:WeaponDef[]; armor:ArmorDef[]; recipes:RecipeDef[]; actions:ActionDef[]; quests:QuestDef[];
  board:Content['board']['quests']; skills:SkillDef[]; toolCharges:{mine:number;insect:number}; fish:{biteFrom:number;biteTo:number};
}
export function usesFieldGather(c: Pick<Content,'fieldGathering'>, q: QuestDef): boolean {
  return !!c.fieldGathering && q.fieldId===c.fieldGathering.fieldId && (!q.gather || q.gather.fieldGathering===true);
}
export function fieldGatherMaterials(c: Pick<Content,'fieldGathering'>, q:QuestDef): string[] {
  return usesFieldGather(c,q) ? [...new Set(c.fieldGathering!.tables.filter(t=>t.rankId===q.rankId).flatMap(t=>t.entries.map(e=>e.itemId)))] : [];
}
/** 地形の高さの格子そのものを掘る。表示と衝突が同じ格子を使う。 */
export function carveGatherPond(c: Content, def:FieldGatherCatalog, errors:string[]):void {
  const f=c.fields.get(def.fieldId), p=def.pond;
  const a=f?.areas.find(a=>a.id===p.areaId), r=a?.relief;
  if (!a || !r || !a.shape || !(p.radius>1 && p.depth>0 && p.terrainBlendM>=r.step && Number.isFinite(p.waterY))) {
    errors.push('field gathering: 池の地形が無いか不正'); return;
  }
  const shape=new AreaShape(a.shape);
  if(shape.signedDistance(p.x,p.z)<p.radius+0.5 || shape.signedDistance(p.bank.x,p.bank.z)<1.6) { errors.push('field gathering: 池または岸が外周に近い'); return; }
  const h=r.h.slice();
  for(let j=0;j<r.nz;j++) for(let i=0;i<r.nx;i++){
    const x=r.x0+i*r.step,z=r.z0+j*r.step,d=Math.hypot(x-p.x,z-p.z);
    if(d>p.radius+p.terrainBlendM)continue;
    const old=h[j*r.nx+i]!/100;
    // 水面に向かって緩やかに下がる縁。外側にある元の斜面は削りすぎない。
    const floor=p.waterY-p.depth*Math.max(.15,1-d/p.radius);
    const t=d<=p.radius ? 1 : Math.max(0,1-(d-p.radius)/p.terrainBlendM);
    h[j*r.nx+i]=Math.round((old+(Math.min(old,floor)-old)*t)*100);
  }
  const next={...r,h};
  if(reliefAt(next,p.x,p.z)>=p.waterY) {errors.push('field gathering: 池底が水面より高い');return;}
  a.relief=next;
}
export function validateFieldGatherCatalog(c: Content, g:FieldGatherCatalog):string[] {
  const e:string[]=[]; const f=c.fields.get(g.fieldId);
  if(!f)return ['field gathering: field が無い'];
  const ids=new Set<string>(), materials=new Set(g.materials.map(m=>m.id));
  if(materials.size!==g.materials.length)e.push('field gathering: 素材 ID 重複');
  for(const m of g.materials){
    if(!FIELD_GATHER_KINDS.includes(m.sourceKind)||!c.ranks.has(m.firstRankId)||!Number.isInteger(m.rarity)||m.rarity<1||m.rarity>10)e.push('field gathering: 素材 '+m.id+' の定義が不正');
  }
  for(const n of g.nodes){
    if(ids.has(n.id))e.push('field gathering: 採取点 ID 重複 '+n.id);ids.add(n.id);
    const a=f.areas.find(a=>a.id===n.areaId);
    if(!a?.shape||!FIELD_GATHER_KINDS.includes(n.kind)||!['ordinary','deep'].includes(n.quality)||!Number.isInteger(n.uses)||n.uses<1||!Number.isFinite(n.x)||!Number.isFinite(n.z)){e.push('field gathering: 採取点 '+n.id+' の定義が不正');continue;}
    if(new AreaShape(a.shape).signedDistance(n.x,n.z)<1.6)e.push('field gathering: '+n.id+' は外周に近い');
    if(a.rocks.some(r=>Math.hypot(n.x-r.x,n.z-r.z)<r.r+1.2))e.push('field gathering: '+n.id+' は岩に近い');
    if(a.exits.some(r=>Math.hypot(n.x-r.x,n.z-r.z)<r.r+4))e.push('field gathering: '+n.id+' は出口に近い');
    if(n.kind==='fish'&&(n.areaId!==g.pond.areaId||Math.hypot(n.x-g.pond.bank.x,n.z-g.pond.bank.z)>0.2))e.push('field gathering: 釣り点は池の岸に置く');
  }
  const tableKeys=new Set<string>();
  for(const t of g.tables){
    const key=[t.nodeKind,t.rankId,t.quality].join('|');
    if(tableKeys.has(key))e.push('field gathering: 抽選表重複 '+key);tableKeys.add(key);
    if(!c.ranks.has(t.rankId)||!FIELD_GATHER_KINDS.includes(t.nodeKind)||!['ordinary','deep'].includes(t.quality)||t.entries.reduce((s,r)=>s+r.weightBps,0)!==10000)e.push('field gathering: 抽選表不正 '+t.id);
    for(const x of t.entries){
      const m=g.materials.find(m=>m.id===x.itemId),order=c.ranks.get(t.rankId)?.order??0;
      if(!m||m.sourceKind!==t.nodeKind||(c.ranks.get(m.firstRankId)?.order??Infinity)>order||!Number.isInteger(x.weightBps)||x.weightBps<=0||!Number.isInteger(x.minCount)||!Number.isInteger(x.maxCount)||x.minCount<1||x.maxCount<x.minCount)e.push('field gathering: 抽選素材不正 '+t.id+' '+x.itemId);
    }
  }
  for(const k of FIELD_GATHER_KINDS)for(const r of c.ranks.keys())for(const q of ['ordinary','deep'])if(!tableKeys.has([k,r,q].join('|')))e.push('field gathering: 抽選表不足 '+k+' '+r+' '+q);
  for(const r of g.recipes){
    const id=r.kind==='craft'||r.kind==='upgrade'?r.resultWeaponId:r.resultArmorId;
    const prefix=id.includes('.ore_only.')?'mat.ore.':id.includes('.bone_only.')?'mat.bone.':'';
    if(!prefix||!r.cost.items.every(x=>x.itemId.startsWith(prefix)&&materials.has(x.itemId)))e.push('field gathering: 純素材レシピでない '+r.id);
  }
  if(!Number.isInteger(g.toolCharges.mine)||g.toolCharges.mine<1||!Number.isInteger(g.toolCharges.insect)||g.toolCharges.insect<1||g.fish.biteFrom<1||g.fish.biteTo<=g.fish.biteFrom||g.fish.biteTo>216)e.push('field gathering: 道具・釣り時間が不正');
  return e;
}
