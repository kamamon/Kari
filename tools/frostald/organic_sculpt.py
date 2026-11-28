"""Frostald V6: connected implicit skin, anatomy-aware weights, inset facial anatomy,
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


def pair_axis(p,names,rest,J,coordinate=2):
    ids=np.array([J[name] for name in names],np.uint16);vals=rest[ids,coordinate];o=np.argsort(vals);ids=ids[o];vals=vals[o]
    i=np.clip(np.searchsorted(vals,p[:,coordinate])-1,0,len(vals)-2);t=np.clip((p[:,coordinate]-vals[i])/(vals[i+1]-vals[i]),0,1);t=t*t*(3-2*t)
    return np.stack([ids[i],ids[i+1]],1),np.stack([1-t,t],1)

def skin_weights(p,J,rest,jaw=False):
    if jaw:
        return np.tile([J['jaw'],0,0,0],(len(p),1)),np.tile([1.,0,0,0],(len(p),1))
    axial=['snout','head','neck_02','neck_01','chest','body','pelvis']+[f'tail_{i:02}' for i in range(1,13)]
    aj,aw=pair_axis(p,axial,rest,J);x,y,z=p.T;limbj=np.zeros((len(p),2),np.uint16);limbw=np.zeros((len(p),2),np.float32);limbw[:,0]=1
    blend=np.zeros(len(p),np.float32)
    for side,d in [('l',1),('r',-1)]:
        for limb,zz in [('fore',.93),('hind',-1.12)]:
            mask=(x*d>0)&(np.abs(z-zz)<.96)&(y<1.67)&((z>-.07) if limb=='fore' else (z<=-.07));ix=np.flatnonzero(mask)
            if not len(ix):continue
            v=p[ix];bn=lambda a:f'{limb}_{a}_{side}';chain=[bn(k) for k in ('upper','lower','ankle','paw')];ids=np.array([J[k] for k in chain]);q=rest[ids]
            best=np.full(len(v),1.e6);jj=np.tile(ids[:2],(len(v),1));ww=np.tile([1.,0.],(len(v),1))
            for i in range(3):
                delta=q[i+1]-q[i];t=np.clip(((v-q[i])*delta).sum(1)/(delta@delta),0,1);dist=np.sum((v-q[i]-t[:,None]*delta)**2,1);m=dist<best;best[m]=dist[m];tt=t[m]*t[m]*(3-2*t[m]);jj[m]=ids[i:i+2];ww[m]=np.stack([1-tt,tt],1)
            toe_mask=(v[:,1]<.23)&(v[:,2]>zz+.27);tii=np.flatnonzero(toe_mask)
            if len(tii):
                toes=np.array([J[bn(f'toe{k}')] for k in range(4)]);near=toes[np.argmin(abs(v[tii,0,None]-rest[toes,0]),axis=1)];t=smooth(zz+.24,zz+.53,v[tii,2]);jj[tii,0]=J[bn('paw')];jj[tii,1]=near;ww[tii]=np.stack([1-t,t],1)
            limbj[ix]=jj;limbw[ix]=ww
            # Smooth skin weight across the axilla/groin; the hip/shoulder on the trunk stays attached.
            side_weight=smooth(.36,.82,np.abs(v[:,0]));low=1-smooth(.66,1.37,v[:,1]);zfade=1-smooth(.60,.96,np.abs(v[:,2]-zz));blend[ix]=np.maximum(side_weight*(.33+.67*low),low)*zfade
    # Teeth, sockets and lips are attached to head/snout rather than being influenced by legs.
    blend[z>1.70]=0
    j=np.concatenate([aj,limbj],1).astype(np.uint16);w=np.concatenate([aw*(1-blend[:,None]),limbw*blend[:,None]],1).astype(np.float32);w/=w.sum(1,keepdims=True)
    return j,w


def emit_skin(V,J,rest,add,source,jaw=False,hd=True):
    p,n,f=V.triangulate(subdivide=True);j,w=skin_weights(p,J,rest,jaw);x,y,z=p.T
    # Metric wrap for the body, more nearly isotropic scale pattern on smaller face and legs.
    cy=np.interp(z,[-4.7,-3.2,-1.4,0.,.9,1.6,2.0,3.2],[.65,.83,1.1,1.12,1.25,1.38,1.49,1.44]).astype(np.float32)
    rad=np.interp(z,[-4.7,-3.2,-1.4,0.,.9,1.6,2.0,3.2],[.035,.25,.45,.72,.73,.49,.38,.20])
    ang=np.arctan2(np.abs(x),y-cy);uv=np.stack([ang*rad/.52,-z/.53],1).astype(np.float32)
    head=(z>1.83);limb=(np.abs(x)>.48)&(y<1.20)&(z>-2.0)&(z<1.70)
    uv_head=np.stack([z/.28,(y+.40*np.abs(x))/.25],1).astype(np.float32)
    # Broad side of each leg is mapped along the limb's own long axis.
    legz=np.where(z>-.07,.93,-1.12);legx=np.interp(y,[.10,.50,1.2],[.85,.76,.58]);theta=np.arctan2(z-legz,np.abs(x)-legx)
    uv_limb=np.stack([(z+.58*np.abs(x))/.40,(-y+.24*np.abs(x))/.42],1).astype(np.float32)
    uv_belly=np.stack([np.abs(x)/.50,-z/.41],1).astype(np.float32)
    if jaw:uv_belly=np.stack([z/.32,ang*.24/.28],1).astype(np.float32)
    fc=p[f].mean(1);fn=n[f].mean(1);fx,fy,fz=fc.T
    tags=np.zeros(len(f),np.uint8);tags[(fz>1.83)]=1;tags[(np.abs(fx)>.48)&(fy<1.20)&(fz>-2.0)&(fz<1.70)]=2
    tags[(fn[:,1]<-.25)&((np.abs(fx)<.67)|(fz<-1.5))&(fz<2.1)]=3
    if jaw:tags[:]=1
    names=['hide','head_skin','limb_skin','belly_skin'];srcnames=['skin','head','skin','belly']
    # Independent per-vertex physical relief derived from the actual reference's scale boundaries.
    # The seams share positions and normals because displacement is computed before material splits.
    tex=np.asarray(Image.open(source/'skin.webp').convert('L').resize((512,512),Image.Resampling.LANCZOS),np.float32)/255
    tex=gaussian_filter(tex,1.0,mode='wrap')-gaussian_filter(tex,13,mode='wrap');u=uv[:,0]%1;v=uv[:,1]%1;rel=map_coordinates(tex,[v*511,u*511],order=1,mode='wrap');amp=np.where(head,.005,.010);amp=np.where(y<.16,.003,amp)
    p+=n*(np.clip(rel,-.18,.18)*amp)[:,None]
    # Recompute continuous smooth normals from the sculpted relief; no hard material seams.
    normal=np.zeros_like(p);cr=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]);flip=np.sum(cr*n[f[:,0]],axis=1)<0;f[flip]=f[flip][:,[0,2,1]];cr[flip]*=-1
    for i in range(3):np.add.at(normal,f[:,i],cr)
    nn=unit(normal).astype(np.float32);bad=np.linalg.norm(nn,axis=1)<.5;nn[bad]=n[bad]
    # Pigment variation: dark only at recessed nostrils and eyelid rims, light scales on the abdomen.
    var=.94+.025*np.sin(z*5.1+x*3.7)+.035*np.sin(y*11+z*7);c=np.tile(var[:,None],(1,3))
    if not jaw:
        for center,rr in V.nostrils:
            d=(p-center)/rr;d2=(d*d).sum(1);shade=.23+.77*smooth(.72,2.1,d2);c*=shade[:,None]
        for center,rr in V.sockets:
            d=(p-center)/rr;d2=(d*d).sum(1);shade=.56+.44*smooth(.66,1.9,d2);c*=shade[:,None]
    c=linear(c)
    for i,name in enumerate(names):
        ff=f[tags==i]
        if not len(ff):continue
        ids,inv=np.unique(ff.ravel(),return_inverse=True);mapped=[uv,uv_head,uv_limb,uv_belly][i];add(name,p[ids],nn[ids],mapped[ids],j[ids],w[ids],inv.reshape(-1,3),c[ids])
    print('organic skin',len(p),len(f),'jaw' if jaw else 'connected trunk',flush=True)


def make_sculpt(add,J,rest,LOD,source,ell,tube):
    """Build a real skinned creature. Kept in a module so both build modes use identical anatomy."""
    hd=LOD>2.;h=.0137 if hd else .037
    V=Volume(([-1.65,-.20,-4.91],[1.65,2.20,3.35]),h);V.nostrils=[];V.sockets=[]
    # Broad rib cage and shoulders with a tapered waist; neck is part of the same field.
    for c,r,k in [((0,1.18,.68),(.77,.66,.83),.17),((0,1.12,-.04),(.73,.62,1.03),.19),((0,1.13,-.96),(.70,.60,.74),.17),((0,1.38,1.29),(.60,.54,.64),.15),((0,1.47,1.78),(.43,.38,.48),.13),((0,1.51,2.12),(.415,.325,.44),.11),((0,1.48,2.54),(.337,.225,.56),.12),((0,1.44,2.92),(.245,.137,.25),.09)]:V.ell(c,r,k)
    for d in (-1,1):
        V.ell((d*.48,1.17,.85),(.38,.48,.46),.15);V.ell((d*.46,1.16,-1.02),(.39,.42,.49),.16)
        V.ell((d*.26,1.48,2.06),(.225,.285,.34),.12) # cheek muscle
    # A smoothly tapered muscular tail, not a chain of isolated cylinders.
    for i,t in enumerate(np.linspace(0,1,19)):
        z=-1.30-3.24*t;y=1.10-.43*t+.065*np.sin(PI*t);rx=.43*(1-t)**.85+.024;ry=.45*(1-t)**.78+.018
        V.ell((0,y,z),(rx,ry,.27*(1-.45*t)+.055),.11*(1-t)+.018)
    V.ell((0,.66,-4.62),(.035,.046,.13),.025)
    # Individual shoulders, elbows, shins and toes are all fused into the skin surface.
    for side,d in [('l',1),('r',-1)]:
        for limb,z in [('fore',.93),('hind',-1.12)]:
            bn=lambda k:f'{limb}_{k}_{side}';a=rest[J[bn('upper')]];b=rest[J[bn('lower')]];c=rest[J[bn('ankle')]]
            V.segment((d*.43,1.35,z),a,.37,.41,.16,.24);V.segment(a,b,.31 if limb=='fore' else .35,.33 if limb=='fore' else .39,.13,.20)
            V.ell((d*.76,.73,z-.12 if limb=='fore' else z+.15),(.26,.28,.30),.10)
            V.segment(b,c,.19,.22,.105,.12);V.ell((d*.85,.18,z+.20),(.30,.175,.30),.105)
            for i in range(4):
                x,y,zz=rest[J[bn('toe'+str(i))]];x+=d*.025*(i-1.5);ztoe=zz+.055*(1-abs(i-1.5)/1.5)
                V.ell((x,.117,ztoe+.04),(.095,.103,.20),.055);V.ell((x,.092,ztoe+.17),(.085,.078,.13),.045)
    # Sculpt a curved upper lip plane with transition into the intact cheek/neck.
    z=V.axes[2];y=V.axes[1];ids=np.flatnonzero(z>2.02)
    for k in ids:
        zz=z[k];lip=1.320+.015*np.sin((zz-2.12)*3.1)+.025*smooth(2.17,2.5,zz)
        cut=(lip-y)[None,:]+(1-smooth(2.03,2.26,zz))*(-.7)
        old=V.f[:,:,k];s=.034;hh=np.maximum(s-np.abs(old-cut),0)/s;old[:]=np.maximum(old,cut)+hh*hh*s*.25
    # Socket and nostril are SUBTRACTED from the skull. No dark balls above the skin.
    eyes=[]
    for side,d in [('l',1),('r',-1)]:
        surf=V.surface([0,1.61,2.44],[d,0,0]);sx=abs(surf[0]);V.ell((d*(sx-.035),1.681,2.41),(.10,.046,.132),.04)
        center=np.array([d*(sx+.005),1.613,2.445]);rr=np.array([.10,.066,.090]);V.ell(center,rr,.020,cut=True);V.sockets.append((center,rr));eyes.append((side,d,sx))
        nr=np.array([d*.13,1.47,2.95]);norm=unit(np.array([d*.56,.78,.21]));nr=V.surface([d*.075,1.42,2.92],norm);rr=np.array([.058,.037,.079]);V.ell(nr+norm*.010,rr,.012,cut=True);V.nostrils.append((nr,rr))
    # Use the actual body field to seat every ice blade root; never float armor above the skin.
    rng=np.random.default_rng(62026)
    def ray(z,ang):
        yy=np.interp(z,[-4.65,-3.2,-1.4,-.1,.85,1.6,2.2,3.1],[.65,.84,1.10,1.12,1.25,1.39,1.48,1.42]);n=np.array([np.sin(ang),np.cos(ang),0.]);return V.surface([0,yy,z],n),n
    def blade(mat,root,mid,tip,width,thickness,bone,seed,axis_hint=None):
        # Smooth tapered crescent with solid cross-section, raised central rib and scalloped edges.
        root=np.asarray(root,float);mid=np.asarray(mid,float);tip=np.asarray(tip,float);r=np.random.default_rng(seed)
        nv=48 if hd else 20;nu=22 if hd else 10;t=np.linspace(0,1,nv+1)[:,None];phi=np.linspace(0,2*PI,nu+1)[None,:]
        P=(1-t)**2*root+2*t*(1-t)*mid+t*t*tip;D=unit(2*(1-t)*(mid-root)+2*t*(tip-mid));hint=np.asarray(axis_hint if axis_hint is not None else [0.,1.,0.],float);W=unit(hint[None,:]-D*np.sum(D*hint,axis=1,keepdims=True));bad=np.linalg.norm(W,axis=1)<.1;W[bad]=unit(np.cross(D[bad],[1.,0.,0.]));N=unit(np.cross(D,W))
        # Broad plate, narrow irregular tip, nonperiodic serrations. Blue roots, frosted edges.
        wave=1+.10*np.sin(PI*t*5+r.uniform(0,2*PI))+.07*np.sin(PI*t*11+r.uniform(0,2*PI))
        wide=width*(.57+.68*np.sin(PI*t)**.72)*(1-t)**.60*wave+width*.012
        thick=thickness*(.88+.28*np.sin(PI*t))*(1-t)**.81+thickness*.025
        edge=np.cos(phi);top=np.sin(phi);bend=(.020 if mat in ('keratin','feather','ice_plate') else .0015)*np.sin(PI*t)*edge**2
        p=P[:,None,:]+W[:,None,:]*(wide*edge)[...,None]+N[:,None,:]*(thick*top+bend)[...,None]
        # Add mineral growth grooves along plate's length. Roots remain seated and the tip remains sharp.
        ridge=(.0035 if mat in ('keratin','feather','ice_plate') else .0005)*np.sin(PI*t)*np.sin(phi*5+t*9+seed)*np.abs(top);p+=N[:,None,:]*(ridge*np.sign(top))[...,None]
        da=np.gradient(p,axis=0);db=np.gradient(p,axis=1);norm=unit(np.cross(da,db));out=unit(W[:,None,:]*edge[...,None]+N[:,None,:]*top[...,None]);norm*=np.where((norm*out).sum(2,keepdims=True)<0,-1,1)
        p=p.reshape(-1,3);norm=norm.reshape(-1,3);uv=np.stack(np.broadcast_arrays((np.cos(phi)+1)*.5 if mat in ('keratin','feather','ice_plate') else phi/(2*PI),t),-1).reshape(-1,2);idx=np.arange(nv)[:,None]*(nu+1)+np.arange(nu)[None,:];a=idx.ravel();b=a+nu+1;f=np.stack([np.stack([a,a+1,b],1),np.stack([a+1,b+1,b],1)],1).reshape(-1,3)
        # A closed root and tip with tiny end caps. Root cap is under the skin.
        caps=np.concatenate([np.stack([np.zeros(nu-1,int),np.arange(1,nu),np.arange(2,nu+1)],1),np.stack([np.full(nu-1,nv*(nu+1)),nv*(nu+1)+np.arange(2,nu+1),nv*(nu+1)+np.arange(1,nu)],1)]);f=np.concatenate([f,caps])
        if mat in ('keratin','feather','ice_plate'):
            v=uv[:,1];e=np.abs(2*uv[:,0]-1);wh=smooth(.23,.95,v)*.52+smooth(.52,.98,e)*.31;shade=.83+.17*v;rgb=np.clip(shade[:,None]*(1-wh[:,None])+wh[:,None]*np.array([1.0,1.0,1.0]),0,1);rgb=np.broadcast_to(rgb,(len(p),3)).copy();rgb[:,0]*=.98
        else:rgb=np.ones((len(p),3),np.float32)
        j=np.tile([J[bone],0,0,0],(len(p),1));w=np.tile([1.,0,0,0],(len(p),1));add(mat,p,norm,uv,j,w,f,linear(rgb))
    # Neck crest: irregular fan of layered, wide, blade-shaped ice scales, rooted in the actual neck.
    for i,z in enumerate([2.09,1.86,1.62,1.36,1.10,.85]):
        for side,d in [('l',1),('r',-1)]:
            for k,ang0 in enumerate([.14,.44,.76,1.08,1.40,1.72]):
                ang=d*(ang0+rng.uniform(-.065,.065));zz=z+rng.uniform(-.045,.045);base,n=ray(zz,ang);base-=n*.054
                # Distinct silhouette: tall central crown, splayed side sheets, shorter neck underside.
                tall=(1-.35*abs(ang0)/1.72)*(1-.18*abs(i-2));L=(.57+.40*tall)*rng.uniform(.70,1.22);out=(.35+.38*tall)*rng.uniform(.80,1.25)
                tip=base+n*out+np.array([d*.05,.09+.14*tall,-L]);mid=base+n*(out*.89)+np.array([d*.02,.19+.16*tall,-L*.23]);hint=np.array([d*.38,1.,.05]);bn=f'mane_{side}_{i+1:02}'
                blade('feather',base,mid,tip,rng.uniform(.085,.18)*(1+.18*tall),rng.uniform(.040,.065),bn,100+i*31+k*3+(side=='r'),hint)
            # Smaller pointed overlapping frost plates beneath main crest.
            for k,ang0 in enumerate([1.02,1.49,1.88]):
                base,n=ray(z-.08,d*ang0);base-=n*.045;tip=base+n*.22+np.array([d*.045,-.06,-rng.uniform(.31,.48)]);mid=base+n*.22+np.array([0,.015,-.15]);blade('keratin',base,mid,tip,.092,.025,f'mane_{side}_{i+1:02}',390+i*17+k+(side=='r'),[d*.5,1,0])
    # Crown above the skull: plates rise naturally out of the brow and transition into the mane.
    for i,z in enumerate(np.linspace(2.83,2.12,7)):
        for d in (-1,1):
            root,n=ray(z,d*(.36+.11*(i%2)));root-=n*.032;h0=.10+.14*(i/6);tip=root+n*h0+np.array([d*.025,.06,-.29]);mid=root+n*(h0*1.13)+np.array([0,.04,-.10]);blade('keratin',root,mid,tip,.062+.009*i,.018,'head',600+i*2+(d>0),[d*.5,1,0])
    # Body dorsal ridges: uneven overlapping plates following the actual skin instead of floating ridges.
    for i,z in enumerate(np.linspace(.62,-4.18,18)):
        taper=np.interp(z,[-4.18,-2.8,-1.,.62],[.28,.56,.85,1.]);bn='body' if z>-.5 else 'pelvis' if z>-1.36 else f'tail_{min(12,max(1,round((-z-1.42)/.2727)+1)):02}'
        for d in (-1,1):
            root,n=ray(z+rng.uniform(-.035,.035),d*(.24+.13*(i%2)));root-=n*.033;H=(.26+.14*rng.random())*taper;L=(.35+.15*rng.random())*taper;mid=root+n*H*1.10+np.array([d*.03,0,-.13*taper]);tip=root+n*H*1.14+np.array([d*.055,-.02,-L]);blade('ice_plate',root,mid,tip,.10*taper+.018,.024*taper+.008,bn,800+i*2+(d>0),[d*.26,1,0])
    # Real curved claws, broad at the nail bed and integrated into the rounded toes.
    for side,d in [('l',1),('r',-1)]:
        for limb,z in [('fore',.93),('hind',-1.12)]:
            bn=lambda k:f'{limb}_{k}_{side}'
            for i in range(4):
                x,y,zz=rest[J[bn('toe'+str(i))]];x+=d*.025*(i-1.5);zz+=.055*(1-abs(i-1.5)/1.5);L=.27+.06*(1-abs(i-1.5)/1.5);root=np.array([x,.132,zz+.155]);mid=np.array([x+d*.023,.19,zz+.31]);tip=np.array([x+d*.030,.023,zz+.155+L]);blade('claw',root,mid,tip,.063,.053,bn('toe'+str(i)),950+i+(side=='r')*7+(limb=='hind')*15,[1,0,0])
            # A few small asymmetrical ice scutes at the outside elbow, seated by field ray.
            for i in range(4):
                h0=.86-i*.14;origin=[d*.60,h0,z-.05];n=np.array([d,.12,-.05]);n=unit(n);base=V.surface(origin,n)-n*.03;mid=base+n*.11+np.array([0,.04,-.07]);tip=base+n*.16+np.array([0,.03,-.25]);blade('ice_plate',base,mid,tip,.065,.022,bn('upper' if i<2 else 'lower'),1080+i+(side=='r')*11+(limb=='hind')*20,[0,1,0])
    # Continuous skin with actual anatomical deformation; oral surfaces and upper teeth stay on skull/jaw.
    emit_skin(V,J,rest,add,source,hd=hd)
    del V
    Q=Volume(([-.54,1.01,1.90],[.54,1.42,3.23]),h*.78);Q.nostrils=[];Q.sockets=[]
    for c,r,k in [((0,1.250,2.25),(.34,.151,.43),.095),((0,1.258,2.63),(.287,.119,.43),.085),((0,1.265,2.94),(.217,.091,.22),.065)]:Q.ell(c,r,k)
    # Flatten the upper surface of jaw, leaving naturally rounded outer lip.
    for k,yy in enumerate(Q.axes[1]):
        if yy>1.30:Q.f[:,k,:]=np.maximum(Q.f[:,k,:],yy-1.332)
    emit_skin(Q,J,rest,add,source,jaw=True,hd=hd)
    # Two flesh-lined gum surfaces, tongue, and small integrated brine glands.
    ell('mouth',(0,1.315,2.55),(.222,.025,.44),'jaw',25,14);ell('mouth',(0,1.331,2.58),(.104,.024,.31),'tongue',20,14)
    ell('mouth',(0,1.374,2.56),(.237,.025,.44),'head',24,14)
    for side,d,sx in eyes:
        # Eye globe recessed in carved socket. The pupil is a shallow cap seated on the iris.
        ec=(d*(sx-.029),1.613,2.445);er=(.050,.039,.052);ell('eye',ec,er,'eye_'+side,28,20)
        # Give iris radially varying natural blue pigment; generator applies the colors below.
        # Lid ridge is geometry that follows the socket, rather than a separate opaque circular disc.
        pc=(d*(sx+.019),1.613,2.445);ell('pupil',pc,(.004,.016,.016),'eye_'+side,20,16)
        # Brine membrane follows jaw-neck fold, sunk rather than hanging as a spherical pouch.
        ell('membrane',(d*.26,1.215,1.91),(.092,.11,.21),'gill_'+side,20,14)
        # Slightly staggered, irregular tooth row; curved ivory teeth rooted in the gums.
        for i in range(14):
            t=i/13;zz=2.23+.77*t+rng.uniform(-.012,.012);x=d*(.286-.105*t*t);y=1.387+.009*np.sin(t*PI);L=(.047+.031*np.sin(t*PI)+.019*(i%4==1))*rng.uniform(.86,1.15);root=np.array([x,y,zz]);mid=root+np.array([-d*.012,-L*.60,-.008]);tip=root+np.array([-d*.035,-L,-.018]);blade('tooth',root,mid,tip,.019+.006*(1-t),.020,'head',1150+i+(d>0)*23,[1,0,0]);
            if i<12:
                root=np.array([x*.89,1.322,zz+.025]);L2=L*.67;mid=root+np.array([-d*.01,L2*.55,-.01]);tip=root+np.array([-d*.02,L2,-.018]);blade('tooth',root,mid,tip,.015,.016,'jaw',1250+i+(d>0)*25,[1,0,0])
    return eyes
