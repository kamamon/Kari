"""Split original icon atlases and install the deterministic game mesh/terrain art. No online API."""
from pathlib import Path
import json,subprocess,sys,os,shutil,hashlib,struct,tempfile
from PIL import Image
P=Path(__file__).parent;ROOT=P.parent.parent;PUBLIC=ROOT/'public/assets';OUT=PUBLIC/'models/monsters/frostald_game.glb';D=P/'data';A=P/'art'
OUT.parent.mkdir(parents=True,exist_ok=True)
def valid(p):
 try:
  with p.open('rb') as f:
   h=f.read(20);n=struct.unpack_from('<I',h,12)[0];g=json.loads(f.read(n));return h[:4]==b'glTF' and g.get('extras',{}).get('eyeDesign')=='calm-blue-v1' and len(g['skins'][0]['joints'])==79 and len(g['animations'])==56 and sum(g['accessors'][x['indices']]['count']//3 for m in g['meshes'] for x in m['primitives'])==329250
 except Exception:return False
if not valid(OUT):
 with tempfile.TemporaryDirectory(prefix='frostald-game-') as temp:
  work=Path(temp);script=work/'build_frostald.py';shutil.copyfile(P/'build_frostald.py',script)
  subprocess.run([sys.executable,str(script)],check=True,cwd=work,env={**os.environ,'FROST_LOD':'1.25','FROST_TEX':'1024','FROST_SUFFIX':'game'})
  if not valid(work/'frostald_game.glb'):raise RuntimeError('invalid Frostald GLB')
  shutil.copyfile(work/'frostald_game.glb',OUT.with_suffix('.tmp'));os.replace(OUT.with_suffix('.tmp'),OUT)
index=json.loads((D/'icon_index.json').read_text());ims={}
for id,ent in index.items():
 dst=PUBLIC/'icons/frostald'/ent['file'];dst.parent.mkdir(parents=True,exist_ok=True)
 if not dst.exists():
  if ent['atlas'] not in ims:ims[ent['atlas']]=Image.open(A/(ent['atlas']+'.webp')).convert('RGBA')
  x=ent['column']*192;y=ent['row']*192;ims[ent['atlas']].crop((x,y,x+192,y+192)).resize((256,256),Image.Resampling.LANCZOS).save(dst,lossless=True)
for src,dst in [('snow.webp','textures/materials/frost_snow_detail.webp'),('ice.webp','textures/materials/frost_ice_detail.webp'),('frostald_concept.webp','bestiary/frostald_concept.webp'),('whitefrost_concept.webp','fields/whitefrost_concept.webp')]:
 dest=PUBLIC/dst;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(A/src,dest)
print('Frostald GLB',OUT.stat().st_size,'bytes, 329250 triangles, 79 joints, 56 clips; 69 icons; SHA256',hashlib.sha256(OUT.read_bytes()).hexdigest())
