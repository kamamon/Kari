import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Mesh, type Object3D } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content } from '../src/data/schemas';
import { Simulation } from '../src/game/sim';
import { buildFieldGatherProps } from '../src/render/fieldGatherProps';
import { buildHubGroup } from '../src/render/hubScene';
import { buildGatherZone, buildEstateRoom } from '../src/render/hubEstateZones';
import { craftMaterials } from '../src/render/hubCraft';
import { IMAGE_SURFACES, imageFile } from '../src/render/materialImages';
import { baseOptions, loadContent } from './helpers';

const root=new URL('../public/assets/textures/materials/',import.meta.url);
type Entry={file:string;bytes:number;gitBlob:string};
const entries=(JSON.parse(readFileSync(new URL('manifest.json',root),'utf8')) as {materials:Entry[]}).materials;
const filenames=new Set(entries.map(e=>e.file));
let c:Content;
beforeAll(async()=>{c=await loadContent();});
function tagged(root:Object3D,requireAll=false){
 const kinds=new Set<string>();
 root.traverse(o=>{
  if(!(o instanceof Mesh))return;
  for(const m of Array.isArray(o.material)?o.material:[o.material]){
   const kind=m.userData.surfaceImage;
   if(requireAll)expect(kind,'physical mesh '+o.name).toBeTruthy();
   if(!kind)continue;
   kinds.add(kind);
   expect(m.userData.surfaceFile).toMatch(/^assets\/textures\/materials\//);
   expect(filenames.has(m.userData.surfaceFile.split('/').pop())).toBe(true);
   expect(o.geometry.getAttribute('uv')?.count,'UV '+o.name).toBe(o.geometry.getAttribute('position').count);
  }
 });
 return kinds;
}
describe('環境の生成画像材質',()=>{
 it('31 WebP files and manifest hashes match',()=>{
  expect(entries).toHaveLength(33);expect(filenames.size).toBe(33);
  for(const entry of entries){
   const bytes=readFileSync(new URL(entry.file,root));
   expect(bytes.length,entry.file).toBe(entry.bytes);
   expect(bytes.toString('ascii',0,4)).toBe('RIFF');
   expect(bytes.toString('ascii',8,12)).toBe('WEBP');
   expect(createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')).toBe(entry.gitBlob);
  }
  for(const kind of IMAGE_SURFACES)expect(filenames.has(imageFile(kind)+'.webp'),kind).toBe(true);
 });
 it('里・外周・採掘場・養魚池・自室に画像参照とUVがある',()=>{
  const map=c.maps.get(c.hub.mapId)!;
  const {group}=buildHubGroup(c.hub,map);
  const all=tagged(group);
  for(const kind of ['wood','masonry','roof','cloth','grass','bark','leaf','water'])expect(all.has(kind),kind).toBe(true);
  expect(tagged(buildGatherZone('mine',4,craftMaterials()).group).has('cliff')).toBe(true);
  expect(tagged(buildGatherZone('pond',4,craftMaterials()).group).has('water')).toBe(true);
  expect(tagged(buildEstateRoom(craftMaterials())).has('wood')).toBe(true);
 });
 it('全20地域の採取ツアーで採取物本体と池・魚が画像材質を参照する',()=>{
  expect(c.fields.size).toBe(21);
  for(const id of c.fields.keys()){
   const q=[...c.quests.values()].find(q=>q.fieldId===id&&q.gather?.fieldGathering&&q.rankId==='rank.1')!;
   expect(q,id).toBeTruthy();
   const sim=new Simulation(c,baseOptions({questId:q.id,field:true,monsterId:null}));
   const scene=buildFieldGatherProps(sim)!;expect(scene,id).toBeTruthy();expect(scene.props.length,id).toBeGreaterThan(0);
   for(const p of scene.props)expect(tagged(p.visual,true).size,id+' '+p.node.kind).toBeGreaterThan(0);
   const kinds=tagged(scene.pond);expect(kinds.has('water'),id).toBe(true);expect(kinds.has('scale'),id).toBe(true);
  }
 });
});
