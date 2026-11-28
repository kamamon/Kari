"""Bake game collisions from the actual exported glTF animation curves, not invented pose tables."""
import json,struct,math,argparse
from pathlib import Path
from functools import lru_cache
import numpy as np
from scipy.spatial.transform import Rotation,Slerp
P=Path(__file__).parent;ap=argparse.ArgumentParser();ap.add_argument('model',type=Path);ap.add_argument('--out',type=Path,default=P/'data');a=ap.parse_args();O=a.out;O.mkdir(exist_ok=True,parents=True);b=a.model.read_bytes();n=struct.unpack_from('<I',b,12)[0];g=json.loads(b[20:20+n]);buf=memoryview(b)[28+n:];K=len(g['skins'][0]['joints']);N=g['nodes'][:K];J={x['name']:i for i,x in enumerate(N)};par={j:i for i,x in enumerate(N) for j in x.get('children',[])};rest=np.array([x['translation'] for x in N]);bind=rest.copy();an={x['name'][3:]:x for x in g['animations']}
for i in range(K):
 if i in par:bind[i]+=bind[par[i]]
def acc(i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];c={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];return np.frombuffer(buf,dtype='<f4',offset=v.get('byteOffset',0)+a.get('byteOffset',0),count=a['count']*c).reshape(-1,c).astype(float)
@lru_cache(None)
def frames(name):
 a=an[name];D=a['extras']['durationTicks'];t=np.arange(D+1)/60;tr=np.tile(rest,(D+1,1,1));sc=np.ones((D+1,K,3));q=np.zeros((D+1,K,4));q[:,:,3]=1
 for c in a['channels']:
  s=a['samplers'][c['sampler']];x=acc(s['input']).ravel();y=acc(s['output']);u=np.clip(t,x[0],x[-1]);i=c['target']['node'];k=c['target']['path']
  if k=='rotation':q[:,i]=Slerp(x,Rotation.from_quat(y))(u).as_quat()
  else:(tr if k=='translation' else sc)[:,i]=np.stack([np.interp(u,x,y[:,j]) for j in range(3)],1)
 rot=Rotation.from_quat(q.reshape(-1,4)).as_matrix().reshape(D+1,K,3,3)*sc[:,:,None,:];w=tr.copy();wr=rot.copy()
 for i in range(K):
  if i in par:
   j=par[i];w[:,i]=w[:,j]+np.einsum('tij,tj->ti',wr[:,j],tr[:,i]);wr[:,i]=wr[:,j]@rot[:,i]
 return w,wr
B=lambda n,x=0,y=0,z=0:(n,[x,y,z]);vec=lambda x:np.round(x,5).tolist()
def pos(a,f=None,t=0):
 i=J[a[0]];v=np.array(a[1]);return bind[i]+v if f is None else f[0][t,i]+f[1][t,i]@v
