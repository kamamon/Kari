import {spawnSync} from 'node:child_process';
import {mkdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const p=dirname(fileURLToPath(import.meta.url));const root=join(p,'../..');
const run=(exe,args,opts={})=>{const r=spawnSync(exe,args,{stdio:'inherit',...opts});if(r.error||r.status!==0)throw r.error??Error(exe+' failed '+r.status);};
let py=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
const probe='import numpy,scipy,PIL,skimage; assert (numpy.__version__,scipy.__version__,PIL.__version__,skimage.__version__)==("2.3.5","1.17.0","12.3.0","0.26.0")';
const valid=exe=>spawnSync(exe,['-c',probe],{stdio:'ignore'}).status===0;
if(!valid(py)){const v=join(root,'tools/out/spinegale-venv');const exe=join(v,process.platform==='win32'?'Scripts/python.exe':'bin/python');if(!existsSync(exe)){mkdirSync(dirname(v),{recursive:true});run(py,['-m','venv',v])}py=exe;if(!valid(py))run(py,['-m','pip','install','-r',join(p,'requirements.txt')]);run(py,['-c',probe]);}
if(process.argv.includes('--master'))run(py,[join(p,'build_master.py'),...process.argv.slice(2).filter(a=>a!=='--master')]);
else {
  run(py,[join(p,'ensure_assets.py')]);
  run(py,[join(p,'build_master.py'),'--install']);
}
