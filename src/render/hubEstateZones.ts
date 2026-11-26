// 拠点の独立した3D区画: 坑道、養魚池、自室。描画・歩行可能領域は同じデータを参照する。
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, FogExp2, Group, HemisphereLight, DirectionalLight, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PointLight, Quaternion, Scene, SphereGeometry, TorusGeometry, Vector3, Euler } from 'three';
import { CraftKit, craftMaterials, lantern } from './hubCraft';
import { ZONES, zoneContains, type GatherZone } from '../data/hubEstate';
import { SeededRng } from '../core/seededRng';
type Materials=ReturnType<typeof craftMaterials>;
export interface ZoneRender {group:Group;update(time:number):void}
const wood=0x816345,dark=0x493a2b,stone=0x818578,water=0x518681;
function gateLantern(k:CraftKit,x:number,z:number,y=1.7){k.box('wood',[x,y+.37,z],[.13,.12,.40],dark);lantern(k,x,y-.1,z+.19,.7);}
function mine(kit:CraftKit,zone:GatherZone,lv:number){
 const rng=new SeededRng(27117+lv),step=.5,b=zone.bounds;
 // 0.5m の歩行グリッドごとに床と露出端の岩壁を作る。接続済みの区画にだけ面を作る。
 for(let z=b.z0+step/2;z<b.z1;z+=step)for(let x=b.x0+step/2;x<b.x1;x+=step){
  if(!zoneContains(zone,x,z,lv))continue;
  kit.box('stone',[x,-.06,z],[step+.004,.12,step+.004],rng.next()>.45?0x77786f:0x6b6e64);
  kit.box('stone',[x,4.1,z],[step+.01,.3,step+.01],0x65685f);
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]] as const){
   if(zoneContains(zone,x+dx*step,z+dz*step,lv))continue;
   const wx=x+dx*step*.5,wz=z+dz*step*.5;
   kit.box('stone',[wx,1.95,wz],[dx?.38:step+.018,4.06,dz?.38:step+.018],0x777c6d);
   for(let h=0;h<4;h++){const zz=wz+rng.range(-.09,.09),xx=wx+rng.range(-.09,.09),r=rng.range(.18,.28);
    kit.sphere('stone',[xx,h+.38,zz],[dx?.26:r,.48,dz?.26:r],h%2?0x73776c:0x8d8d7c,0,[rng.range(-.25,.25),rng.range(0,6),.07]);
   }
  }
 }
 // 人が通る支保工とレール。端の広さを守り、入口から連続させる。
 for(let z=6.5;z>-10;z-=3.2){
  for(const x of [-1.78,1.78]){
   kit.box('wood',[x,1.77,z],[.23,3.54,.25],dark,[0,0,0],.025);
   kit.box('stone',[x,.15,z],[.42,.30,.43],stone);
   kit.beam('wood',[x,2.67,z],[x*.54,3.53,z],.16,wood);
  }
  kit.box('wood',[0,3.65,z],[3.85,.29,.27],wood,[0,0,0],.022);
  gateLantern(kit,-1.65,z);
 }
 for(let z=7;z>-13;z-=.65){
  kit.box('wood',[0,.026,z],[1.40,.05,.16],wood);
 }
 for(const x of [-.43,.43])kit.box('metal',[x,.072,-2.5],[.08,.065,19],0x756e5d);
 for(const n of zone.nodes.filter(n=>n.level<=lv)){
  // 採集点の足元は空ける。鉱石は壁際の端に付く。
  const toward=n.x===0?1:Math.sign(n.x),x=n.x+toward*.55,z=n.z-.45;
  for(let i=0;i<7;i++){const a=i*2.39;
   kit.sphere('stone',[x+.24*Math.cos(a),.23+i*.035,z+.25*Math.sin(a)],[.24,.29+i*.025,.24],i%2?0x7c837a:0x636b64,1,[0,a,.2]);
  }
  const tint=n.level>=4?0xd4b580:n.level>=3?0x8db8c1:n.level>=2?0x96b898:0xb7b2a1;
  for(let i=0;i<6;i++){
   const a=i*2.3999,dx=.22*Math.cos(a),dz=.22*Math.sin(a);
   kit.cyl('metal',[x+dx,.39+i*.065,z+dz],.012,.073,.36+.07*(i%3),tint,[.38*Math.sin(a),a,.25*Math.cos(a)],5);
  }
  gateLantern(kit,n.x,n.z+.63,1.4);
 }
 // 深部の閉鎖札は実際の境界を示し、解放済みの支坑を塞がない。
 const exits=[{x:5.96,z:-12,level:2},{x:-5.95,z:-13,level:3},{x:-13.5,z:-16.98,level:4}];
 for(const e of exits.filter(e=>lv<e.level&&lv>=e.level-1)){
  kit.box('wood',[e.x,1.25,e.z],[.32,.18,1.7],wood,[0,0,.08]);
  kit.box('cloth',[e.x,1.4,e.z],[.34,.50,.66],0xac8a52);
 }
}
function pond(kit:CraftKit,zone:GatherZone,lv:number){
 const rng=new SeededRng(27119+lv),b=zone.bounds,step=.5;
 for(let z=b.z0+step/2;z<b.z1;z+=step)for(let x=b.x0+step/2;x<b.x1;x+=step){
  if(!zoneContains(zone,x,z,lv))continue;
  const overWater=Math.abs(x)<7&&z<3&&z>-8;
  kit.box(overWater?'wood':'stone',[x,-.06,z],[step+.002,.12,step+.002],overWater?0x9c7b54:rng.next()<.4?0x8c9a78:0x8e8c78);
  // 水辺の端の岩、木杭。通れる桟橋は地面を切り欠いて追加。
  if(!overWater&&Math.abs(Math.abs(x)-7.25)<.01&&z>-8&&z<3&&Math.floor((z+8)*2)%3===0)kit.sphere('stone',[Math.sign(x)*6.98,-.15,z],[.25,.32,.30],0x788478,0);
 }
 for(const x of [-11,11])for(let z=-12;z<=9;z+=1.5){
  kit.box('wood',[x,.52,z],[.12,1.04,.12],dark);
  if(z+1.5<=9)for(const y of [.36,.81])kit.box('wood',[x,y,z+.75],[.09,.10,1.5],wood);
 }
 for(const z of [-13,10])for(let x=-10.5;x<=10.5;x+=1.5){
  kit.box('wood',[x,.52,z],[.12,1.04,.12],dark);
  if(x+1.5<=10.5)for(const y of [.36,.81])kit.box('wood',[x+.75,y,z],[1.5,.10,.09],wood);
 }
 // 流入口、木樋、排水の石組み、養魚の小屋。
 kit.box('stone',[10.1,.8,-11.6],[1.3,1.6,2.1],stone,[0,0,0],.035);
 kit.box('wood',[9.35,.68,-9.6],[.72,.22,3.3],wood,[.18,0,0]);
 for(const s of [-1,1])kit.box('wood',[9.35+s*.31,.85,-9.6],[.085,.30,3.3],dark,[.18,0,0]);
 for(const x of [-10.1,-8.2])for(const z of [7.3,9.1]){kit.box('wood',[x,1.18,z],[.14,2.36,.14],dark);kit.box('stone',[x,.08,z],[.24,.16,.24],stone);}
 kit.box('cloth',[-9.15,2.36,8.2],[2.35,.08,2.3],0xbba785,[.14,0,0]);
 kit.box('wood',[-9.15,.5,8.6],[1.5,1,.6],wood);kit.box('wood',[-9.15,1.02,8.6],[1.65,.09,.72],dark);
 for(const n of zone.nodes.filter(n=>n.level<=lv)){
  kit.box('wood',[n.x+.5,.27,n.z+.54],[.63,.13,.34],wood,[0,0,0],.02);
  for(const dx of [-.22,.22])kit.box('wood',[n.x+.5+dx,.12,n.z+.54],[.1,.25,.10],dark);
  kit.cyl('metal',[n.x-.53,.20,n.z+.45],.19,.14,.40,0x9d885c);
  kit.beam('wood',[n.x+.48,.30,n.z+.40],[n.x+.14,1.03,n.z-.13],.035,wood,true);
  if(n.level>=2){kit.box('wood',[n.x+.72,.46,n.z-1],[.12,.92,.12],dark);lantern(kit,n.x+.72,.94,n.z-1,.65);}
 }
 if(lv>=2)for(const x of [-1.55,1.55])for(let z=0;z<=3;z+=1){kit.box('wood',[x,-.15,z],[.18,.95,.18],dark);kit.box('wood',[x,.46,z],[.12,.92,.12],wood);}
 if(lv>=3){
  for(let i=0;i<3;i++){const x=-4.4+i*4.4;
   for(const dx of [-1.2,1.2]){kit.box('wood',[x+dx,.24,-7.85],[.12,.48,.12],dark);kit.box('wood',[x+dx,.21,-6.5],[.10,.09,2.8],wood);}
   for(const z of [-7.8,-5.2])kit.box('wood',[x,.21,z],[2.5,.09,.10],wood);
  }
 }
 // 外側の自然な岩・樹木、畑の空を包む山並み。
 for(let i=0;i<33;i++){
  const a=i*2.39996,x=Math.cos(a)*(14+rng.range(0,4)),z=Math.sin(a)*(16+rng.range(0,5))-1;
  kit.sphere('stone',[x,.4,z],[rng.range(1.1,2.5),rng.range(1.1,4.0),rng.range(1.1,2.5)],0x839084,0);
  const h=rng.range(3.3,7.0);
  kit.cyl('wood',[x,h*.28,z],.10,.15,h*.56,dark,[0,0,0],7);
  for(let j=0;j<3;j++)kit.cyl('plain',[x,h*(.43+j*.18),z],.05,h*(.20-j*.04),h*.44,0x49674c+j*0x030402,[0,a,0],8);
 }
}
export function buildGatherZone(id:'mine'|'pond',level:number,materials:Materials):ZoneRender{
 const zone=ZONES[id],kit=new CraftKit(materials);
 if(id==='mine')mine(kit,zone,level);else pond(kit,zone,level);
 const g=kit.build('estate-zone:'+id);
 const rings=new Group();rings.name='estate-nodes';
 for(const n of zone.nodes.filter(n=>n.level<=level)){
  const ring=new Mesh(new TorusGeometry(.39,.028,5,20),new MeshBasicMaterial({color:id==='mine'?0xd7ad62:0x92c8b3}));ring.rotation.x=-Math.PI/2;ring.position.set(n.x,.045,n.z);ring.userData.node=n.id;rings.add(ring);
 }
 g.add(rings);
 if(id==='mine')return {group:g,update(t){for(const r of rings.children)r.scale.setScalar(1+.09*Math.sin(t*2));}};
 const waterGeo=new PlaneGeometry(14,11,28,22);waterGeo.rotateX(-Math.PI/2);waterGeo.translate(0,-.33,-2.5);
 const waterMat=new MeshStandardMaterial({color:0x548982,roughness:.29,metalness:.10,transparent:true,opacity:.72,depthWrite:false,side:DoubleSide});
 const w=new Mesh(waterGeo,waterMat);w.name='pond-surface';w.renderOrder=2;g.add(w);
 const bed=new Mesh(new BoxGeometry(14,.16,11),new MeshStandardMaterial({color:0x6d7960,roughness:.95}));bed.position.set(0,-.67,-2.5);g.add(bed);
 const fishKit=new CraftKit(materials);
 fishKit.sphere('plain',[0,0,0],[.10,.055,.27],0x8b9c82,2);
 fishKit.sphere('plain',[0,.015,.20],[.077,.045,.065],0x9fad91,1);
 fishKit.tri('plain',[0,0,-.21],[-.085,.02,-.39],[.085,.02,-.39],0x658b83);
 const fg=fishKit.build('pond-fish-template'),mesh=fg.children[0] as Mesh;
 const fish=new InstancedMesh(mesh.geometry,mesh.material,12);fish.frustumCulled=false;fish.name='pond-fish';g.add(fish);
 const matrix=new Matrix4(),q=new Quaternion(),pos=new Vector3(),s=new Vector3(1,1,1);
 const attr=w.geometry.getAttribute('position');
 return {group:g,update(t){
  for(let i=0;i<attr.count;i++){const x=attr.getX(i),z=attr.getZ(i);attr.setY(i,-.33+.025*Math.sin(1.6*x+.95*z+t*2)+.015*Math.sin(2.3*z-t*1.7));}
  attr.needsUpdate=true;w.geometry.computeVertexNormals();
  for(let i=0;i<12;i++){const a=t*.45+i*2.39996,rx=2.0+(i%4)*1.05,rz=2.1+(i%3)*.8;pos.set(rx*Math.cos(a),-.46+.045*Math.sin(a*3),-2.5+rz*Math.sin(a));q.setFromAxisAngle(new Vector3(0,1,0),Math.atan2(-rx*Math.sin(a),rz*Math.cos(a)));matrix.compose(pos,q,s);fish.setMatrixAt(i,matrix);}
  fish.instanceMatrix.needsUpdate=true;for(const r of rings.children)r.scale.setScalar(1+.09*Math.sin(t*2));
 }};
}
export function buildEstateRoom(materials:Materials):Group{
 const kit=new CraftKit(materials),wall=0xd9cbae;
 // 8mの自室。実際の開口と柱、梁、床板・窓・棚の下地。南側中央は入口。
 kit.box('wood',[0,-.09,0],[8,.18,7],wood);
 for(let i=0;i<26;i++)kit.box('wood',[(i-12.5)*.30,.005,0],[.285,.022,6.92],i%4?0x967952:0x886746);
 for(const x of [-3.94,3.94])kit.box('plain',[x,1.53,0],[.12,3.06,7],wall);
 kit.box('plain',[0,.53,-3.44],[8,1.06,.12],wall);
 kit.box('plain',[0,2.7,-3.44],[8,.72,.12],wall);
 for(const x of [-2.95,2.95])kit.box('plain',[x,1.62,-3.44],[2.1,1.18,.12],wall);
 for(const x of [-2.50,2.50])kit.box('plain',[x,1.53,3.44],[2.98,3.06,.12],wall);
 kit.box('plain',[0,2.70,3.44],[2.03,.70,.12],wall);
 for(const x of [-3.88,3.88])for(const z of [-3.36,0,3.36])kit.box('wood',[x,1.5,z],[.15,3,.15],dark);
 for(const z of [-3.34,0,3.34])kit.box('wood',[0,2.98,z],[7.9,.17,.18],dark);
 for(const x of [-1.98,0,1.98])kit.box('wood',[x,1.62,-3.34],[.085,1.25,.14],dark);
 for(const y of [1.05,1.61,2.22])kit.box('wood',[0,y,-3.34],[4.05,.075,.18],wood);
 for(const x of [-1.05,1.05])kit.box('wood',[x,1.53,3.36],[.16,3.05,.15],dark);
 for(const x of [-3.7,3.7])lantern(kit,x,1.85,.10,.75);
 // 窓から見える杉の稜線。背景は独立した立体で、室内を塞がない。
 for(let i=0;i<9;i++){const x=(i-4)*2.4,z=-11-(i%3)*2;
  kit.cyl('stone',[x,-.2,z],.0,2.8,4.4+(i%3)*.7,i%2?0x7e9180:0x849b8e,[0,i*.28,0],7);
 }
 const g=kit.build('estate-room-shell');return g;
}
