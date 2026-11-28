import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, FieldAreaDef } from '../src/data/schemas';
import { reliefAt } from '../src/game/relief';
import { buildLandscapeSurface, buildLandscapeExterior, landscapeProfile, FIELD_LANDSCAPE_IDS } from '../src/render/fieldLandscape';
import { loadContent } from './helpers';
import { Matrix4, Vector3, Quaternion, InstancedMesh, Mesh } from 'three';

let c:Content;
beforeAll(async()=>{c=await loadContent();});
const input=(id:string,a:FieldAreaDef)=>({bounds:a.bounds,shape:a.shape,relief:a.relief,gates:a.exits,profile:landscapeProfile(id,a)});
describe('自然な外周景観（描画専用）',()=>{
 it('登録済み20地域すべてに景観の定義があり、地域とエリアごとに変わる',()=>{
  expect(new Set(FIELD_LANDSCAPE_IDS)).toEqual(new Set(c.fields.keys()));
  const ps=[...c.fields.values()].map(f=>landscapeProfile(f.id,f.areas[0]!));
  expect(new Set(ps.map(p=>p.style)).size).toBe(9);
  expect(ps.find(p=>p.fieldId==='field.coast')?.water).toBe('sea');
  expect(ps.find(p=>p.fieldId==='field.icegorge')?.cover).toBeLessThan(.1);
  expect(ps.find(p=>p.fieldId==='field.mistforest')?.trees).toBeGreaterThan(100);
  expect(ps.find(p=>p.fieldId==='field.ashmine')?.trees).toBe(0);
  const basin=c.fields.get('field.basin')!;
  expect(landscapeProfile(basin.id,basin.areas[1]!).seed).not.toBe(landscapeProfile(basin.id,basin.areas[2]!).seed);
 });
 it('全地域の全エリア: 内側の地面高を保持、外側に起伏、共通頂点で連続し、過剰な平面を削る',()=>{
  let n=0,wet=0;
  for(const f of c.fields.values())for(const a of f.areas){
   const s=buildLandscapeSurface(input(f.id,a)),near=s.near.getAttribute('position'),outer=s.outer.getAttribute('position');
   const label=f.id+'/'+a.id;
   expect(s.metrics.sharedVertices,label).toBeGreaterThan(0);
   expect(s.metrics.outerMax-s.metrics.outerMin,label).toBeGreaterThan(9);
   expect(s.metrics.nearTriangles+s.metrics.outerTriangles,label).toBeLessThan(27000);
   let err=0;
   for(let i=0;i<near.count;i++)err=Math.max(err,Math.abs(near.getY(i)-reliefAt(a.relief,near.getX(i),near.getZ(i))));
   expect(err,label).toBeLessThan(.002);
   const nearMap=new Map<string,number>();for(let i=0;i<near.count;i++)nearMap.set(near.getX(i)+':'+near.getZ(i),near.getY(i));
   let shared=0,minimum=Infinity;
   for(let i=0;i<outer.count;i++){
    const x=outer.getX(i),z=outer.getZ(i),y=outer.getY(i);
    minimum=Math.min(minimum,s.distance(x,z));
    const same=nearMap.get(x+':'+z);
    if(same!==undefined){shared++;expect(y,label).toBe(same);}
   }
   expect(minimum,label).toBeGreaterThan(1.60);
   expect(shared,label).toBe(s.metrics.sharedVertices);
   if(s.water){
    wet++;const w=s.water.getAttribute('position');let d=Infinity;
    for(let i=0;i<w.count;i++)d=Math.min(d,s.distance(w.getX(i),w.getZ(i)));
    expect(d,label).toBeGreaterThan(4.1);
   }
   s.near.dispose();s.outer.dispose();s.water?.dispose();n++;
  }
  expect(n).toBeGreaterThan(150);expect(wet).toBeGreaterThan(15);
 },60000);
 it('樹木・岩・水面は既存の画像材質を使い、配置は範囲外。景観は決定的で、描画回数を抑える',()=>{
  for(const key of ['basin','mistforest','wetland','coast','icegorge','ashmine','deepveil']){
   const f=c.fields.get('field.'+key)!,a=f.areas[0]!,data=input(f.id,a);
   const s=buildLandscapeSurface(data),g=buildLandscapeExterior(data,s),stats=g.userData.landscape;
   expect(stats.fieldId).toBe(f.id);expect(stats.outerTriangles).toBeGreaterThan(0);
   expect(g.children.length).toBeLessThanOrEqual(9);
   // v0.79.0: 遠い稜線の 2 層は、1 つの形にまとめた（描画 1 回。丘の草の描画 1 回ぶんを空ける）。頂点は 2 層ぶん（101 × 3 × 2）
   const ridge=g.getObjectByName('field-distant-ridge') as Mesh;
   expect(ridge.userData.layers).toBe(2);expect(ridge.geometry.getAttribute('position').count).toBe(606);
   const m=g.getObjectByName('field-exterior-relief') as Mesh;
   // v0.78.0: 盆地の外側は、内側と同じ地面の絵（src/render/exteriorGround.ts。印は outerGround）。ほかの狩場は、画像の材質
   const ud=(m.material as {userData:Record<string,unknown>}).userData;
   if(key==='basin')expect(ud.outerGround,key).toBe(true);else expect(ud.surfaceImage,key).toBeDefined();
   for(const name of ['field-exterior-trunks']){
    const mesh=g.getObjectByName(name) as InstancedMesh|undefined;if(!mesh)continue;
    const matrix=new Matrix4(),v=new Vector3(),q=new Quaternion(),scale=new Vector3();
    for(let i=0;i<mesh.count;i++){
     mesh.getMatrixAt(i,matrix);matrix.decompose(v,q,scale);expect(s.distance(v.x,v.z),key+'/'+name).toBeGreaterThan(5);
    }
   }
   // v0.78.0: 岩は、依頼 10 の岩の図を 1 つの形にまとめたもの（描画 1 回）。置いた場所は userData.rocks
   const stone=g.getObjectByName('field-exterior-rocks') as Mesh|undefined;
   for(const r of (stone?.userData.rocks??[]) as {x:number;z:number}[])expect(s.distance(r.x,r.z),key+'/field-exterior-rocks').toBeGreaterThan(5);
   expect(stats.rocks,key).toBeGreaterThan(20);
   if(data.profile.trees)expect(stats.trees,key).toBeGreaterThan(15);
   if(key==='coast')expect(stats.water).toBe(true);
   const repeat=buildLandscapeSurface(data);
   expect(Array.from(repeat.outer.getAttribute('position').array)).toEqual(Array.from(s.outer.getAttribute('position').array));
   repeat.near.dispose();repeat.outer.dispose();repeat.water?.dispose();s.near.dispose();
   g.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();for(const mat of Array.isArray(o.material)?o.material:[o.material])mat.dispose();}});
  }
 },30000);
});
