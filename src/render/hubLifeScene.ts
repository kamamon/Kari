// 描画のみ: 山里の小さなサービス施設、季節、昼夜、気象、設備発展、生活動作。
// simulationやhub.jsonの地形・当たりは変更しない。静的物は1つのインスタンスバッチ。
import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Euler, Float32BufferAttribute, FogExp2, Group, HemisphereLight, IcosahedronGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Points, PointsMaterial, Quaternion, Vector3, type Scene } from 'three';
import { groundAt } from '../game/world';
import type { MapDef } from '../data/schemas';
import { freshHubLife, type HubLifeState, type ResourceId } from '../data/hubLife';
import { HUB_SERVICES } from '../game/hubLife';
import { HUB_RESOURCE_POINTS } from '../game/hubResources';
import { SeededRng } from '../core/seededRng';
import { VILLAGE_FOG_DENSITY, type Arena } from './arena';
import { SKY_LOOKS, type SkyLook } from './sky';
import { HubLivestock, PENS } from './hubLivestock';
import type { HubThreat } from '../data/hubNarrative';
import type { HubSample } from '../core/hubSoundtrack';
import { imageLambert,bindSurfaceImage,ensureSurfaceUV,type ImageSurface } from './materialImages';
type V=readonly [number,number,number];
type Part={p:V;s:V;color:number;ry:number;rx:number;rz:number;resource?:ResourceId;level?:number;village?:number;decor?:string};
const wood=0x644831, stone=0x818175, roof=0x4d5348, gold=0xd2a664, cloth=0xaa7851, moss=0x708b4f, warm=0xfac17b;
const mat=new Matrix4(),q=new Quaternion(),e=new Euler(),p=new Vector3(),s=new Vector3(),col=new Color();
function place(mesh:InstancedMesh,i:number,x:V,scale:V,ry=0,rx=0,rz=0){mat.compose(p.set(...x),q.setFromEuler(e.set(rx,ry,rz,'YXZ')),s.set(...scale));mesh.setMatrixAt(i,mat);}
function tint(mesh:InstancedMesh,i:number,color:number){mesh.setColorAt(i,col.set(color));}
export type HubVisualEnvironment={daylight:Exclude<HubLifeState['daylight'],'auto'>;weather:Exclude<HubLifeState['weather'],'auto'>;season:Exclude<HubLifeState['season'],'auto'>};
export function hubEnvironment(state:HubLifeState,cycle:number,time:number):HubVisualEnvironment{
 const day=(['day','dusk','night','morning'] as const)[Math.floor((time+cycle*15)/100)%4]!;
 const season=(['spring','summer','autumn','winter'] as const)[Math.floor(cycle/4)%4]!;
 const selected=state.season==='auto'?season:state.season;
 const weather=cycle===0?'clear':(['clear','clear','rain','mist','clear',selected==='winter'?'snow':'rain'] as const)[cycle%6]!;
 return {daylight:state.daylight==='auto'?day:state.daylight,season:selected,weather:state.weather==='auto'?weather:state.weather};
}
const SKY:Record<HubVisualEnvironment['daylight'],{zenith:number;horizon:number;sun:number;cloudLit:number;cloudShade:number;sunPower:number;hemi:number;hemiColor:number;backdrop:number}>={
 morning:{zenith:0x96b8c7,horizon:0xd9d2b5,sun:0xffe1b2,cloudLit:0xf5dfbe,cloudShade:0xa6b0b2,sunPower:1.55,hemi:1.12,hemiColor:0xe8efdf,backdrop:0xf1e4d0},
 day:{zenith:0x7f9fba,horizon:0xaebcab,sun:0xfff1d6,cloudLit:0xf4f2ea,cloudShade:0xa2aaa9,sunPower:1.9,hemi:1.15,hemiColor:0xe6efe2,backdrop:0xffffff},
 dusk:{zenith:0x7c829a,horizon:0xd7af86,sun:0xffbd7f,cloudLit:0xf3cba2,cloudShade:0x9e8790,sunPower:1.2,hemi:1.05,hemiColor:0xddcfd5,backdrop:0xe8c6aa},
 night:{zenith:0x25334e,horizon:0x637482,sun:0x7586b0,cloudLit:0x8293a7,cloudShade:0x454d62,sunPower:.32,hemi:.86,hemiColor:0x9eb4d2,backdrop:0x8596b2}
};
export class HubLifeScene {
 readonly group=new Group();
 private state=freshHubLife();private cycle=0;private village=1;private lastEnv='';
 private structures:{mesh:InstancedMesh;parts:Part[]}[]=[];private parts:Part[]=[];
 private agents:InstancedMesh;private heads:InstancedMesh;private birds:InstancedMesh;private fish:InstancedMesh;
 private rain:LineSegments;private snow:Points;private steam:Points;private rainPos:Float32Array;private snowPos:Float32Array;
 private originals=new Map<InstancedMesh,Float32Array>();private lastSeason='';
 private agentLocations:V[];
 private livestock:HubLivestock;private threat:HubThreat=0;private livestockTimer=0;private flashTimer=0;private flash=0;
 private timer=0;private env:HubVisualEnvironment={daylight:'day',weather:'clear',season:'spring'};
 constructor(private map:MapDef,private scene:Scene,private arena:Arena){
  this.group.name='hub-life-scene';
  const part=(pos:V,scale:V,color:number,ry=0,rx=0,rz=0,extra:Partial<Part>={})=>this.parts.push({p:pos,s:scale,color,ry,rx,rz,...extra});
  const ground=(x:number,z:number)=>groundAt(map.platforms,x,z);
  // 小屋の造形は施設標識・木枠・屋根・生活小物。人が立つサービス点を空ける。
  for(const service of HUB_SERVICES){
   const {x,z}=service,y=ground(x,z);
   const sx=x+1.05,sz=z+.75;
   part([sx,y+.45,sz],[.11,.9,.11],wood);part([sx,y+.91,sz],[.62,.32,.14],gold);
   part([sx,y+1.14,sz],[.72,.10,.28],roof);
   part([sx+.29,y+.12,sz],[.25,.24,.28],stone);
  }
  // 食事処の卓・炉・日除け。通路側には大きな箱を置かない。
  const meal=HUB_SERVICES.find(x=>x.id==='dining')!,dy=meal.floor,mx=meal.x+2.4,mz=meal.z+1.9;
  part([mx,dy+.65,mz],[2.5,.12,1.05],wood);
  for(const dx of [-1,1])for(const dz of [-.36,.36])part([mx+dx,dy+.32,mz+dz],[.13,.64,.13],wood);
  for(const dz of [-.9,.9]){part([mx,dy+.3,mz+dz],[2.2,.13,.33],wood);for(const dx of [-.85,.85])part([mx+dx,dy+.15,mz+dz],[.12,.30,.12],wood);}
  for(const dx of [-1.3,1.3])for(const dz of [-.82,.82])part([mx+dx,dy+1.35,mz+dz],[.12,2.7,.12],wood);
  part([mx,dy+2.7,mz],[3.1,.08,2.0],cloth,0,.09);
  part([mx+.4,dy+.78,mz],[.30,.15,.30],stone);
  // 水音の湯: 里の下段の石風呂。床の端に近づけず、利用地点を中央に残す。
  const bath=HUB_SERVICES.find(x=>x.id==='bath')!,bx=bath.x+2.5,bz=bath.z-3,by=bath.floor;
  part([bx,by+.20,bz],[3.65,.4,2.8],stone);part([bx,by+.43,bz],[3.02,.08,2.14],0x6caaa2);
  for(const dir of [-1,1]){
   part([bx+dir*1.66,by+.53,bz],[.34,.53,2.8],stone);part([bx,by+.53,bz+dir*1.25],[3.65,.53,.28],stone);
   part([bx+dir*1.90,by+.90,bz-1.62],[.18,1.8,.18],wood);
  }
  part([bx,by+1.34,bz-1.62],[3.95,.72,.09],cloth);
  part([bx,by+1.84,bz-1.62],[4.1,.1,.14],wood);
  // 里の発展段階: 修繕資材・旗・灯を増やす。既存の灯や水車は残す。
  for(const [x,z,l] of [[-5,15,2],[18,1,2],[-18,36,3],[12,49,3],[-31,37,4],[20,56,4]] as const){
   const y=ground(x,z);part([x,y+1.15,z],[.11,2.3,.11],wood,0,0,0,{village:l});
   part([x+.45,y+1.65,z],[.82,.8,.07],l===4?0xa65d42:0xbda475,0,0,0,{village:l});
   part([x,y+2.25,z],[.27,.28,.27],warm,0,0,0,{village:l});
  }
  // 設備の発展。1段ごとに追加の鉢、木枠、採掘箱、竿受けなどが現れる。
  for(const r of HUB_RESOURCE_POINTS)for(let lv=2;lv<=4;lv++){
   const id=r.id as ResourceId,off=1.1+(lv-2)*.51,xx=r.x+(id==='mine'?-1:1)*off,zz=r.z+(id==='fish'?-.9:.85),yy=r.floor;
   const ex={resource:id,level:lv};
   part([xx,yy+.24,zz],[.47,.48,.53],id==='mine'||id==='bone'?stone:wood,0,0,0,ex);
   part([xx,yy+.55,zz],[.45,.14,.43],id==='farm'?moss:id==='insect'?0xb3a24f:id==='fish'?0x659a90:0xc4b394,0,0,0,ex);
   if(lv===4)part([xx,yy+.99,zz],[.07,.86,.07],wood,0,0,0,ex);
  }
  // 宿の調度は外から見える展示棚の色も変える。室内の全景は専用メニューのプレビュー。
  for(const [style,color] of [['wood',0x94704e],['green',0x718b57],['bronze',0xa99156]] as const)
   part([-30.3,8+1.12,28.65],[1.12,.67,.09],color,0,0,0,{decor:style});
  const kindOf=(a:Part):ImageSurface|'light'=>a.color===stone?'masonry':a.color===roof?'roof':a.color===gold?'bronze':a.color===warm?'light':a.color===cloth||a.color===0xa65d42||a.color===0xbda475?'cloth':a.color===0x6caaa2||a.color===0x659a90?'water':a.color===moss?'leaf':a.color===0xc4b394?'bone':a.color===0xb3a24f?'scale':a.decor==='bronze'?'bronze':'wood';
  for(const kind of ['wood','masonry','roof','bronze','cloth','water','leaf','bone','scale','light'] as const){
   const parts=this.parts.filter(a=>kindOf(a)===kind);if(!parts.length)continue;
   const material=kind==='light'?new MeshBasicMaterial({color:0xffffff}):imageLambert(kind,{color:0xffffff},{gain:kind==='water'?2.5:1.35});
   const mesh=new InstancedMesh(new BoxGeometry(1,1,1),material,parts.length);mesh.name='hub-life-'+kind;mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=false;mesh.userData.noMerge=true;this.structures.push({mesh,parts});this.group.add(mesh);
  }
  // 匿名の生活者4人: 住民を増やす仮形状。採集点や依頼のNPCとは分離。
  this.agentLocations=[[-19,ground(-19,34),34],[mx+.8,dy,mz+.8],[-33,ground(-33,-27),-27],[8,ground(8,48),48]];
  this.agents=new InstancedMesh(new BoxGeometry(1,1,1),imageLambert('cloth',{color:0xffffff}),this.agentLocations.length*6);this.agents.name='hub-workers';this.agents.frustumCulled=false;
  this.heads=new InstancedMesh(new IcosahedronGeometry(1,1),imageLambert('skin',{color:0xffffff}),this.agentLocations.length);this.heads.frustumCulled=false;
  const birdGeo=new BufferGeometry();birdGeo.setAttribute('position',new Float32BufferAttribute([0,0,0,-.5,0,.08,-.20,0,-.30,0,0,0,.20,0,-.30,.5,0,.08],3));birdGeo.computeVertexNormals();
  this.birds=new InstancedMesh(ensureSurfaceUV(birdGeo,.8),bindSurfaceImage(new MeshBasicMaterial({color:0x394143,side:2}),'feather'),6);this.birds.frustumCulled=false;this.birds.name='hub-birds';
  this.fish=new InstancedMesh(new IcosahedronGeometry(1,0),imageLambert('scale',{color:0x566d6a}),5);this.fish.frustumCulled=false;this.fish.name='hub-river-fish';
  this.group.add(this.agents,this.heads,this.birds,this.fish);
  const n=140;this.rainPos=new Float32Array(n*6);const rg=new BufferGeometry();rg.setAttribute('position',new Float32BufferAttribute(this.rainPos,3));
  // Float32BufferAttribute copies the array: retain the actual attribute array.
  this.rainPos=rg.getAttribute('position').array as Float32Array;this.rain=new LineSegments(rg,new LineBasicMaterial({color:0xb9d2d5,transparent:true,opacity:.42,depthWrite:false}));this.rain.frustumCulled=false;this.rain.name='hub-rain';
  const sg=new BufferGeometry();sg.setAttribute('position',new Float32BufferAttribute(new Float32Array(100*3),3));this.snowPos=sg.getAttribute('position').array as Float32Array;this.snow=new Points(sg,new PointsMaterial({color:0xe9eef0,size:.10,transparent:true,opacity:.78,depthWrite:false}));this.snow.frustumCulled=false;this.snow.name='hub-snow';
  const tg=new BufferGeometry();tg.setAttribute('position',new Float32BufferAttribute(new Float32Array(8*3),3));this.steam=new Points(tg,new PointsMaterial({color:0xe0e4d7,size:.9,transparent:true,opacity:.18,depthWrite:false}));this.steam.frustumCulled=false;this.steam.name='hub-bath-steam';this.steam.userData.origin=[bx,by+.48,bz];
  this.group.add(this.rain,this.snow,this.steam);
  this.livestock=new HubLivestock(map);this.group.add(this.livestock.group);
  this.set(freshHubLife(),0,1);
  this.update(0,0,new Vector3(0,0,0));
 }
 set(state:HubLifeState,cycle:number,village:number,threat:HubThreat=0){
  this.state=state;this.cycle=cycle;this.village=village;this.threat=threat;this.lastEnv='';this.livestock.set(state.livestock??{});
  for(const {mesh,parts} of this.structures){
   for(const [i,a] of parts.entries()){
    const show=(!a.resource||(state.levels[a.resource]>=a.level!))&&(!a.village||village>=a.village)&&(!a.decor||state.decor===a.decor);
    place(mesh,i,a.p,show?a.s:[0,0,0],a.ry,a.rx,a.rz);tint(mesh,i,a.color);
   }
   mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
  }
 }
 private environment(time:number){
  const env=hubEnvironment(this.state,this.cycle,time);if(this.threat===2&&this.state.weather==='auto')env.weather='mist';const key=Object.values(env).join(':')+':'+this.threat;this.env=env;if(key===this.lastEnv)return;this.lastEnv=key;
  const k=SKY[env.daylight],wet=env.weather==='rain'||env.weather==='snow',mist=env.weather==='mist';
  const fog=new Color(k.horizon);if(mist||wet)fog.lerp(new Color(0xa6b2b3),.22);
  const sky:SkyLook={...SKY_LOOKS.village,zenith:k.zenith,horizon:fog.getHex(),sun:k.sun,cloudLit:k.cloudLit,cloudShade:k.cloudShade,coverage:mist||wet?.33:.56};
  this.arena.sky?.setLook(sky);
  if(this.scene.fog instanceof FogExp2){this.scene.fog.color.copy(fog);this.scene.fog.density=VILLAGE_FOG_DENSITY*(mist?1.75:wet?1.30:1);}
  if(this.scene.background instanceof Color)this.scene.background.copy(fog);
  this.arena.sun.color.set(k.sun);this.arena.sun.intensity=k.sunPower*(wet?.70:1);
  for(const obj of this.scene.children)if(obj instanceof HemisphereLight){obj.intensity=k.hemi;obj.color.set(k.hemiColor);if(env.season==='autumn')obj.groundColor.set(0x776447);else if(env.season==='winter')obj.groundColor.set(0x8b9397);else obj.groundColor.set(0x56624f);}
  for(const obj of this.arena.backdrop.children)if(obj instanceof Mesh&&obj.material instanceof MeshBasicMaterial)obj.material.color.set(k.backdrop);
  // 葉のインスタンスの基礎色を保存し、季節で掛ける。再適用で色を累積させない。
  if(this.lastSeason!==env.season){
   this.lastSeason=env.season;
   for(const name of ['mountain-cedars','autumn-canopies']){
    const m=this.arena.group.getObjectByName(name);if(!(m instanceof InstancedMesh)||!m.instanceColor)continue;
    let a=this.originals.get(m);if(!a){a=new Float32Array(m.instanceColor.array);this.originals.set(m,a);}
    const f=new Color(env.season==='spring'?0xc5f2ac:env.season==='autumn'?0xe9b87d:env.season==='winter'?0xd2dce2:0xffffff);
    for(let i=0;i<m.count;i++){col.setRGB(a[i*3]!,a[i*3+1]!,a[i*3+2]!).multiply(f);m.setColorAt(i,col);}m.instanceColor.needsUpdate=true;
   }
  }
  this.rain.visible=env.weather==='rain';this.snow.visible=env.weather==='snow';this.birds.visible=env.weather==='clear'&&env.daylight!=='night';
 }
 /** 合成音の既存IDを利用。時々だけ虫・鳥・鐘が鳴る。 */
 ambienceCue(time:number):{id:string;k:number}|null{
  if(time<this.timer+12)return null;this.timer=time;
  if(this.env.daylight==='night')return {id:'insect_buzz',k:.12};
  if(this.env.weather==='clear')return {id:this.village>=3&&Math.floor(time/12)%3===0?'bell_far':'bird_screech',k:.12};
  return null;
 }
 sampleCue(time:number,listener:Vector3):{id:HubSample;k:number}|null{
  if(this.threat===2&&this.state.weather==='auto'&&time>this.flashTimer+37){this.flashTimer=time;this.flash=time;return {id:'thunder',k:.35};}
  if(time<this.livestockTimer+9)return null;this.livestockTimer=time;
  const kinds=['goat','hen','ox'] as const;const k=kinds[Math.floor(time/9)%3]!,p=PENS[k],dist=Math.hypot(listener.x-p.x,listener.z-p.z);
  return dist<18&&Math.abs(listener.y-8)<9?{id:k,k:.48*(1-dist/18)}:null;
 }
 update(time:number,_dt:number,camera:Vector3){
  this.environment(time);this.livestock.update(time,camera);
  if(this.threat===2&&this.state.weather==='auto'){
   const base=SKY[this.env.daylight].sunPower,age=time-this.flash;
   this.arena.sun.intensity=base*(this.env.weather==='rain'||this.env.weather==='snow'?.70:1)+(this.flash>0&&age<.28?.23*(1-age/.28):0);
  }
  for(const [i,a] of this.agentLocations.entries()){
   const phase=time*1.6+i*1.9,walk=i===2?Math.sin(time*.35)*.65:0,bob=Math.sin(phase*2)*.018;
   const x=a[0]+walk,y=a[1],z=a[2]+(i===2?.24*Math.cos(time*.35):0);
   const palette=[0x849061,0xa36e46,0x80775e,0x708492],color=palette[i]!;
   // body, apron, arms, legs. Work gesture is simple joint-like swinging parts, not final humanoid rig.
   const idx=i*6;
   place(this.agents,idx,[x,y+1.04+bob,z],[.43,.62,.27]);tint(this.agents,idx,color);
   place(this.agents,idx+1,[x,y+.91,z+.15],[.34,.43,.055]);tint(this.agents,idx+1,0xc4af8b);
   for(let j=0;j<2;j++){const sign=j?1:-1;place(this.agents,idx+2+j,[x+sign*.25,y+1.00+bob,z+.05],[.11,.46,.13],0,-.30+Math.sin(phase+j*1.7)*.55,sign*.2);tint(this.agents,idx+2+j,color);place(this.agents,idx+4+j,[x+sign*.13,y+.32,z+.07*Math.sin(phase+j*Math.PI)],[.15,.64,.18],0,walk*Math.sin(phase+j*Math.PI)*.3);tint(this.agents,idx+4+j,wood);}
   place(this.heads,i,[x,y+1.49+bob,z],[.15,.19,.15]);tint(this.heads,i,0xc2a080);
  }
  this.agents.instanceMatrix.needsUpdate=true;this.heads.instanceMatrix.needsUpdate=true;if(this.agents.instanceColor)this.agents.instanceColor.needsUpdate=true;if(this.heads.instanceColor)this.heads.instanceColor.needsUpdate=true;
  for(let i=0;i<6;i++){const a=time*.13+i*.31,flap=.65+.35*Math.sin(time*8+i);place(this.birds,i,[-9+Math.cos(a)*58,35+i*.37+Math.sin(a*3)*2,15+Math.sin(a)*55],[1.7,flap,1.7],-a,Math.sin(time*8+i)*.12,Math.sin(time*3+i)*.2);}this.birds.instanceMatrix.needsUpdate=true;
  const fy=groundAt(this.map.platforms,-44,-35);
  for(let i=0;i<5;i++){const a=time*.8+i*1.7;place(this.fish,i,[-44+.75*Math.sin(a),fy+.04,-35+1.8*Math.cos(a)],[.085,.045,.31],a);}
  this.fish.instanceMatrix.needsUpdate=true;
  // 粒子の位置はカメラ周囲。固定seed相当の式で揺らぎ、フレーム依存の乱数列を作らない。
  const fall=(i:number,speed:number)=>((i*2.73-time*speed)%9+9)%9;
  if(this.rain.visible){for(let i=0;i<this.rainPos.length/6;i++){const x=camera.x+((i*13.97)%22)-11,z=camera.z+((i*7.81)%22)-11,y=camera.y+fall(i,10)-2;this.rainPos.set([x,y,z,x-.15,y-.8,z+.06],i*6);}this.rain.geometry.getAttribute('position').needsUpdate=true;}
  if(this.snow.visible){for(let i=0;i<this.snowPos.length/3;i++){const x=camera.x+((i*13.97)%22)-11+.5*Math.sin(time+i),z=camera.z+((i*7.81)%22)-11,y=camera.y+fall(i,1.1)-2;this.snowPos.set([x,y,z],i*3);}this.snow.geometry.getAttribute('position').needsUpdate=true;}
  const steam=this.steam.geometry.getAttribute('position'),o=this.steam.userData.origin as number[];
  for(let i=0;i<steam.count;i++){const f=(time*.28+i/steam.count)%1;steam.setXYZ(i,o[0]!+Math.sin(i*2)*.83+f*.6,o[1]!+.3+f*2.1,o[2]!+Math.cos(i)*.65);}
  steam.needsUpdate=true;
 }
}
