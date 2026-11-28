"""Generate and verify the approved high-density Frostald mesh, in an isolated texture directory.

Normal predev/prebuild/pretest never generate or ship this large file.
--install makes the master selectable in the local game (?frostaldQuality=master).
--dist installs into an already built preview for CI verification only.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, struct, subprocess, sys, tempfile
import numpy as np

P=Path(__file__).resolve().parent
ROOT=P.parent.parent
WORK=ROOT/'tools/out/frostald-master'
GAME=ROOT/'public/assets/models/monsters/frostald_game.glb'
NAME='frostald_master.glb'
SRC=P/'build_frostald.py'
EXPECTED=2283726

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest()

class GLB:
    def __init__(self,path):
        self.path=path
        with path.open('rb') as f:
            head=f.read(20)
            magic,version,size,n,kind=struct.unpack('<4sIII4s',head)
            if (magic,version,size,kind)!=(b'glTF',2,path.stat().st_size,b'JSON'):raise ValueError('GLB header')
            self.g=json.loads(f.read(n))
            length,kind=struct.unpack('<I4s',f.read(8))
            if kind!=b'BIN\0' or f.tell()+length!=size:raise ValueError('GLB BIN chunk')
            self.base=f.tell()
        self.f=path.open('rb')
    def __enter__(self):return self
    def __exit__(self,*args):self.f.close()
    def read(self,i):
        a=self.g['accessors'][i];v=self.g['bufferViews'][a['bufferView']]
        self.f.seek(self.base+v.get('byteOffset',0)+a.get('byteOffset',0))
        return self.f.read(v['byteLength']-a.get('byteOffset',0))
    def validate(self,expected):
        g=self.g
        assert len(g['skins'][0]['joints'])==79 and len(g['animations'])==56
        tri=verts=0
        for mesh in g['meshes']:
            for prim in mesh['primitives']:
                at=prim['attributes'];v=g['accessors'][at['POSITION']]['count'];verts+=v
                idx=np.frombuffer(self.read(prim['indices']),dtype='<u4')
                assert len(idx)%3==0 and idx.max()<v
                tri+=len(idx)//3
                w=np.frombuffer(self.read(at['WEIGHTS_0']),dtype='<f4').reshape(-1,4)
                j=np.frombuffer(self.read(at['JOINTS_0']),dtype='<u2')
                assert len(w)==v and len(j)==4*v and j.max()<79
                assert np.isfinite(w).all() and (w>=0).all() and np.max(abs(w.sum(1)-1))<1e-6
        assert tri==expected,(tri,expected)
        return {'triangles':tri,'vertices':verts,'joints':79,'clips':56,'bytes':self.path.stat().st_size,'sha256':sha(self.path)}

def compare(master):
    with GLB(GAME) as a,GLB(master) as b:
        stats=b.validate(EXPECTED);a.validate(329250)
        assert a.g['nodes']==b.g['nodes']
        assert a.g['skins'][0]['joints']==b.g['skins'][0]['joints']
        assert a.read(a.g['skins'][0]['inverseBindMatrices'])==b.read(b.g['skins'][0]['inverseBindMatrices'])
        for x,y in zip(a.g['animations'],b.g['animations']):
            assert x['name']==y['name'] and x['channels']==y['channels'] and x['extras']==y['extras']
            assert len(x['samplers'])==len(y['samplers'])
            for u,v in zip(x['samplers'],y['samplers']):
                assert u['interpolation']==v['interpolation']
                for k in ('input','output'):assert a.read(u[k])==b.read(v[k]),(x['name'],k)
        return stats

def main():
    cli=argparse.ArgumentParser();cli.add_argument('--install',action='store_true');cli.add_argument('--dist',action='store_true')
    args=cli.parse_args()
    if not GAME.is_file():raise RuntimeError('Run npm run frostald:build first')
    WORK.mkdir(parents=True,exist_ok=True);dest=WORK/NAME;meta=WORK/'verification.json'
    # Both source and reference game hash participate in the cache key.
    key={'sourceSha256':sha(SRC),'gameSha256':sha(GAME),'lod':3.5,'textureSize':2048}
    old=json.loads(meta.read_text()) if meta.is_file() else {}
    if not dest.is_file() or old.get('key')!=key:
        with tempfile.TemporaryDirectory(prefix='frostald-master-') as temp:
            p=Path(temp);script=p/SRC.name;shutil.copyfile(SRC,script)
            env={**os.environ,'FROST_LOD':'3.5','FROST_TEX':'2048','FROST_SUFFIX':'master'}
            subprocess.run([sys.executable,str(script)],cwd=p,env=env,check=True)
            stats=compare(p/NAME)
            shutil.copyfile(p/NAME,dest.with_suffix('.tmp'))
            os.replace(dest.with_suffix('.tmp'),dest)
            shutil.copyfile(p/'model_manifest_master.json',WORK/'model_manifest_master.json')
    else:stats=compare(dest)
    meta.write_text(json.dumps({'key':key,'master':stats,'animationCompatibility':'identical nodes, inverse bind matrices, all 56 animation samplers and channels'},indent=2)+'\n')
    for folder,enabled in [('public',args.install),('dist',args.dist)]:
        if enabled:
            target=ROOT/folder/'assets/models/monsters'/NAME;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(dest,target.with_suffix('.tmp'));os.replace(target.with_suffix('.tmp'),target)
    print('FROSTALD_MASTER_OK '+json.dumps(stats))
if __name__=='__main__':main()
