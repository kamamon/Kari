from pathlib import Path
import math, json, struct
import numpy as np
from scipy.spatial.transform import Rotation as R,Slerp
from functools import lru_cache
P=Path(__file__).parent;OUT=P/'data';OUT.mkdir(exist_ok=True);raw=(P/'frostald_game.glb').read_bytes();n=struct.unpack_from('<I',raw,12)[0];d=json.loads(raw[20:20+n]);buf=raw[28+n:];N=d['nodes'][:len(d['skins'][0]['joints'])];K=len(N);IX={n['name']:i for i,n in enumerate(N)};parent={c:i for i,n in enumerate(N) for c in n.get('children',[])};rest=np.array([n.get('translation',[0,0,0]) for n in N]);an={a['name']:a for a in d['animations']}
def acc(i):
 a=d['accessors'][i];v=d['bufferViews'][a['bufferView']];n={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];return np.frombuffer(buf,dtype='<f4',offset=v.get('byteOffset',0)+a.get('byteOffset',0),count=a['count']*n).reshape(-1,n).astype(float)
@lru_cache(None)
def frames(name):
 a=an['fa_'+name];D=a['extras']['durationTicks'];times=np.arange(D+1)/60;ts=np.tile(rest,(D+1,1,1));q=np.zeros((D+1,K,4));q[:,:,3]=1
 for c in a['channels']:
  s=a['samplers'][c['sampler']];x=acc(s['input']).ravel();y=acc(s['output']);t=np.clip(times,x[0],x[-1]);i=c['target']['node']
  if c['target']['path']=='rotation':q[:,i]=Slerp(x,R.from_quat(y))(t).as_quat()
  else:ts[:,i]=np.stack([np.interp(t,x,y[:,j]) for j in range(3)],1)
 rot=R.from_quat(q.reshape(-1,4)).as_matrix().reshape(D+1,K,3,3);world=ts.copy();wr=rot.copy()
 for i in range(K):
  if i in parent:
   j=parent[i];world[:,i]=world[:,j]+np.einsum('tij,tj->ti',wr[:,j],ts[:,i]);wr[:,i]=wr[:,j]@rot[:,i]
 return world,wr
bind=rest.copy()
for i in range(K):
 if i in parent:bind[i]+=bind[parent[i]]
B=lambda n,x=0,y=0,z=0:(n,[x,y,z])
def pos(a,f=None,t=0):
 i=IX[a[0]];v=np.array(a[1]);return bind[i]+v if f is None else f[0][t,i]+f[1][t,i]@v
vec=lambda x:np.round(x,5).tolist()
parts_cfg=[('head','頭',[.64,.70,.53],180,'shell',[(B('head'),B('snout',0,0,.23),.30)]),('mane','氷冠',[.34,.52,.34],230,'shell',[(B('neck_01',0,.3),B('chest',0,.4),.80)]),('foreleg','前脚',[.48,.56,.39],200,'hide',[(B('fore_upper_'+s),B('fore_paw_'+s),.28) for s in ['l','r']]),('hindleg','後脚',[.45,.53,.38],180,'hide',[(B('hind_upper_'+s),B('hind_paw_'+s),.28) for s in ['l','r']]),('tail','尾',[.55,.42,.42],None,'shell',[(B('tail_01'),B('tail_05'),.40),(B('tail_05'),B('tail_09'),.28),(B('tail_09'),B('tail_12',0,0,-.22),.16)]),('body','胴',[.40,.45,.40],None,'hide',[(B('pelvis'),B('chest'),.65)])]
shape=lambda x:{'a':vec(pos(x[0])),'b':vec(pos(x[1])),'r':x[2]}
parts=[];anchors=[]
for id,name,z,bd,mat,ss in parts_cfg:
 p=dict(id=id,name=name,hitzone=dict(zip(['cut','blunt','shot'],z)),elementZone=.22,breakDurability=bd,material=mat,flinch=dict(threshold=210 if id in ('foreleg','hindleg') else 155,growth=65,ticks=120 if id in ('foreleg','hindleg') else 50,**({'topple':True} if id in ('foreleg','hindleg') else {})),shapes=list(map(shape,ss)))
 if id=='head':p['head']=True
 if bd:p['brokenHitzone']=dict(zip(['cut','blunt','shot'],[min(.95,v+(.18 if id=='mane' else .10)) for v in z]))
 if id=='tail':p['sever']={'threshold':240,'staggerTicks':100,'shapesAfter':[shape(ss[0])]}
 for i,x in enumerate(ss):anchors.append((id,i,False,x))
 if id=='tail':anchors.append((id,0,True,ss[0]))
 parts.append(p)
