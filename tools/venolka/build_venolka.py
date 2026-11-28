"""Venolka: actual skinned original 3D mesh, bone-driven wings, original-art PBR."""
from pathlib import Path
import argparse,json,struct,math,os
import numpy as np
from scipy.spatial.transform import Rotation as R
from scipy.ndimage import gaussian_filter,map_coordinates
from PIL import Image
from volume import Volume,unit,smooth,linear
from materials import PROFILES,bake,digest,VERSION as MATERIAL_VERSION
P=Path(__file__).parent;PI=np.pi;B=[];J={};M={};rng=np.random.default_rng(261128)
def bone(n,p,xyz):J[n]=len(B);B.append((n,J[p] if p else -1,np.array(xyz,float)))
for n,p,x in [('root',None,(0,0,0)),('body','root',(0,2.12,0)),('pelvis','body',(0,2.12,-.54)),('chest','body',(0,2.30,.65)),('neck_01','chest',(0,2.65,1.20)),('neck_02','neck_01',(0,3.13,1.62)),('neck_03','neck_02',(0,3.50,2.00)),('head','neck_03',(0,3.68,2.38)),('jaw','head',(0,3.46,2.45)),('beak','head',(0,3.62,2.86)),('tongue','jaw',(0,3.40,2.80))]:bone(n,p,x)
for s,d in [('l',1),('r',-1)]:
 for n,p,x in [('hip','pelvis',(d*.49,2.05,-.43)),('knee','hip',(d*.80,1.30,.13)),('hock','knee',(d*.92,.73,-.50)),('ankle','hock',(d*.97,.19,-.22)),('foot','ankle',(d*.98,.13,-.04))]:bone(n+'_'+s,p if p=='pelvis' else p+'_'+s,x)
 for i in range(3):
  x=d*(.80+.18*i);z=.20-.06*abs(i-1);bone(f'toe{i+1}_{s}','foot_'+s,(x,.105,z));bone(f'toe{i+1}_tip_{s}',f'toe{i+1}_{s}',(x+d*.035*(i-1),.085,z+.34))
 bone('dewtoe_'+s,'foot_'+s,(d*1.02,.14,-.39));bone('arm_upper_'+s,'chest',(d*.46,2.16,.72));bone('arm_lower_'+s,'arm_upper_'+s,(d*.77,1.85,1.14));bone('hand_'+s,'arm_lower_'+s,(d*.88,1.65,1.40))
 for i in range(3):bone(f'hand_digit{i+1}_{s}','hand_'+s,(d*(.77+i*.10),1.52,1.52-.035*i))
 bone('wing_shoulder_'+s,'chest',(d*.55,2.54,.35));bone('wing_elbow_'+s,'wing_shoulder_'+s,(d*1.56,3.05,.48));bone('wing_wrist_'+s,'wing_elbow_'+s,(d*2.53,3.67,.72))
 for i,(x,y,z) in enumerate([(5.02,3.26,-.72),(4.65,2.67,-2.03),(3.61,2.17,-3.18),(2.05,1.90,-2.82)],1):
  tip=np.array([d*x,y,z]);mid=B[J['wing_wrist_'+s]][2]*.48+tip*.52+np.array([d*.12,.11,.08]);bone(f'wing_digit{i}_a_{s}','wing_wrist_'+s,mid);bone(f'wing_digit{i}_b_{s}',f'wing_digit{i}_a_{s}',tip)
 bone('wing_thumb_'+s,'wing_wrist_'+s,(d*2.60,3.78,1.01));bone('sac_'+s,'head',(d*.29,3.40,2.35));bone('eye_'+s,'head',(d*.34,3.77,2.65))
 for i in range(5):bone(f'crest_{i+1}_{s}','head',(d*(.17+.04*i),3.84-.045*i,2.37-.075*i))
 for i in range(3):bone(f'ruff_{i+1}_{s}','neck_01' if i<2 else 'chest',(d*.41,2.92-.18*i,1.38-.22*i))
for i in range(14):
 t=i/13;bone(f'tail_{i+1:02}','pelvis' if not i else f'tail_{i:02}',(0,2.14-.52*t+.10*np.sin(PI*t),-1.03-5.40*t))
for s,d in [('l',1),('r',-1)]:
 for i in range(3):bone(f'tail_fan_{i+1}_{s}',f'tail_{10+i:02}',(d*.08,1.80-.07*i,-4.77-.415*i))
rest=np.array([v[2] for v in B]);ID=np.array([0.,0,0,1.])
def add(mat,p,n,uv,j,w,f,c=None):
 p=np.asarray(p,np.float32);n=np.asarray(n,np.float32);f=np.asarray(f,np.uint32);cr=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]);valid=np.linalg.norm(cr,axis=1)>1e-10;f=f[valid];cr=cr[valid];flip=(cr*n[f[:,0]]).sum(1)<0;f[flip]=f[flip][:,[0,2,1]];g=M.setdefault(mat,{k:[] for k in ('p','n','uv','j','w','f','c')});off=sum(len(x) for x in g['p']);c=np.ones_like(p) if c is None else c
 assert np.isfinite(p).all() and np.isfinite(n).all() and np.max(abs(np.asarray(w).sum(1)-1))<1e-5
 for k,x in zip(('p','n','uv','j','w','f','c'),(p,n,uv,j,w,f+off,c)):g[k].append(np.asarray(x,dtype=np.uint16 if k=='j' else np.uint32 if k=='f' else np.float32))
def grid(nv,nu):
 a=(np.arange(nv)[:,None]*(nu+1)+np.arange(nu)[None,:]).ravel();b=a+nu+1;return np.stack([np.stack([a,a+1,b],1),np.stack([a+1,b+1,b],1)],1).reshape(-1,3)
