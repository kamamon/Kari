"""Original-art anatomical projection; estimated PBR, not measured reflectance."""
from pathlib import Path
import hashlib,json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
VERSION='venolka-art-projection-v2'
PROFILES={'hide':(2048,.48,.74,.11),'belly':(1024,.54,.82,.06),'face':(2048,.46,.71,.10),'leg':(2048,.49,.77,.08),'feather':(2048,.62,.83,.06),'wing':(2048,.43,.76,.12),'sac':(1024,.25,.48,.32),'claw':(1024,.28,.55,.19),'beak':(1024,.28,.51,.18),'mouth':(1024,.16,.36,.24)}
def unit(v):return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1e-9)
def smooth(a,b,x):
 t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)
def luma(a):return a@np.array([.2126,.7152,.0722],np.float32)
def periodic(a):
 a=a.copy()
 for axis in (0,1):
  n=a.shape[axis];u=(np.arange(n,dtype=np.float32)+.5)/n;w=(1-smooth(.01,.12,np.minimum(u,1-u))).reshape([n if k==axis else 1 for k in range(a.ndim)]);a=a*(1-w)+np.roll(a,n//2,axis=axis)*w
 return a
def digest(root):
 h=hashlib.sha256()
 for f in sorted(root.glob('*.py'))+sorted((root/'material_source').glob('*')):
  if f.is_file():h.update(f.name.encode());h.update(f.read_bytes())
 return h.hexdigest()
def atlas_uv(uv,index,cols,rows):
 uv=np.array(uv,dtype=np.float32,copy=True);uv=np.clip(uv,0,1);uv=.045+.91*uv;uv[:,0]=(uv[:,0]+index%cols)/cols;uv[:,1]=(uv[:,1]+index//cols)/rows;return uv
def bake(source,out,hd):
 out.mkdir(parents=True,exist_ok=True);meta=json.loads((source/'provenance.json').read_text());results={}
 for i,(mat,(dim,lo,hi,coat)) in enumerate(PROFILES.items()):
  f=source/meta[mat]['file'];assert hashlib.sha256(f.read_bytes()).hexdigest()==meta[mat]['sha256'];N=dim if hd else dim//2
  a=np.asarray(Image.open(f).convert('RGB').resize((N,N),Image.Resampling.LANCZOS),np.float32)/255
  layout=meta[mat]['layout'];cols,rows=map(int,layout.split('x')) if 'x' in layout else (1,1)
  if layout=='periodic':a=periodic(a)
  for iy in range(rows):
   for ix in range(cols):
    ys=slice(round(iy*N/rows),round((iy+1)*N/rows));xs=slice(round(ix*N/cols),round((ix+1)*N/cols));p=a[ys,xs];lum=luma(p);mode='wrap' if layout=='periodic' else 'nearest';low=gaussian_filter(lum,max(3,min(p.shape[:2])/12),mode=mode);c=np.clip((np.median(low)+.09)/(low+.09),.76,1.28)**(.48 if mat in ('wing','feather','sac','belly','leg','face') else .68);p[:]=np.clip(p*c[...,None],0,1)
  if mat=='hide':a=np.clip(a*np.array([.97,1.04,.91],np.float32)+.018,0,1)
  if mat=='wing':a=np.clip(a*np.array([1.07,1.035,1.06],np.float32)+.015,0,1)
  if mat=='feather':a=np.clip(a*np.array([1.04,.99,1.06],np.float32)+.012,0,1)
  if mat=='belly':a=np.clip(a*1.15+.050,0,1)
  if mat=='sac':a=np.clip(a*1.03+.015,0,1)
  if mat in ('beak','claw'):a=np.clip(a*.83+.018,0,1)
  normal=np.zeros_like(a);orm=np.zeros_like(a)
  for iy in range(rows):
   for ix in range(cols):
    ys=slice(round(iy*N/rows),round((iy+1)*N/rows));xs=slice(round(ix*N/cols),round((ix+1)*N/cols));p=a[ys,xs];lum=luma(p);mode='wrap' if layout=='periodic' else 'nearest';k=max(2,min(p.shape[:2])/40);detail=lum-gaussian_filter(lum,k,mode=mode);h=.5+(1.4 if mat in ('hide','belly','leg','face','sac') else .77)*detail
    rng=np.random.default_rng(261128+i*17+iy*5+ix);h+=gaussian_filter(rng.standard_normal(h.shape,dtype=np.float32),.7,mode=mode)*.003
    gy,gx=np.gradient(h);strength=min(p.shape[:2])/(43 if mat in ('hide','belly','leg','face','sac') else 72);n=unit(np.stack([-gx*strength,-gy*strength,np.ones_like(h)],-1));normal[ys,xs]=n*.5+.5
    rough=lo+(hi-lo)*np.clip(.70-.40*lum-.32*detail,0,1);ao=np.clip(.94+.48*(h-.5),.70,1);orm[ys,xs]=np.stack([ao,rough,np.zeros_like(ao)],-1)
  Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5)).save(out/(mat+'_basecolor.jpg'),quality=95,subsampling=0)
  Image.fromarray(np.uint8(np.clip(normal,0,1)*255+.5)).save(out/(mat+'_normal.png'),compress_level=4)
  Image.fromarray(np.uint8(np.clip(orm,0,1)*255+.5)).save(out/(mat+'_orm.png'),compress_level=4)
  results[mat]={'source':mat,'resolution':N,'layout':layout,'sourceSha256':meta[mat]['sha256'],'roughnessRange':[float(orm[...,1].min()),float(orm[...,1].max())],'normalVariation':float(normal[...,:2].std()*2),'clearcoat':coat}
 return results
