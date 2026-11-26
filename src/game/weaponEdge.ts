// 斬れ味分布は武器ごと。原作の値ではなくKariの初期調整値。
import type { Content, EdgeRules, WeaponDef, WeaponEdgeProfile } from '../data/schemas';
export function weaponEdgeProfile(w: WeaponDef): WeaponEdgeProfile | undefined {
  if (w.edgeProfile) return w.edgeProfile;
  if (w.family === 'ring_bow' || w.starter) return undefined;
  const familyWear: Record<string, number> = {heavy_blade:1.6,guard_blade:1.5,war_maul:1.3,twin_blades:1.2,long_blade:1.6,long_lance:1.4};
  const wear = familyWear[w.family];
  if (wear === undefined) return undefined;
  const legacy = /^weapon\.[^.]+\.(\d{3})$/.exec(w.id);
  const rank = Math.max(1, Math.min(4, Number(w.rankId?.split('.').pop() ?? (legacy ? Math.max(1, Number(legacy[1])-1) : 1)) || 1));
  let hash=2166136261;
  for(const c of w.series??w.id) hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
  const max=100+(rank-1)*8;
  const keen=Math.max(34, Math.round(max*(.58-(rank-1)*.065)+((hash%9)-4)));
  const worn=Math.max(12,Math.round(max*.23+((hash>>>8)%7)-3));
  return {max,keen:Math.max(worn+5,keen),worn,wearPerHit:wear};
}
export function weaponEdgeRules(c: Pick<Content,'edge'|'weapons'|'families'>, weaponId:string): EdgeRules {
  const w=c.weapons.get(weaponId);
  if(!w||!c.families.get(w.family)?.edge)return c.edge;
  const p=weaponEdgeProfile(w);
  if(!p||c.edge.stages.length!==3)return c.edge;
  return {...c.edge,max:p.max,stages:c.edge.stages.map((s,i)=>({...s,min:i===0?p.keen:i===1?p.worn:0,elementScale:i===0?1:i===1?.84:.60}))};
}
