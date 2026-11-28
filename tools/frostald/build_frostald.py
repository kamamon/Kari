"""Frostald: reproducible procedural original GLB. Requires numpy scipy Pillow. No external APIs."""
from pathlib import Path
import numpy as np, math, json, struct, os
from scipy.ndimage import gaussian_filter
from scipy.spatial.transform import Rotation as R
from PIL import Image
from material_atlas import VERSION as MATERIAL_DESIGN, PROFILES, bake_maps, source_digest
from organic_sculpt import VERSION as SCULPT_DESIGN, make_sculpt
P=Path(__file__).parent; T=P/'textures';T.mkdir(exist_ok=True)
LOD=float(os.environ.get('FROST_LOD','1.25'));SUFFIX=os.environ.get('FROST_SUFFIX','game')
PI=np.pi;rng=np.random.default_rng(281127);N=int(os.environ.get('FROST_TEX','1024'));v,u=np.mgrid[:N,:N].astype(np.float32)/N
from scipy.spatial import cKDTree
from scipy.ndimage import map_coordinates
sites=np.array([((i+.5+.5*(j%2)+rng.uniform(-.19,.19))/12,(j+.5+rng.uniform(-.21,.21))/12) for j in range(12) for i in range(12)])%1
pts=np.concatenate([sites+[a,b] for a in [-1,0,1] for b in [-1,0,1]])
d,ix=cKDTree(pts).query(np.stack([u,v],-1).reshape(-1,2),k=2,workers=4);d=d.reshape(N,N,2);ix=ix[:,0].reshape(N,N)%144;edge=np.clip((d[:,:,1]-d[:,:,0])*95,0,1).astype(np.float32);center=np.clip(1-d[:,:,0]*13,0,1).astype(np.float32);del d
HIDE=(.13+.67*np.sin(edge*PI/2)+.18*center)*rng.uniform(.82,1.12,144).astype(np.float32)[ix]
# Keep original HIDE geometry displacement; replace rendered material only.

# Dedicated 79-node quadruped skeleton; rest coordinates in meters, Y up +Z front.
B=[];J={}
def b(n,p,xyz):J[n]=len(B);B.append((n,J[p] if p else -1,np.array(xyz,float)));return n
for n,p,x in [('root',None,(0,0,0)),('body','root',(0,1.12,0)),('pelvis','body',(0,1.12,-.95)),('chest','body',(0,1.25,.85)),('neck_01','chest',(0,1.39,1.34)),('neck_02','neck_01',(0,1.45,1.72)),('head','neck_02',(0,1.46,2.03)),('jaw','head',(0,1.27,2.08)),('snout','head',(0,1.42,2.85)),('tongue','jaw',(0,1.25,2.5)),('eye_l','head',(.30,1.60,2.48)),('eye_r','head',(-.30,1.60,2.48))]:b(n,p,x)
for side,d in [('l',1),('r',-1)]:
 for limb,parent,z in [('fore','chest',.93),('hind','pelvis',-1.12)]:
  n=lambda v:f'{limb}_{v}_{side}'
  b(n('upper'),parent,(d*.61,1.19,z));b(n('lower'),n('upper'),(d*.79,.68,z-.17 if limb=='fore' else z+.25));b(n('ankle'),n('lower'),(d*.86,.19,z+.05));b(n('paw'),n('ankle'),(d*.86,.12,z+.27))
  for i in range(4):b(n('toe'+str(i)),n('paw'),(d*(.67+i*.125),.09,z+.39+.035*np.sin(i)))
for i in range(12):
 t=i/11;b(f'tail_{i+1:02}','pelvis' if not i else f'tail_{i:02}',(0,1.10-.42*t+.08*np.sin(t*np.pi),-1.42-3.00*t))
for i in range(6):
 for side,d in [('l',1),('r',-1)]:b(f'mane_{side}_{i+1:02}','neck_01' if i<3 else 'chest',(d*(.31+.24*np.sin((i+1)/7*np.pi)),1.75-.035*i,1.72-i*.22))
