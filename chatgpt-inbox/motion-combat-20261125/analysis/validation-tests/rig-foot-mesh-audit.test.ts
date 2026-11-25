// Validation source: copy this file to <disposable applied repository>/tests/ to run.
import { it, expect, vi } from 'vitest';
import { TextureLoader, Texture, Vector3, SkinnedMesh, Skeleton } from 'three';
import { writeFileSync } from 'node:fs';
import { HunterRig } from '../src/render/rig';
import { clipPose, JOINTS } from '../src/render/poses';
import { groundedHeavyAttack } from '../src/render/heavyBodyMotion';
import { sampleTrack } from '../src/game/tracks';
import { loadContent } from './helpers';
it('independent actual skinned boot vertices across all heavy quarter ticks',async()=>{
 const mock=vi.spyOn(TextureLoader.prototype,'load').mockImplementation(()=>new Texture());
 const content=await loadContent(),rig=new HunterRig(),r=rig as unknown as {bodyMesh:SkinnedMesh;skeleton:Skeleton};
 const mesh=r.bodyMesh,position=mesh.geometry.attributes.position!,idx=mesh.geometry.attributes.skinIndex!,weight=mesh.geometry.attributes.skinWeight!;
 const footIds=[JOINTS.indexOf('footL'),JOINTS.indexOf('footR')],vertices:number[]=[];
 for(let i=0;i<position.count;i++)for(let w=0;w<4;w++)if(footIds.includes(idx.getComponent(i,w))&&weight.getComponent(i,w)>.01){vertices.push(i);break;}
 const rows:any[]=[];const v=new Vector3();
 for(const name of ['overhead','side_sweep','draw_slash'])for(const version of ['old','new']){
  const a=content.actions.get(`player.heavy_blade.${name}`)!,tr=content.tracks.get(a.weaponTrack!)!;
  const stats:any={name,version,minFootMeshY:Infinity,samples:0,footVertices:vertices.length};
  for(let t=0;t<=a.durationTicks;t+=.25){
   let p=clipPose(a.clip,t)!;if(version==='new')p=groundedHeavyAttack(p,a.clip,t);
   rig.setPose(p);const k=sampleTrack(tr,t);rig.weaponToTrack(k.grip,k.dir,tr.planeNormal??[1,0,0],{two:true,along:.2});rig.root.updateMatrixWorld(true);r.skeleton.update();
   for(const i of vertices){v.fromBufferAttribute(position,i);mesh.applyBoneTransform(i,v);v.applyMatrix4(mesh.matrixWorld);if(v.y<stats.minFootMeshY){stats.minFootMeshY=v.y;stats.worstTick=t;stats.worstVertex=i;}}
   stats.samples++;
  }rows.push(stats);
  if(version==='new')expect(stats.minFootMeshY,`${name} actual skinned boot floor`).toBeGreaterThanOrEqual(-.002);
 }
 mock.mockRestore();writeFileSync('rig-foot-mesh.results.json',JSON.stringify(rows,null,2));expect(rows).toHaveLength(6);
});