S=[('sac','毒嚢',[.70,.66,.57],170,'hide',[(B('sac_'+s),B('sac_'+s,0,-.15,.10),.29) for s in ['l','r']]),('head','頭',[.60,.72,.55],200,'shell',[(B('head'),B('beak',0,-.19,.65),.33)]),('crest','冠羽',[.48,.50,.57],180,'hide',[(B('crest_1_l',0,.35,-.20),B('crest_1_r',0,.32,-.65),.34)]),('wing_l','左翼',[.53,.48,.59],220,'hide',[(B('wing_shoulder_l'),B('wing_wrist_l'),.27),(B('wing_wrist_l'),B('wing_digit1_b_l'),.28),(B('wing_wrist_l'),B('wing_digit3_b_l'),.38)]),('wing_r','右翼',[.53,.48,.59],220,'hide',[(B('wing_shoulder_r'),B('wing_wrist_r'),.27),(B('wing_wrist_r'),B('wing_digit1_b_r'),.28),(B('wing_wrist_r'),B('wing_digit3_b_r'),.38)]),('legs','後脚',[.54,.55,.40],190,'hide',[(B('hip_'+s),B('knee_'+s),.35) for s in ['l','r']]+[(B('knee_'+s),B('foot_'+s),.23) for s in ['l','r']]),('tail','尾羽',[.50,.42,.48],180,'hide',[(B('tail_02'),B('tail_06'),.32),(B('tail_06'),B('tail_10'),.23),(B('tail_10'),B('tail_14',0,0,-.36),.29)]),('body','胴',[.43,.45,.40],None,'hide',[(B('pelvis'),B('chest'),.61),(B('chest'),B('neck_02'),.39)])]
parts=[];anchors=[]
for id,name,z,bd,mat,ss in S:
 p=dict(id=id,name=name,hitzone=dict(zip(['cut','blunt','shot'],z)),elementZone=.22,breakDurability=bd,material=mat,flinch=dict(threshold=200 if id in ('legs','wing_l','wing_r') else 155,growth=65,ticks=120 if id=='legs' else 50,**({'topple':True} if id=='legs' else {})),shapes=[{'a':vec(pos(a)),'b':vec(pos(b)),'r':r} for a,b,r in ss]);
 if id=='head':p['head']=True
 if bd:p['brokenHitzone']=dict(zip(['cut','blunt','shot'],[min(.95,x+(.12 if id=='sac' else .08)) for x in z]))
 parts.append(p);anchors.extend((id,i,v) for i,v in enumerate(ss))
A={'peck':(16,'cut',B('head'),B('beak',0,-.19,.65),.36),'double_peck':(13,'cut',B('head'),B('beak',0,-.19,.65),.36),'rush':(24,'blunt',B('chest'),B('head'),.65),'hop_kick':(23,'cut',B('hock_l'),B('toe2_tip_l',0,0,.25),.30),'glide':(29,'blunt',B('pelvis'),B('head'),.72),'back_peck':(18,'cut',B('head'),B('beak',0,-.19,.65),.34)}
for s in ['l','r']:
 A['wing_'+s]=(21,'blunt',B('wing_elbow_'+s),B('wing_digit2_b_'+s),.43);A['tail_'+s]=(19,'blunt',B('tail_05'),B('tail_14',0,0,-.25),.30);A['poison_tail_'+s]=(21,'cut',B('tail_05'),B('tail_14',0,0,-.25),.32)
H={'poison_spit':(17,3,1.1,.5,48),'poison_fan':(15,3,1.1,2.0,40),'poison_cloud':(13,5,1.4,3.3,38)}
move={'peck':(.28,0),'double_peck':(.48,0),'rush':(7.2,0),'hop_kick':(2.6,0),'glide':(10.,0),'retreat':(1.8,180),'back_peck':(.22,0)}
base='monster.venolka.';acts=[];tracks=[];curves=[];follow={};opening_report=[]
def follow_grid(f,D,static=None):
 ts=[min(i*6,D-1) for i in range(math.ceil((D-1)/6)+1)];return {'shapes':[{'part':pid,'i':i,'d':[np.rint(np.r_[pos(aa,f,t if static is None else static)-pos(aa),pos(bb,f,t if static is None else static)-pos(bb)]*100).astype(int).tolist() for t in ts]} for pid,i,(aa,bb,r) in anchors]}
