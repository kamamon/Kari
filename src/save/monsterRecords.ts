// 依頼を達成し、報酬と同じ保存トランザクションが成立した個体だけを記録する。
// 寸法は登録簿の基準体長×個体倍率。描画のAABBやカメラ距離で推定しない。
export interface IndividualRecord { speciesId:string; sizePct:number; outcome:'slay'|'capture' }
export interface SpeciesRecord { minPct:number; maxPct:number; slain:number; captured:number }
export type MonsterRecords=Record<string,SpeciesRecord>;
const isObj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const validPct=(v:unknown):v is number=>typeof v==='number'&&Number.isInteger(v)&&v>=92&&v<=112;
const validId=(v:unknown):v is string=>typeof v==='string'&&/^monster\.[a-z0-9_]+$/.test(v)&&v!=='monster.training_dummy';
const validCount=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=9999999;
export function monsterRecordErrors(raw:unknown):string[]{
 if(raw===undefined)return [];
 if(!isObj(raw))return ['狩猟個体記録の形式が不正'];
 const errors:string[]=[];
 for(const [id,r] of Object.entries(raw))if(!validId(id)||!isObj(r)||!validPct(r.minPct)||!validPct(r.maxPct)||r.minPct>r.maxPct||!validCount(r.slain)||!validCount(r.captured)||r.slain+r.captured===0)errors.push('個体記録 '+id+' が不正');
 return errors;
}
export function accumulateMonsterRecords(records:MonsterRecords|undefined,hunts:readonly IndividualRecord[]):MonsterRecords{
 const next:MonsterRecords={...records};
 for(const h of hunts){
  if(!validId(h.speciesId)||!validPct(h.sizePct)||(h.outcome!=='slay'&&h.outcome!=='capture'))continue;
  const old=Object.hasOwn(next,h.speciesId)?next[h.speciesId]:undefined;
  next[h.speciesId]={minPct:Math.min(old?.minPct??h.sizePct,h.sizePct),maxPct:Math.max(old?.maxPct??h.sizePct,h.sizePct),slain:Math.min(9999999,(old?.slain??0)+(h.outcome==='slay'?1:0)),captured:Math.min(9999999,(old?.captured??0)+(h.outcome==='capture'?1:0))};
 }
 return next;
}
export function recordSizeText(record:SpeciesRecord,baseMeters:number|undefined):string{
 const fmt=(p:number)=>baseMeters&&Number.isFinite(baseMeters)&&baseMeters>0?(baseMeters*p/100).toFixed(2)+'m':p+'%';
 return '最小 '+fmt(record.minPct)+(record.minPct<=95?'〔小型記録〕':'')+' / 最大 '+fmt(record.maxPct)+(record.maxPct>=109?'〔大型記録〕':'');
}
