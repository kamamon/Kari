// 拠点の採集は狩場の採集表を再利用する。採取量と作付けの状態は保存済み claims に格納。
import type { Content } from '../data/schemas';
import type { FieldGatherKind } from '../data/fieldGathering';
import { SeededRng } from '../core/seededRng';
import { cloneSave, MAX_COUNT, RuleError, type SaveDoc } from '../save/profile';
import { nearestFacility } from './hub';
import type { World } from './world';
import type { V3 } from '../core/math';

export interface HubResourcePoint {
  id: string; name: string; kind: FieldGatherKind; x: number; z: number; r: number; uses: number; floor: number;
}
/** 既存の5段の床と当たりの空き位置。施設の輪とは重ならない。 */
export const HUB_RESOURCE_POINTS: readonly HubResourcePoint[] = [
  { id:'farm', name:'段々農場', kind:'plant', x:-23, z:34.7, r:2, uses:1, floor:8 },
  { id:'mine', name:'炉の段・鉱脈', kind:'mine', x:-37, z:1, r:2, uses:2, floor:-3 },
  { id:'fish', name:'水音の庭・釣り場', kind:'fish', x:-40, z:-35, r:1.65, uses:2, floor:-10 },
  { id:'insect', name:'暮らしの段・虫取り場', kind:'insect', x:-7, z:35, r:2, uses:2, floor:8 },
  { id:'bone', name:'水音の庭・骨採取場', kind:'bone', x:-12, z:-33, r:2, uses:1, floor:-10 },
];
export const HUB_FISH_BITE = { from: 75, to: 165 } as const; // simulation 60Hz
export type HubResourceAction = 'sow' | 'harvest' | 'gather' | 'wait' | 'empty' | 'unavailable';
export interface ResourceStatus {
  action: HubResourceAction; summary: string; token: string; rankId: string; left: number;
}
type Catalog = Pick<Content,'quests'|'ranks'|'fieldGathering'|'materials'>;
const prefix = (id:string):string => 'hub.resource.v1.' + id + ':';
/** 実在する達成済み依頼のみ。里納品や訓練、ページ再読込では回復しない。 */
export function resourceCycle(doc: SaveDoc, c: Catalog): number {
  let n=0; for (const [id,count] of Object.entries(doc.progress.questClears)) if(c.quests.has(id)) n+=count; return n;
}
export function resourceRank(doc: SaveDoc, c: Catalog): string {
  let rankId='rank.1', order=c.ranks.get(rankId)?.order??1;
  for(const [id,count] of Object.entries(doc.progress.questClears)){
    if(count<=0)continue;
    const q=c.quests.get(id), r=q&&c.ranks.get(q.rankId);
    if(r&&r.order>order){rankId=r.id;order=r.order;}
  }
  return rankId;
}
function readMarker(doc:SaveDoc,p:HubResourcePoint): { cycle:number; count:number } | null {
  const a=doc.claims.find(x=>x.startsWith(prefix(p.id)));
  if(!a)return null;
  const m=/^(\d+):(\d+)$/.exec(a.slice(prefix(p.id).length));
  if(!m)return null;
  const cycle=Number(m[1]), count=Number(m[2]);
  return Number.isSafeInteger(cycle)&&Number.isSafeInteger(count)&&cycle>=0&&count>=0 ? {cycle,count}:null;
}
export function resourceStatus(doc:SaveDoc,c:Catalog,p:HubResourcePoint):ResourceStatus {
  const cycle=resourceCycle(doc,c),rankId=resourceRank(doc,c), m=readMarker(doc,p);
  const token=[p.id,cycle,rankId,m?.cycle??'-',m?.count??'-'].join(':');
  const rank=c.ranks.get(rankId)?.name??'初級';
  if(!c.fieldGathering?.tables.some(t=>t.nodeKind===p.kind&&t.rankId===rankId&&t.quality==='ordinary'))
    return {action:'unavailable',summary:'素材表がありません',token,rankId,left:0};
  if(p.id==='farm'){
    if(!m)return {action:'sow',summary:'種をまく（無料）。依頼1回達成で育つ',token,rankId,left:0};
    if(cycle<=m.cycle)return {action:'wait',summary:'生育中：依頼を1回達成すると収穫できる',token,rankId,left:0};
    return {action:'harvest',summary:rank+'の作物を収穫する',token,rankId,left:1};
  }
  const used=m&&m.cycle>=cycle?Math.min(p.uses,m.count):0;
  const left=p.uses-used;
  return {action:left?'gather':'empty',summary:left?rank+'・残り'+left+'回（依頼達成で補充）':'採取済み：依頼を達成すると補充',token,rankId,left};
}
export function nearbyResource(world:World,pos:V3):HubResourcePoint|null {
  return nearestFacility(HUB_RESOURCE_POINTS,world,pos);
}
export function resourceReward(doc:SaveDoc,c:Catalog,p:HubResourcePoint):{itemId:string;count:number}|null {
  const status=resourceStatus(doc,c,p);
  if(status.action!=='harvest'&&status.action!=='gather')return null;
  const t=c.fieldGathering?.tables.find(t=>t.nodeKind===p.kind&&t.rankId===status.rankId&&t.quality==='ordinary');
  if(!t?.entries.length)return null;
  let seed=0x811c9dc5;
  for(const char of status.token)seed=Math.imul(seed^char.charCodeAt(0),16777619)>>>0;
  const rng=new SeededRng(seed);
  let roll=rng.int(10000),e=t.entries[t.entries.length-1]!;
  for(const a of t.entries){roll-=a.weightBps;if(roll<0){e=a;break;}}
  return {itemId:e.itemId,count:p.id==='farm'?2:e.minCount+rng.int(e.maxCount-e.minCount+1)};
}
/** 同じ表示から送った二重操作を token で拒否する。素材と状態は一つの保存トランザクション。 */
export function useHubResource(doc:SaveDoc,c:Catalog,id:string,expectedToken:string):SaveDoc {
  const p=HUB_RESOURCE_POINTS.find(x=>x.id===id);
  if(!p)throw new RuleError('unknown','その採集場はありません');
  const s=resourceStatus(doc,c,p);
  if(s.token!==expectedToken)throw new RuleError('claimed','状態が変わりました。もう一度確認してください');
  if(s.action==='empty'||s.action==='wait'||s.action==='unavailable')throw new RuleError('locked',s.summary);
  const n=cloneSave(doc), cycle=resourceCycle(doc,c);
  n.claims=n.claims.filter(x=>!x.startsWith(prefix(id)));
  if(s.action==='sow'){n.claims.push(prefix(id)+cycle+':1');return n;}
  const reward=resourceReward(doc,c,p);
  if(!reward||!c.materials.has(reward.itemId))throw new RuleError('unknown','採集素材が見つかりません');
  if((n.items[reward.itemId]??0)+reward.count>MAX_COUNT)throw new RuleError('full','これ以上は持てません');
  n.items[reward.itemId]=(n.items[reward.itemId]??0)+reward.count;
  if(p.id!=='farm')n.claims.push(prefix(id)+cycle+':'+(p.uses-s.left+1));
  return n;
}
