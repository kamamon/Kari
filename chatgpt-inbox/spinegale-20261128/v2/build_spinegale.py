"""Spinegale: reproducible procedural original GLB. Requires numpy scipy Pillow. No external APIs."""
from pathlib import Path
import numpy as np, math, json, struct, os
from scipy.ndimage import gaussian_filter
from scipy.spatial.transform import Rotation as R
from PIL import Image
P=Path(__file__).parent; T=P/'textures';T.mkdir(exist_ok=True)
LOD=float(os.environ.get('SPINE_LOD','1')); SUFFIX=os.environ.get('SPINE_SUFFIX','v2');
PI=np.pi;rng=np.random.default_rng(281126);N=512;v,u=np.mgrid[:N,:N]/N
# Textures: separate basecolor, tangent normal, packed occlusion/roughness/metallic.
for mat in ['hide','keratin','membrane','feather','mouth']:
    n=rng.normal(0,1,(N,N));s=gaussian_filter(n,2);s/=s.std();noise=.025*n+.016*s
    if mat=='hide':
        X=u*36+(np.floor(v*46)%2)*.5+.09*np.sin(v*28);Y=v*46+.10*np.sin(u*30+v*14);d=np.sqrt(((X%1-.5)/.55)**2+((Y%1-.5)/.53)**2);h=np.clip((1-d)*5,0,1)*(.56+.40*np.clip(1-d,0,1))+noise
        tile=rng.uniform(.85,1.15,(48,40));var=tile[np.floor(Y).astype(int)%48,np.floor(X).astype(int)%40];dors=np.clip((np.sin(2*PI*u)+.28)/.9,0,1);dark=np.clip((np.sin(2*PI*(v*8.6+.21*np.sin(u*2*PI)+.08*np.sin(v*16+u*22)))-.13)*4,0,1)*dors
        col=np.array([161,148,119])*(1-dors[...,None])+np.array([177,161,71])*dors[...,None];col=col*(1-dark[...,None])+np.array([50,50,42])*dark[...,None];col*=((.50+.50*np.clip(h+.18,0,1))*var)[...,None];rough=.75-.15*np.clip(h,0,1)
    elif mat=='keratin':
        h=.5+.11*np.sin(u*2*PI*25+np.sin(v*19))+.05*s+noise;a=np.clip(.18+.52*v+noise,0,1);col=np.array([34,32,27])*(1-a[...,None])+np.array([144,129,91])*a[...,None];rough=np.full_like(h,.48)
    elif mat=='membrane':
        f=.5+.5*np.cos(2*PI*(u*10+.10*np.sin(v*13)));h=.35+.37*f+noise;a=np.clip(.24+.53*(1-v)+.19*f+noise,0,1);col=np.array([98,29,17])*(1-a[...,None])+np.array([224,106,40])*a[...,None];rough=np.full_like(h,.62)
    elif mat=='feather':
        barb=np.sin(2*PI*(v*95+abs(u-.5)*13));h=.36+.10*barb+.32*np.exp(-((u-.5)/.045)**2)+noise;a=np.clip((np.sin(2*PI*(v*1.5+.3*abs(u-.5)))-.16)*3,0,1);col=(np.array([191,161,55])*(1-a[...,None])+np.array([46,44,37])*a[...,None])*(.90+.10*barb)[...,None];rough=np.full_like(h,.76)
    else:h=.5+noise;col=np.array([119,49,43])*(.95+noise[...,None]);rough=np.full_like(h,.32)
    gy,gx=np.gradient(h);normal=np.stack([-4*gx,-4*gy,np.ones_like(h)],-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True);orm=np.stack([np.clip(.73+.27*h,0,1),rough,np.zeros_like(h)],-1)
    for suffix,a in [('basecolor',col),('normal',(normal*.5+.5)*255),('orm',orm*255)]:Image.fromarray(np.uint8(np.clip(a,0,255))).save(T/f'{mat}_{suffix}.png')
