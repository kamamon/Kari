"""Frostald material bake from original generated atlas crops.
Color/height estimates are image-derived, not measured reflectance. No external services.
Preserves all geometry, indices, weights and animation keys; only UVs, material groups and vertex colors change.
"""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

VERSION='frostald-art-pbr-v1'
# game delivery map dimensions: 2K main surfaces; smaller details 1K (half for mobile).
PROFILES={
 'hide':       dict(source='skin', resolution=2048, rough=(.43,.76), height=.58, coat=.12),
 'head_skin':  dict(source='head', resolution=2048, rough=(.43,.72), height=.48, coat=.14),
 'limb_skin':  dict(source='skin', resolution=1024, rough=(.39,.71), height=.60, coat=.15),
 'belly_skin': dict(source='belly',resolution=1024, rough=(.49,.77), height=.46, coat=.08),
 'keratin':    dict(source='ice',  resolution=2048, rough=(.17,.43), height=.38, coat=.42),
 'ice_plate':  dict(source='plate',resolution=1024, rough=(.22,.53), height=.55, coat=.27),
 'claw':       dict(source='claw', resolution=1024, rough=(.26,.48), height=.40, coat=.19),
 'feather':    dict(source='mane', resolution=2048, rough=(.35,.78), height=.46, coat=.20),
 'membrane':   dict(source='wet',  resolution=1024, rough=(.24,.49), height=.32, coat=.23),
 'mouth':      dict(source='mouth',resolution=1024, rough=(.12,.32), height=.36, coat=.35),
}

def smooth(a,b,x):
    t=np.clip((x-a)/(b-a),0,1);return t*t*(3-2*t)

def linear(c):
    c=np.clip(c,0,1);return np.where(c<.04045,c/12.92,((c+.055)/1.055)**2.4).astype(np.float32)

