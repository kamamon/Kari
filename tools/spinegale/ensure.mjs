// Reproducible game GLB; no external model service. The accepted source art is in this directory.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, existsSync, copyFileSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const src=dirname(fileURLToPath(import.meta.url));
const root=join(src,'../..');
const dest=join(root,'public/assets/models/monsters/spinegale_v3_game.glb');
const manifest=JSON.parse(readFileSync(join(src,'model_manifest.json'),'utf8'));
const expected='1af14a068028067aadef271b5ae9c42876a1804a6883061d985320b8c7f60b42';
function verify(file){
  const b=readFileSync(file);
  if(b.length<28 || b.toString('ascii',0,4)!=='glTF' || b.readUInt32LE(4)!==2 || b.readUInt32LE(8)!==b.length) throw Error('invalid Spinegale GLB');
  const g=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  const tri=g.meshes.flatMap(m=>m.primitives).reduce((a,p)=>a+g.accessors[p.indices].count/3,0);
  if(tri!==manifest.triangles || g.skins[0].joints.length!==manifest.joints || g.animations.length!==manifest.animationClips || g.materials.length!==manifest.materials) throw Error('Spinegale structure changed');
  for(const c of manifest.clips){
    const a=g.animations.find(a=>a.name===c.name);
    if(!a || Math.abs(Math.max(...a.samplers.map(s=>g.accessors[s.input].max[0]))-c.durationTicks/60)>0.001) throw Error('Spinegale animation changed: '+c.name);
  }
  const sha=createHash('sha256').update(b).digest('hex');
  console.log('Spinegale GLB:',b.length,'bytes;',tri,'triangles;',manifest.joints,'joints;',manifest.animationClips,'clips;',sha);
  if(sha!==expected) console.warn('Cross-platform binary hash differs; mesh/skin/clip structure verified.');
}
if(existsSync(dest)){try{verify(dest);process.exit(0)}catch(e){console.warn('Regenerating invalid GLB:',String(e))}}
const run=(exe,args,opts={})=>{const p=spawnSync(exe,args,{stdio:'inherit',...opts});if(p.error||p.status!==0)throw p.error??Error(exe+' exited '+p.status)};
let python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
const probe='import numpy,scipy,PIL; assert (numpy.__version__,scipy.__version__,PIL.__version__)==("2.3.5","1.17.0","12.3.0")';
if(spawnSync(python,['-c',probe],{stdio:'ignore'}).status!==0){
  const venv=join(root,'tools/out/spinegale-venv');
  mkdirSync(dirname(venv),{recursive:true});
  const py=join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python');
  if(!existsSync(py))run(python,['-m','venv',venv]);
  python=py;
  if(spawnSync(python,['-c',probe],{stdio:'ignore'}).status!==0)run(python,['-m','pip','install','-r',join(src,'requirements.txt')]);
  run(python,['-c',probe]);
}
const work=mkdtempSync(join(tmpdir(),'kari-sg-'));
try{
  for(const file of ['build_spinegale_refined.py','art_bake.py','reference.webp'])copyFileSync(join(src,file),join(work,file));
  run(python,[join(work,'build_spinegale_refined.py')],{env:{...process.env,SPINE_LOD:'1.2',SPINE_SUFFIX:'v3_game_raw',SPINE_TEX:'1024'}});
  run(python,[join(work,'art_bake.py')]);
  const file=join(work,'spinegale_v3_game.glb');
  verify(file);mkdirSync(dirname(dest),{recursive:true});copyFileSync(file,dest+'.tmp');renameSync(dest+'.tmp',dest);
}finally{rmSync(work,{recursive:true,force:true})}