# Skeleton, all rest axes identity; Y up, Z forward, metres.
B=[];J={}
def b(n,p,xyz):J[n]=len(B);B.append((n,J[p] if p else -1,np.array(xyz,float)));return n
for n,p,xyz in [('root',None,(0,0,0)),('pelvis','root',(0,1.17,-.36)),('body','pelvis',(0,1.34,-.15)),('lumbar','body',(0,1.39,.03)),('chest','lumbar',(0,1.47,.42)),('neck_01','chest',(0,1.65,.72)),('neck_02','neck_01',(0,1.84,.94)),('head','neck_02',(0,1.87,1.18)),('jaw','head',(0,1.73,1.22)),('tongue_01','jaw',(0,1.72,1.32)),('tongue_02','tongue_01',(0,1.71,1.50)),('eye_l','head',(.125,1.91,1.32)),('eye_r','head',(-.125,1.91,1.32)),('lid_l','head',(.125,1.91,1.32)),('lid_r','head',(-.125,1.91,1.32)),('snout','head',(0,1.80,1.58))]:b(n,p,xyz)
for side,sign in [('l',1),('r',-1)]:
    def bb(n,p,xyz):return b(n+'_'+side,p if p in ('pelvis','chest') else p+'_'+side,(sign*xyz[0],xyz[1],xyz[2]))
    for n,p,xyz in [('hind_upper','pelvis',(.265,1.20,-.30)),('hind_lower','hind_upper',(.32,.78,.07)),('hock','hind_lower',(.33,.41,-.42)),('metatarsus','hock',(.33,.13,-.05))]:bb(n,p,xyz)
    for n,x,z in [('inner',.23,.12),('middle',.33,.16),('outer',.43,.10)]:bb('toe_'+n,'metatarsus',(x,.075,z));bb('toe_'+n+'_tip','toe_'+n,(x,.045,z+.17))
    bb('toe_rear','metatarsus',(.34,.095,-.18));bb('hind_twist','hind_lower',(.325,.58,-.15))
    for n,p,xyz in [('fore_upper','chest',(.23,1.47,.42)),('fore_lower','fore_upper',(.32,1.22,.27)),('wrist','fore_lower',(.34,1.08,.55)),('palm','wrist',(.34,1.02,.64))]:bb(n,p,xyz)
    for i,x in enumerate([.294,.34,.386],1):bb('digit_'+str(i),'palm',(x,.98,.68))
for i in range(1,11):b(f'tail_{i:02}','pelvis' if i==1 else f'tail_{i-1:02}',(0,1.4-.08*(i-1)/9+.09*math.sin((i-1)/9*PI),-.61-(i-1)*.318))
for s,d in [('l',1),('r',-1)]:b('fan_'+s,'tail_10',(d*.06,1.34,-3.48))
for i in range(1,4):b(f'dewlap_{i:02}','neck_01' if i==1 else f'dewlap_{i-1:02}',(0,1.49-.17*(i-1),.91+.045*(i-1)))
for s,d in [('l',1),('r',-1)]:b('ribs_'+s,'chest',(d*.20,1.43,.30))
for i,z in enumerate([.62,.20,-.24,-.66],1):b(f'dorsal_{i:02}',['neck_01','chest','body','tail_01'][i-1],(0,1.74,z))
for s,d in [('l',1),('r',-1)]:b('crest_'+s,'head',(d*.05,2.01,1.18))
assert len(B)==77
rest=np.array([v[2] for v in B]);M={}
def unit(x):return x/(np.linalg.norm(x,axis=-1,keepdims=True)+1e-12)
def add(mat,p,n,uv,j,w,f):
    g=M.setdefault(mat,{k:[] for k in ['p','n','uv','j','w','f']});off=sum(len(x) for x in g['p']);p=np.array(p,float);n=np.array(n,float);f=np.array(f,np.uint32);cr=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]]);valid=np.linalg.norm(cr,axis=1)>1e-10;f=f[valid];cr=cr[valid];flip=(cr*n[f[:,0]]).sum(1)<0;f[flip]=f[flip][:,[0,2,1]]
    for k,a in [('p',p),('n',n),('uv',uv),('j',j),('w',w),('f',f+off)]:g[k].append(np.array(a))