def periodic(a):
    # Crossfade original boundaries with an offset interior, on each axis independently.
    # Periodic edges use exactly the same sampling function; no mirrored scale rows.
    a=a.astype(np.float32,copy=True)
    for ax in (0,1):
        n=a.shape[ax];coord=(np.arange(n,dtype=np.float32)+.5)/n;edge=np.minimum(coord,1-coord)
        w=1-smooth(.025,.16,edge);shape=[1]*a.ndim;shape[ax]=n;w=w.reshape(shape)
        a=a*(1-w)+np.roll(a,n//2,axis=ax)*w
    return a

def luma(x):return x[...,0]*.2126+x[...,1]*.7152+x[...,2]*.0722

def source_digest(source):
    # Invalidate GLB caches when source pixels, provenance or baker change.
    h=hashlib.sha256(Path(__file__).read_bytes())
    for f in sorted(source.iterdir()):
        if f.is_file():h.update(f.name.encode());h.update(f.read_bytes())
    return h.hexdigest()

def src_tiles(source):
    meta=json.loads((source/'provenance.json').read_text(encoding='utf8'));tiles={}
    for name,record in meta.items():
        f=source/record['file'];assert hashlib.sha256(f.read_bytes()).hexdigest()==record['sha256'],name
        a=np.asarray(Image.open(f).convert('RGB').resize((512,512),Image.Resampling.LANCZOS),dtype=np.float32)/255
        a=periodic(a)
        # Remove broad baked lighting only, retaining scale borders and fine color mottling.
        lum=luma(a);broad=gaussian_filter(lum,34,mode='wrap');median=np.median(broad)
        correction=np.clip((median+.08)/(broad+.08),.72,1.30)**.72
        a=np.clip(a*correction[...,None],0,1)
        # Compress hard highlights in skin, preserving stronger crystalline white in ice/frost.
        if name in ('skin','head','belly','claw','mouth','wet'):
            lum=luma(a);hi=smooth(.72,1.,lum);a*= (1-.13*hi)[...,None]
        tiles[name]=a
    return tiles

def resize_float(x,n):
    if x.ndim==2:return np.asarray(Image.fromarray(x.astype(np.float32)).resize((n,n),Image.Resampling.BICUBIC),np.float32)
    # Use 8bit working color for compact memory and deterministic export.
    return np.asarray(Image.fromarray(np.uint8(np.clip(x,0,1)*255)).resize((n,n),Image.Resampling.BICUBIC),np.float32)/255

def build_tile(name,tiles):
    """Base map and independent wet/frost masks in a 1024px material work tile."""
    s=1024;u=(np.arange(s,dtype=np.float32)+.5)[None,:]/s;v=(np.arange(s,dtype=np.float32)+.5)[:,None]/s
    def rep(key,rx=2,ry=2):
        a=tiles[key];ix=(np.arange(s)*rx*len(a)//s)%len(a);iy=(np.arange(s)*ry*len(a)//s)%len(a);return a[iy[:,None],ix[None,:]]
    color=rep(PROFILES[name]['source'],1,1);wet=np.zeros((s,s),np.float32);frost=wet.copy()
    if name=='hide':
        # Axial tube is head->tail; its +V tangent is local -Z, and sin(U angle)>0 is ventral.
        # Repeat different image patches around its circumference, blend actual pale belly scales.
        dorsal=rep('skin',6,2);belly=rep('belly',6,2);wet_tile=rep('wet',6,2)
        sin=np.sin(u*2*np.pi);ventral=smooth(.28,.74,sin)
        wet=np.broadcast_to((1-ventral)*(.12+.35*np.abs(np.cos(u*2*np.pi)))*(.8+.2*np.cos(v*2*np.pi)),(s,s)).copy()
        dorsal=dorsal*(1-.22*wet[...,None])+wet_tile*.22*wet[...,None]
        color=dorsal*(1-ventral[...,None])+belly*ventral[...,None]
        f=smooth(.48,.80,luma(rep('frost',6,3)))
        frost=(1-ventral)*smooth(.28,.88,-sin)*f*.36
    elif name=='head_skin':
        color=.88*color+.12*rep('skin',1,1);wet=.22+.22*smooth(.35,.8,luma(color));frost=smooth(.58,.88,luma(rep('frost',2,2)))*.10
    elif name=='limb_skin':
        wet=.16+.37*smooth(.32,.72,luma(rep('wet',1,1)));color=color*(1-.12*wet[...,None])+rep('wet',1,1)*.12*wet[...,None]
        frost=smooth(.58,.88,luma(rep('frost',2,2)))*.12
    elif name=='belly_skin':wet=.18+.13*smooth(.4,.8,luma(color))
    elif name in ('keratin','ice_plate','feather'):
        # Rime accumulates toward the tips of the UV-oriented plates and mane.
        flecks=rep('frost',2,3);tip=smooth(.36,.92,v)
        frost=smooth(.46,.83,luma(flecks))*(.13+.67*tip)*(1.0 if name=='feather' else .75)
        color=color*(1-.16*frost[...,None])+np.array([.89,.94,.98],np.float32)*(.16*frost[...,None])
        wet=.30*(1-frost)
    elif name=='membrane':
        # The brine sac is wet skin, not an opaque ice crystal.
        color=.65*rep('head')+.35*rep('wet');wet=np.full((s,s),.82,np.float32)
    elif name=='mouth':wet=.78+.16*smooth(.35,.72,luma(color))
    elif name=='claw':wet=.2+.2*smooth(.32,.8,luma(color))
    if name in ('hide','head_skin','limb_skin'):
        color=color*(1-.19*frost[...,None])+rep('frost',4,4)*(.19*frost[...,None])
    return np.clip(color,0,1),np.broadcast_to(wet,(s,s)).copy(),np.broadcast_to(frost,(s,s)).copy()

def save_jpeg(path,a):Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5)).save(path,quality=94,subsampling=0,optimize=True)
def save_png(path,a):Image.fromarray(np.uint8(np.clip(a,0,1)*255+.5)).save(path,compress_level=4)