for i in range(7):b(f'dorsal_{i+1:02}','body' if i<4 else f'tail_{(i-3)*2:02}',(0,1.63-.075*i,.5-i*.55))
for side,d in [('l',1),('r',-1)]:b('gill_'+side,'neck_02',(d*.28,1.24,1.76));b('lid_'+side,'head',(d*.30,1.60,2.48))
rest=np.array([v[2] for v in B]);M={}

def unit(x):return x/(np.linalg.norm(x,axis=-1,keepdims=True)+1e-12)
def add(mat,p,n,uv,j,w,f,col=None):
    g=M.setdefault(mat,{k:[] for k in ['p','n','uv','j','w','f','c']});off=sum(len(x) for x in g['p']);p=np.asarray(p,np.float32);n=np.asarray(n,np.float32);f=np.asarray(f,np.uint32);cr=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]);valid=np.linalg.norm(cr,axis=1)>1e-11;f=f[valid];cr=cr[valid];flip=(cr*n[f[:,0]]).sum(1)<0;f[flip]=f[flip][:,[0,2,1]]
    if col is None:col=np.ones_like(p,dtype=np.float32)
    for k,a in [('p',p),('n',n),('uv',np.asarray(uv,np.float32)),('j',np.asarray(j,np.uint16)),('w',np.asarray(w,np.float32)),('f',f+off),('c',np.asarray(col,np.float32))]:g[k].append(a)
def wt(a,b,t):t=float(np.clip(t,0,1));return [J[a],J[b],0,0],[1-t,t,0,0]
def cat(a,b,c,d,t):return .5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
def faces(k,s):
    i=(np.arange(k)[:,None]*(s+1)+np.arange(s)[None,:]).ravel();l=i+s+1;return np.stack([np.stack([i,i+1,l],1),np.stack([i+1,l+1,l],1)],1).reshape(-1,3)
def linear(c):
    c=np.clip(c,0,1);return np.where(c<.04045,c/12.92,((c+.055)/1.055)**2.4).astype(np.float32)
def tint(mat,p,n,uv,region):
    x,y,z=p.T;nx,ny,nz=n.T;u,v=uv.T
    if mat=='hide':
        dorsal=np.clip((ny+.65)*.9,0,1);bands=.18*np.sin(z*5.4+x*3+y*4)+.09*np.sin(z*12+y*9);f=.05*np.sin(x*95+y*83+z*64)*np.cos(y*71-z*35)
        belly=np.array([.69,.75,.79]);back=np.array([.23,.38,.54]);c=belly*(1-dorsal[:,None])+back*dorsal[:,None];c*=np.clip(1+bands[:,None]*dorsal[:,None]+f[:,None],.62,1.3);return linear(c)
    if mat in ('keratin','feather'):
        h=np.clip(v,0,1);c=np.array([.30,.46,.65] if mat=='keratin' else [.57,.73,.85])*(1-h[:,None])+np.array([.97,.99,1])*h[:,None];return linear(c)
    return np.ones_like(p,np.float32)
def norm_surface(p,normal):
    n=unit(np.cross(np.gradient(p,axis=0),np.gradient(p,axis=1)));n*=np.where(np.sum(n*normal,axis=-1,keepdims=True)<0,-1,1);bad=np.linalg.norm(n,axis=-1)<.5;n[bad]=normal[bad];return unit(n)
def scute(center,normal,tangent,L,W,H,j,w,col,seed):
    t=np.linspace(0,1,10)[:,None];r=np.linspace(-1,1,7)[None,:];tangent=unit(tangent-normal*(tangent@normal));side=unit(np.cross(tangent,normal));width=W*(np.sin(PI*t)**.63)*(1-.28*t);height=H*np.sin(PI*t)**.6*np.maximum(0,1-r*r)**.55;ridge=.24*H*np.exp(-(r/.25)**2)*np.sin(PI*t);q=center[None,None,:]+tangent[None,None,:]*((t-.30)*L)[...,None]+side[None,None,:]*(r*width)[...,None]+normal[None,None,:]*(height+ridge-.005-0.006*(r*r+t*t))[...,None];nn=norm_surface(q,np.broadcast_to(normal,q.shape));uv=np.stack(np.broadcast_arrays(.027+.065*(r+1)/2,.03+.065*t),-1).reshape(-1,2);q=q.reshape(-1,3);nn=nn.reshape(-1,3);pig=np.broadcast_to(col,(len(q),3)).copy();pig*=np.broadcast_to((.72+.28*np.sin(PI*t)*np.maximum(0,1-r*r)**.2)[...,None],(10,7,3)).reshape(-1,3);add('hide',q,nn,uv,np.tile(j,(len(q),1)),np.tile(w,(len(q),1)),faces(9,6),pig)
