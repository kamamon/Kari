"""Reproducible build of the two skinned models; split HD files below GitHub's 100MB limit."""
from pathlib import Path
import hashlib,json,os,struct,subprocess,sys,tempfile,shutil
from PIL import Image
import numpy as np
P=Path(__file__).parent;ROOT=P.parent.parent;AS=ROOT/'public/assets';TARGET=AS/'models/monsters';TARGET.mkdir(parents=True,exist_ok=True)
from materials import digest,VERSION
key=digest(P);CACHE=ROOT/'tools/out/venolka';CACHE.mkdir(parents=True,exist_ok=True)
def parse(p):
 b=p.read_bytes();magic,v,size=struct.unpack_from('<4sII',b);assert magic==b'glTF' and v==2 and size==len(b);n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);return g,memoryview(b)[28+n:]
def validate(p,quality):
 g,b=parse(p);assert g['extras']['sourceSha256']==key and g['extras']['quality']==quality and g['extras']['materialDesign']==VERSION;assert len(g['skins'][0]['joints'])==111 and len(g['animations'])==56
 tris=0
 for pr in g['meshes'][0]['primitives']:
  def acc(k):
   a=g['accessors'][k];v=g['bufferViews'][a['bufferView']];typ={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];return np.frombuffer(b,dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[a['componentType']],offset=v.get('byteOffset',0)+a.get('byteOffset',0),count=a['count']*typ)
  at=pr['attributes'];p0=acc(at['POSITION']);w=acc(at['WEIGHTS_0']).reshape(-1,4);j=acc(at['JOINTS_0']);f=acc(pr['indices']);assert f.max()<len(p0)//3 and j.max()<111 and np.isfinite(p0).all() and np.isfinite(w).all() and (w>=0).all() and np.max(abs(w.sum(1)-1))<1e-5;tris+=len(f)//3
 assert tris==(285404 if quality=='game' else 2298702),(quality,tris)
 assert len(g['extras']['materialMaps'])==10
 assert g['extras']['materialMaps']['wing']['layout']=='3x2' and g['extras']['materialMaps']['feather']['layout']=='4x2' and g['extras']['materialMaps']['face']['layout']=='2x1'
 return g,b,tris
for q in ('game','master'):
 f=CACHE/f'venolka_{q}.glb'
 try:g,b,tris=validate(f,q)
 except Exception:
  subprocess.run([sys.executable,str(P/'build_venolka.py'),'--quality',q,'--out',str(CACHE)],check=True,env={**os.environ,'OPENBLAS_NUM_THREADS':'1'});g,b,tris=validate(f,q)
 if q=='game':
  shutil.copyfile(f,TARGET/f.name)
  game_keys=[(a['name'],[(c['target'],bytes(b[g['bufferViews'][g['accessors'][a['samplers'][c['sampler']]['output']]['bufferView']]['byteOffset']:][:g['bufferViews'][g['accessors'][a['samplers'][c['sampler']]['output']]['bufferView']]['byteLength']])) for c in a['channels']]) for a in g['animations']];game_nodes=g['nodes'];del b
 else:
  assert g['nodes']==game_nodes
  for a,(name,channels) in zip(g['animations'],game_keys):
   assert a['name']==name
   for c,(t,raw) in zip(a['channels'],channels):
    v=g['bufferViews'][g['accessors'][a['samplers'][c['sampler']]['output']]['bufferView']];assert c['target']==t and b[v['byteOffset']:v['byteOffset']+v['byteLength']]==raw
  dest=TARGET/'venolka_hd';dest.mkdir(exist_ok=True);groups=[];chunks=bytearray();orig=[]
  for v in g['bufferViews']:
   off=v.get('byteOffset',0);length=v['byteLength'];assert length<80_000_000
   if len(chunks)+length>32*1024*1024 and chunks:groups.append(chunks);chunks=bytearray()
   chunks.extend(b'\0'*((-len(chunks))%4));v['buffer']=len(groups);v['byteOffset']=len(chunks);raw=b[off:off+length];chunks.extend(raw);orig.append((off,length))
  if chunks:groups.append(chunks)
  g['buffers']=[];files={}
  for i,chunk in enumerate(groups):
   name=f'chunk_{i:02}.bin';(dest/name).write_bytes(chunk);g['buffers'].append({'uri':name,'byteLength':len(chunk)});files[name]={'bytes':len(chunk),'sha256':hashlib.sha256(chunk).hexdigest()}
  for v,(off,n) in zip(g['bufferViews'],orig):assert memoryview(groups[v['buffer']])[v['byteOffset']:v['byteOffset']+n]==b[off:off+n]
  (dest/'venolka.gltf').write_text(json.dumps(g,separators=(',',':')));(dest/'delivery.json').write_text(json.dumps({'triangles':tris,'joints':111,'clips':56,'sourceSha256':key,'materialDesign':VERSION,'files':files},indent=2));del b,groups,chunks
 print('Venolka',q,tris,'triangles, 111 joints, 56 clips',flush=True)
for f in ('venolka_concept.webp',):
 target=AS/'bestiary'/f;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(P/f,target)
# Actual independent icon assets are stored as a compact source atlas and expanded to 256px.
index=json.loads((P/'data/icon_index.json').read_text());atlas=Image.open(P/'icon_atlas.webp').convert('RGBA')
for id,e in index.items():
 x,y=e['column']*128,e['row']*128;dest=AS/'icons/venolka'/e['file'];dest.parent.mkdir(parents=True,exist_ok=True);atlas.crop((x,y,x+128,y+128)).resize((256,256),Image.Resampling.LANCZOS).save(dest,lossless=True)
print('Venolka 69 icons installed; all bufferViews and 56 animation outputs matched',flush=True)