def bake_maps(source,out,quality=2048,master=None):
    """Bake PBR using a 4K working color master; preserve roughness/height provenance."""
    out.mkdir(parents=True,exist_ok=True);tiles=src_tiles(source);summary={}
    for i,(name,p) in enumerate(PROFILES.items()):
        c,w,f=build_tile(name,tiles);n=min(p['resolution'],quality if p['resolution']>=2048 else max(512,quality//2))
        # Main surfaces 2K, small parts 1K; 1K/512 for explicit mobile LOD.
        # Native atlas crops are 116--280px. 4K is an interpolated working canvas, not native 4K capture.
        master_rgb=Image.fromarray(np.uint8(np.clip(c,0,1)*255+.5)).resize((4096,4096),Image.Resampling.BICUBIC)
        if master:
            master.mkdir(parents=True,exist_ok=True);master_rgb.save(master/(name+'_basecolor_4k.jpg'),quality=94,subsampling=0,optimize=True)
        c=np.asarray(master_rgb.resize((n,n),Image.Resampling.LANCZOS),np.float32)/255;del master_rgb
        wet=np.clip(resize_float(w,n),0,1);frost=np.clip(resize_float(f,n),0,1)
        lum=luma(c);mid=gaussian_filter(lum,max(2,n/96),mode='wrap');low=gaussian_filter(lum,max(4,n/30),mode='wrap')
        # Approximate height: combine scale contours and fine grain, not a recovered real depth map.
        contrast=(lum-mid);height=np.clip(.52+1.55*(lum-low)+.65*contrast,0,1)
        rng=np.random.default_rng(9137+i);detail=rng.standard_normal((n,n),dtype=np.float32);detail=gaussian_filter(detail,.65,mode='wrap');detail/=max(1e-5,float(detail.std()))
        height=np.clip(gaussian_filter(height,.75,mode='wrap')+detail*.014+frost*.075,0,1)
        # Wrap-aware gradient avoids a discontinuity on the tiled surface. glTF tangent normal.
        strength=p['height']*n/60
        gx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*.5*strength
        gy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*.5*strength
        normal=np.stack([-gx,-gy,np.ones_like(gx)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
        lo,hi=p['rough'];rough=lo+(hi-lo)*np.clip(.60-.56*wet+.48*frost-.24*contrast,0,1)
        ao=np.clip(.93+.32*(height-.55)-.12*np.maximum(0,-contrast),.65,1.)
        orm=np.stack([ao,rough,np.zeros_like(ao)],axis=-1)
        save_jpeg(out/(name+'_basecolor.jpg'),c);save_png(out/(name+'_normal.png'),normal*.5+.5);save_png(out/(name+'_orm.png'),orm)
        # Height and masks are kept in the work/authoring output, not sent as extra GPU maps.
        if master:
            save_png(master/(name+'_height.png'),height);save_png(master/(name+'_wet_mask.png'),wet);save_png(master/(name+'_frost_mask.png'),frost)
        summary[name]={'resolution':n,'source':p['source'],'roughnessRange':[round(float(rough.min()),3),round(float(rough.max()),3)],'clearcoat':p['coat'],'meanRGB':np.round(c.mean((0,1)),3).tolist(),'normalVariation':round(float(normal[...,:2].std()),4)}
    (out/'material_manifest.json').write_text(json.dumps({'version':VERSION,'sourceResolution':'native cropped patches; 4K resampled work canvas','maps':summary},indent=2)+'\n')
    return summary

def apply_materials(mesh,bones):
    """Remap the existing per-piece UVs. No position, index, normal or skin change."""
    groups={};before=sum(sum(len(x) for x in g['f']) for g in mesh.values())
    for mat,g in mesh.items():
        for i,p in enumerate(g['p']):
            p=np.asarray(p);uv=g['uv'][i].copy();c=g['c'][i].copy();j=g['j'][i];w=g['w'][i]
            bone_names=[bones[int(k)][0] for k in np.unique(j[:,0])];name=mat
            if mat=='hide':
                if np.ptp(p[:,2])>5:
                    name='hide';uv[:,0]/=max(float(uv[:,0].max()),1e-6);uv[:,1]*=.65
                elif np.ptp(uv[:,0])<.10 and np.ptp(uv[:,1])<.10:
                    name='ice_plate';uv=(uv-uv.min(axis=0))/np.maximum(np.ptp(uv,axis=0),1e-6)
                elif all(x=='jaw' for x in bone_names):name='belly_skin';uv*=.85
                elif any(x in ('head','snout','jaw') or x.startswith('lid_') for x in bone_names):name='head_skin';uv*=.70
                else:name='limb_skin';uv*=.78
            elif mat=='keratin':
                name='claw' if any('toe' in x for x in bone_names) else 'ice_plate' if any(x.startswith(('fore_','hind_','tail_','dorsal_')) for x in bone_names) else 'keratin'
            if name in PROFILES:
                # Image carries the actual pigment. Avoid multiplying it by the old blue/black vertex tint.
                if name in ('hide','limb_skin','head_skin','belly_skin'):
                    var=.94+.035*np.sin(p[:,2]*3.2+p[:,1]*5)+.015*np.cos(p[:,0]*15-p[:,2]*2)
                elif name in ('keratin','ice_plate','feather'):
                    var=.86+.14*np.clip(uv[:,1]%1,0,1)
                else:var=np.full(len(p),.96,np.float32)
                c[:]=linear(np.repeat(var[:,None],3,axis=1))
            # Existing indices in each group include an offset; rebase without changing triangles.
            dst=groups.setdefault(name,{k:[] for k in g});old_offset=sum(len(x) for x in g['p'][:i]);new_offset=sum(len(x) for x in dst['p'])
            for k in g:
                val=uv if k=='uv' else c if k=='c' else (g[k][i]-old_offset+new_offset).astype(np.uint32) if k=='f' else g[k][i]
                dst[k].append(val)
    assert before==sum(sum(len(x) for x in g['f']) for g in groups.values())
    return groups

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('source',type=Path);ap.add_argument('out',type=Path);ap.add_argument('--quality',type=int,default=2048);ap.add_argument('--master',type=Path);a=ap.parse_args();print(json.dumps(bake_maps(a.source,a.out,a.quality,a.master),indent=2))