def rigid(n,N):return np.tile([J[n],0,0,0],(N,1)),np.tile([1.,0,0,0],(N,1))
def chainweights(p,chains):
 best=np.full(len(p),1e9);j=np.zeros((len(p),2),np.uint16);w=np.tile([1.,0],(len(p),1))
 for names in chains:
  for a,b in zip(names[:-1],names[1:]):
   ai,bi=J[a],J[b];q=rest[ai];v=rest[bi]-q;t=np.clip(((p-q)*v).sum(1)/(v@v),0,1);d=((p-q-t[:,None]*v)**2).sum(1);hit=d<best;tt=t[hit]**2*(3-2*t[hit]);best[hit]=d[hit];j[hit]=[ai,bi];w[hit]=np.stack([1-tt,tt],1)
 return j,w
AXIAL=['beak','head','neck_03','neck_02','neck_01','chest','body','pelvis']+[f'tail_{i+1:02}' for i in range(14)]
def weights(p,jaw=False):
 if jaw:return rigid('jaw',len(p))
 j,w=chainweights(p,[AXIAL]);x,y,z=p.T;oj=np.zeros_like(j);ow=np.tile([1.,0],(len(p),1));bl=np.zeros(len(p))
 for s,d in [('l',1),('r',-1)]:
  for mask,chains,kind in [((d*x>0)&(z<.78)&(z>-1.1)&(y<2.46),[['hip_'+s,'knee_'+s,'hock_'+s,'ankle_'+s,'foot_'+s,f'toe{i}_tip_{s}'] for i in range(1,4)],'leg'),((d*x>0)&(z>.58)&(z<1.85)&(y<2.38),[['arm_upper_'+s,'arm_lower_'+s,'hand_'+s,f'hand_digit{i}_{s}'] for i in range(1,4)],'arm')]:
   ix=np.flatnonzero(mask)
   if not len(ix):continue
   v=p[ix];jj,ww=chainweights(v,chains);xx=np.abs(v[:,0]);yy=v[:,1];zz=v[:,2];a=np.maximum(1-smooth(1.42,2.26,yy),smooth(.46,.90,xx))*(1-smooth(.65,1.1,abs(zz+.23))) if kind=='leg' else np.maximum(1-smooth(1.72,2.3,yy),smooth(.43,.81,xx))*(1-smooth(.54,.85,abs(zz-1.06)));a=np.clip(a,0,1);hit=a>bl[ix];oy=ix[hit];bl[oy]=a[hit];oj[oy]=jj[hit];ow[oy]=ww[hit]
 jj=np.concatenate([j,oj],1);ww=np.concatenate([w*(1-bl[:,None]),ow*bl[:,None]],1);return jj,ww/ww.sum(1,keepdims=True)
def ell_mesh(mat,c,r,bn,hd):
 nu=64 if hd else 32;nv=40 if hd else 20;t=np.linspace(0,PI,nv+1)[:,None];p=np.linspace(0,2*PI,nu+1)[None,:];v=np.stack(np.broadcast_arrays(np.sin(t)*np.cos(p),np.cos(t),np.sin(t)*np.sin(p)),-1);xyz=(np.asarray(c)+v*np.asarray(r)).reshape(-1,3);n=unit(v/np.asarray(r)).reshape(-1,3);uv=np.stack(np.broadcast_arrays(p/(2*PI),t/PI),-1).reshape(-1,2);j,w=rigid(bn,len(xyz));add(mat,xyz,n,uv,j,w,grid(nv,nu))
def blade(mat,root,mid,tip,width,thick,bn,hd,seed,up=(0,1,0),color=None):
 root,mid,tip=map(lambda x:np.asarray(x,float),(root,mid,tip));nv=42 if hd else 18;nu=18 if hd else 9;t=np.linspace(0,1,nv+1)[:,None];a=np.linspace(0,2*PI,nu+1)[None,:];P0=(1-t)**2*root+2*t*(1-t)*mid+t*t*tip;D=unit(2*(1-t)*(mid-root)+2*t*(tip-mid));h=np.asarray(up,float);W=unit(h-D*(D@h)[:,None]);bad=np.linalg.norm(W,axis=1)<.5;W[bad]=unit(np.cross(D[bad],[1.,0,0]));N=unit(np.cross(D,W));ir=1+.065*np.sin(t*PI*7+seed);w=width*(.64+.55*np.sin(PI*t)**.8)*(1-t)**.75*ir+width*.006;hh=thick*(.9+.12*np.sin(PI*t))*(1-t)**.9+thick*.01;u=np.cos(a);v=np.sin(a);p=P0[:,None,:]+W[:,None,:]*(w*u)[...,None]+N[:,None,:]*(hh*v+(.012 if mat=='feather' else .001)*np.sin(PI*t)*u**2)[...,None];norm=unit(np.cross(np.gradient(p,axis=0),np.gradient(p,axis=1)));expect=unit(W[:,None,:]*u[...,None]+N[:,None,:]*v[...,None]);norm*=np.where((norm*expect).sum(2,keepdims=True)<0,-1,1);p=p.reshape(-1,3);norm=norm.reshape(-1,3);uv=np.stack(np.broadcast_arrays((u+1)*.5,t),-1).reshape(-1,2);j,w=rigid(bn,len(p));f=grid(nv,nu);caps=np.concatenate([np.stack([np.zeros(nu-1,int),np.arange(1,nu),np.arange(2,nu+1)],1),np.stack([np.full(nu-1,nv*(nu+1)),nv*(nu+1)+np.arange(2,nu+1),nv*(nu+1)+np.arange(1,nu)],1)]);c=None if color is None else linear(np.broadcast_to(np.asarray(color),p.shape).copy());add(mat,p,norm,uv,j,w,np.concatenate([f,caps]),c)
