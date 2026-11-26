import { Group, Mesh, MeshLambertMaterial, MeshBasicMaterial, CylinderGeometry, IcosahedronGeometry, SphereGeometry, ConeGeometry, CircleGeometry, RingGeometry, DoubleSide, type BufferGeometry } from 'three';
import type { Simulation } from '../game/sim';
import { bindSurfaceImage,imageLambert,type ImageSurface } from './materialImages';
import type { FieldGatherNode, FieldGatherKind } from '../data/fieldGathering';
export const GATHER_COLORS:Record<FieldGatherKind,number>={mine:0x6cc4ff,bone:0xe8d5ad,plant:0x8edc77,insect:0xf3cd64,fish:0x6ce7df};
type Prop={node:FieldGatherNode;root:Group;visual:Group;marker:Mesh;flutter?:Group};
export interface FieldGatherProps {group:Group;props:Prop[];pond:Group;school:Mesh[];ripple:Mesh}
function mat(color:number,kind:ImageSurface){return imageLambert(kind,{color,flatShading:true});}
function mesh(parent:Group,geometry:BufferGeometry,material:MeshLambertMaterial|MeshBasicMaterial,x:number,y:number,z:number):Mesh{const m=new Mesh(geometry,material);m.position.set(x,y,z);parent.add(m);return m;}
export function buildFieldGatherProps(sim:Simulation):FieldGatherProps|null{
 const cat=sim.content.fieldGathering;if(!cat||sim.field?.id!==cat.fieldId)return null;
 const group=new Group(),props:Prop[]=[],pond=new Group(),school:Mesh[]=[];group.name='field-gathering';group.add(pond);
 const stone=mat(0x514f4b,'cliff'),dark=mat(0x333d41,'cliff'),ivory=mat(0xd8c6a0,'bone'),green=mat(0x48713d,'leaf'),leaf=mat(0x9bb857,'leaf'),wood=mat(0x62563b,'bark'),berry=mat(0xa94a35,'skin'),gold=mat(0xc69836,'scale'),wing=mat(0xe3c78e,'feather');
 for(const node of sim.fieldGather?.nodes??[]){
  const root=new Group(),visual=new Group();root.add(visual);root.position.set(node.x,sim.world.groundHeight(node.x,node.z),node.z);group.add(root);let flutter:Group|undefined;
  if(node.kind==='mine'){
   for(let i=0;i<5;i++){const a=i*2.4,m=mesh(visual,new IcosahedronGeometry(.39,0),i%2?stone:dark,Math.cos(a)*.32,.21+i%2*.07,Math.sin(a)*.29);m.scale.set(1.2,.75,1);}
   const gem=mat(node.quality==='deep'?0xd4ad48:0x70b3c8,'crystal');for(let i=0;i<3;i++){const m=mesh(visual,new ConeGeometry(.13,.47+i*.10,5),gem,-.27+i*.25,.45,0);m.rotation.z=(i-1)*.32;}
  }else if(node.kind==='bone'){
   for(let i=0;i<3;i++){const b=new Group();b.position.set(-.32+i*.32,.14,Math.sin(i*2)*.17);b.rotation.set(.08,i*1.7,Math.PI/2.5);visual.add(b);mesh(b,new CylinderGeometry(.064,.083,.52,8),ivory,0,0,0);for(const s of [-1,1]){mesh(b,new SphereGeometry(.10,8,5),ivory,0,s*.27,0);mesh(b,new SphereGeometry(.07,6,4),ivory,.08,s*.24,0);}}
  }else if(node.kind==='plant'){
   for(let i=0;i<7;i++){const a=i*Math.PI*2/7,m=mesh(visual,new SphereGeometry(.22,6,4),i%2?green:leaf,Math.cos(a)*.27,.24+i%3*.08,Math.sin(a)*.27);m.scale.set(.46,1.6,.60);m.rotation.z=Math.sin(a)*.8;m.rotation.x=Math.cos(a)*.8;}
   for(let i=0;i<3;i++)mesh(visual,new SphereGeometry(.075,6,4),berry,.1*i-.1,.52,.08);
  }else if(node.kind==='insect'){
   mesh(visual,new CylinderGeometry(.16,.21,.75,7),wood,0,.18,0).rotation.z=Math.PI/2;
   for(let i=0;i<3;i++)mesh(visual,new IcosahedronGeometry(.16,0),green,-.25+i*.2,.27,.13);
   flutter=new Group();visual.add(flutter);
   for(let i=0;i<3;i++){const b=new Group();b.position.set(-.26+i*.25,.62+i*.12,Math.sin(i)*.19);flutter.add(b);mesh(b,new SphereGeometry(.065,8,5),gold,0,0,0);for(const s of [-1,1])mesh(b,new SphereGeometry(.10,6,4),wing,s*.10,.025,0).scale.set(1.25,.15,.75);}
  }else{mesh(visual,new CylinderGeometry(.045,.06,.64,7),wood,0,.32,0).rotation.z=-.11;}
  const marker=mesh(root,new ConeGeometry(.12,.22,4),new MeshBasicMaterial({color:GATHER_COLORS[node.kind]}),0,1.25,0);marker.rotation.z=Math.PI;marker.visible=false;
  props.push({node,root,visual,marker,flutter});
 }
 const p=cat.pond;pond.position.set(p.x,p.waterY+.015,p.z);
 const water=mesh(pond,new CircleGeometry(p.radius,40),bindSurfaceImage(new MeshBasicMaterial({color:0x9cb8b5,transparent:true,opacity:.79,side:DoubleSide,depthWrite:false}),'water',{animated:true,gain:1.7}),0,0,0);water.rotation.x=-Math.PI/2;water.renderOrder=2;
 const ripple=mesh(pond,new RingGeometry(.20,.23,28),new MeshBasicMaterial({color:0xb7ded6,transparent:true,opacity:.55,side:DoubleSide,depthWrite:false}),0,.025,0);ripple.rotation.x=-Math.PI/2;ripple.renderOrder=3;
 for(let i=0;i<5;i++){const f=mesh(pond,new SphereGeometry(.15,8,5),mat(0x284a4c,'scale'),0,.005,0);f.scale.set(.45,.25,1.6);f.renderOrder=1;school.push(f);}
 return {group,props,pond,school,ripple};
}
export function updateFieldGatherProps(view:FieldGatherProps,sim:Simulation,time:number):void{
 const g=sim.fieldGather,cat=sim.content.fieldGathering;
 for(const p of view.props){const n=p.node;p.root.visible=!!g&&n.areaId===sim.areaId;if(!p.root.visible||!g)continue;const left=g.left(n);p.visual.scale.set(1,left?1:.40,1);p.marker.visible=left>0&&g.hasTool(n)&&g.discovered.has(n.id)&&Math.hypot(sim.player.pos.x-n.x,sim.player.pos.z-n.z)<12;p.marker.position.y=1.25+Math.sin(time*3+n.x)*.11;if(p.flutter){p.flutter.visible=left>0;p.flutter.position.y=Math.sin(time*3+n.x)*.12;p.flutter.rotation.y=time*.8;}}
 view.pond.visible=cat?.pond.areaId===sim.areaId;
 if(view.pond.visible){const surface=view.pond.children[0] as Mesh;const wm=surface.material as MeshBasicMaterial;if(wm.map)wm.map.offset.set(time*.025,-time*.04);const op=sim.player.errandOp,a=sim.player.action,bite=!!g&&op?.target.kind==='field_node'&&op.target.source==='fish'&&!!a&&g.bite(a.tick);
 for(let i=0;i<view.school.length;i++){const ang=time*.45+i*1.37,r=.8+i%3*.62,f=view.school[i]!;f.position.set(Math.cos(ang)*r,.01,Math.sin(ang)*r);f.rotation.y=-ang;}
 const s=bite?1.1+Math.sin(time*12)*.5:.7+(Math.sin(time*2)+1)*.4;view.ripple.scale.set(s,s,1);view.ripple.position.x=bite?0:Math.cos(time*.6)*1.5;view.ripple.position.z=bite?0:Math.sin(time*.6)*1.5;
 }
}