attack={'bite':(18,'cut',B('head'),B('snout',0,0,.18),.32),'double_bite':(13,'cut',B('head'),B('snout',0,0,.18),.32),'claw_l':(21,'cut',B('fore_lower_l'),B('fore_toe2_l',0,0,.30),.30),'claw_r':(21,'cut',B('fore_lower_r'),B('fore_toe2_r',0,0,.30),.30),'body_ram':(25,'blunt',B('chest'),B('head'),.63),'slide':(28,'blunt',B('chest'),B('snout'),.63),'tail_l':(20,'blunt',B('tail_04'),B('tail_12'),.33),'tail_r':(20,'blunt',B('tail_04'),B('tail_12'),.33),'roll_l':(24,'blunt',B('pelvis'),B('chest'),.76),'roll_r':(24,'blunt',B('pelvis'),B('chest'),.76),'head_slam':(24,'blunt',B('head'),B('snout'),.40),'back_bite':(19,'cut',B('head'),B('snout'),.34)}
ice={'ice_breath':(22,6,1.05,0.40),'ice_sweep_l':(19,7,1.05,.62),'ice_sweep_r':(19,7,1.05,.62),'ice_burst':(21,6,1.3,3.4)}
move={'bite':(.35,0),'double_bite':(.55,0),'body_ram':(5.2,0),'slide':(10.3,0),'claw_l':(.42,0),'claw_r':(.42,0),'roll_l':(2.5,90),'roll_r':(2.5,-90),'head_slam':(.35,0),'retreat':(1.8,180),'back_bite':(.25,0)}
base='monster.frostald.';actions=[];tracks=[];curves=[];follow={}
def grid(f,D,step=6,static=None):
 ticks=[min(k*step,D-1) for k in range(math.ceil((D-1)/step)+1)];sh=[]
 for part,i,after,(a,b,r) in anchors:
  keys=[np.rint(np.r_[pos(a,f,static if static is not None else t)-pos(a),pos(b,f,static if static is not None else t)-pos(b)]*100).astype(int).tolist() for t in ticks];sh.append(dict(part=part,i=i,d=keys,**({'after':True} if after else {})))
 return {'shapes':sh}
def track(name,a,b,rad,D,f):
 length=float(np.linalg.norm(pos(b)-pos(a)));tid='fa_track_'+name;keys=[]
 for t in range(D+1):
  A=pos(a,f,t);v=pos(b,f,t)-A;keys.append({'t':t,'grip':vec(A),'dir':vec(v/max(1e-9,np.linalg.norm(v)))})
 tracks.append({'id':tid,'radius':rad,'from':0,'to':round(length,5),'keys':keys});return tid
for name in list(attack)+list(ice)+['rage_roar','turn_l','turn_r','pivot_l','pivot_r','retreat','threat','recharge','shake_mane']:
 a0=an['fa_'+name];D=a0['extras']['durationTicks'];wins=a0['extras']['hitWindows'];f=frames(name)
 phases=[{'id':'startup','from':0,'to':wins[0][0]},{'id':'active','from':wins[0][0],'to':wins[-1][1]},{'id':'recovery','from':wins[-1][1],'to':D}] if wins else [{'id':'startup','from':0,'to':D}]
 a=dict(schemaVersion=1,actionId=base+name,clip='fa_'+name,tickRate=60,durationTicks=D,phases=phases,rootMotion={'mode':'none'},hitWindows=[],cancelWindows=[],events=[],onFinish='keep')
 if name in move:
  dist,angle=move[name];start=wins[0][0] if wins else 18;end=wins[-1][1] if wins else D-18;a['rootMotion']={'mode':'controller','curveId':'fa_move_'+name,**({'dirDeg':angle} if angle else {})};curves.append({'id':'fa_move_'+name,'keys':[[0,0],[start,0],[end,dist],[D,dist]]})
 if name in ('body_ram','slide'):a['brake']={'from':wins[0][0],'to':wins[-1][1]}
 if name.startswith(('turn_','pivot_')):a['spin']={'from':6,'to':D-6,'degrees':(90 if name.startswith('turn') else 180)*(1 if name.endswith('l') else -1)}
 if name in attack:
  dmg,kind,aa,bb,rad=attack[name];tid=track(name,aa,bb,rad,D,f)
  for j,(start,end) in enumerate(wins):a['hitWindows'].append(dict(id='strike'+str(j+1),**{'from':start,'to':end},shapeTrack=tid,damageType=kind,damageCoefficient=1,maxHitsPerTarget=1,hitstopTicks=0,baseDamage=dmg,guardable=True,guardCost=dmg+10,reaction='knockdown' if dmg>=24 else 'flinch'))
  a['events']=[{'tick':max(0,wins[0][0]-12),'type':'sound','id':'galdros_warn'},{'tick':wins[0][0],'type':'sound','id':'galdros_swing'}]
 if name in ice:
  dmg,num,rad,spread=ice[name];a['hazards']=[dict(tick=wins[0][0],count=num,spread=spread,radius=rad,warnTicks=28,activeTicks=12,baseDamage=dmg,reaction='flinch',origin=vec(pos(B('snout',0,0,.18),f,wins[0][0])),peak=.65 if name!='ice_burst' else 2.2,look='ice',**({'pattern':'line'} if name!='ice_burst' else {}))];a['events']=[{'tick':8,'type':'sound','id':'ice_crack'},{'tick':wins[0][0],'type':'sound','id':'ice_crack'}]
 if wins:
  a['opening']={'partId':'mane' if name.startswith('ice') else 'foreleg' if name.startswith(('claw','roll')) else 'head' if name not in ('tail_l','tail_r') else 'hindleg','from':wins[-1][1]+5,'to':D-3}
  if not name.startswith(('tail','roll','claw','back_bite')):a['turning']={'untilTick':wins[0][0]-6,'maxDegreesPerSecond':85}
 if name in ('rage_roar','threat'):a['events']=[{'tick':20,'type':'sound','id':'galdros_warn'}]
 actions.append(a);follow[a['actionId']]=grid(f,D)