for name in list(A)+list(H)+['turn_l','turn_r','pivot_l','pivot_r','rage_roar','threat','retreat','refill']:
 D=an[name]['extras']['durationTicks'];wins=an[name]['extras']['hitWindows'];f=frames(name);ph=[{'id':'startup','from':0,'to':wins[0][0]},{'id':'active','from':wins[0][0],'to':wins[-1][1]},{'id':'recovery','from':wins[-1][1],'to':D}] if wins else [{'id':'startup','from':0,'to':D}];a=dict(schemaVersion=1,actionId=base+name,clip='vn_'+name,tickRate=60,durationTicks=D,phases=ph,rootMotion={'mode':'none'},hitWindows=[],cancelWindows=[],events=[],onFinish='keep')
 if name in move:
  dist,angle=move[name];start=wins[0][0] if wins else 18;end=(150 if name=='glide' else wins[-1][1]) if wins else D-18;a['rootMotion']={'mode':'controller','curveId':'vn_move_'+name,**({'dirDeg':angle} if angle else {})};curves.append({'id':'vn_move_'+name,'keys':[[0,0],[start,0],[end,dist],[D,dist]]})
 if name in ('rush','glide'):a['brake']={'from':wins[0][0],'to':wins[-1][1]}
 if name.startswith(('turn_','pivot_')):a['spin']={'from':6,'to':D-12,'degrees':(90 if name.startswith('turn') else 180)*(1 if name.endswith('l') else -1)}
 if name in A:
  dmg,kind,aa,bb,rad=A[name];L=np.linalg.norm(pos(bb)-pos(aa));tid='vn_track_'+name;keys=[]
  # Fixed length segment: preserve moving endpoint direction; conservative radius, actual pose at 60 Hz.
  for t in range(D+1):
   p=pos(aa,f,t);v=pos(bb,f,t)-p;keys.append({'t':t,'grip':vec(p),'dir':vec(v/max(1e-9,np.linalg.norm(v)))})
  tracks.append({'id':tid,'radius':rad,'from':0,'to':round(float(L),5),'keys':keys})
  for k,(s,e) in enumerate(wins):a['hitWindows'].append(dict(id='strike'+str(k+1),**{'from':s,'to':e},shapeTrack=tid,damageType=kind,damageCoefficient=1,maxHitsPerTarget=1,hitstopTicks=0,baseDamage=dmg,guardable=True,guardCost=dmg+8,reaction='knockdown' if dmg>=23 else 'flinch',**({'status':{'kind':'poison','power':48}} if name.startswith('poison_tail_') else {})))
  a['events']=[{'tick':max(0,wins[0][0]-12),'type':'sound','id':'galdros_warn'},{'tick':wins[0][0],'type':'sound','id':'galdros_swing'}]
 if name in H:
  dmg,num,rad,spread,power=H[name];a['hazards']=[dict(tick=s,count=num,spread=spread,radius=rad,warnTicks=18,activeTicks=9,baseDamage=dmg,reaction='flinch',origin=vec(pos(B('beak',0,-.18,.60),f,s)),peak=.65,look='poison',pattern='line' if name=='poison_spit' else 'around',status={'kind':'poison','power':power}) for s,e in wins];a['events']=[{'tick':10,'type':'sound','id':'bird_screech'}]
 if wins:
  # Deliberate held crouch. Use lower legs if the intended head/sac is not in range at every frame.
  last=wins[-1][1];start=math.ceil((last+(34 if name=='glide' else 24))/6)*6;end=math.floor((D-8)/6)*6;start=max(start,math.ceil((max([0]+[h['tick']+h['warnTicks']+h['activeTicks'] for h in a.get('hazards',[]) ]))/6)*6)
  options=['sac','head','legs','wing_l','wing_r','tail','body'] if name.startswith('poison_') else ['head','legs','sac','wing_l','wing_r','tail','body'];good=[]
  for id in options:
   ss=next(x[-1] for x in S if x[0]==id);p=np.array([[np.r_[pos(aa,f,t),pos(bb,f,t)] for aa,bb,r in ss] for t in range(start,end+1)]);low=max(min(min(p[t,i,1],p[t,i,4])-ss[i][2] for i in range(len(ss))) for t in range(len(p)));step=float(np.linalg.norm(np.diff(p,axis=0).reshape(-1,3),axis=1).max()) if len(p)>1 else 0
   if low<=1.6 and step<=.016:good.append((id,low,step))
  if good and end-start>=30:
   id,low,step=good[0];a['opening']={'partId':id,'from':start,'to':end};opening_report.append([name,id,start,end,round(low,3),round(step,5)])
  else:raise ValueError(('No stable counter opening',name,start,end,good))
  if name not in ('back_peck','tail_l','tail_r','wing_l','wing_r','poison_tail_l','poison_tail_r'):a['turning']={'untilTick':wins[0][0]-6,'maxDegreesPerSecond':75}
 if name in ('rage_roar','threat'):a['events']=[{'tick':18,'type':'sound','id':'bird_screech'}]
 acts.append(a);follow[a['actionId']]=follow_grid(f,D)