def wt(a,b,t):t=float(np.clip(t,0,1));return [J[a],J[b],0,0],[1-t,t,0,0]
def cat(a,b,c,d,t):return .5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)
def tube(mat,C,steps=8,sides=24,scale=1):
    steps=max(2,round(steps*LOD));sides=max(6,round(sides*LOD));c=np.array([x[:5] for x in C]);K=len(c)-1;V=[];F=[];N=[];U=[];I=[];W=[];S=[];last=None
    for k in range(K*steps+1):
        i=min(k//steps,K-1);t=(k-i*steps)/steps;d=cat(c[max(0,i-1)],c[i],c[i+1],c[min(K,i+2)],t);d[3:]=np.maximum(.001,d[3:]);S.append(d)
    S=np.array(S);A=np.r_[0,np.cumsum(np.linalg.norm(np.diff(S[:,:3],axis=0),axis=1))];A/=A[-1]
    for k,d in enumerate(S):
        i=min(k//steps,K-1);t=(k-i*steps)/steps;j,w=wt(C[i][5],C[i+1][5],t*t*(3-2*t));axis=unit(S[min(k+1,len(S)-1),:3]-S[max(0,k-1),:3]);x=np.array([1.,0,0]);x-=axis*(axis@x)
        if np.linalg.norm(x)<.04:x=np.array([0.,0,1]);x-=axis*(axis@x)
        x=unit(x);y=unit(np.cross(axis,x));
        if last is not None and y@last<0:x=-x;y=-y
        last=y
        for a in range(sides+1):
            th=a/sides*2*PI;co,si=np.cos(th),np.sin(th);V.append(d[:3]+x*d[3]*co+y*d[4]*si);N.append(unit(x*co/d[3]+y*si/d[4]));U.append([a/sides,A[k]*scale]);I.append(j);W.append(w)
    for k in range(len(S)-1):
        for a in range(sides):i=k*(sides+1)+a;l=i+sides+1;F.extend([[i,i+1,l],[i+1,l+1,l]])
    add(mat,V,N,U,I,W,F)
def ell(mat,c,r,bn,sides=22,rings=13):
    sides=max(8,round(sides*LOD));rings=max(5,round(rings*LOD));V=[];N=[];U=[];I=[];W=[];F=[];r=np.array(r);c=np.array(c)
    for k in range(rings+1):
        ph=PI*k/rings
        for a in range(sides+1):
            th=2*PI*a/sides;v=np.array([np.sin(ph)*np.cos(th),np.cos(ph),np.sin(ph)*np.sin(th)]);V.append(c+v*r);N.append(unit(v/r));U.append([a/sides,k/rings]);I.append([J[bn],0,0,0]);W.append([1,0,0,0])
    for k in range(rings):
        for a in range(sides):i=k*(sides+1)+a;l=i+sides+1;F.extend([[i,i+1,l],[i+1,l+1,l]])
    add(mat,V,N,U,I,W,F)
def spike(mat,points,bn,r=(.04,.035),sides=12):
    tube(mat,[(*p,r[0]*max(.025,1-i/(len(points)-1)),r[1]*max(.025,1-i/(len(points)-1)),bn) for i,p in enumerate(points)],5,sides)
# body + tail, smooth continuous skin
C=[]
for i in range(10,0,-1):
    bn=f'tail_{i:02}';x,y,z=rest[J[bn]];q=(11-i)/10;C.append((x,y,z,.018+.18*q**1.25,.022+.19*q**1.2,bn))
C.extend([(0,1.4,-.35,.29,.29,'pelvis'),(0,1.43,-.02,.34,.32,'body'),(0,1.48,.34,.29,.29,'chest'),(0,1.57,.60,.183,.215,'chest'),(0,1.70,.78,.125,.17,'neck_01'),(0,1.85,.97,.12,.15,'neck_02'),(0,1.88,1.18,.161,.155,'head'),(0,1.85,1.36,.135,.12,'head'),(0,1.79,1.60,.10,.065,'snout'),(0,1.755,1.74,.05,.047,'snout'),(0,1.73,1.77,.002,.004,'snout')]);tube('hide',C,8,56)
tube('hide',[(0,1.74,1.12,.09,.045,'jaw'),(0,1.70,1.29,.128,.065,'jaw'),(0,1.69,1.51,.092,.038,'jaw'),(0,1.695,1.72,.035,.022,'jaw'),(0,1.70,1.74,.002,.002,'jaw')],8,32);ell('mouth',(0,1.735,1.40),(.115,.020,.265),'jaw');ell('mouth',(0,1.737,1.43),(.055,.017,.16),'tongue_02');spike('keratin',[(0,1.77,1.66),(0,1.745,1.75),(0,1.68,1.79)],'snout',(.058,.045),20)
for s,sign in [('l',1),('r',-1)]:
    for i in range(8):
        z=1.28+i*.055;x=sign*(.117-.006*i);y=1.765-.003*i;spike('tooth',[(x,y,z),(x*.98,y-.025,z+.006),(x*.94,y-.047,z-.006)],'head',(.012,.014),8)
        if i<6:spike('tooth',[(x*.91,1.714,z+.025),(x*.89,1.74,z+.024)],'jaw',(.01,.01),8)
    ell('keratin',(sign*.135,1.91,1.32),(.027,.065,.078),'head');ell('eye',(sign*.154,1.916,1.325),(.028,.041,.046),'eye_'+s);ell('pupil',(sign*.178,1.919,1.335),(.009,.026,.010),'eye_'+s);ell('pupil',(sign*.089,1.817,1.61),(.008,.013,.025),'snout',12,8)
    tube('hide',[(sign*.143,1.945,1.25,.016,.018,'lid_'+s),(sign*.163,1.957,1.32,.013,.013,'lid_'+s),(sign*.142,1.945,1.39,.012,.012,'lid_'+s)],6,12)
    Bn=lambda n:n+'_'+s
    tube('hide',[(sign*.16,1.42,-.29,.15,.15,Bn('hind_upper')),(sign*.27,1.24,-.31,.235,.255,Bn('hind_upper')),(sign*.31,1.02,-.17,.192,.19,Bn('hind_upper')),(sign*.32,.79,.065,.105,.12,Bn('hind_lower')),(sign*.335,.59,-.16,.091,.104,Bn('hind_twist')),(sign*.33,.41,-.42,.064,.073,Bn('hock')),(sign*.33,.26,-.23,.055,.061,Bn('hock')),(sign*.33,.13,-.05,.078,.068,Bn('metatarsus'))],10,36)
    for nm,x,z in [('inner',.23,.12),('middle',.33,.16),('outer',.43,.10)]:
        a=x+(.04 if nm=='outer' else -.04 if nm=='inner' else 0);bn=Bn('toe_'+nm);tip=Bn('toe_'+nm+'_tip');tube('hide',[(sign*.33,.115,-.025,.058,.052,Bn('metatarsus')),(sign*x,.075,z,.052,.048,bn),(sign*a,.052,z+.16,.039,.032,tip),(sign*a,.044,z+.19,.028,.024,tip)],6,18);spike('keratin',[(sign*a,.05,z+.17),(sign*a,.059,z+.23),(sign*a,.015,z+.31)],tip,(.034,.028),12)
    spike('keratin',[(sign*.34,.12,-.12),(sign*.36,.085,-.22),(sign*.36,.035,-.27)],Bn('toe_rear'),(.028,.028))
    tube('hide',[(sign*.17,1.5,.42,.10,.12,Bn('fore_upper')),(sign*.25,1.40,.38,.099,.10,Bn('fore_upper')),(sign*.32,1.22,.27,.06,.067,Bn('fore_lower')),(sign*.34,1.08,.55,.043,.052,Bn('wrist')),(sign*.34,1.02,.64,.065,.039,Bn('palm'))],8,24)
    for i,x in enumerate([.294,.34,.386],1):
        x*=sign;bn=Bn('digit_'+str(i));tube('hide',[(x,1.02,.64,.024,.023,Bn('palm')),(x,.95,.70,.023,.021,bn),(x,.91,.73,.017,.018,bn)],5,12);spike('keratin',[(x,.92,.725),(x,.865,.735),(x,.82,.68)],bn,(.023,.017))
    for i in range(5):
        z=1.32-i*.095;y=2.01-i*.006;spike('keratin',[(sign*.045,y,z),(sign*.068,y+.10,z-.07),(sign*.085,y+.19-i*.017,z-.26),(sign*.11,y+.16-i*.015,z-.39)],'crest_'+s,(.035,.038),14)
    for i in range(6):
        x=sign*(.31+.02*np.sin(i));y=1.38-i*.048;z=.33+i*.035;spike('keratin',[(x,y,z),(x+sign*.035,y-.055,z-.06),(x+sign*.052,y-.12,z-.11)],Bn('fore_upper' if i<3 else 'fore_lower'),(.026,.016),10)
for i in range(15):
    z=.83-i*.18
    if z>.52:y=1.76+(z-.52)*.7;bn='dorsal_01'
    elif z>.07:y=1.76;bn='dorsal_02'
    elif z>-.42:y=1.72;bn='dorsal_03'
    elif z>-.72:y=1.65;bn='dorsal_04'
    else:j=min(10,max(1,round((-z-.61)/.318)+1));bn=f'tail_{j:02}';y=rest[J[bn],1]+(.21-.017*j)
    h=.23*(1-i/20)+.035;spike('keratin',[(0,y,z),(0,y+h*.58,z-.07),(0,y+h,z-.24),(0,y+h*.87,z-.32)],bn,(.036*(1-i/30),.065*(1-i/28)),12)
    for s in [-1,1]:spike('keratin',[(s*.095,y-.06,z+.03),(s*.14,y+h*.28,z-.08),(s*.16,y+h*.30,z-.19)],bn,(.022,.04),9)
# two-sided folded dewlap, distinct skin weights
V=[];N=[];U=[];I=[];W=[];F=[];nx=max(8,round(32*LOD));ny=max(6,round(22*LOD))
for s in [-1,1]:
    off=len(V)
    for i in range(ny+1):
        t=i/ny
        for j in range(nx+1):
            a=j/nx;z=.64+.78*a-.04*t;y=1.60+.12*a-(.10+.49*np.sin(PI*a)**.85)*t+.024*np.sin(a*8*PI)*t*t;x=s*(.014+.082*np.sin(PI*t)*np.sin(PI*a)+.01*np.cos(a*16*PI)*np.sin(PI*t));V.append([x,y,z]);N.append([s,0,0]);U.append([a,t]);n0='neck_01' if t<.25 else 'dewlap_01' if t<.52 else 'dewlap_02';n1='dewlap_01' if t<.25 else 'dewlap_02' if t<.52 else 'dewlap_03';jj,ww=wt(n0,n1,t);I.append(jj);W.append(ww)
    for i in range(ny):
        for j in range(nx):k=off+i*(nx+1)+j;l=k+nx+1;F.extend([[k,l,k+1],[k+1,l,l+1]])
add('membrane',V,N,U,I,W,F)
# V-shaped fan: layered curved vanes with actual geometry, not planes on billboard.
def feather(bn,a,z,w,twist=0):
    a=np.array(a);z=np.array(z);d=unit(z-a);side=unit(np.cross(d,[1.,0,0]));normal=unit(np.cross(side,d));V=[];N=[];U=[];I=[];W=[];F=[];nv=max(5,round(16*LOD));nu=max(4,round(8*LOD))
    for k in range(nv+1):
        t=k/nv;ww=w*np.sin(PI*t)**.68
        for j in range(nu+1):
            u=j/nu;off=2*u-1;V.append(a+(z-a)*t+side*off*ww+normal*(.018*(1-off*off)*np.sin(PI*t)+twist*off*t));N.append(normal);U.append([u,t]);I.append([J[bn],0,0,0]);W.append([1,0,0,0])
    for k in range(nv):
        for j in range(nu):i=k*(nu+1)+j;l=i+nu+1;F.extend([[i,i+1,l],[i+1,l+1,l]])
    add('feather',V,N,U,I,W,F)
for s,sign in [('l',1),('r',-1)]:
    for i in range(8):
        a=i/7;feather('fan_'+s,(sign*(.014+.012*i),1.34+sign*.023*i,-3.18-.027*i),(sign*(.045+.013*i),1.34+sign*(.23+.44*a),-4.55+.25*a),.085+.026*(1-a),sign*.02)
    for i in range(4):feather('fan_'+s,(sign*.045,1.34+sign*.05*i,-3.09),(sign*.095,1.34+sign*(.18+.06*i),-3.77-.06*i),.10)
# shoulder scutes using layered vane geometry, same material family
for sign in [-1,1]:
    for i in range(7):
        z=.40-i*.11;x=sign*(.24+.055*np.sin(i/6*PI));y=1.59+.03*np.sin(i);feather('chest' if i<3 else 'body',(x,y,z),(x+sign*.045,y-.04,z-.22),.037,sign*.014)
# motion: local quaternions, in-place except vertical jump/fall. Analytical hindleg IK.
Id=np.array([0.,0.,0.,1.]);
def rot(x=0,y=0,z=0):return R.from_euler('xyz',[x,y,z]).as_quat()
def align(a,b):
    a=unit(a);b=unit(b);c=np.cross(a,b);d=np.clip(a@b,-1,1);return Id.copy() if np.linalg.norm(c)<1e-8 else R.from_rotvec(unit(c)*np.arccos(d)).as_quat()
def mul(a,b):return (R.from_quat(a)*R.from_quat(b)).as_quat()
def inv(a):return R.from_quat(a).inv().as_quat()
def leg(q,shift,s,foot):
    a,b,c,d=[J[n+'_'+s] for n in ('hind_upper','hind_lower','hock','metatarsus')];hip=rest[a]+shift;target=foot-(rest[d]-rest[c]);V=target-hip;l1=np.linalg.norm(rest[b]-rest[a]);l2=np.linalg.norm(rest[c]-rest[b]);L=np.clip(np.linalg.norm(V),abs(l1-l2)+.001,l1+l2-.002);axis=unit(V);pole=rest[b]-rest[a];pole=unit(pole-axis*(pole@axis));x=(l1*l1-l2*l2+L*L)/(2*L);k=hip+axis*x+pole*np.sqrt(max(0,l1*l1-x*x));ank=hip+axis*L;q[a]=align(rest[b]-rest[a],k-hip);w=align(rest[c]-rest[b],ank-k);q[b]=mul(inv(q[a]),w);q[c]=inv(w)
ATT={'bite':(64,[[24,31]]),'double_bite':(112,[[26,33],[56,63]]),'dash':(144,[[30,96]]),'pounce':(132,[[36,52]]),'jump_kick':(120,[[38,53]]),'tail_sweep_l':(100,[[32,48]]),'tail_sweep_r':(100,[[32,48]]),'turn_bite':(88,[[30,40]]),'side_strike_l':(96,[[28,40]]),'side_strike_r':(96,[[28,40]]),'triple_dash':(240,[[38,64],[105,130],[172,197]]),'pack_call':(96,[])}
CLIPS={'idle':120,'walk':48,'trot':36,'sprint':28,'brake':56,'turn_l':60,'turn_r':60,'pivot_l':40,'pivot_r':40,'backstep':55,'limp':80,'look_around':150,'sniff':100,'eat':120,'drink':120,'sleep_enter':120,'sleep_loop':180,'sleep_exit':105,'blink':24,'preen':150,**{k:v[0] for k,v in ATT.items()},'fatigue_enter':40,'fatigue_pant_loop':90,'fatigue_recover':50,'fatigue_full':600,'flinch_head':46,'flinch_body':46,'flinch_leg_l':55,'flinch_leg_r':55,'flinch_tail':52,'fall_l':95,'fall_r':95,'rise':115,'break_crest':75,'break_spine':75,'sever_tail':92,'rage_roar':85,'stun':180,'paralysis':180,'trap':240,'capture':120,'death':180}
LOOP={'idle','walk','trot','sprint','limp','sleep_loop','fatigue_pant_loop','stun','paralysis','trap'}
def pose(n,t,D):
    q=np.tile(Id,(len(B),1));s=np.zeros(3);rt=np.zeros(3);p=t/D;ph=p*2*PI;gp=ph;body=neck=head=yaw=tail=roll=fan=pant=arm=crouch=gait=hop=fall=0.;jaw=.02;amp=.32
    def pulse(a,b,c):return np.interp(p,[0,a,b,c,1],[0,0,1,0,0])
    if n in ['walk','trot','sprint','limp','backstep','turn_l','turn_r','pivot_l','pivot_r','dash','triple_dash','brake']:
        gait=1;amp={'walk':.45,'trot':.43,'sprint':.52,'limp':.31,'backstep':-.32,'brake':.35,'turn_l':.17,'turn_r':.17,'pivot_l':.19,'pivot_r':.19,'dash':.49,'triple_dash':.50}[n]
        if n.startswith('turn') or n.startswith('pivot'):yaw=(.32 if n.endswith('_l') else -.32)*np.sin(PI*p);roll=-.23*yaw
        if n in ['dash','triple_dash']:gait=1 if any(a<=t<b for a,b in ATT[n][1]) else .08;body=.19*gait;neck=.20*gait;tail=-.12;fan=.22;gp=t/28*2*PI
        else:body=.16 if n=='sprint' else .07 if n=='trot' else 0;neck=.1 if n=='sprint' else 0;tail=-.07*np.sin(ph);roll+=.035*np.sin(ph)
        if n=='brake':gait*=max(0,1-1.5*p);crouch=.17*np.sin(PI*p);body=-.18*np.sin(PI*p)
        s[1]=(.018 if n=='walk' else .04)*np.sin(gp*2)*gait
    if n=='idle':body=.009*np.sin(ph);neck=.017*np.sin(ph);tail=.03*np.sin(ph);pant=.12+.08*np.sin(ph)
    if n in ['bite','double_bite','turn_bite']:
        k=pulse(.05,.42,.78)+(pulse(.37,.52,.83) if n=='double_bite' else 0);neck=-.18*np.sin(PI*p)+.39*k;head=.17*k;jaw=.65*k;crouch=.07*k;tail=-.12*k;yaw=(.35 if n=='turn_bite' else .13)*np.sin(ph)
    if n in ['pounce','jump_kick','side_strike_l','side_strike_r']:
        a=pulse(0,.22,.36);h=pulse(.22,.36,.57);l=pulse(.45,.59,.83);crouch=.23*a+.18*l;hop=.56*h;body=.25*a-.24*h+.18*l;neck=.28*h;jaw=.28*h;arm=.50*h;tail=-.23*h;fan=.28*h
        if n.startswith('side'):roll=(.34 if n.endswith('_l') else -.34)*h;yaw=.32*roll
        if n=='jump_kick':neck=-.18*h;arm=.1*h
    if n.startswith('tail_sweep'):k=pulse(0,.41,.88);yaw=(.52 if n.endswith('_l') else -.52)*k;tail=-1.9*yaw;fan=.5*k;crouch=.09*k
    if n in ['pack_call','rage_roar']:k=pulse(0,.36,.85);neck=-.27*k;head=-.19*k;jaw=.72*k;pant=.6*k;fan=.45*k;arm=.12*k
    if n.startswith('fatigue'):
        k=np.interp(t,[0,40,550,600],[0,1,1,0]) if n=='fatigue_full' else p if n=='fatigue_enter' else 1-p if n=='fatigue_recover' else 1;k=k*k*(3-2*k);phase=2*PI*(t-40)/90 if n=='fatigue_full' else ph;crouch=.19*k;body=.28*k;neck=.39*k;head=.16*k;jaw=(.26+.13*(.5+.5*np.sin(phase)))*k;pant=(.55+.35*np.sin(phase))*k;tail=-.16*k;fan=-.23*k
    if n=='look_around':yaw=.5*np.sin(ph);neck=-.07*np.sin(ph)
    if n in ['sniff','eat','drink','preen']:k=np.sin(PI*p);crouch=.14*k;body=.20*k;neck=.57*k;head=.29*k;jaw=.19*k*(.5+.5*np.sin(ph*4));yaw=.4*k if n=='preen' else .07*np.sin(ph)
    if n.startswith('sleep') or n=='capture':k=p if n in ['sleep_enter','capture'] else 1-p if n=='sleep_exit' else 1;k=k*k*(3-2*k);crouch=.47*k;body=.24*k;neck=.43*k;head=.12*k;tail=.1*k;pant=.1+.08*np.sin(ph)
    if n.startswith('flinch') or n.startswith('break') or n=='sever_tail':k=np.sin(PI*p)**2;head=-.37*k if 'head' in n or 'crest' in n else -.11*k;body=-.18*k;yaw=.18*np.sin(ph);crouch=.12*k;tail=.6*k if 'tail' in n else .18*k;roll=.15*k*(-1 if n.endswith('_r') else 1)
    if n in ['fall_l','fall_r','death','rise']:k=p if n!='rise' else 1-p;k=k*k*(3-2*k);fall=k*(-1 if n=='fall_r' else 1);crouch=.35*k;head=.23*k;jaw=.28*k;tail=.18*k
    if n in ['stun','paralysis','trap']:k=np.sin(ph*4);crouch=.15;head=.05*k;roll=.05*k;arm=.15*k;tail=.12*np.sin(ph*3);jaw=.12
    s[1]-=crouch;rt[1]=hop
    if fall:rt[1]=abs(fall)*.45;q[J['root']]=rot(z=fall*1.30)
    def setq(bn,x=0,y=0,z=0):q[J[bn]]=rot(x,y,z)
    for bn,x,y,z in [('body',body,yaw*.3,roll),('lumbar',body*.22,yaw*.35,0),('chest',body*.10,yaw*.25,0),('neck_01',neck*.65,yaw*.5,0),('neck_02',neck*.35,yaw*.3,0),('head',head,yaw*.15,0),('jaw',jaw,0,0),('tongue_01',-.13*jaw,0,0),('tongue_02',-.2*jaw,0,0)]:setq(bn,x,y,z)
    for side,sg in [('l',1),('r',-1)]:
        setq('eye_'+side,0,yaw*.12);setq('lid_'+side,0,0,sg*(.1*np.sin(PI*p)**4 if n=='blink' else 0));setq('ribs_'+side,0,0,sg*pant*.1);setq('fore_upper_'+side,-arm+.12*gait*np.sin(gp+sg*PI/2),0,sg*.05);setq('fore_lower_'+side,arm*.32+.1*gait);setq('wrist_'+side,.13*arm)
        for i in range(1,4):setq(f'digit_{i}_'+side,.24*arm)
        foot=rest[J['metatarsus_'+side]].copy();a=(gp/(2*PI)+(0 if side=='l' else .5))%1
        if gait:
            stance=.51 if n in ['walk','limp','turn_l','turn_r','pivot_l','pivot_r','backstep'] else .32
            if a<stance:z=amp*(1-2*a/stance);y=0
            else:h=(a-stance)/(1-stance);z=amp*(-1+2*h*h*(3-2*h));y=.23*np.sin(PI*h)
            if n=='limp' and side=='r':z*=.48;y*=.20
            foot[2]+=z*gait;foot[1]+=y*gait
        if hop:foot[1]+=.17*hop;foot[2]+=(.45 if n=='jump_kick' and side=='l' else -.30)*hop
        leg(q,s,side,foot);setq('fan_'+side,sg*fan,sg*fan*.25);setq('crest_'+side,.05*pant)
        for k in ['inner','middle','outer']:setq('toe_'+k+'_'+side,.14*gait*max(0,np.sin(2*PI*a)))
    for i in range(1,11):setq(f'tail_{i:02}',tail*.16+.009*np.sin(ph-i*.4),yaw*.055+tail*.13+.024*np.sin(ph-i*.5))
    for i in range(1,4):setq(f'dewlap_{i:02}',.10*pant*np.sin(ph-i*.5),.025*np.sin(ph-i*.4))
    for i in range(1,5):setq(f'dorsal_{i:02}',-.06*pant+.03*np.sin(ph-i*.3))
    return q,s,rt
# glTF 2.0 with embedded texture images, joint attributes, inverse bind matrices and animation channels.
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
    g=GLB();images=[];textures=[];materials=[];prims=[];stats={}
    def texture(path):images.append({'bufferView':g.view(path.read_bytes()),'mimeType':'image/png','name':path.stem});textures.append({'source':len(images)-1,'sampler':0});return len(textures)-1
    for mat,parts in M.items():
        mi=len(materials);m={'name':mat,'doubleSided':mat in ['membrane','feather'],'pbrMetallicRoughness':{'metallicFactor':0,'roughnessFactor':.65}}
        if mat in ['hide','keratin','membrane','feather','mouth']:
            m['pbrMetallicRoughness'].update(baseColorTexture={'index':texture(T/f'{mat}_basecolor.png')},metallicRoughnessTexture={'index':texture(T/f'{mat}_orm.png')},roughnessFactor=1);m['normalTexture']={'index':texture(T/f'{mat}_normal.png'),'scale':.65};m['occlusionTexture']={'index':m['pbrMetallicRoughness']['metallicRoughnessTexture']['index'],'strength':.55}
        else:m['pbrMetallicRoughness'].update(baseColorFactor={'tooth':[.72,.63,.42,1],'eye':[.70,.34,.055,1],'pupil':[.012,.009,.005,1]}[mat],roughnessFactor=.2 if mat in ['eye','pupil'] else .46)
        materials.append(m);a={k:np.concatenate(x,axis=0) for k,x in parts.items()};
        if mat=='hide':
            x,y,z=a['p'].T;mask=(abs(x)>.13)&(abs(x)<.36)&(y>1.25)&(y<1.70)&(z>-.02)&(z<.55)&np.isin(a['j'][:,0],[J['body'],J['chest'],J['pelvis']]);a['w'][mask]*=.83;a['j'][mask,2]=np.where(x[mask]>0,J['ribs_l'],J['ribs_r']);a['w'][mask,2]=.17
        assert np.max(abs(a['w'].sum(1)-1))<1e-6 and a['j'].max()<len(B);stats[mat]={'vertices':len(a['p']),'triangles':len(a['f'])};attrs={'POSITION':g.accessor(a['p'],'VEC3',target=34962,bounds=True),'NORMAL':g.accessor(a['n'],'VEC3',target=34962),'TEXCOORD_0':g.accessor(a['uv'],'VEC2',target=34962),'JOINTS_0':g.accessor(a['j'],'VEC4',5123,target=34962),'WEIGHTS_0':g.accessor(a['w'],'VEC4',target=34962)};prims.append({'attributes':attrs,'indices':g.accessor(a['f'].ravel(),'SCALAR',5125,target=34963),'material':mi})
    nodes=[];ib=[]
    for i,(name,p,xyz) in enumerate(B):
        n={'name':name,'translation':(xyz-(rest[p] if p>=0 else 0)).tolist()};kids=[j for j,x in enumerate(B) if x[1]==i]
        if kids:n['children']=kids
        nodes.append(n);m=np.eye(4);m[:3,3]=-xyz;ib.append(m.T.ravel())
    nodes.append({'name':'Spinegale_mesh','mesh':0,'skin':0});skin={'name':'Spinegale_77','joints':list(range(len(B))),'skeleton':0,'inverseBindMatrices':g.accessor(ib,'MAT4')};animations=[]
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
        if np.max(abs(s))>1e-6:channel(J['pelvis'],'translation',s+rest[J['pelvis']],'VEC3')
        if np.max(abs(r))>1e-6:channel(0,'translation',r,'VEC3')
        animations.append({'name':'sg_'+name,'samplers':sam,'channels':chan,'extras':{'durationTicks':D,'loop':name in LOOP,'hitWindows':ATT.get(name,(0,[]))[1]}})
    doc={'asset':{'version':'2.0','generator':'Kari Spinegale procedural v2'},'scene':0,'scenes':[{'nodes':[0,len(B)]}],'nodes':nodes,'skins':[skin],'meshes':[{'name':'Spinegale','primitives':prims}],'materials':materials,'textures':textures,'images':images,'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],'animations':animations,'bufferViews':g.views,'accessors':g.acc,'buffers':[{'byteLength':len(g.buf)}],'extras':{'status':'procedural prototype, not photoreal final','coordinate':'Y up +Z forward metres','monsterId':'monster.spinegale','stats':stats}}
    j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);g.buf.extend(b'\0'*((-len(g.buf))%4));out=struct.pack('<4sII',b'glTF',2,12+8+len(j)+8+len(g.buf))+struct.pack('<I4s',len(j),b'JSON')+j+struct.pack('<I4s',len(g.buf),b'BIN\0')+g.buf;(P/f'spinegale_{SUFFIX}.glb').write_bytes(out)
    manifest={'joints':len(B),'animationClips':len(CLIPS),'materials':len(M),'vertices':sum(x['vertices'] for x in stats.values()),'triangles':sum(x['triangles'] for x in stats.values()),'stats':stats,'clips':[{'name':x['name'],**x['extras']} for x in animations],'rig':[{'name':n,'parent':B[p][0] if p>=0 else None,'restM':xyz.tolist()} for n,p,xyz in B]};(P/('model_manifest.json' if SUFFIX=='v2' else f'model_manifest_{SUFFIX}.json')).write_text(json.dumps(manifest,indent=2));print({k:manifest[k] for k in ['joints','animationClips','materials','vertices','triangles']});print('GLB',len(out))
if __name__=='__main__':main()