for name in ('tail_l','tail_r'):
 a=next(x for x in actions if x['actionId']==base+name);a2=json.loads(json.dumps(a));a2['actionId']+='_short';a2['hitWindows'][0]['shapeTrack']=track(name+'_short',B('tail_01'),B('tail_05'),.32,a['durationTicks'],frames(name));a2['hitWindows'][0]['baseDamage']=15;actions.append(a2);follow[a2['actionId']]=follow[a['actionId']]
choices=[]
for n,lo,hi,ang,w,cd,side,clear in [('bite',0,3.8,45,4,0,None,0),('double_bite',0,4,45,2,180,None,0),('claw_l',0,3.5,100,2,180,'left',0),('claw_r',0,3.5,100,2,180,'right',0),('body_ram',4,8.5,35,2.4,240,None,4),('slide',7,14,25,2.4,360,None,8),('tail_l',0,5.6,180,2,180,'left',0),('tail_r',0,5.6,180,2,180,'right',0),('roll_l',0,3.6,140,1.5,240,'left',0),('roll_r',0,3.6,140,1.5,240,'right',0),('ice_breath',3.5,13,40,3,300,None,0),('ice_sweep_l',4,12,80,1,480,None,0),('ice_sweep_r',4,12,80,1,480,None,0),('ice_burst',0,5.0,180,1,550,None,0),('head_slam',0,3.8,40,2,180,None,0),('back_bite',0,4.0,180,1,220,None,0),('retreat',0,3.1,180,.65,420,None,0),('threat',5,12,60,.7,650,None,0),('shake_mane',0,8,180,.4,680,None,0)]:
 c=dict(actionId=base+n,minDist=lo,maxDist=hi,maxAngleDeg=ang,weight=w,**({'cooldownTicks':cd} if cd else {}),**({'side':side,'minAngleDeg':55 if n.startswith('tail') else 15} if side else {}),**({'clearAhead':clear} if clear else {}));
 if n.startswith('tail_'):c['ifSevered']={'partId':'tail','actionId':base+n+'_short'}
 if n=='back_bite':c['minAngleDeg']=100
 choices.append(c)
monster=dict(schemaVersion=1,id='monster.frostald',name='氷冠獣 フロストアルド',rigFamily='quad_heavy',assetId='model.monster.frostald',hp=1750,bodyRadius=1.02,turnDegPerSec=85,moveSpeed=2.45,captureAllowed=True,element='ice',weak=['fire','thunder'],resist=['ice'],lootId='loot.frostald',lootByRank={'rank.2':'loot.frostald.r2','rank.3':'loot.frostald.r3'},capture={'hpRatio':.25,'tranqNeeded':2,'tranqDecayTicks':900},respawnTicks=None,breakStaggerTicks=85,collision=[{'z':.9,'r':.85},{'z':-.75,'r':.75}],approach={'stopDist':3.2,'faceDeg':50},turnSteps={'faceDeg':50,'backDeg':130,'left':base+'turn_l','right':base+'turn_r','backLeft':base+'pivot_l','backRight':base+'pivot_r'},discover={'range':18,'fovDeg':140,'closeRange':6,'actionId':base+'rage_roar'},rage={'threshold':460,'durationTicks':1800,'actionId':base+'rage_roar','speedScale':1.12,'damageScale':1.14,'cooldownScale':.82},parts=parts,ai={'aggroRange':200,'cooldownTicks':[35,65],'choices':choices},frostaldRank=1)
state={'topple':{'ticks':110,**grid(frames('fall_l'),110)},'flinch':{'ticks':50,**grid(frames('flinch_body'),50)},'stun':{'ticks':164,**grid(frames('stun'),164)}}
for file,obj in [('monster.json',monster),('actions.json',{'schemaVersion':1,'actions':actions}),('tracks.json',{'schemaVersion':1,'tracks':tracks}),('curves.json',{'schemaVersion':1,'curves':curves}),('follow.json',{'schemaVersion':1,'monsterId':monster['id'],'step':6,'actions':follow,'states':state,'poses':{'sleep':grid(frames('sleep_loop'),1)}})]: (OUT/file).write_text(json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n')
print('Actions',len(actions),'Tracks',len(tracks),'Follow',len(follow),'Joints',K)