def emit(V,hd,jaw=False):
 p,n,f=V.triangulate(subdivide=hd);j,w=weights(p,jaw);x,y,z=p.T;cy=np.interp(z,[-6.6,-4.,-1.1,0.,.8,1.6,2.3,3.4],[1.62,1.88,2.13,2.14,2.3,3.0,3.62,3.52]);rx=np.interp(z,[-6.6,-4.,-1.1,0.,.8,1.6,2.3,3.4],[.035,.25,.50,.62,.52,.30,.38,.16]);ang=np.arctan2(np.abs(x),y-cy);uv=np.stack([ang*rx/.30,-z/.38],1).astype(np.float32);tex=np.asarray(Image.open(P/'material_source/hide.webp').convert('L').resize((512,512)),np.float32)/255;tex=gaussian_filter(tex,1.,mode='wrap')-gaussian_filter(tex,12,mode='wrap');h=map_coordinates(tex,[(uv[:,1]%1)*511,(uv[:,0]%1)*511],order=1,mode='wrap');p+=n*(np.clip(h,-.22,.22)*np.where(y<.3,.004,.014))[:,None];fc=p[f].mean(1);fn=n[f].mean(1);a,b,c=fc.T;tags=np.zeros(len(f),np.uint8);tags[c>2.04]=2;tags[(np.abs(a)>.43)&(b<1.31)&(c<1.)]=3;tags[(fn[:,1]<-.31)&(np.abs(a)<.53)&(c<2.1)&(b>1.4)]=1
 # Poison glands are blended into the living cheek surface, not separate balls.
 gland=np.zeros(len(p));glface=np.zeros(len(f));glside=np.zeros(len(p),np.int16)
 if not jaw:
  for side,d in [('l',1),('r',-1)]:
   center=np.array([d*.29,3.42,2.32]);dist=np.sqrt((((p-center)/np.array([.32,.33,.36]))**2).sum(1));v=(1-smooth(.65,1.36,dist))*smooth(.22,.41,d*p[:,0]);take=v>gland;gland[take]=v[take];glside[take]=J['sac_'+side]
  mask=gland>.01;j[mask,2]=glside[mask];j[mask,3]=J['head'];w[mask,:2]*=(1-gland[mask,None]);w[mask,2]=gland[mask];w[mask,3]=0;w[mask]/=w[mask].sum(1,keepdims=True)
  tags[gland[f].mean(1)>.42]=4
 if jaw:tags[:]=2
 rgb=np.ones_like(p)*(.94+.038*np.sin(z*4.1+x*3.7)+.022*np.cos(y*12+z*7))[:,None]
 for c0,r0 in getattr(V,'recesses',[]):rgb*=(.28+.72*smooth(.5,2.0,(((p-c0)/r0)**2).sum(1)))[:,None]
 col=linear(rgb);norm=np.zeros_like(p);cr=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]);flip=(cr*n[f[:,0]]).sum(1)<0;f[flip]=f[flip][:,[0,2,1]];cr[flip]*=-1
 for i in range(3):np.add.at(norm,f[:,i],cr)
 norm=unit(norm);bad=np.linalg.norm(norm,axis=1)<.5;norm[bad]=n[bad];maps=[uv,np.stack([np.abs(x)/.35,-z/.28],1),np.stack([z/.24,(y+.30*np.abs(x))/.21],1),np.stack([(z+.4*np.abs(x))/.20,-y/.30],1),np.stack([(z-2.0)/.42,(y-3.1)/.48],1)]
 for i,k in enumerate(('hide','belly','face','leg','sac')):
  ff=f[tags==i]
  if len(ff):ids,iv=np.unique(ff.ravel(),return_inverse=True);add(k,p[ids],norm[ids],maps[i][ids],j[ids],w[ids],iv.reshape(-1,3),col[ids])
 print('skin',len(f),'jaw' if jaw else 'connected',flush=True)
