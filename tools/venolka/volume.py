"""Venolka common implicit-surface utility, based on Frostald V6: connected implicit skin, anatomy-aware weights, inset facial anatomy,
hand-shaped ice blades. All distances are metres; reuses the 79-node rig unchanged.
No model-generation service or external art. Source references are original Frostald art.
"""
import math
import numpy as np
from scipy.ndimage import map_coordinates, gaussian_filter
from skimage.measure import marching_cubes
from PIL import Image

VERSION='organic-v6'
PI=np.pi

def unit(v):
    return v/np.maximum(np.linalg.norm(v,axis=-1,keepdims=True),1.e-10)
def smooth(lo,hi,v):
    t=np.clip((v-lo)/(hi-lo),0,1);return t*t*(3-2*t)
def linear(c):
    c=np.clip(c,0,1);return np.where(c<.04045,c/12.92,((c+.055)/1.055)**2.4).astype(np.float32)

class Volume:
    """Localized signed-distance union. Blend controls are actual joint/skin volume, not overlap meshes."""
    def __init__(self,bounds,h):
        self.h=h;self.lo=np.array(bounds[0],np.float32);self.hi=np.array(bounds[1],np.float32)
        self.shape=tuple(np.ceil((self.hi-self.lo)/h).astype(int)+1)
        self.axes=[self.lo[i]+np.arange(n,dtype=np.float32)*h for i,n in enumerate(self.shape)]
        self.f=np.full(self.shape,1.0,np.float32)
    def ell(self,c,r,k=.085,axes=None,cut=False):
        c=np.array(c,np.float32);r=np.array(r,np.float32);A=np.eye(3,dtype=np.float32) if axes is None else np.array(axes,np.float32)
        extent=np.sqrt((A*A)@(r*r))+.13+2*k
        lo=np.maximum(0,np.floor((c-extent-self.lo)/self.h).astype(int));hi=np.minimum(self.shape,np.ceil((c+extent-self.lo)/self.h).astype(int)+1)
        if np.any(hi<=lo):return
        sl=tuple(slice(int(x),int(y)) for x,y in zip(lo,hi));x,y,z=np.ix_(*[self.axes[i][sl[i]]-c[i] for i in range(3)])
        a=(x*A[0,0]+y*A[1,0]+z*A[2,0])/r[0];b=(x*A[0,1]+y*A[1,1]+z*A[2,1])/r[1];d=(x*A[0,2]+y*A[1,2]+z*A[2,2])/r[2]
        q=np.sqrt(a*a+b*b+d*d);q2=np.sqrt((a/r[0])**2+(b/r[1])**2+(d/r[2])**2);s=np.where(q2>1.e-7,q*(q-1)/np.maximum(q2,1.e-7),-min(r)).astype(np.float32)
        old=self.f[sl]
        if cut:
            s=-s;t=np.maximum(k-np.abs(old-s),0)/max(k,1.e-6);old[:]=np.maximum(old,s)+t*t*k*.25
        else:
            t=np.maximum(k-np.abs(old-s),0)/max(k,1.e-6);old[:]=np.minimum(old,s)-t*t*k*.25
    def segment(self,a,b,rx,rz,k=.10,overlap=.18):
        a=np.asarray(a);b=np.asarray(b);v=unit(b-a);ref=np.array([1.,0,0]);x=unit(ref-v*(v@ref));
        if np.linalg.norm(x)<.5:x=unit(np.cross(v,[0,0,1.]))
        z=unit(np.cross(x,v));self.ell((a+b)*.5,[rx,np.linalg.norm(b-a)*.5+overlap,rz],k,np.stack([x,v,z],1))
    def value(self,p):
        return map_coordinates(self.f,((np.asarray(p)-self.lo)/self.h).T,order=1,mode='constant',cval=1.)
    def surface(self,origin,normal):
        ts=np.linspace(0,1.7,170,dtype=np.float32);p=np.asarray(origin)+ts[:,None]*np.asarray(normal);inside=self.value(p)<0
        inds=np.flatnonzero(inside)
        if not len(inds):return np.asarray(origin)
        i=inds[-1]
        if i>=len(ts)-1:return p[i]
        a,b=ts[i],ts[i+1]
        for _ in range(9):
            m=(a+b)*.5
            if self.value(np.asarray(origin)[None,:]+m*np.asarray(normal)[None,:])[0]<0:a=m
            else:b=m
        return np.asarray(origin)+a*np.asarray(normal)
    def normals(self,p):
        a=[];delta=self.h*.60
        for i in range(3):
            d=np.zeros(3,np.float32);d[i]=delta;a.append((self.value(p+d)-self.value(p-d))/(2*delta))
        return unit(np.stack(a,1)).astype(np.float32)
    def triangulate(self,subdivide=True):
        p,f,_,_=marching_cubes(self.f,level=0.,spacing=(self.h,)*3,allow_degenerate=False)
        p=(p+self.lo).astype(np.float32);f=f.astype(np.uint32)
        if subdivide:
            # Subdivide the actual implicit surface once, projecting all new vertices to zero level.
            edges=np.stack([f[:,[0,1]],f[:,[1,2]],f[:,[2,0]]],1).reshape(-1,2);edges.sort(axis=1)
            enc=edges[:,0].astype(np.uint64)*np.uint64(len(p))+edges[:,1];uniq,inv=np.unique(enc,return_inverse=True);a=(uniq//len(p)).astype(int);b=(uniq%len(p)).astype(int)
            mid=(p[a]+p[b])*.5
            for _ in range(2):mid-=self.normals(mid)*self.value(mid)[:,None]
            q=(inv.reshape(-1,3)+len(p)).astype(np.uint32);a,b,c=f.T;ab,bc,ca=q.T
            f=np.concatenate([np.stack([a,ab,ca],1),np.stack([ab,b,bc],1),np.stack([ca,bc,c],1),np.stack([ab,bc,ca],1)]);p=np.concatenate([p,mid])
        n=self.normals(p);return p,n,f

