"""PBR maps derived from original art; no external generator. Native crops are small, so detail is estimated."""
from pathlib import Path
import json,hashlib
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
VERSION='venolka-pbr-v1'
PROFILES={
'hide':(2048,.48,.70,.12),'belly':(1024,.52,.78,.07),'face':(1024,.47,.69,.08),'leg':(1024,.50,.76,.07),
'feather':(2048,.47,.73,.13),'wing':(2048,.34,.64,.21),'sac':(1024,.23,.48,.30),'claw':(1024,.31,.52,.20),'beak':(1024,.30,.50,.16),'mouth':(1024,.15,.32,.25)}
def unit(v):return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-9)
def smooth(a,b,x):
 t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
def luma(a):return a@np.array([.2126,.7152,.0722],np.float32)
def periodic(a):
 a=a.copy()
 for axis in (0,1):
  n=a.shape[axis];u=(np.arange(n,dtype=np.float32)+.5)/n;w=(1-smooth(.02,.15,np.minimum(u,1-u))).reshape([n if k==axis else 1 for k in range(a.ndim)]);a=a*(1-w)+np.roll(a,n//2,axis=axis)*w
 return a

def digest(root):
 h=hashlib.sha256()
 for f in sorted(root.glob('*.py'))+sorted((root/'material_source').glob('*')):
  if f.is_file():h.update(f.name.encode());h.update(f.read_bytes())
 return h.hexdigest()

def bake(source,out,hd):
 out.mkdir(parents=True,exist_ok=True);meta=json.loads((source/'provenance.json').read_text());results={}
 for i,(mat,(dim,lo,hi,coat)) in enumerate(PROFILES.items()):
  f=source/meta[mat]['file'];assert hashlib.sha256(f.read_bytes()).hexdigest()==meta[mat]['sha256'];N=dim if hd else dim//2
  a=np.asarray(Image.open(f).convert('RGB').resize((512,512),Image.Resampling.LANCZOS),np.float32)/255
  a=periodic(a);lum=luma(a);broad=gaussian_filter(lum,32,mode='wrap');correction=np.clip((np.median(broad)+.04)/(broad+.04),.65,1.45)**.9;a=np.clip(a*correction[...,None],0,1)
  # Source art pigment and scale/vein pattern, not a blue or purple multiplied procedural checker.
  if mat=='hide':a=.89*a+np.array([.035,.053,.018])
  elif mat=='wing':a=.92*a+np.array([.039,.020,.042])
  elif mat in ('face','belly','leg','sac'):
   # Harmonise source pigment across anatomy; retain the actual different scale/skin patterns.
   skin=np.asarray(Image.open(source/'hide.webp').convert('RGB').resize((512,512),Image.Resampling.LANCZOS),np.float32)/255;skin=periodic(skin)
   base=np.array([.38,.40,.26]);avg=a.mean((0,1));target=np.array([.47,.44,.33]) if mat=='belly' else np.array([.40,.40,.30]) if mat=='leg' else base if mat=='face' else np.array([.52,.40,.31]);a=np.clip(a+(target-avg)*.80,0,1)
   blend={'face':.52,'belly':.19,'leg':.27,'sac':.21}[mat];a=(1-blend)*a+blend*skin
  elif mat=='feather':a=.95*a+np.array([.032,.013,.035])
  elif mat=='beak':a=.76*a+np.array([.030,.023,.019])
  elif mat=='mouth':a=.85*a+np.array([.032,.010,.018])
  a=np.clip(a,0,1);a=np.asarray(Image.fromarray(np.uint8(a*255)).resize((N,N),Image.Resampling.LANCZOS),np.float32)/255
  lum=luma(a);rng=np.random.default_rng(61128+i);grain=rng.standard_normal((N,N),dtype=np.float32);grain=gaussian_filter(grain,.75,mode='wrap');grain/=max(.01,grain.std());detail=lum-gaussian_filter(lum,N/36,mode='wrap');h=np.clip(.5+1.4*detail+.009*grain,0,1)
  if mat in ('feather','wing','beak','claw'):
   u=(np.arange(N,dtype=np.float32)+.5)/N;v=u[:,None];# irregular directional fibers rather than uniform ribbed plastic
   direction=(u[None,:]*56+v*8+.32*np.sin(v*19)) if mat=='feather' else (u[None,:]*29+.25*np.sin(v*11));h+=.014*np.sin(direction*2*np.pi)*(.5+.5*gaussian_filter(np.abs(grain),4,mode='wrap'))
  strength=(.75 if mat in ('hide','belly','leg') else .45)*N/54;gx=(np.roll(h,-1,axis=1)-np.roll(h,1,axis=1))*.5*strength;gy=(np.roll(h,-1,axis=0)-np.roll(h,1,axis=0))*.5*strength;n=unit(np.stack([-gx,-gy,np.ones_like(h)],-1));rough=lo+(hi-lo)*np.clip(.62-.52*lum-.45*detail,0,1);ao=np.clip(.92+.65*(h-.5),.58,1);orm=np.stack([ao,rough,np.zeros_like(ao)],-1)
  Image.fromarray(np.uint8(a*255+.5)).save(out/(mat+'_basecolor.jpg'),quality=93,subsampling=0)
  Image.fromarray(np.uint8(np.clip(n*.5+.5,0,1)*255+.5)).save(out/(mat+'_normal.png'),compress_level=4)
  Image.fromarray(np.uint8(np.clip(orm,0,1)*255+.5)).save(out/(mat+'_orm.png'),compress_level=4)
  results[mat]={'source':mat,'resolution':N,'roughnessRange':[float(rough.min()),float(rough.max())],'normalVariation':float(n[...,:2].std()),'clearcoat':coat}
 return results
