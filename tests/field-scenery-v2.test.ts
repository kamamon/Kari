import {beforeAll,describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import type {Content} from '../src/data/schemas';
import {assembleScenery,sceneryKey,type SceneryDocument} from '../src/data/fieldScenery';
import {buildLandscapeSurface,landscapeProfile} from '../src/render/fieldLandscape';
import {SCENERY_ASSET_IDS,crownAsset,outcropAsset,plantAsset} from '../src/render/sceneryAssets';
import {reliefAt} from '../src/game/relief';
import {loadContent} from './helpers';
let c:Content;
beforeAll(async()=>{c=await loadContent();});
describe('P0-P4 field scenery V2',()=>{
 it('all actual areas and reciprocal gates are mapped; the data loader rejects a missing area',()=>{
  const areas=[...c.fields.values()].flatMap(f=>f.areas.map(a=>[f,a] as const));expect(c.fieldScenery?.size).toBe(areas.length);
  expect(areas.length).toBe(201);expect(areas.reduce((n,[,a])=>n+a.exits.length,0)).toBe(514);
  for(const [f,a] of areas){const p=c.fieldScenery!.get(sceneryKey(f.id,a.id))!;expect(p.gates.length).toBe(a.exits.length);for(const e of a.exits){const g=p.gates.find(x=>x.toAreaId===e.to)!;expect(c.fieldScenery!.get(sceneryKey(f.id,e.to))!.gates.find(x=>x.toAreaId===a.id)!.anchorKey).toBe(g.anchorKey);}}
  const docs=['a','b'].map(x=>JSON.parse(readFileSync(new URL('../public/data/field_landscape_v2_'+x+'.json',import.meta.url),'utf8')) as SceneryDocument);docs[0]!.areas.pop();const errors:string[]=[];assembleScenery(docs,c.fields,errors);expect(errors.some(x=>x.includes('missing'))).toBe(true);
 });
 it('all area profiles build an exterior; swept viewpoints use unchanged playable heights and finite surfaces',()=>{
  let views=0,wet=0;
  for(const f of c.fields.values())for(const a of f.areas){
   const p=landscapeProfile(f.id,a,c.fieldScenery!.get(sceneryKey(f.id,a.id))),s=buildLandscapeSurface({bounds:a.bounds,shape:a.shape,relief:a.relief,gates:a.exits,profile:p}),near=s.near.getAttribute('position'),outer=s.outer.getAttribute('position');
   let err=0;for(let i=0;i<near.count;i++)err=Math.max(err,Math.abs(near.getY(i)-reliefAt(a.relief,near.getX(i),near.getZ(i))));
   expect(err,f.id+'/'+a.id).toBeLessThan(.002);
   expect(s.metrics.outerMax-s.metrics.outerMin,f.id+'/'+a.id).toBeGreaterThan(7);
   expect(s.metrics.sharedVertices).toBeGreaterThan(0);expect(s.gates.every(g=>g.anchor)).toBe(true);
   const centers=[a.center??{x:(a.bounds.minX+a.bounds.maxX)/2,z:(a.bounds.minZ+a.bounds.maxZ)/2},...a.exits.map(e=>e.arrive).filter(e=>s.outline.contains(e.x,e.z)),...a.exits.map(e=>({x:e.x,z:e.z})),...a.platforms.map(t=>({x:(t.minX+t.maxX)/2,z:(t.minZ+t.maxZ)/2}))];
   for(const pt of centers)for(let y=0;y<8;y++)for(const pitch of [-.25,.3,1.15]){
    const a0=y*Math.PI/4;
    // Simplified terrain sampler, not a screenshot/ray visibility assertion. Keep camera sample finite.
    for(const d of [8,24,48,96,150]){const x=pt.x+Math.cos(a0)*d*Math.cos(pitch),z=pt.z+Math.sin(a0)*d*Math.cos(pitch);if(!Number.isFinite(s.height(x,z)))throw Error(f.id+'/'+a.id+' nonfinite camera sample');}
    views++;
   }
   for(let i=0;i<outer.count;i++)if(!Number.isFinite(outer.getY(i)))throw Error('invalid terrain vertex');
   if(s.water){wet++;const v=s.water.getAttribute('position');for(let i=0;i<v.count;i++){if(s.distance(v.getX(i),v.getZ(i))<4.08)throw Error('water invades area');}}
   s.near.dispose();s.outer.dispose();s.water?.dispose();
  }
  expect(views).toBeGreaterThan(10000);expect(wet).toBeGreaterThan(15);console.log('SCENERY_SWEEP '+views+' sample viewpoints, not full visual screenshots');
 },60000);
 it('41 dedicated asset variants have valid geometry and no duplicated identifiers',()=>{
  const ids=Object.values(SCENERY_ASSET_IDS).flat();expect(ids.length).toBe(41);expect(new Set(ids).size).toBe(41);
  const gs=[...Array.from({length:6},(_,i)=>crownAsset('broadleaf',i,true)),...Array.from({length:4},(_,i)=>crownAsset('pine',i,true)),...Array.from({length:4},(_,i)=>crownAsset('swamp',i,true)),...Array.from({length:8},(_,i)=>outcropAsset('layered',i)),...Array.from({length:3},(_,i)=>plantAsset('fern',i))];
  for(const g of gs){const p=g.getAttribute('position');expect(p.count).toBeGreaterThan(0);expect(g.getAttribute('uv').count).toBe(p.count);expect(Array.from(p.array).every(Number.isFinite)).toBe(true);g.dispose();}
 });
});