def geometry(hd):
 h=.0148 if hd else .023;V=Volume(([-1.70,-.22,-6.90],[1.70,4.26,3.56]),h);V.recesses=[]
 for c,r,k in [((0,2.12,-.45),(.64,.61,.96),.18),((0,2.25,.43),(.62,.58,.82),.17),((0,2.52,.99),(.46,.46,.50),.14),((0,2.88,1.43),(.34,.43,.40),.13),((0,3.27,1.77),(.32,.43,.40),.11),((0,3.55,2.11),(.35,.38,.40),.10),((0,3.68,2.44),(.40,.33,.50),.09),((0,3.60,2.79),(.30,.18,.36),.09)]:V.ell(c,r,k)
 for t in np.linspace(0,1,34):
  y=2.14-.52*t+.10*np.sin(PI*t);z=-.86-5.72*t;rx=.44*(1-t)**.95+.025;ry=.40*(1-t)**.88+.024;V.ell((0,y,z),(rx,ry,.23*(1-.38*t)+.055),.09*(1-t)+.025)
 for s,d in [('l',1),('r',-1)]:
  q=lambda n:rest[J[n+'_'+s]]
  V.ell((d*.43,2.03,-.38),(.41,.49,.62),.18);V.segment(q('hip'),q('knee'),.35,.40,.15,.22);V.ell(q('knee'),(.28,.31,.31),.10);V.segment(q('knee'),q('hock'),.20,.24,.09,.15);V.segment(q('hock'),q('ankle'),.115,.147,.08,.09);V.ell(q('foot'),(.26,.14,.27),.08)
  for i in range(1,4):V.segment(q(f'toe{i}'),q(f'toe{i}_tip'),.092,.091,.045,.075)
  V.segment(q('foot'),q('dewtoe'),.085,.08,.055,.08);V.ell((d*.40,2.25,.68),(.27,.29,.30),.14);V.segment(q('arm_upper'),q('arm_lower'),.18,.20,.10,.10);V.segment(q('arm_lower'),q('hand'),.125,.13,.08,.08);V.ell(q('hand'),(.15,.12,.17),.07)
  for i in range(1,4):V.segment(q('hand'),q(f'hand_digit{i}'),.054,.055,.045,.05)
  V.ell((d*.49,2.55,.38),(.33,.31,.36),.15);V.ell((d*.29,3.42,2.32),(.24,.285,.305),.115)
 for k,z in enumerate(V.axes[2]):
  if z<2.32:continue
  cut=(3.46-V.axes[1])[None,:]-.65*(1-smooth(2.32,2.56,z));old=V.f[:,:,k];a=.032;t=np.maximum(a-abs(old-cut),0)/a;old[:]=np.maximum(old,cut)+t*t*a*.25
 eyes=[]
 for s,d in [('l',1),('r',-1)]:
  surf=V.surface([0,3.77,2.65],[d,0,0]);sx=abs(surf[0]);c=np.array([d*(sx+.013),3.77,2.65]);rr=np.array([.091,.055,.075]);V.ell((d*(sx-.045),3.86,2.60),(.11,.05,.14),.045);V.ell(c,rr,.02,cut=True);V.recesses.append((c,rr));eyes.append((s,d,sx));n=unit(np.array([d*.62,.72,.26]));c=V.surface([d*.11,3.62,2.86],n);rr=np.array([.051,.037,.061]);V.ell(c+n*.007,rr,.012,cut=True);V.recesses.append((c,rr))
 def ray(z,y,ang):
  n=np.array([np.sin(ang),np.cos(ang),0.]);return V.surface([0,y,z],n),n
 for s,d in [('l',1),('r',-1)]:
  for i,z in enumerate(np.linspace(2.73,1.96,5)):
   cy=np.interp(z,[1.96,2.73],[3.49,3.65]);bn=f'crest_{i+1}_{s}'
   for k,angle in enumerate([.12,.48,.85,1.18]):
    r,n=ray(z,cy,d*(angle+rng.uniform(-.09,.09)));r-=n*.07;L=rng.uniform(.64,1.05)*(1-.055*i);tip=r+n*rng.uniform(.25,.46)+np.array([d*.10,.35-L*.10,-L]);mid=r+n*.36+np.array([d*.04,.37,-L*.38]);blade('feather',r,mid,tip,rng.uniform(.075,.135),.025,bn,hd,30+i*17+k+d,up=(d*.8,1,.1),color=(.92,.81,.95))
  for i,z in enumerate([1.55,1.27,1.00]):
   cy=np.interp(z,[1.0,1.55],[2.55,3.0]);bn=f'ruff_{i+1}_{s}'
   for k,angle in enumerate([.32,.65,.97,1.31,1.65]):
    r,n=ray(z,cy,d*angle);r-=n*.065;L=rng.uniform(.43,.79);mid=r+n*.25+np.array([d*.05,.17,-L*.35]);tip=r+n*.34+np.array([d*.11,-.04,-L]);blade('feather',r,mid,tip,rng.uniform(.095,.15),.026,bn,hd,100+i*20+k+d,up=(d*.6,1,0))
  for i,z in enumerate([-4.55,-4.96,-5.36]):
   cy=1.78-.06*i
   for k,a in enumerate([.23,.55,.95,1.31]):
    r,n=ray(z,cy,d*a);r-=n*.052;L=rng.uniform(.92,1.46);tip=r+n*.26+np.array([d*.27,-rng.uniform(.26,.55),-L]);mid=r+n*.31+np.array([d*.13,.05,-L*.5]);blade('feather',r,mid,tip,.10+.035*rng.random(),.022,f'tail_fan_{i+1}_{s}',hd,250+i*17+k+d,up=(d*.8,1,0))
 for i,z in enumerate(np.linspace(.6,-5.75,27)):
  cy=np.interp(z,[-5.75,-3.,-1.,.6],[1.67,1.97,2.13,2.29]);bn='body' if z>-.45 else 'pelvis' if z>-1.03 else f'tail_{np.clip(round((-z-1.03)/5.4*13)+1,1,14):02d}';taper=np.interp(z,[-5.75,-2,.6],[.28,.70,1.])
  for d in (-1,1):
   r,n=ray(z,cy,d*(.19+.12*(i%2)));r-=n*.025;mid=r+n*(.085+.06*rng.random())*taper+np.array([d*.025,0,-.09*taper]);tip=r+n*.16*taper+np.array([d*.04,-.01,-.36*taper]);blade('hide',r,mid,tip,.075*taper+.014,.030*taper+.005,bn,hd,500+i*2+d,up=(d*.7,1,0),color=(.88,.92,.81))
 emit(V,hd);del V
 Q=Volume(([-.47,3.17,2.27],[.47,3.51,3.49]),h*.65);Q.recesses=[];Q.ell((0,3.37,2.59),(.31,.126,.40),.085);Q.ell((0,3.40,2.90),(.245,.079,.29),.055);emit(Q,hd,True)
 blade('beak',(0,3.61,2.73),(0,3.65,3.24),(0,3.31,3.68),.285,.115,'beak',hd,23,up=(1,0,0),color=(.91,.91,.95));blade('beak',(0,3.36,2.75),(0,3.37,3.05),(0,3.43,3.31),.225,.067,'jaw',hd,25,up=(1,0,0),color=(.84,.83,.86));ell_mesh('mouth',(0,3.461,2.81),(.222,.025,.38),'head',hd);ell_mesh('mouth',(0,3.425,2.83),(.183,.027,.36),'jaw',hd);ell_mesh('mouth',(0,3.45,2.90),(.09,.024,.27),'tongue',hd)
 for s,d,sx in eyes:
  ec=(d*(sx-.043),3.77,2.65);ell_mesh('eye',ec,(.058,.039,.051),'eye_'+s,hd);v=M['eye']['p'][-1];yy=(v[:,1]-ec[1])/.039;zz=(v[:,2]-ec[2])/.051;r=np.sqrt(yy*yy+zz*zz);theta=np.arctan2(yy,zz);iris=np.array([.77,.65,.24])[None,:]*(1+.08*np.cos(theta*37)+.03*np.sin(theta*53+r*21))[:,None];rim=smooth(.72,1.,r)[:,None];M['eye']['c'][-1][:]=linear(iris*(1-rim)+np.array([.21,.19,.09])[None,:]*rim);ell_mesh('pupil',(d*(sx+.012),3.77,2.65),(.003,.016,.016),'eye_'+s,hd)
  for i in range(1,4):
   p=rest[J[f'toe{i}_tip_{s}']];blade('claw',p+[0,.025,-.09],p+[d*.018,.075,.15],p+[d*.035,.004,.36],.083,.073,f'toe{i}_tip_{s}',hd,720+i+d,up=(1,0,0));p=rest[J[f'hand_digit{i}_{s}']];blade('claw',p+[0,.035,-.04],p+[d*.025,-.055,.13],p+[d*.018,-.25,.08],.047,.048,f'hand_digit{i}_{s}',hd,740+i+d,up=(1,0,0))
  p=rest[J['dewtoe_'+s]];blade('claw',p,p+[d*.03,.045,-.14],p+[d*.04,-.02,-.28],.064,.064,'dewtoe_'+s,hd,760+d,up=(1,0,0));wing(s,d,hd)