choices=[]
for n,lo,hi,ang,w,cd,side,clear in [('peck',0,4.2,45,4,0,None,0),('double_peck',0,4.5,45,2,200,None,0),('wing_l',0,4.5,125,2,180,'left',0),('wing_r',0,4.5,125,2,180,'right',0),('tail_l',0,6.1,180,2,180,'left',0),('tail_r',0,6.1,180,2,180,'right',0),('rush',4.5,11,30,2,300,None,6),('hop_kick',2,5,45,2,240,None,2),('glide',7,15,25,1.5,540,None,9),('poison_spit',3.2,12,45,3,280,None,0),('poison_fan',4,13,55,1.5,480,None,0),('poison_tail_l',0,6.0,180,1.5,300,'left',0),('poison_tail_r',0,6.0,180,1.5,300,'right',0),('poison_cloud',0,5,100,1.2,650,None,0),('back_peck',0,4.0,180,1,220,None,0),('threat',5,12,65,.6,750,None,0),('retreat',0,2.2,180,.6,420,None,0)]:
 c=dict(actionId=base+n,minDist=lo,maxDist=hi,maxAngleDeg=ang,weight=w,**({'cooldownTicks':cd} if cd else {}),**({'side':side,'minAngleDeg':55 if 'tail_' in n else 18} if side else {}),**({'clearAhead':clear} if clear else {}));
 if n=='back_peck':c['minAngleDeg']=100
 choices.append(c)
monster=dict(schemaVersion=1,id='monster.venolka',name='毒羽竜 ヴェノルカ',rigFamily='biped_wing',assetId='model.monster.venolka',hp=1950,bodyRadius=.84,turnDegPerSec=95,moveSpeed=3.0,captureAllowed=True,weak=['fire','thunder'],resist=[],lootId='loot.venolka',lootByRank={'rank.2':'loot.venolka.r2','rank.3':'loot.venolka.r3'},capture={'hpRatio':.24,'tranqNeeded':2,'tranqDecayTicks':900},respawnTicks=None,breakStaggerTicks=85,collision=[{'z':.5,'r':.65},{'z':-.65,'r':.60}],approach={'stopDist':3.6,'faceDeg':50},turnSteps={'faceDeg':50,'backDeg':130,'left':base+'turn_l','right':base+'turn_r','backLeft':base+'pivot_l','backRight':base+'pivot_r'},discover={'range':19,'fovDeg':140,'closeRange':6,'actionId':base+'rage_roar'},rage={'threshold':480,'durationTicks':1800,'actionId':base+'rage_roar','speedScale':1.12,'damageScale':1.12,'cooldownScale':.82},parts=parts,ai={'aggroRange':200,'cooldownTicks':[32,60],'choices':choices},venolkaRank=1)
state={k:{'ticks':D,**follow_grid(frames(cl),D)} for k,cl,D in [('topple','fall_l',120),('flinch','flinch_body',54),('stun','stun',150)]}
for n,v in [('monster.json',monster),('actions.json',{'schemaVersion':1,'actions':acts}),('tracks.json',{'schemaVersion':1,'tracks':tracks}),('curves.json',{'schemaVersion':1,'curves':curves}),('follow.json',{'schemaVersion':1,'monsterId':monster['id'],'step':6,'actions':follow,'states':state,'poses':{'sleep':follow_grid(frames('sleep_loop'),1)}}),('opening_report.json',opening_report)]: (O/n).write_text(json.dumps(v,ensure_ascii=False,separators=(',',':'))+'\n')
print('baked',len(acts),'actions',len(tracks),'tracks',len(opening_report),'stable windows',flush=True)