def tube(mat,C,steps=8,sides=24,scale=1):
    steps=max(2,round(steps*LOD));sides=max(6,round(sides*LOD));c=np.array([x[:5] for x in C]);K=len(c)-1;S=[];I=[];W=[]
    for k in range(K*steps+1):
        i=min(k//steps,K-1);t=(k-i*steps)/steps;d=cat(c[max(0,i-1)],c[i],c[i+1],c[min(K,i+2)],t);d[3:]=np.maximum(.001,d[3:]);S.append(d);j,w=wt(C[i][5],C[i+1][5],t*t*(3-2*t));I.append(j);W.append(w)
    S=np.asarray(S);A=np.r_[0,np.cumsum(np.linalg.norm(np.diff(S[:,:3],axis=0),axis=1))];axis=unit(np.gradient(S[:,:3],axis=0));X=np.tile([1.,0,0],(len(S),1));X-=axis*np.sum(axis*X,axis=1)[:,None];m=np.linalg.norm(X,axis=1)<.04;X[m]=np.array([0.,0,1])-axis[m]*axis[m,2,None];X=unit(X);Y=unit(np.cross(axis,X))
    for k in range(1,len(Y)):
        if Y[k]@Y[k-1]<0:X[k]*=-1;Y[k]*=-1
    th=np.linspace(0,2*PI,sides+1);co=np.cos(th)[None,:,None];si=np.sin(th)[None,:,None];X=X[:,None,:];Y=Y[:,None,:];rad=S[:,3:5];p=S[:,None,:3]+X*rad[:,0,None,None]*co+Y*rad[:,1,None,None]*si;n=unit(X*co/rad[:,0,None,None]+Y*si/rad[:,1,None,None]);bn=C[len(C)//2][5];region='axial' if len(C)>15 else 'hind' if 'hind_' in bn or 'hock' in bn else 'fore' if 'fore_' in bn else 'head' if bn in ('head','jaw','snout') or 'lid_' in bn else 'other'
    if mat=='hide':
        if region=='hind':
            a=(A/A[-1])[:,None];bulge=.06*np.sin(3*th[None,:]+a*5)*np.exp(-((a-.29)/.24)**2)+.025*np.sin(2*th[None,:]-a*6);p+=n*(bulge*np.mean(rad,axis=1)[:,None])[...,None]
        if region=='axial':
            z=S[:,2,None];ridge=.019*np.exp(-((z-.0)/.65)**2)*np.sin(th[None,:]*2+.4)**2;fold=.008*np.exp(-((z-.72)/.44)**2)*np.sin(A[:,None]*83+np.cos(th[None,:])*2);p+=n*(ridge+fold)[...,None]
        tile=.29 if region=='axial' else .19 if region=='hind' else .14 if region in ('fore','head') else .105;rep=max(1,round(2*PI*np.median(np.mean(rad,axis=1))/tile));uu,vv=np.broadcast_arrays(np.linspace(0,rep,sides+1)[None,:],(A/tile)[:,None]);uv=np.stack([uu,vv],-1);h=map_coordinates(HIDE,np.stack([(vv%1)*(N-1),(uu%1)*(N-1)]),order=1,mode='wrap');p+=n*((h-.5)*np.minimum(.0045,np.mean(rad,axis=1)*.035)[:,None])[...,None]
    else:uv=np.stack(np.broadcast_arrays(np.linspace(0,1,sides+1)[None,:],(A/A[-1]*scale)[:,None]),-1)
    nn=norm_surface(p,n)
    if mat=='hide' and region=='axial':
        # Overlapping dorsolateral osteoderms are actual skinned surfaces, not a billboard.
        prev=-10
        for k in range(2,len(S)-2):
            z=S[k,2];step=.092 if z>-.9 else .105
            if z>1.60 or A[k]-prev<step:continue
            prev=A[k];radius=np.mean(rad[k]);count=max(3,min(11,int(radius*40)))
            for q in range(count):
                theta=(q+.5*(k%2))/count*PI;idx=int((theta/(2*PI))*sides)%sides
                # Choose dorsal samples from both sides; normal Y points up.
                jx=int((sides-idx)%sides) if n[k,idx,1]<0 else idx
                no=unit(n[k,jx]);c0=p[k,jx];
                if no[1]<.05:continue
                l=min(.13,max(.045,radius*.65));w0=min(.055,max(.015,radius*.20));h0=min(.019,max(.004,radius*.06));c=tint('hide',c0[None,:],no[None,:],np.array([[0.,0.]]),'axial')[0];scute(c0,no,-axis[k],l,w0,h0,np.asarray(I[k]),np.asarray(W[k]),c,k*17+q)
    p=p.reshape(-1,3);nn=nn.reshape(-1,3);uv=uv.reshape(-1,2);I=np.repeat(np.asarray(I),sides+1,axis=0);W=np.repeat(np.asarray(W),sides+1,axis=0);add(mat,p,nn,uv,I,W,faces(len(S)-1,sides),tint(mat,p,nn,uv,region))
def ell(mat,c,r,bn,sides=22,rings=13):
    sides=max(8,round(sides*LOD));rings=max(5,round(rings*LOD));r=np.asarray(r);c=np.asarray(c);ph=np.linspace(0,PI,rings+1)[:,None];th=np.linspace(0,2*PI,sides+1)[None,:];v=np.stack(np.broadcast_arrays(np.sin(ph)*np.cos(th),np.cos(ph),np.sin(ph)*np.sin(th)),-1);p=(c+v*r).reshape(-1,3);n=unit(v/r).reshape(-1,3);uv=np.stack(np.broadcast_arrays(th/(2*PI),ph/PI),-1).reshape(-1,2);I=np.tile([J[bn],0,0,0],(len(p),1));W=np.tile([1,0,0,0],(len(p),1));add(mat,p,n,uv,I,W,faces(rings,sides),tint(mat,p,n,uv,'head' if bn=='head' else 'other'))
def soften_ell(mat,old,new,ratio):
    # Transform an already triangulated ellipse; preserve index count, UVs and skin weights.
    xyz=M[mat]['p'][-1];normal=M[mat]['n'][-1];scale=np.asarray(ratio,np.float32)
    xyz[:]=np.asarray(new,np.float32)+(xyz-np.asarray(old,np.float32))*scale
    normal[:]=unit(normal/scale)
def calm_eye(side,d):
    # A recessed socket, cool natural iris and round pupil (no emission or glowing eye).
    socket=(d*.31,1.61,2.45)
    ell('keratin',socket,(.052,.09,.13),'head',24,16)
    soften_ell('keratin',socket,(d*.31,1.615,2.45),(.88,.78,.91))
    old=(d*.356,1.62,2.47);new=(d*.350,1.62,2.47)
    ell('eye',old,(.033,.044,.054),'eye_'+side,24,16)
    soften_ell('eye',old,new,(.97,.96,.92))
    v=M['eye']['p'][-1];y=(v[:,1]-new[1])/(.044*.96);z=(v[:,2]-new[2])/(.054*.92)
    radius=np.sqrt(y*y+z*z);theta=np.arctan2(y,z)
    # Subtle radial fibers and a dark limbal ring; no yellow or self-lit material.
    iris=np.array([.32,.56,.67],np.float32)[None,:]*(1+.065*np.cos(theta*31)+.035*np.sin(theta*47+radius*18))[:,None]
    rim=np.clip((radius-.72)/.28,0,1)[:,None]
    col=iris*(1-rim)+np.array([.13,.25,.33],np.float32)[None,:]*rim
    M['eye']['c'][-1][:]=linear(col)
    old=(d*.384,1.622,2.48)
    ell('pupil',old,(.006,.032,.013),'eye_'+side,14,10)
    soften_ell('pupil',old,(d*.379,1.62,2.47),(1.0,.625,1.5384615385))
def spike(mat,points,bn,r=(.04,.035),sides=12):
    tube(mat,[(*p,r[0]*max(.025,1-i/(len(points)-1)),r[1]*max(.025,1-i/(len(points)-1)),bn) for i,p in enumerate(points)],5,sides)

# V6 connected skin and individually sculpted ice plates. Existing rig stays in metre-space.
sculpt_eyes=make_sculpt(add,J,rest,LOD,P/'material_source',ell,tube)
for k,(side,d,sx) in enumerate(sculpt_eyes):
    v=M['eye']['p'][k]; yy=(v[:,1]-1.613)/.039;zz=(v[:,2]-2.445)/.052;r=np.sqrt(yy*yy+zz*zz);theta=np.arctan2(yy,zz)
    iris=np.array([.32,.59,.71])[None,:]*(1+.075*np.cos(theta*29)+.035*np.sin(theta*47+r*18))[:,None]
    rim=np.clip((r-.70)/.30,0,1)[:,None];col=iris*(1-rim)+np.array([.13,.24,.32])[None,:]*rim
    M['eye']['c'][k][:]=linear(col)

Id=np.array([0.,0.,0.,1.]);PI=math.pi
def rot(x=0,y=0,z=0):return R.from_euler('xyz',[x,y,z]).as_quat()
def align(a,b):
 a=unit(a);b=unit(b);c=np.cross(a,b);d=np.clip(a@b,-1,1);return Id.copy() if np.linalg.norm(c)<1e-8 else R.from_rotvec(unit(c)*np.arccos(d)).as_quat()
def mul(a,b):return (R.from_quat(a)*R.from_quat(b)).as_quat()
def inv(a):return R.from_quat(a).inv().as_quat()
ATT={'bite':(72,[[24,38]]),'double_bite':(124,[[25,38],[60,72]]),'claw_l':(94,[[35,49]]),'claw_r':(94,[[35,49]]),'body_ram':(130,[[36,76]]),'slide':(164,[[40,109]]),'tail_l':(111,[[37,60]]),'tail_r':(111,[[37,60]]),'roll_l':(138,[[39,81]]),'roll_r':(138,[[39,81]]),'ice_breath':(150,[[43,85]]),'ice_sweep_l':(170,[[49,94]]),'ice_sweep_r':(170,[[49,94]]),'ice_burst':(156,[[53,72]]),'head_slam':(110,[[38,52]]),'back_bite':(96,[[34,47]])}
CLIPS={'idle':180,'walk':60,'trot':44,'sprint':35,'limp':90,'turn_l':62,'turn_r':62,'pivot_l':82,'pivot_r':82,'retreat':72,'threat':100,'rage_roar':110,'drink':240,'shake_mane':104,'sniff':120,'eat':140,'sleep_enter':100,'sleep_loop':180,'sleep_exit':100,'swim':60,'dive':90,'surface':85,**{k:v[0] for k,v in ATT.items()},'flinch_head':50,'flinch_body':50,'flinch_leg_l':60,'flinch_leg_r':60,'flinch_tail':56,'fall_l':110,'fall_r':110,'rise':100,'break_mane':90,'break_head':90,'sever_tail':100,'stun':164,'paralysis':180,'trap':180,'capture':120,'death':180,'pant':120,'recharge':240}
LOOP={'idle','walk','trot','sprint','limp','swim','sleep_loop','stun','paralysis','trap','pant'}
def pose(n,t,D):
 p=t/D;phase=p*2*PI;q=np.tile(Id,(len(B),1));s=np.zeros(3);rt=np.zeros(3)
 def pulse(a,b,c):return np.interp(t,[0,a,b,c,D],[0,0,1,0,0])
 def put(bn,x=0,y=0,z=0):q[J[bn]]=rot(x,y,z)
 sway=.035*np.sin(phase);head=.025*np.sin(phase);jaw=.025;tail=.06*np.sin(phase);mane=0;gait=0;roll=0;pitch=0
 if n in ('walk','trot','sprint','limp','retreat','turn_l','turn_r','pivot_l','pivot_r','slide','body_ram'):
  gait={'walk':.75,'trot':.9,'sprint':1.,'limp':.55,'retreat':-.55,'turn_l':.5,'turn_r':.5,'pivot_l':.55,'pivot_r':.55,'slide':.15,'body_ram':.7}[n];s[1]=.035*abs(gait)*np.sin(2*phase);tail+=.10*np.sin(phase);pitch=.04*np.sin(2*phase)
 if n in ATT:
  w=ATT[n][1];v=max(pulse(max(1,a-18),(a+b)/2,min(D-1,b+22)) for a,b in w);prep=np.sin(PI*min(1,t/w[0][0])) if t<w[0][0] else 0
  if 'bite' in n:head=.35*v-.18*prep;jaw=.65*v+.25*prep;pitch=.05*v;tail=.13*v
  if n.startswith('claw'):side=n[-1];s[1]=.06*v;put('fore_upper_'+side,-.60*v);put('fore_lower_'+side,.78*v);roll=(1 if side=='l' else -1)*.20*v
  if n=='head_slam':head=.72*v-.38*prep;jaw=.14*v;pitch=.20*v;s[1]=-.18*v
  if n in ('slide','body_ram'):pitch=.10*v;head=.22*v;s[1]=-.24*v;tail=.18*np.sin(phase);gait=.05 if n=='slide' else .7
  if n.startswith('tail_'):tail=(1 if n.endswith('l') else -1)*1.10*v;sway=-tail*.23;head=.13*v
  if n.startswith('roll_'):roll=(1 if n.endswith('l') else -1)*1.25*v;s[1]=-.47*v;tail=.20*v
  if n.startswith('ice_'):head=-.25*prep+.12*v;jaw=.79*v+.30*prep;mane=.21*v;pitch=-.04*v;tail=.12*v;s[1]=.04*v
  if n.startswith('ice_sweep'):sway=(1 if n.endswith('l') else -1)*.78*(2*np.clip((t-w[0][0])/(w[0][1]-w[0][0]),0,1)-1)*v
 if n in ('rage_roar','threat','shake_mane','recharge','drink','eat','sniff'):
  v=np.sin(PI*p)**1.3;jaw=.75*v if n in ('rage_roar','threat') else .12*v;head=-.31*v if n in ('rage_roar','threat') else .46*v;mane=.25*v if n!='shake_mane' else .35*np.sin(phase*5)*v;tail=.13*np.sin(phase*2)
 if n in ('sleep_enter','sleep_loop','sleep_exit','fall_l','fall_r','rise','stun','capture','death'):
  v=1 if n in ('sleep_loop','stun') else (1-p if n in ('rise','sleep_exit') else min(1,p*2));s[1]=-.55*v;roll=(1 if n!='fall_r' else -1)*.93*v if n in ('fall_l','fall_r','stun','death','rise') else .10*v;head=.35*v;jaw=.10*v
 if n.startswith('flinch') or n.startswith('break') or n=='sever_tail':
  v=np.sin(PI*p);head=-.23*v;sway=.25*v*np.sin(phase*2);s[1]=-.08*v;tail=.18*v
 if n in ('paralysis','trap','pant'):head=.14+.03*np.sin(phase*5);jaw=.20+.10*np.sin(phase*4);mane=.07*np.sin(phase*4)
 if n in ('swim','dive','surface'):tail=.50*np.sin(phase);sway=.15*np.sin(phase);pitch=.10*np.sin(phase);gait=.3
 put('body',pitch,sway,roll);put('neck_01',head*.45,sway*.45);put('neck_02',head*.35,sway*.45);put('head',head*.35,sway*.7);put('jaw',jaw)
 for i in range(12):put(f'tail_{i+1:02}',.02*np.sin(phase-i*.45),tail*(.19+.03*np.sin(i)),.025*np.cos(phase-i*.4))
 for side,d in [('l',1),('r',-1)]:
  for i in range(6):put(f'mane_{side}_{i+1:02}',.035*np.sin(phase*2-i*.6),0,d*(mane+.018*np.sin(phase-i)))
  put('gill_'+side,0,0,d*.035*np.sin(phase*2))
  for limb,offset in [('fore',0),('hind',PI)]:
   if limb=='fore' and n=='claw_'+side:continue
   ph=phase+offset+(0 if side=='l' else PI);v=abs(gait);stride=.24*gait*np.cos(ph);lift=.14*v*max(0,np.sin(ph));bn=lambda j:f'{limb}_{j}_{side}'
   a,k,e=[J[bn(x)] for x in ('upper','lower','ankle')];hip=rest[a];target=rest[e]+np.array([0,lift-s[1],stride]);V=target-hip;l1=np.linalg.norm(rest[k]-rest[a]);l2=np.linalg.norm(rest[e]-rest[k]);L=np.clip(np.linalg.norm(V),abs(l1-l2)+.001,l1+l2-.001);axis=unit(V);pole=rest[k]-rest[a];pole=unit(pole-axis*(pole@axis));x=(l1*l1-l2*l2+L*L)/(2*L);K=hip+axis*x+pole*np.sqrt(max(0,l1*l1-x*x));A=hip+axis*L
   if v>0:q[a]=align(rest[k]-rest[a],K-hip);w=align(rest[e]-rest[k],A-K);q[k]=mul(inv(q[a]),w);q[e]=inv(w)
   elif n in ('fall_l','fall_r','stun','death','sleep_loop','capture','sleep_enter','sleep_exit','rise'):put(bn('upper'),.25,0,d*.5*min(1,abs(s[1])/.55));put(bn('lower'),-.55)
 return q,s,rt

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

def main():
    global M
    source=P/'material_source';source_hash=source_digest(source)
    assert set(M)==set(PROFILES)|{'eye','pupil','tooth'},set(M)
    M={name:M[name] for name in [*PROFILES,'tooth','eye','pupil']}
    maps=bake_maps(source,T,N,Path(os.environ['FROST_MATERIAL_MASTER']) if os.environ.get('FROST_MATERIAL_MASTER') else None)
    g=GLB();images=[];textures=[];materials=[];prims=[];stats={}
    def texture(path):images.append({'bufferView':g.view(path.read_bytes()),'mimeType':'image/jpeg' if path.suffix=='.jpg' else 'image/png','name':path.stem});textures.append({'source':len(images)-1,'sampler':0});return len(textures)-1
    for mat,parts in M.items():
        mi=len(materials);m={'name':mat,'doubleSided':mat in ['membrane','feather'],'pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':.65}}
        if mat in PROFILES:
            m['pbrMetallicRoughness'].update(baseColorTexture={'index':texture(T/f'{mat}_basecolor.jpg')},metallicRoughnessTexture={'index':texture(T/f'{mat}_orm.png')},roughnessFactor=1)
            m['normalTexture']={'index':texture(T/f'{mat}_normal.png'),'scale':.60 if mat in ('hide','head_skin','limb_skin','belly_skin') else .55}
            m['occlusionTexture']={'index':m['pbrMetallicRoughness']['metallicRoughnessTexture']['index'],'strength':.65}
            m['extensions']={'KHR_materials_clearcoat':{'clearcoatFactor':PROFILES[mat]['coat'],'clearcoatRoughnessFactor':.23 if mat in ('keratin','ice_plate','mouth','membrane') else .38}}
            m['extras']={'sourceAtlas':PROFILES[mat]['source'],'materialDesign':MATERIAL_DESIGN,'maps':maps[mat]}
        else:m['pbrMetallicRoughness'].update(baseColorFactor={'tooth':[.84,.77,.61,1],'eye':[1,1,1,1],'pupil':[.014,.021,.027,1]}[mat],roughnessFactor=.32 if mat=='eye' else .26 if mat=='pupil' else .46)
        materials.append(m);a={k:np.concatenate(x,axis=0) for k,x in parts.items()};
        assert np.max(abs(a['w'].sum(1)-1))<1e-6 and a['j'].max()<len(B);stats[mat]={'vertices':len(a['p']),'triangles':len(a['f'])};attrs={'POSITION':g.accessor(a['p'],'VEC3',target=34962,bounds=True),'NORMAL':g.accessor(a['n'],'VEC3',target=34962),'TEXCOORD_0':g.accessor(a['uv'],'VEC2',target=34962),'JOINTS_0':g.accessor(a['j'],'VEC4',5123,target=34962),'WEIGHTS_0':g.accessor(a['w'],'VEC4',target=34962),'COLOR_0':g.accessor(a['c'],'VEC3',target=34962)};prims.append({'attributes':attrs,'indices':g.accessor(a['f'].ravel(),'SCALAR',5125,target=34963),'material':mi})
    nodes=[];ib=[]
    for i,(name,p,xyz) in enumerate(B):
        n={'name':name,'translation':(xyz-(rest[p] if p>=0 else 0)).tolist()};kids=[j for j,x in enumerate(B) if x[1]==i]
        if kids:n['children']=kids
        nodes.append(n);m=np.eye(4);m[:3,3]=-xyz;ib.append(m.T.ravel())
    nodes.append({'name':'Frostald_mesh','mesh':0,'skin':0});skin={'name':'Frostald_rig','joints':list(range(len(B))),'skeleton':0,'inverseBindMatrices':g.accessor(ib,'MAT4')};animations=[]
    for name,D in CLIPS.items():
        ts=np.unique(np.r_[np.arange(0,D,4),D,[v for x in ATT.get(name,(0,[]))[1] for v in x]]);poses=[pose(name,t,D) for t in ts];q=np.array([x[0] for x in poses]);s=np.array([x[1] for x in poses]);r=np.array([x[2] for x in poses]);ti=g.accessor(ts/60,'SCALAR',bounds=True);sam=[];chan=[]
        if name in LOOP:q[-1]=q[0];s[-1]=s[0];r[-1]=r[0]
        def channel(node,path,a,typ):
            sam.append({'input':ti,'output':g.accessor(a,typ),'interpolation':'LINEAR'});chan.append({'sampler':len(sam)-1,'target':{'node':node,'path':path}})
        for i in range(len(B)):
            a=q[:,i,:]
            if np.max(abs(a-Id))<1e-5:continue
            for j in range(1,len(a)):
                if a[j]@a[j-1]<0:a[j]*=-1
            channel(i,'rotation',a,'VEC4')
        if np.max(abs(s))>1e-6:channel(J['body'],'translation',s+rest[J['body']],'VEC3')
        if np.max(abs(r))>1e-6:channel(0,'translation',r,'VEC3')
        animations.append({'name':'fa_'+name,'samplers':sam,'channels':chan,'extras':{'durationTicks':D,'loop':name in LOOP,'hitWindows':ATT.get(name,(0,[]))[1]}})
    doc={'asset':{'version':'2.0','generator':'Kari Frostald V6 connected anatomy and image PBR'},'extensionsUsed':['KHR_materials_clearcoat'],'scene':0,'scenes':[{'nodes':[0,len(B)]}],'nodes':nodes,'skins':[skin],'meshes':[{'name':'Frostald','primitives':prims}],'materials':materials,'textures':textures,'images':images,'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],'animations':animations,'bufferViews':g.views,'accessors':g.acc,'buffers':[{'byteLength':len(g.buf)}],'extras':{'status':'procedural skinned sculpt; concept parity unverified','coordinate':'Y up +Z forward metres','monsterId':'monster.frostald','eyeDesign':'calm-blue-v1','sculptDesign':SCULPT_DESIGN,'materialDesign':MATERIAL_DESIGN,'materialSourceSha256':source_hash,'materialMaps':maps,'stats':stats}}
    j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);g.buf.extend(b'\0'*((-len(g.buf))%4));out=struct.pack('<4sII',b'glTF',2,12+8+len(j)+8+len(g.buf))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(g.buf),b'BIN\0')+g.buf;(P/f'frostald_{SUFFIX}.glb').write_bytes(out)
    manifest={'joints':len(B),'animationClips':len(CLIPS),'materials':len(M),'sculptDesign':SCULPT_DESIGN,'materialDesign':MATERIAL_DESIGN,'materialSourceSha256':source_hash,'materialMaps':maps,'vertices':sum(x['vertices'] for x in stats.values()),'triangles':sum(x['triangles'] for x in stats.values()),'stats':stats,'clips':[{'name':x['name'],**x['extras']} for x in animations],'rig':[{'name':n,'parent':B[p][0] if p>=0 else None,'restM':xyz.tolist()} for n,p,xyz in B]};(P/('model_manifest.json' if SUFFIX=='v2' else f'model_manifest_{SUFFIX}.json')).write_text(json.dumps(manifest,indent=2));print({k:manifest[k] for k in ['joints','animationClips','materials','vertices','triangles']});print('GLB',len(out))
if __name__=='__main__':main()