def wing(s,d,hd):
 wr=rest[J['wing_wrist_'+s]];sh=rest[J['wing_shoulder_'+s]];el=rest[J['wing_elbow_'+s]];attach=np.array([d*.54,2.11,-.72]);nv=86 if hd else 40;nu=52 if hd else 24
 chains=[['wing_wrist_'+s,f'wing_digit{i}_a_{s}',f'wing_digit{i}_b_{s}'] for i in range(1,5)];chains.append(['wing_wrist_'+s,'wing_elbow_'+s,'chest']);chains.append(['wing_wrist_'+s,'wing_elbow_'+s,'wing_shoulder_'+s]);ctrl=[np.array([rest[J[n]] for n in ch]) if i!=4 else np.array([wr,(el+attach)*.5,attach]) for i,ch in enumerate(chains)]
 def curve(i,t):
  a,b,c=ctrl[i];return (1-t)**2*a+2*t*(1-t)*b+t*t*c
 def radial(i,t):
  ids=np.array([J[n] for n in chains[i]],np.uint16);v=np.clip(t*2,0,2);k=np.minimum(1,v.astype(int));r=v-k;return ids[k],ids[k+1],1-r,r
 for i in range(5):
  t=np.linspace(0,1,nv+1)[:,None];u=np.linspace(0,1,nu+1)[None,:];a=curve(i,t);b=curve(i+1,t);p=a[:,None,:]*(1-u[...,None])+b[:,None,:]*u[...,None];p+=(wr[None,None,:]-p)*((.17 if i<3 else .12)*np.sin(PI*u)*t**4)[...,None];p[...,1]-=.10*np.sin(PI*u)*np.sin(PI*t)+.012*np.sin(PI*u*9+t*13)*np.sin(PI*t)*np.sin(PI*u);n=unit(np.cross(np.gradient(p,axis=0),np.gradient(p,axis=1)));n*=np.where(n[...,1,None]<0,-1,1);n[0]=n[1];p=p.reshape(-1,3);n=n.reshape(-1,3);us,ts=np.broadcast_arrays(u,t);a0,a1,aw0,aw1=radial(i,ts);b0,b1,bw0,bw1=radial(i+1,ts);j=np.stack([a0,a1,b0,b1],-1).reshape(-1,4);w=np.stack([aw0*(1-us),aw1*(1-us),bw0*us,bw1*us],-1).reshape(-1,4);uv=np.stack([us,ts],-1).reshape(-1,2);pig=.92+.075*abs(2*us-1)-.055*ts+.035*np.sin(us*9+ts*8+i);c=linear(np.repeat(pig.reshape(-1,1),3,axis=1));add('wing',p,n,uv,j,w,grid(nv,nu),c)
 def spar(C,chain,r0,r1,sub):
  t=np.linspace(0,1,sub+1)[:,None];a,b,c=C;p=(1-t)**2*a+2*t*(1-t)*b+t*t*c;D=unit(2*(1-t)*(b-a)+2*t*(c-b));W=unit(np.cross(D,[0,1.,0]));bad=np.linalg.norm(W,axis=1)<.5;W[bad]=unit(np.cross(D[bad],[0,0,1.]));N=unit(np.cross(D,W));ns=18 if hd else 10;th=np.linspace(0,2*PI,ns+1)[None,:];rad=r0*(1-t)**1.1+r1*t;v=W[:,None,:]*np.cos(th)[...,None]+N[:,None,:]*np.sin(th)[...,None];xyz=(p[:,None,:]+v*rad[...,None]).reshape(-1,3);norm=v.reshape(-1,3);u,vv=np.broadcast_arrays(th/(2*PI),t);uv=np.stack([u,vv*np.linalg.norm(c-a)/.32],-1).reshape(-1,2);ids=np.array([J[n] for n in chain]);k=np.minimum(1,(vv*2).astype(int));u0=vv*2-k;j=np.stack([ids[k],ids[k+1],np.zeros_like(k),np.zeros_like(k)],-1).reshape(-1,4);w=np.stack([1-u0,u0,np.zeros_like(u0),np.zeros_like(u0)],-1).reshape(-1,4);add('hide',xyz,norm,uv,j,w,grid(sub,ns))
 spar(np.array([sh,el,wr]),['wing_shoulder_'+s,'wing_elbow_'+s,'wing_wrist_'+s],.22,.105,60 if hd else 28)
 for i in range(4):spar(ctrl[i],chains[i],.105 if i==0 else .075,.009,64 if hd else 30)
 p=rest[J['wing_thumb_'+s]];blade('claw',wr+[0,-.035,-.02],p+[d*.04,.08,.07],p+[d*.10,-.12,.23],.105,.095,'wing_wrist_'+s,hd,920+d,up=(1,0,0))
