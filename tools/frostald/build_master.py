"""Generate and verify the approved high-density Frostald mesh, in an isolated texture directory.

Normal predev/prebuild/pretest generate and install the full-density model.
--install writes the exact master as glTF with split binary buffers into public.
--dist installs the same split assets into an already built preview.
The raw master remains in tools/out and is never published as a >100MB Git blob.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, struct, subprocess, sys, tempfile
import numpy as np
from material_atlas import VERSION as MATERIAL_DESIGN,PROFILES,source_digest

P=Path(__file__).resolve().parent
ROOT=P.parent.parent
WORK=ROOT/'tools/out/frostald-master'
GAME=ROOT/'public/assets/models/monsters/frostald_game.glb'
NAME='frostald_master.glb'
SRC=P/'build_frostald.py'
EXPECTED=2283726
EYE_DESIGN='calm-blue-v1'
PART_LIMIT=32*1024*1024

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
        assert g.get('extras',{}).get('eyeDesign')==EYE_DESIGN
        assert g['extras'].get('materialDesign')==MATERIAL_DESIGN and g['extras'].get('materialSourceSha256')==source_digest(P/'material_source')
        assert set(g['extras']['materialMaps'])==set(PROFILES)
        for mat in g['materials']:
            if mat['name'] in PROFILES:
                assert all(k in mat['pbrMetallicRoughness'] for k in ('baseColorTexture','metallicRoughnessTexture')) and 'normalTexture' in mat and 'occlusionTexture' in mat
                assert mat['extras']['maps']['normalVariation']>.01
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

def publish_split(master,target,stats):
    # External glTF buffers preserve every source bufferView byte (positions, indices,
    # all textures, skin data, and animation keys). Split only at view boundaries.
    # GitHub rejects single files above 100 MB, so no raw master GLB in public/dist.
    target=Path(target); target.parent.mkdir(parents=True,exist_ok=True)
    manifest=target/'delivery.json'
    if manifest.is_file():
        try:
            old=json.loads(manifest.read_text())
            if old['sourceSha256']==stats['sha256'] and old['eyeDesign']==EYE_DESIGN and old.get('materialDesign')==MATERIAL_DESIGN and old['format']==1 and all((target/name).stat().st_size==info['bytes'] and sha(target/name)==info['sha256'] for name,info in old['files'].items()):
                print('FROSTALD_HD_DELIVERY_CACHED '+json.dumps(old['files']));return
        except (OSError,KeyError,ValueError):pass
    with tempfile.TemporaryDirectory(prefix='frostald-hd-',dir=target.parent) as temp:
        work=Path(temp)
        with GLB(master) as src:
            g=src.g
            buffers=[];part=None;out=None;used=0
            def close_part():
                if out is not None:
                    out.close();buffers.append({'uri':part.name,'byteLength':used})
            try:
                for view in g['bufferViews']:
                    length=view['byteLength'];offset=view.get('byteOffset',0)
                    pad=(-used)%4
                    if out is None or (used and used+pad+length>PART_LIMIT):
                        close_part();part=work/('buffer-%02d.bin'%len(buffers));out=part.open('wb');used=0;pad=0
                    if length>=90_000_000:raise ValueError('single view exceeds publish budget')
                    out.write(b'\0'*pad);used+=pad
                    src.f.seek(src.base+offset)
                    data=src.f.read(length)
                    if len(data)!=length:raise ValueError('truncated bufferView')
                    out.write(data)
                    view['buffer']=len(buffers);view['byteOffset']=used;used+=length
                close_part();out=None
            finally:
                if out is not None:out.close()
            g['buffers']=buffers
            # Re-read all mapped views and compare to the unmodified source GLB.
            with GLB(master) as original:
                handles=[(work/b['uri']).open('rb') for b in buffers]
                try:
                    for before,after in zip(original.g['bufferViews'],g['bufferViews']):
                        original.f.seek(original.base+before.get('byteOffset',0))
                        f=handles[after['buffer']];f.seek(after['byteOffset'])
                        n=before['byteLength']
                        if f.read(n)!=original.f.read(n):raise ValueError('split data mismatch')
                finally:
                    for f in handles:f.close()
            (work/'frostald.gltf').write_text(json.dumps(g,separators=(',',':'))+'\n')
        files={p.name:{'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(work.iterdir()) if p.is_file()}
        if not files or max(x['bytes'] for x in files.values())>=90_000_000:raise ValueError('asset exceeds GitHub file budget')
        (work/'delivery.json').write_text(json.dumps({'format':1,'eyeDesign':EYE_DESIGN,'materialDesign':MATERIAL_DESIGN,'sourceSha256':stats['sha256'],'triangles':stats['triangles'],'joints':79,'clips':56,'files':files},indent=2)+'\n')
        # All outputs are generated assets in a dedicated directory; replace only that directory.
        if target.exists():shutil.rmtree(target)
        shutil.copytree(work,target)
        print('FROSTALD_HD_DELIVERY_OK '+json.dumps({'files':len(files),'bytes':sum(x['bytes'] for x in files.values()),'largest':max(x['bytes'] for x in files.values()),'triangles':stats['triangles']}))

def main():
    cli=argparse.ArgumentParser();cli.add_argument('--install',action='store_true');cli.add_argument('--dist',action='store_true')
    args=cli.parse_args()
    if not GAME.is_file():raise RuntimeError('Run npm run frostald:build first')
    WORK.mkdir(parents=True,exist_ok=True);dest=WORK/NAME;meta=WORK/'verification.json'
    # Both source and reference game hash participate in the cache key.
    key={'sourceSha256':sha(SRC),'materialSourceSha256':source_digest(P/'material_source'),'gameSha256':sha(GAME),'lod':3.5,'textureSize':2048}
    old=json.loads(meta.read_text()) if meta.is_file() else {}
    if not dest.is_file() or old.get('key')!=key:
        with tempfile.TemporaryDirectory(prefix='frostald-master-') as temp:
            p=Path(temp);script=p/SRC.name;shutil.copyfile(SRC,script)
            shutil.copyfile(P/'material_atlas.py',p/'material_atlas.py');shutil.copytree(P/'material_source',p/'material_source')
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
            target=ROOT/folder/'assets/models/monsters'
            publish_split(dest,target/'frostald_hd',stats)
            # Remove only the obsolete generated master path from older development builds.
            (target/NAME).unlink(missing_ok=True)
    print('FROSTALD_MASTER_OK '+json.dumps(stats))
if __name__=='__main__':main()
