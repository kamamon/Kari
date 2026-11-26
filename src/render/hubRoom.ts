// 自室の小規模な3D見学モード。屋内は独立したビューアで、狩猟本編の当たり・セーブには介入しない。
import {BoxGeometry,Color,CylinderGeometry,Group,HemisphereLight,DirectionalLight,Mesh,MeshStandardMaterial,PerspectiveCamera,PointLight,Scene,Vector3,WebGLRenderer} from 'three';
import type {Content} from '../data/schemas';
import {HunterRig} from './rig';
import {emptyPose} from './poses';
import {armorTierOf} from './hunterArmor';

export function startHubRoom(renderer:WebGLRenderer,canvas:HTMLCanvasElement,panel:HTMLElement,content:Content,q:URLSearchParams):void{
 const scene=new Scene();scene.background=new Color(0x708477);scene.add(new HemisphereLight(0xf3e1c3,0x554739,1.8));const sun=new DirectionalLight(0xffe5bb,2);sun.position.set(-3,6,-4);scene.add(sun);
 const wood=0x74503a,dark=0x453327,trim=0xb38a58,plaster=0xc7bb9e,cloth=q.get('decor')==='green'?0x6e8557:q.get('decor')==='bronze'?0xb58244:0x9b6d49;
 const layout=q.get('layout')==='right'?-1:1, room=new Group();scene.add(room);
 const materials=new Map<number,MeshStandardMaterial>();function material(color:number){let m=materials.get(color);if(!m){m=new MeshStandardMaterial({color,roughness:.92});materials.set(color,m);}return m;}
 const box=(x:number,y:number,z:number,w:number,h:number,d:number,c:number,parent=room)=>{const m=new Mesh(new BoxGeometry(w,h,d),material(c));m.position.set(x,y,z);parent.add(m);return m;};
 box(0,-.1,0,8,.2,7,wood);for(let i=-7;i<=7;i++)box(i*.52,.01,0,.02,.015,6.98,dark);
 box(-4,1.5,0,.18,3,7,plaster);box(4,1.5,0,.18,3,7,plaster);box(0,1.5,3.5,8,3,.18,plaster);
 // 窓の下と左右を残し、山の空が見える開口にする。
 box(0,.48,-3.5,8,.96,.18,plaster);box(0,2.65,-3.5,8,.7,.18,plaster);box(-2.8,1.64,-3.5,2.4,1.36,.18,plaster);box(2.8,1.64,-3.5,2.4,1.36,.18,plaster);
 for(const x of [-3.87,0,3.87])for(const z of [-3.37,3.37])box(x,1.5,z,.2,3,.2,dark);for(const z of [-3.35,0,3.35])box(0,2.95,z,7.95,.18,.18,dark);
 box(0,3.05,0,8,.13,7,dark);box(0,1.0,-3.37,3.5,.16,.26,trim);box(0,1.64,-3.38,.09,1.35,.12,dark);
 for(const x of [-1.6,1.6])box(x,1.64,-3.34,.12,1.42,.18,trim);
 for(let i=0;i<9;i++){const peak=new Mesh(new CylinderGeometry(0,2.8,4.2+(i%3),5),material(i%2?0x6d8176:0x839487));peak.position.set((i-4)*2.4,0,-10-(i%3)*2);scene.add(peak);}
 const bx=-2.6*layout;box(bx,.26,-1.9,1.55,.5,2.35,dark);box(bx,.59,-1.9,1.45,.18,2.2,0xdfd2aa);box(bx,.72,-1.43,1.45,.14,1.25,cloth);box(bx,.76,-2.72,1.08,.22,.44,0xe9dab9);box(bx,.72,-3.0,1.65,1.1,.12,trim);
 const tx=2.55*layout;box(tx,.82,-2.6,1.8,.12,.8,wood);for(const dx of [-.73,.73])for(const dz of [-.28,.28])box(tx+dx,.38,-2.6+dz,.11,.77,.11,dark);box(tx,.98,-2.5,.58,.18,.35,0xcbbd91);box(tx,.19,-1.65,.65,.38,.65,wood);
 box(0,.035,.65,2.6,.04,2.4,cloth);box(0,.4,2.55,1.6,.8,.75,dark);box(0,.82,2.55,1.66,.12,.8,trim);box(0,.63,2.13,.18,.18,.07,0xc5a96e);
 for(const x of [-3.7,3.7]){box(x,1.8,0,.12,.4,.3,trim);box(x*.96,1.72,0,.12,.3,.13,0xeac279);const l=new PointLight(0xffc175,7,6);l.position.set(x*.91,1.76,0);scene.add(l);}
 // 保存された展示品を実際のゲーム装備リグで飾る（登録済みIDのみ）。
 const w=content.weapons.get(q.get('weapon')??''),a=content.armor.get(q.get('armor')??'');let displayName='未展示';
 if(w||a){const rig=new HunterRig();rig.setPose(emptyPose());if(w){const family=content.families.get(w.family);if(family){rig.setFamily(w.family,family.offhand,w.assetId);rig.weaponToSocket('back');}}else{rig.weapon.visible=false;rig.shield.visible=false;}if(a)rig.setArmor({[a.slot]:armorTierOf(a.assetId)});rig.root.position.set(2.55*layout,.14,.8);rig.root.rotation.y=-.45*layout;room.add(rig.root);box(2.55*layout,.07,.8,1.35,.14,1.35,trim);displayName=[w?.name,a?.name].filter(Boolean).join(' / ');}
 const camera=new PerspectiveCamera(68,1,.04,100),p=new Vector3(0,1.55,1.8),keys=new Set<string>();let yaw=0,pitch=-.08,drag:{x:number;y:number}|null=null,last=performance.now();
 const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
 const blocks=[{x:bx,z:-1.9,w:1.55,d:2.35},{x:tx,z:-2.6,w:1.8,d:.85},{x:tx,z:-1.65,w:.65,d:.65},{x:0,z:2.55,w:1.65,d:.85},...(w||a?[{x:tx,z:.8,w:1.35,d:1.35}]:[])];
 function free(x:number,z:number){return Math.abs(x)<3.65&&Math.abs(z)<3.13&&!blocks.some(b=>Math.abs(x-b.x)<b.w/2+.22&&Math.abs(z-b.z)<b.d/2+.22);}
 const down=(e:KeyboardEvent)=>{const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(k)){e.preventDefault();keys.add(k);}};
 window.addEventListener('keydown',down);window.addEventListener('keyup',e=>keys.delete(e.key.toLowerCase()));window.addEventListener('blur',()=>keys.clear());
 canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(drag){yaw-=(e.clientX-drag.x)*.005;pitch=clamp(pitch-(e.clientY-drag.y)*.005,-1.15,1.15);drag={x:e.clientX,y:e.clientY};}});canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
 panel.replaceChildren();panel.style.width='min(40vw,240px)';const header=document.createElement('h2');header.textContent='狩人の自室';const desc=document.createElement('p');desc.textContent='ドラッグで視点、WASDまたは下のボタンで移動。展示：'+displayName;panel.append(header,desc);
 const controls=document.createElement('div');controls.style.cssText='display:grid;grid-template-columns:repeat(3,1fr);gap:5px;touch-action:none;';for(const [label,key] of [['',''],['↑','w'],['',''],['←','a'],['↓','s'],['→','d']]){if(!key){controls.append(document.createElement('span'));continue;}const b=document.createElement('button');b.textContent=label;b.style.cssText='min-height:44px;font-size:20px;touch-action:none;';b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(key);});for(const name of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(name,()=>keys.delete(key));controls.append(b);}panel.append(controls);const reset=document.createElement('button');reset.textContent='入口へ戻る';reset.onclick=()=>{p.set(0,1.55,1.8);yaw=0;pitch=-.08;};panel.append(reset);const exit=document.createElement('p');exit.textContent='このタブを閉じると元のゲームへ戻れます。';panel.append(exit);
 function frame(now:number){const dt=Math.min(.05,(now-last)/1000);last=now;const forward=Number(keys.has('w')||keys.has('arrowup'))-Number(keys.has('s')||keys.has('arrowdown')),side=Number(keys.has('d')||keys.has('arrowright'))-Number(keys.has('a')||keys.has('arrowleft'));const scale=dt*2.2/Math.max(1,Math.hypot(forward,side));const dx=(Math.sin(yaw)*forward+Math.cos(yaw)*side)*scale,dz=(-Math.cos(yaw)*forward+Math.sin(yaw)*side)*scale;if(free(p.x+dx,p.z))p.x+=dx;if(free(p.x,p.z+dz))p.z+=dz;
  camera.position.copy(p);camera.lookAt(p.x+Math.sin(yaw)*Math.cos(pitch),p.y+Math.sin(pitch),p.z-Math.cos(yaw)*Math.cos(pitch));const w=canvas.clientWidth,h=canvas.clientHeight;if(w&&h&&camera.aspect!==w/h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}renderer.render(scene,camera);requestAnimationFrame(frame);}
 renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setSize(canvas.clientWidth,canvas.clientHeight,false);requestAnimationFrame(frame);
}