ATT={'peck':(132,[(30,44)]),'double_peck':(168,[(30,43),(64,77)]),'wing_l':(156,[(37,58)]),'wing_r':(156,[(37,58)]),'tail_l':(150,[(35,55)]),'tail_r':(150,[(35,55)]),'rush':(184,[(32,88)]),'hop_kick':(168,[(40,66)]),'glide':(250,[(68,122)]),'poison_spit':(168,[(44,45)]),'poison_fan':(216,[(48,49),(72,73),(96,97)]),'poison_tail_l':(168,[(42,65)]),'poison_tail_r':(168,[(42,65)]),'poison_cloud':(228,[(55,56)]),'back_peck':(150,[(36,50)])}
CLIPS={'idle':180,'walk':72,'trot':48,'sprint':40,'limp':96,'turn_l':66,'turn_r':66,'pivot_l':90,'pivot_r':90,'threat':114,'rage_roar':124,'retreat':84,'refill':240,'takeoff':80,'hover':72,'land':96,'fly_forward':80,'sniff':110,'eat':130,'sleep_enter':100,'sleep_loop':180,'sleep_exit':100,**{k:d for k,(d,_) in ATT.items()},'flinch_head':54,'flinch_body':54,'flinch_leg_l':60,'flinch_leg_r':60,'flinch_wing_l':60,'flinch_wing_r':60,'fall_l':120,'fall_r':120,'rise':104,'stun':150,'paralysis':150,'trap':180,'capture':120,'death':180,'break_sac':78,'break_crest':80,'break_wing':86,'sever_tail':96,'pant':144}
LOOP={'idle','walk','trot','sprint','limp','hover','fly_forward','sleep_loop','stun','paralysis','trap','pant'}
def rot(x=0,y=0,z=0):return R.from_euler('xyz',[x,y,z]).as_quat()
def align(a,b):
 a=unit(a);b=unit(b);v=np.cross(a,b);d=np.clip(a@b,-1,1);return ID.copy() if np.linalg.norm(v)<1e-8 else R.from_rotvec(unit(v)*np.arccos(d)).as_quat()
def mul(a,b):return (R.from_quat(a)*R.from_quat(b)).as_quat()
def inv(a):return R.from_quat(a).inv().as_quat()
def pose(name,t,D):
 p=t/D;ph=2*PI*p;q=np.tile(ID,(len(B),1));s=np.zeros(3);rt=np.zeros(3);scales={}
 def put(n,x=0,y=0,z=0):q[J[n]]=rot(x,y,z)
 def env(a,b,c,d):return float(smooth(a,b,t)*(1-smooth(c,d,t)))
 breath=.015*np.sin(ph);pitch=.015*np.sin(ph);head=.022*np.sin(ph);yaw=.023*np.sin(ph);jaw=.035;tail=.08*np.sin(ph);roll=0.;gait=0.;spread=.26;flight=0.;wingbeat=0.;sac=.88+.045*np.sin(ph);crest=.12;recover=0.
 if name in ('walk','trot','sprint','limp','retreat','turn_l','turn_r','pivot_l','pivot_r'):
  gait={'walk':.68,'trot':1.,'sprint':1.34,'limp':.43,'retreat':-.50,'turn_l':.55,'turn_r':.55,'pivot_l':.60,'pivot_r':.60}[name];s[1]=.045*np.sin(ph*2)*abs(gait);tail=.12*np.sin(ph);pitch=.045*np.cos(ph*2);spread=.27+.08*np.sin(ph*2)
 if name in ATT:
  wins=ATT[name][1];last=wins[-1][1];start=wins[0][0];v=max(env(max(0,a-18),a,b,b+12) for a,b in wins);prep=env(0,12,start-8,start);op0=math.ceil((last+(34 if name=='glide' else 24))/6)*6;op1=math.floor((D-8)/6)*6;recover=env(last+8,op0,op1,D-1);head=.03*prep;tail=.07*np.sin(ph)*v;spread=.24+.12*prep
  if name in ('peck','double_peck','back_peck'):head=.92*v-.28*prep;pitch=.18*v;jaw=.4*v;tail=-.18*v
  if name.startswith('wing_'):d=1 if name.endswith('l') else -1;spread=.24+.74*v;wingbeat=d*1.05*v;roll=d*.12*v;yaw=-d*.28*v;head=.16*v
  if name.startswith(('tail_','poison_tail_')):d=1 if name.endswith('l') else -1;tail=d*1.30*v;yaw=-d*.35*v;pitch=.04*v;spread=.45*v+.22
  if name=='rush':pitch=.29*v;head=.58*v;gait=1.25*env(8,25,75,95);spread=.15;s[1]=-.07*v
  if name=='hop_kick':flight=.74*env(18,43,61,84);spread=.55+.30*v;wingbeat=.38*np.sin(ph*2)*v;pitch=.13*v
  if name=='glide':flight=1.40*env(20,60,105,150);spread=.98;wingbeat=.32*np.sin(ph*3)*env(5,30,125,150);pitch=.12*v-.10*prep
  if name.startswith(('poison_spit','poison_fan','poison_cloud')):head=-.18*prep+.33*v;jaw=.78*v+.28*prep;sac=.88+.26*prep-.32*v;crest=.35*prep;spread=.42+.25*v
  s[1]-=.51*recover;pitch=(1-recover)*pitch+.31*recover;head=(1-recover)*head+.82*recover;yaw*=1-recover;tail*=1-recover;roll*=1-recover;spread=(1-recover)*spread+.26*recover;gait*=1-recover;jaw*=1-recover;wingbeat*=1-recover
 if name in ('threat','rage_roar','refill','sniff','eat','pant'):
  v=env(0,D*.18,D*.78,D);spread=.26+(.66 if name in ('threat','rage_roar') else .12)*v;crest=.12+.65*v;head=(-.23 if name in ('threat','rage_roar') else .58)*v;jaw=(.46 if name in ('threat','rage_roar') else .22)*v;wingbeat=.48*v if name in ('threat','rage_roar') else 0.;sac=.85+.22*v;s[1]=-.40*v if name in ('refill','eat','pant') else 0
 if name in ('takeoff','hover','land','fly_forward'):
  flight=1.3*(smooth(0,D*.65,t) if name=='takeoff' else 1-smooth(0,D*.68,t) if name=='land' else 1);spread=1;wingbeat=.48*np.sin(ph*2);pitch=-.10 if name=='takeoff' else .12 if name=='land' else .03
 if name in ('fall_l','fall_r','sleep_enter','sleep_loop','sleep_exit','stun','rise','death','capture'):
  v=1 if name in ('sleep_loop','stun') else 1-smooth(0,D*.9,t) if name in ('rise','sleep_exit') else smooth(0,D*.5,t);s[1]=-1.06*v;roll=(1 if name!='fall_r' else -1)*.77*v if name in ('fall_l','fall_r','death','stun','rise') else .12*v;head=.49*v;pitch=.18*v;spread=.35+.30*v;tail=.12*v;jaw=.08*v;breath*=1-v
 if name.startswith(('flinch','break','sever')):v=np.sin(PI*p);head=-.27*v;roll=.15*v*np.sin(ph);s[1]=-.09*v;spread=.28+.35*v
 if name in ('paralysis','trap'):head=.08*np.sin(ph*8);jaw=.14;spread=.32;tail=.05*np.sin(ph*7)
 s[1]+=flight+breath*(1-recover);put('body',pitch,0,roll);put('neck_01',head*.39,yaw*.30);put('neck_02',head*.34,yaw*.35);put('neck_03',head*.27,yaw*.35);put('head',head*.17,yaw*.18);put('jaw',jaw);put('tongue',jaw*.14)
 for i in range(14):put(f'tail_{i+1:02}',.015*np.sin(ph-i*.43)*(1-recover),tail*(.12+.018*np.sin(i)),.017*np.cos(ph-i*.4)*(1-recover))
 bodyrot=R.from_quat(q[J['body']]);body=rest[J['body']]
 for side,d in [('l',1),('r',-1)]:
  ph0=ph+(0 if side=='l' else PI);lift=max(0,np.sin(ph0))*.22*abs(gait);stride=.50*gait*np.cos(ph0);bn=lambda k:k+'_'+side;a,k,e=[J[bn(x)] for x in ('hip','knee','hock')];hip=rest[a];hock=rest[e];target=bodyrot.inv().apply(hock-body+np.array([0,lift-s[1]+flight,stride]))+body
  if flight>.02:target=hock+np.array([0,.30*flight,.38*flight]);
  if name=='hop_kick' and side=='l':target+=np.array([0,.18*flight,.42*flight])
  v=target-hip;l1=np.linalg.norm(rest[k]-hip);l2=np.linalg.norm(hock-rest[k]);L=np.clip(np.linalg.norm(v),abs(l1-l2)+.001,l1+l2-.002);axis=unit(v);pole=unit(rest[k]-hip-axis*((rest[k]-hip)@axis));X=(l1*l1-l2*l2+L*L)/(2*L);K=hip+axis*X+pole*np.sqrt(max(0,l1*l1-X*X));E=hip+axis*L;q[a]=align(rest[k]-hip,K-hip);wr=align(hock-rest[k],E-K);q[k]=mul(inv(q[a]),wr);q[e]=mul(inv(wr),bodyrot.inv().as_quat());put(bn('ankle'),.22*flight);put(bn('foot'),-.13*flight)
  if name in ('death','fall_l','fall_r','sleep_loop','stun'):put(bn('hip'),.35,0,d*.42);put(bn('knee'),-.7);put(bn('hock'),.32)
  for i in range(1,4):put(f'toe{i}_{side}',-.14*flight+.06*lift);put(f'toe{i}_tip_{side}',-.23*flight)
  fold=1-np.clip(spread,0,1);put(bn('wing_shoulder'),-.06*fold,d*.52*fold,d*(-.58*fold+wingbeat if name not in ('wing_l','wing_r') else -.52*fold+wingbeat*(1 if side==name[-1] else .12)));put(bn('wing_elbow'),.08*fold,d*.68*fold,d*.18*fold);put(bn('wing_wrist'),.10*fold,d*.32*fold,d*-.20*fold)
  for i in range(1,5):put(f'wing_digit{i}_a_{side}',.035*np.sin(ph+i)*spread*(1-recover),d*.14*fold*(i-2),d*.055*fold);put(f'wing_digit{i}_b_{side}',.07*fold,d*.11*fold*(i-2),0)
  put(bn('arm_upper'),.16*np.sin(ph0)*gait,0,d*.06*flight);put(bn('arm_lower'),.16*flight,.03*np.sin(ph0)*(1-recover),0);put(bn('hand'),.13*flight)
  for i in range(1,6):put(f'crest_{i}_{side}',.05*np.sin(ph-i*.2)*(1-recover),0,d*crest*.18)
  for i in range(1,4):put(f'ruff_{i}_{side}',.03*np.sin(ph+i)*(1-recover),0,d*crest*.16);put(f'tail_fan_{i}_{side}',.03*np.sin(ph-i)*(1-recover),d*tail*.05,0)
  scales[bn('sac')]=np.array([sac,sac,sac])
 return q,s,rt,scales

