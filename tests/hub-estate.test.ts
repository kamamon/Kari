import {beforeAll,describe,it,expect} from 'vitest';
import {Mesh,InstancedMesh} from 'three';
import type {Content,MapDef} from '../src/data/schemas';
import {ANIMALS,FURNITURE,ROOM_ENTRY,ZONES,defaultFurniture,furnitureErrors,furnitureBlocks,roomFurniture,zoneWalkable,zoneNodeNear,type FurniturePlacement} from '../src/data/hubEstate';
import {freshHubLife,lifeOf,hubLifeShapeErrors} from '../src/data/hubLife';
import {hubThreat,hubReports,newHubReports} from '../src/data/hubNarrative';
import {applyHubLife} from '../src/game/hubLife';
import {HUB_RESOURCE_POINTS,resourceStatus,useHubResource} from '../src/game/hubResources';
import {newSave,validateSave} from '../src/save/profile';
import {buildCraftVillage,craftMaterials,furnitureModel} from '../src/render/hubCraft';
import {buildGatherZone,buildEstateRoom} from '../src/render/hubEstateZones';
import {HubLivestock} from '../src/render/hubLivestock';
import {hubScore,hubSample,HUB_SAMPLE_RATE} from '../src/core/hubSoundtrack';
import {MemoryBackend} from '../src/save/saveDb';
import {SaveManager} from '../src/save/saveManager';
import {loadContent} from './helpers';
let c:Content,map:MapDef;
beforeAll(async()=>{c=await loadContent();map=c.maps.get(c.hub.mapId)!;});
const fresh=()=>newSave(c,{now:'2026-11-27T00:00:00Z',appVersion:'test',contentVersion:c.contentVersion});
const act=(d:ReturnType<typeof fresh>,cmd:Parameters<typeof applyHubLife>[2])=>applyHubLife(d,c,cmd)??d;
describe('灯継ぎの里の専用区画・模型・家畜',()=>{
 it('家具12種、旧データの初期配置、任意の角度と位置を保存',()=>{
  expect(Object.keys(FURNITURE)).toHaveLength(12);
  expect(furnitureErrors(defaultFurniture('left'))).toEqual([]);expect(furnitureErrors(defaultFurniture('right'))).toEqual([]);
  const row:FurniturePlacement={id:'one',kind:'desk',x:1.12,z:-1.18,yaw:.77,finish:2};const d=act(fresh(),{kind:'furniture',items:[row]});
  expect(roomFurniture(lifeOf(d))).toEqual([row]);expect(validateSave(d)).toEqual([]);
  expect(furnitureBlocks(row,row.x,row.z)).toBe(true);expect(furnitureBlocks(row,ROOM_ENTRY.x,ROOM_ENTRY.z)).toBe(false);
  expect(furnitureErrors([{...row,x:8}]).length).toBeGreaterThan(0);
  expect(furnitureErrors([{...row,x:0,z:2.35}]).length).toBeGreaterThan(0);
  expect(furnitureErrors([row,{...row,id:'two'}]).length).toBeGreaterThan(0);
  expect(()=>act(fresh(),{kind:'furniture',items:[{...row,x:999}]})).toThrow();
 });
 it('坑道・養魚池の解放済み全採取点に入口から到達でき、未解放の点は採取対象にしない',()=>{
  for(const zone of Object.values(ZONES))for(let lv=1;lv<=4;lv++){
   const step=.25,x0=zone.bounds.x0,z0=zone.bounds.z0,nx=Math.round((zone.bounds.x1-x0)/step)+1,nz=Math.round((zone.bounds.z1-z0)/step)+1;
   const sx=Math.round((zone.spawn.x-x0)/step),sz=Math.round((zone.spawn.z-z0)/step),queue=[[sx,sz]],seen=new Set<number>();
   while(queue.length){const [x,z]=queue.pop()!,key=x!+z!*nx;if(x!<0||x!>=nx||z!<0||z!>=nz||seen.has(key)||!zoneWalkable(zone,x0+x!*step,z0+z!*step,lv))continue;seen.add(key);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]])queue.push([x!+dx!,z!+dz!]);}
   expect(seen.size,zone.id+lv).toBeGreaterThan(100);
   for(const n of zone.nodes){
    if(n.level>lv){expect(zoneNodeNear(zone,n.x,n.z,lv)?.id).not.toBe(n.id);continue;}
    expect([...seen].some(k=>Math.hypot(x0+(k%nx)*step-n.x,z0+Math.floor(k/nx)*step-n.z)<1.35),zone.id+' '+lv+' '+n.id).toBe(true);
   }
  }
 });
 it('専用区画の報酬は里の既存採集と共有する（同じ状態の二重報酬なし）',()=>{
  for(const id of ['mine','fish']){const p=HUB_RESOURCE_POINTS.find(x=>x.id===id)!,d=fresh(),s=resourceStatus(d,c,p),n=useHubResource(d,c,p.id,s.token);expect(resourceStatus(n,c,p).left).toBe(p.uses-1);expect(()=>useHubResource(n,c,p.id,s.token)).toThrow();}
 });
 it('家畜は購入・給餌・依頼成功の後に回収する。消費と生産を一度に保存',()=>{
  let d=fresh();d.money=5000;
  for(const [id,a] of Object.entries(ANIMALS)){expect(c.materials.has(a.product)).toBe(true);expect(c.shop.sell.some(x=>x.itemId===a.product)).toBe(true);d.items[a.feed]=20;const k=id as keyof typeof ANIMALS;d=act(d,{kind:'animalBuy',id:k});d=act(d,{kind:'animalFeed',id:k});expect(()=>act(d,{kind:'animalCollect',id:k})).toThrow();expect(()=>act(d,{kind:'animalFeed',id:k})).toThrow();}
  d.progress.questClears['quest.basin.003']=1;
  for(const [id,a] of Object.entries(ANIMALS)){const k=id as keyof typeof ANIMALS;d=act(d,{kind:'animalCollect',id:k});expect(d.items[a.product]).toBe(a.yield);expect(()=>act(d,{kind:'animalCollect',id:k})).toThrow();expect(()=>act(d,{kind:'animalFeed',id:k})).toThrow();}
  expect(validateSave(d)).toEqual([]);
 });
 it('看板の未実装依頼は達成扱いにしない。既存主線から予兆と警戒報告が解禁',()=>{
  const a={'quest.basin.003':1},b={...a,'quest.spinegale.r1':1};expect(hubThreat(c,{})).toBe(0);expect(hubThreat(c,a)).toBe(1);expect(hubThreat(c,b)).toBe(2);
  expect(newHubReports(c,{},a)).toEqual(['hub.thunder.rumor']);expect(newHubReports(c,a,b)).toEqual(['hub.thunder.watch']);expect(newHubReports(c,b,b)).toEqual([]);
  expect(hubThreat(c,{...b,'quest.story.thunder_return':1})).toBe(2);
  for(const s of hubReports(c,b))for(const l of s.lines){expect(c.story.speakers[l.who!]).toBeDefined();expect(l.text!.length).toBeLessThanOrEqual(60);}
 });
 it('専用3Dモデル・区画・12種家具の形状が作られる（GPU不要の構造検査）',()=>{
  const before=JSON.stringify([map,c.hub]),g=buildCraftVillage(c.hub,map);
  expect(g.userData.buildings).toBeGreaterThanOrEqual(12);expect(g.userData.triangles).toBeGreaterThan(10000);expect(g.children.length).toBeLessThanOrEqual(7);
  expect(JSON.stringify([map,c.hub])).toBe(before);
  for(const mesh of g.children as Mesh[]){expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);expect(mesh.geometry.getAttribute('color').count).toBe(mesh.geometry.getAttribute('position').count);}
  const mats=craftMaterials(),room=buildEstateRoom(mats);expect(room.children.length).toBeGreaterThan(2);
  for(const kind of Object.keys(FURNITURE) as (keyof typeof FURNITURE)[]){const f=furnitureModel({id:'test',kind,x:0,z:0,yaw:0,finish:0},mats);expect(f.userData.triangles,kind).toBeGreaterThan(20);}
  for(const id of ['mine','pond'] as const){const z=buildGatherZone(id,4,mats);expect(z.group.getObjectByName('estate-nodes')?.children.length).toBe(5);z.update(.4);}
  const live=new HubLivestock(map);expect(live.group.children.filter(x=>x.name.startsWith('hub-livestock:'))).toHaveLength(3);let instances=0;live.group.traverse(o=>{if(o instanceof InstancedMesh)instances++;});expect(instances).toBeGreaterThan(10);
 });
 it('オリジナルPCM音源は決定的・有限・非無音、通常曲と警戒曲が異なる',()=>{
  const a=hubScore(false),b=hubScore(true);expect(a.length).toBe(b.length);expect(a.length/HUB_SAMPLE_RATE).toBeGreaterThan(15);
  expect(a[0]).toBe(0);expect(a.every(Number.isFinite)).toBe(true);expect(b.every(Number.isFinite)).toBe(true);
  expect(a.some((x,i)=>Math.abs(x-b[i]!)>.01)).toBe(true);
  for(const k of ['goat','hen','ox','mine','fish','thunder','door','feed','reward'] as const){const x=hubSample(k);expect(x.every(Number.isFinite)).toBe(true);expect(x.some(v=>Math.abs(v)>.02),k).toBe(true);}
 });
 it('家具と家畜の保存は競合と保存失敗で部分的に更新しない',async()=>{
  const backend=new MemoryBackend(),env={now:()=> '2026-11-27T00:00:00Z',appVersion:'test'};
  const m=await SaveManager.open(c,backend,env),row:FurniturePlacement={id:'x',kind:'lamp',x:1,z:-1,yaw:0,finish:1};
  const revision=m.doc.revision;backend.failNext=new Error('失敗');expect((await m.hubLife({kind:'furniture',items:[row]},revision)).ok).toBe(false);expect(lifeOf(m.doc).furniture).toBeUndefined();
  expect((await m.hubLife({kind:'furniture',items:[row]},m.doc.revision)).ok).toBe(true);
  const again=await SaveManager.open(c,backend,env);expect(lifeOf(again.doc).furniture).toEqual([row]);expect(hubLifeShapeErrors(lifeOf(again.doc))).toEqual([]);
 });
});
