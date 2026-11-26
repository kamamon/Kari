import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, MapDef } from '../src/data/schemas';
import { HUB_RESOURCE_POINTS, resourceStatus, resourceReward, useHubResource, nearbyResource, resourceCycle, resourceRank } from '../src/game/hubResources';
import { newSave, cloneSave, validateSave } from '../src/save/profile';
import { MemoryBackend } from '../src/save/saveDb';
import { SaveManager } from '../src/save/saveManager';
import { World, groundAt } from '../src/game/world';
import { buildHubGroup } from '../src/render/hubScene';
import { loadContent } from './helpers';
let c:Content,map:MapDef;
beforeAll(async()=>{c=await loadContent();map=c.maps.get(c.hub.mapId)!;});
const fresh=()=>newSave(c,{now:'2026-11-27T00:00:00.000Z',appVersion:'test',contentVersion:c.contentVersion});
const point=(id:string)=>HUB_RESOURCE_POINTS.find(p=>p.id===id)!;
const q1=()=>[...c.quests.values()].find(q=>q.rankId==='rank.1')!;
describe('里の農場と採集',()=>{
  it('五つの採集場が歩ける同じ段にあり、既存施設と当たりを避ける',()=>{
    const w=new World(map);
    for(const p of HUB_RESOURCE_POINTS){
      expect(groundAt(map.platforms,p.x,p.z),p.id).toBe(p.floor);
      expect(nearbyResource(w,{x:p.x,y:p.floor,z:p.z})?.id).toBe(p.id);
      expect(nearbyResource(w,{x:p.x,y:p.floor+3,z:p.z})).toBeNull();
      for(const r of map.rocks)expect(Math.hypot(p.x-r.x,p.z-r.z),p.id).toBeGreaterThan(r.r+c.player.radius);
      for(const f of c.hub.facilities)expect(Math.hypot(p.x-f.x,p.z-f.z),p.id).toBeGreaterThan(p.r+f.r);
    }
    expect(buildHubGroup(c.hub,map).group.getObjectByName('hub-resource-points')).toBeDefined();
  });
  it('農場は作付けして依頼を達成すると収穫、再作付けできる',()=>{
    const p=point('farm'),d=fresh();
    const s=resourceStatus(d,c,p);
    const planted=useHubResource(d,c,p.id,s.token);
    expect(resourceStatus(planted,c,p).action).toBe('wait');
    expect(()=>useHubResource(planted,c,p.id,s.token)).toThrow();
    planted.progress.questClears[q1().id]=1;
    const h=resourceStatus(planted,c,p);expect(h.action).toBe('harvest');
    const r=resourceReward(planted,c,p)!;
    const next=useHubResource(planted,c,p.id,h.token);
    expect(next.items[r.itemId]).toBe(2);
    expect(resourceStatus(next,c,p).action).toBe('sow');
    expect(validateSave(next)).toEqual([]);
  });
  it('採掘・釣り・虫取り・骨は回数制限、再読込で増えず依頼達成で補充',()=>{
    for(const id of ['mine','fish','insect','bone']){
      const p=point(id);let d=fresh();
      for(let i=0;i<p.uses;i++){
        const s=resourceStatus(d,c,p),r=resourceReward(d,c,p)!;
        expect(c.materials.has(r.itemId)).toBe(true);
        expect(resourceReward(cloneSave(d),c,p)).toEqual(r);
        d=useHubResource(d,c,id,s.token);
        expect(()=>useHubResource(d,c,id,s.token)).toThrow();
      }
      expect(resourceStatus(cloneSave(d),c,p).action).toBe('empty');
      expect(()=>useHubResource(d,c,id,resourceStatus(d,c,p).token)).toThrow();
      d.progress.questClears[q1().id]=1;
      expect(resourceStatus(d,c,p).left).toBe(p.uses);
    }
  });
  it('上の級は実際の依頼を達成した時だけ利用でき、未知のIDでは補充しない',()=>{
    const d=fresh();d.progress.questClears['unknown.123']=50;
    expect(resourceCycle(d,c)).toBe(0);expect(resourceRank(d,c)).toBe('rank.1');
    const q=[...c.quests.values()].find(q=>q.rankId==='rank.2')!;
    expect(q).toBeDefined();d.progress.questClears[q.id]=1;
    expect(resourceRank(d,c)).toBe('rank.2');
    const r=resourceReward(d,c,point('mine'))!;
    expect(c.fieldGathering!.materials.find(x=>x.id===r.itemId)?.firstRankId).toBe('rank.2');
  });
  it('保存の失敗・二重入力は素材を増やさず、永続状態を維持する',async()=>{
    const backend=new MemoryBackend(),env={now:()=> '2026-11-27T00:00:00.000Z',appVersion:'test'};
    const m=await SaveManager.open(c,backend,env),p=point('mine'),s=resourceStatus(m.doc,c,p);
    const r=resourceReward(m.doc,c,p)!;
    backend.failNext=new Error('容量不足');
    expect((await m.useHubResource(p.id,s.token)).ok).toBe(false);
    expect(m.doc.items[r.itemId]??0).toBe(0);
    const both=await Promise.all([m.useHubResource(p.id,s.token),m.useHubResource(p.id,s.token)]);
    expect(both.filter(x=>x.ok)).toHaveLength(1);
    expect(m.doc.items[r.itemId]).toBe(r.count);
    const again=await SaveManager.open(c,backend,env);
    expect(resourceStatus(again.doc,c,p).left).toBe(p.uses-1);
    expect(again.doc.items[r.itemId]).toBe(r.count);
  });
});