class GLB:
    def __init__(self):self.buf=bytearray();self.views=[];self.acc=[]
    def view(self,a,target=None):
        self.buf.extend(b'\0'*((-len(self.buf))%4));a=a if isinstance(a,bytes) else np.ascontiguousarray(a).tobytes();v={'buffer':0,'byteOffset':len(self.buf),'byteLength':len(a)};self.buf.extend(a)
        if target:v['target']=target
        self.views.append(v);return len(self.views)-1
    def accessor(self,a,typ,ctype=5126,target=None,bounds=False):
        a=np.asarray(a,dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[ctype]);r={'bufferView':self.view(a,target),'componentType':ctype,'count':len(a),'type':typ}
        if bounds:r.update(min=np.min(a,axis=0).reshape(-1).tolist(),max=np.max(a,axis=0).reshape(-1).tolist())
        self.acc.append(r);return len(self.acc)-1

def build(hd,out):
 M.clear();geometry(hd);source=P/'material_source';out.mkdir(parents=True,exist_ok=True);tex=out/'textures';maps=bake(source,tex,hd);g=GLB();images=[];textures=[];mats=[];prims=[];stats={}
 def texture(path):images.append({'bufferView':g.view(path.read_bytes()),'mimeType':'image/jpeg' if path.suffix=='.jpg' else 'image/png','name':path.stem});textures.append({'source':len(images)-1,'sampler':0});return len(textures)-1
 for mat in [*PROFILES,'eye','pupil']:
  parts=M[mat];mi=len(mats);m={'name':mat,'doubleSided':mat=='wing','pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':.7}};pm=m['pbrMetallicRoughness']
  if mat in PROFILES:
   pm.update(baseColorTexture={'index':texture(tex/f'{mat}_basecolor.jpg')},metallicRoughnessTexture={'index':texture(tex/f'{mat}_orm.png')},roughnessFactor=1);m['normalTexture']={'index':texture(tex/f'{mat}_normal.png'),'scale':.65 if mat in ('hide','belly','leg','face') else .5};m['occlusionTexture']={'index':pm['metallicRoughnessTexture']['index'],'strength':.55};m['extensions']={'KHR_materials_clearcoat':{'clearcoatFactor':PROFILES[mat][3],'clearcoatRoughnessFactor':.35}};m['extras']=maps[mat]
  else:pm.update(baseColorFactor=[1,1,1,1] if mat=='eye' else [.015,.017,.012,1],roughnessFactor=.29)
  mats.append(m);a={k:np.concatenate(x) for k,x in parts.items()};stats[mat]={'vertices':len(a['p']),'triangles':len(a['f'])};attrs={'POSITION':g.accessor(a['p'],'VEC3',target=34962,bounds=True),'NORMAL':g.accessor(a['n'],'VEC3',target=34962),'TEXCOORD_0':g.accessor(a['uv'],'VEC2',target=34962),'JOINTS_0':g.accessor(a['j'],'VEC4',5123,target=34962),'WEIGHTS_0':g.accessor(a['w'],'VEC4',target=34962),'COLOR_0':g.accessor(a['c'],'VEC3',target=34962)};prims.append({'attributes':attrs,'indices':g.accessor(a['f'].ravel(),'SCALAR',5125,target=34963),'material':mi})
 nodes=[];ib=[]
 for i,(n,p,xyz) in enumerate(B):
  a={'name':n,'translation':(xyz-(rest[p] if p>=0 else 0)).tolist()};kids=[j for j,x in enumerate(B) if x[1]==i]
  if kids:a['children']=kids
  nodes.append(a);m=np.eye(4);m[:3,3]=-xyz;ib.append(m.T.ravel())
 nodes.append({'name':'Venolka_mesh','mesh':0,'skin':0});skin={'name':'Venolka_rig','joints':list(range(len(B))),'skeleton':0,'inverseBindMatrices':g.accessor(ib,'MAT4')};animations=[]
 for n,D in CLIPS.items():
  ts=np.unique(np.r_[np.arange(0,D,3),D,[v for x in ATT.get(n,(0,[]))[1] for v in x]]);pp=[pose(n,t,D) for t in ts];q=np.array([x[0] for x in pp]);s=np.array([x[1] for x in pp]);rt=np.array([x[2] for x in pp]);sc={bn:np.array([x[3].get(bn,np.ones(3)) for x in pp]) for bn in ('sac_l','sac_r')};ti=g.accessor(ts/60,'SCALAR',bounds=True);sam=[];chan=[]
  if n in LOOP:q[-1]=q[0];s[-1]=s[0];rt[-1]=rt[0];[a.__setitem__(-1,a[0]) for a in sc.values()]
  def channel(node,path,a,typ):sam.append({'input':ti,'output':g.accessor(a,typ),'interpolation':'LINEAR'});chan.append({'sampler':len(sam)-1,'target':{'node':node,'path':path}})
  for i in range(len(B)):
   a=q[:,i,:]
   if np.max(abs(a-ID))<1e-6:continue
   for k in range(1,len(a)):
    if a[k]@a[k-1]<0:a[k]*=-1
   channel(i,'rotation',a,'VEC4')
  if np.max(abs(s))>1e-6:channel(J['body'],'translation',s+rest[J['body']],'VEC3')
  if np.max(abs(rt))>1e-6:channel(0,'translation',rt,'VEC3')
  for bn,a in sc.items():channel(J[bn],'scale',a,'VEC3')
  animations.append({'name':'vn_'+n,'samplers':sam,'channels':chan,'extras':{'durationTicks':D,'loop':n in LOOP,'hitWindows':ATT.get(n,(0,[]))[1]}})
 doc={'asset':{'version':'2.0','generator':'Kari Venolka connected-skin V1'},'extensionsUsed':['KHR_materials_clearcoat'],'scene':0,'scenes':[{'nodes':[0,len(B)]}],'nodes':nodes,'skins':[skin],'meshes':[{'name':'Venolka','primitives':prims}],'materials':mats,'textures':textures,'images':images,'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],'animations':animations,'bufferViews':g.views,'accessors':g.acc,'buffers':[{'byteLength':len(g.buf)}],'extras':{'monsterId':'monster.venolka','sculptDesign':'connected-winged-v1','materialDesign':MATERIAL_VERSION,'sourceSha256':digest(P),'stats':stats,'materialMaps':maps,'quality':'master' if hd else 'game'}}
 j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);g.buf.extend(b'\0'*((-len(g.buf))%4));path=out/('venolka_master.glb' if hd else 'venolka_game.glb')
 with path.open('wb') as f:f.write(struct.pack('<4sII',b'glTF',2,28+len(j)+len(g.buf)));f.write(struct.pack('<I4s',len(j),b'JSON'));f.write(j);f.write(struct.pack('<I4s',len(g.buf),b'BIN\0'));f.write(g.buf)
 manifest={'joints':len(B),'clips':len(CLIPS),'triangles':sum(s['triangles'] for s in stats.values()),'vertices':sum(s['vertices'] for s in stats.values()),'bytes':path.stat().st_size,'stats':stats,'animations':[{'name':x['name'],**x['extras']} for x in animations]};(out/('manifest_master.json' if hd else 'manifest_game.json')).write_text(json.dumps(manifest,indent=2));print(json.dumps({k:manifest[k] for k in ('joints','clips','triangles','vertices','bytes')}),flush=True);return path
if __name__=='__main__':
 ap=argparse.ArgumentParser();ap.add_argument('--quality',choices=['game','master'],default='game');ap.add_argument('--out',type=Path,default=P/'out');args=ap.parse_args();build(args.quality=='master',args.out)
