// 拠点内の実操作を伴う3D区画。mainのSaveManagerを共有し、別タブや独自セーブを作らない。
import { BoxHelper, Color, FogExp2, Group, HemisphereLight, DirectionalLight, Mesh, Object3D, OrthographicCamera, PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, type Camera, type Material } from 'three';
import type { Content } from '../data/schemas';
import { FURNITURE,FURNITURE_MAX,ROOM_BOUNDS,ROOM_ENTRY,ZONES,defaultFurniture,furnitureBlocks,furnitureErrors,roomFurniture,zoneNodeNear,zoneWalkable,type FurnitureKind,type FurniturePlacement,type ZoneId } from '../data/hubEstate';
import { lifeOf } from '../data/hubLife';
import { HUB_RESOURCE_POINTS,HUB_FISH_BITE,resourceReward,resourceStatus } from '../game/hubResources';
import { craftMaterials,furnitureModel } from '../render/hubCraft';
import { buildEstateRoom,buildGatherZone,type ZoneRender } from '../render/hubEstateZones';
import { HunterRig } from '../render/rig';
import { emptyPose } from '../render/poses';
import { armorTierOf } from '../render/hunterArmor';
import type { SaveManager } from '../save/saveManager';
import type { HubSample } from '../core/hubSoundtrack';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',text=''):HTMLElementTagNameMap[K]=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text)e.textContent=text;return e;};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const label=(id:ZoneId)=>id==='home'?'狩人の自室':ZONES[id].name;
export interface EstateHost {save:SaveManager;playEstateSound?(id:HubSample,k?:number):void}
export class HubEstatePanel{
 readonly root=el('section','estate-panel');private stage=el('div','estate-stage');private canvas=el('canvas','estate-canvas');private side=el('div','estate-side');private status=el('p','estate-status');private prompt=el('button','life-button');private info=el('p','life-text');
 private scene=new Scene();private renderer:WebGLRenderer;private camera=new PerspectiveCamera(65,1,.05,95);private planCam=new OrthographicCamera(-5,5,4,-4,.1,50);
 private mats=craftMaterials();private zone:ZoneRender|null=null;private furnitureGroup=new Group();private furnitureMeshes=new Map<string,{key:string;group:Group}>();private displayRig:HunterRig|null=null;
 private furniture:FurniturePlacement[]=[];private savedRevision=0;private selected='';private edit=false;private dirty=false;private warnedClose=false;
 private pos={x:0,z:0};private yaw=0;private pitch=-.10;private keys=new Set<string>();private drag:{x:number;y:number}|null=null;
 private ray=new Raycaster();private floor=new Plane(new Vector3(0,1,0),0);private selectBox:BoxHelper|null=null;private selectEl:HTMLSelectElement|null=null;
 private controls:{x:HTMLInputElement;z:HTMLInputElement;yaw:HTMLInputElement}|null=null;private saveBtn:HTMLButtonElement|null=null;private modeBtn:HTMLButtonElement|null=null;
 private active=true;private busy=false;private last=performance.now();private time=0;private raf=0;private level=1;
 private operation:{node:string;token:string;start:number;kind:'mine'|'pond'}|null=null;
 private lastPrompt='';private lastWidth=0;private lastHeight=0;private inputListeners:Array<()=>void>=[];
 constructor(private c:Content,private h:EstateHost,readonly id:ZoneId,private close:()=>void){
  this.root.dataset.zone=id;const head=el('header','estate-head');head.append(el('h3','',label(id)),this.button('農場・自室の一覧へ',()=>this.requestClose()));
  this.stage.append(this.canvas);this.root.append(head,this.stage,this.side);this.side.append(this.status);this.status.setAttribute('role','status');
  // rendererは利用時だけ作成し、閉じると破棄する。メインのゲーム描画を停止して2重負荷を避ける。
  this.renderer=new WebGLRenderer({canvas:this.canvas,antialias:true,powerPreference:'high-performance'});this.renderer.setPixelRatio(Math.min(1.5,window.devicePixelRatio||1));
  this.renderer.setClearColor(0x70877b);this.scene.add(new HemisphereLight(0xf1e6ce,id==='mine'?0x4a443a:0x5b6b50,id==='mine'?1.12:1.8));
  const sun=new DirectionalLight(id==='mine'?0xf3ca8f:0xffe7c1,id==='mine'?.78:2.15);sun.position.set(4,9,5);this.scene.add(sun);
  this.scene.background=new Color(id==='mine'?0x282c28:id==='pond'?0x9eb5ad:0x80968a);
  this.scene.fog=new FogExp2(id==='mine'?0x343831:0xa1b4a7,id==='mine'?.037:.009);
  if(id==='home'){
   this.scene.add(buildEstateRoom(this.mats),this.furnitureGroup);this.pos={...ROOM_ENTRY};
   this.furniture=roomFurniture(lifeOf(h.save.doc)).map(x=>({...x}));this.savedRevision=h.save.doc.revision;this.selected=this.furniture[0]?.id??'';
   this.setupHome();this.syncFurniture();
  }else{
   const z=ZONES[id];this.pos={...z.spawn};this.level=lifeOf(h.save.doc).levels[id==='mine'?'mine':'fish'];this.zone=buildGatherZone(id,this.level,this.mats);this.scene.add(this.zone.group);
   if(id==='mine'){this.scene.add(new HemisphereLight(0x87795f,0x4f5047,.36));}
   this.side.append(el('p','life-text','設備Lv.'+this.level+'。奥の区画は増築で開く。採取回数と素材は里の設備と共有。'),this.info);
   this.prompt.textContent=id==='mine'?'鉱脈のそばに立つ':'釣り場のそばに立つ';this.prompt.addEventListener('click',()=>this.interact());this.side.append(this.prompt);
  }
  this.side.append(el('p','life-text','視点：画面ドラッグ。移動：矢印 / WASD / 下の方向ボタン。'));this.addMovement();this.addInput();this.h.playEstateSound?.('door',.45);
 }
 start(){this.raf=requestAnimationFrame(this.frame);}
 private button(text:string,run:()=>void){const b=el('button','life-button',text);b.type='button';b.addEventListener('click',()=>{if(this.active&&!this.busy)run();});return b;}
 private tell(text:string,bad=false){this.status.textContent=text;this.status.classList.toggle('bad',bad);}
 private requestClose(){
  if(this.busy)return;
  if(this.dirty&&!this.warnedClose){this.warnedClose=true;this.tell('未保存の家具配置があります。保存するか、もう一度戻るを押すと破棄します。',true);return;}
  this.close();
 }
 sync(){if(!this.active)return;this.updatePrompt();}
 private bind<K extends keyof WindowEventMap>(name:K,fn:(e:WindowEventMap[K])=>void){window.addEventListener(name,fn as EventListener);this.inputListeners.push(()=>window.removeEventListener(name,fn as EventListener));}
 private addInput(){
  const moveKeys=['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'];
  this.bind('keydown',e=>{if(!this.active||e.target instanceof HTMLInputElement||e.target instanceof HTMLSelectElement||e.target instanceof HTMLButtonElement)return;
   const key=e.key.toLowerCase();if(moveKeys.includes(key)){e.preventDefault();this.keys.add(key);}else if(key==='e'&&!e.repeat&&this.id!=='home'){e.preventDefault();this.interact();}
  });
  this.bind('keyup',e=>this.keys.delete(e.key.toLowerCase()));
  this.bind('blur',()=>{this.keys.clear();this.drag=null;this.operation=null;});
  this.canvas.addEventListener('pointerdown',e=>{this.canvas.setPointerCapture(e.pointerId);this.drag={x:e.clientX,y:e.clientY};if(this.edit)this.editAt(e.clientX,e.clientY);});
  this.canvas.addEventListener('pointermove',e=>{
   if(!this.drag)return;
   if(this.edit){this.editAt(e.clientX,e.clientY);return;}
   this.yaw-=.006*(e.clientX-this.drag.x);this.pitch=clamp(this.pitch-.006*(e.clientY-this.drag.y),-1.2,1.15);this.drag={x:e.clientX,y:e.clientY};
  });
  const end=()=>{this.drag=null;};this.canvas.addEventListener('pointerup',end);this.canvas.addEventListener('pointercancel',end);
 }
 private addMovement(){
  const pad=el('div','estate-move');
  for(const [txt,key] of [['',''],['↑','w'],['',''],['←','a'],['↓','s'],['→','d']] as const){
   if(!key){pad.append(el('span'));continue;}
   const b=el('button','life-button',txt);b.type='button';b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);if(!this.edit)this.keys.add(key);});
   for(const n of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(n,()=>this.keys.delete(key));pad.append(b);
  }
  this.side.append(pad,this.button('入口へ戻る',()=>{this.pos=this.id==='home'?{...ROOM_ENTRY}:{...ZONES[this.id].spawn};this.yaw=0;this.pitch=-.1;this.operation=null;}));
 }
 private setupHome(){
  this.modeBtn=this.button('家具編集モード',()=>this.setEdit(!this.edit));this.side.append(this.modeBtn);
  const editing=el('div','estate-edit');editing.hidden=true;editing.dataset.editing='';
  const select=el('select','life-select');select.addEventListener('change',()=>{this.selected=select.value;this.updateControls();this.updateSelection();});this.selectEl=select;
  editing.append(el('label','life-text','家具を選択'),select);
  const add=el('select','life-select');for(const [kind,f] of Object.entries(FURNITURE)){const o=el('option','',f.name);o.value=kind;add.append(o);}
  editing.append(add,this.button('家具を追加',()=>this.addFurniture(add.value as FurnitureKind)));
  const makeRange=(name:string,min:number,max:number,step:number)=>{
   const l=el('label','estate-range'),t=el('span','life-text',name),input=el('input');input.type='range';input.min=String(min);input.max=String(max);input.step=String(step);l.append(t,input);editing.append(l);return input;
  };
  this.controls={x:makeRange('横の位置（m）',-3.8,3.8,.025),z:makeRange('奥行き（m）',-3.25,3.25,.025),yaw:makeRange('回転（°）',0,359,1)};
  for(const k of ['x','z','yaw'] as const)this.controls[k].addEventListener('input',()=>{const p=this.selectedFurniture();if(!p)return;const v=Number(this.controls![k].value);p[k]=k==='yaw'?v*Math.PI/180:v;this.changed();});
  editing.append(this.button('材質を切替',()=>{const p=this.selectedFurniture();if(p){p.finish=((p.finish+1)%3) as 0|1|2;this.changed();}}),this.button('選択した家具を撤去',()=>{this.furniture=this.furniture.filter(p=>p.id!==this.selected);this.selected=this.furniture[0]?.id??'';this.changed();this.updateControls();}));
  this.saveBtn=this.button('家具配置を保存',()=>void this.saveFurniture());editing.append(this.saveBtn,this.button('初期配置に戻す',()=>{this.furniture=defaultFurniture(lifeOf(this.h.save.doc).roomLayout);this.selected=this.furniture[0]!.id;this.changed();this.updateControls();}),this.button('保存済みを読み直す',()=>{this.furniture=roomFurniture(lifeOf(this.h.save.doc)).map(p=>({...p}));this.selected=this.furniture[0]?.id??'';this.savedRevision=this.h.save.doc.revision;this.dirty=false;this.warnedClose=false;this.syncFurniture();this.updateControls();this.tell('保存済みの配置を読み込みました');}));
  editing.append(el('p','life-text','真上からの地図をタップ／ドラッグして移動。位置・角度の微調整、追加、撤去もできます。最大24点。壁、入口、家具の重なりを検査します。'));this.side.append(editing);this.updateControls();
 }
 private selectedFurniture(){return this.furniture.find(p=>p.id===this.selected);}
 private setEdit(on:boolean){
  if(!on){const errors=furnitureErrors(this.furniture);if(errors.length){this.tell(errors[0]!,true);return;}}
  this.edit=on;this.keys.clear();this.drag=null;this.pos={...ROOM_ENTRY};this.modeBtn!.textContent=on?'歩いて確認':'家具編集モード';
  this.side.querySelector<HTMLElement>('[data-editing]')!.hidden=!on;this.updateSelection();this.updateControls();
  this.tell(on?'家具を選んで床をタップ、またはドラッグしてください。':'室内の歩行モード。');
 }
 private updateControls(){
  if(!this.selectEl||!this.controls)return;this.selectEl.replaceChildren();
  for(const p of this.furniture){const o=el('option','',FURNITURE[p.kind].name+' ['+p.id+']');o.value=p.id;this.selectEl.append(o);}
  this.selectEl.value=this.selected;
  const p=this.selectedFurniture();if(p){this.controls.x.value=String(p.x);this.controls.z.value=String(p.z);this.controls.yaw.value=String(Math.round(p.yaw*180/Math.PI)%360);}
  for(const e of Object.values(this.controls))e.disabled=!p;
 }
 private editAt(cx:number,cy:number){
  const p=this.selectedFurniture();if(!p)return;const r=this.canvas.getBoundingClientRect();this.ray.setFromCamera(new Vector2((cx-r.left)/r.width*2-1,-(cy-r.top)/r.height*2+1),this.planCam);
  const hit=this.ray.ray.intersectPlane(this.floor,new Vector3());if(hit){p.x=Math.round(hit.x*40)/40;p.z=Math.round(hit.z*40)/40;this.changed();this.updateControls();}
 }
 private changed(){this.dirty=true;this.warnedClose=false;this.syncFurniture();const e=furnitureErrors(this.furniture);this.tell(e.length?e[0]!:'未保存の変更があります。',!!e.length);if(this.saveBtn)this.saveBtn.disabled=!!e.length;}
 private addFurniture(kind:FurnitureKind){
  if(this.furniture.length>=FURNITURE_MAX){this.tell('家具は24点までです',true);return;}
  let i=1;while(this.furniture.some(p=>p.id==='f'+i))i++;
  const p:FurniturePlacement={id:'f'+i,kind,x:0,z:0,yaw:0,finish:0};
  let found=false;for(let z=-2.5;z<=2.5&&!found;z+=.5)for(let x=-3.0;x<=3.0&&!found;x+=.5){
   p.x=x;p.z=z;if(!furnitureErrors([...this.furniture,p]).length)found=true;
  }
  if(!found){this.tell('空きがありません。他の家具を移動してください。',true);return;}
  this.furniture.push(p);this.selected=p.id;this.changed();this.updateControls();
 }
 private async saveFurniture(){
  const errors=furnitureErrors(this.furniture);if(errors.length){this.tell(errors[0]!,true);return;}
  if(this.busy)return;this.busy=true;this.tell('保存中…');
  try{const r=await this.h.save.hubLife({kind:'furniture',items:this.furniture.map(x=>({...x}))},this.savedRevision);if(!this.active)return;
   if(r.ok){this.savedRevision=this.h.save.doc.revision;this.dirty=false;this.warnedClose=false;this.tell(this.h.save.mode==='persistent'?'家具配置を保存しました':'配置を更新しました（端末保存なし）');}else this.tell(r.message,true);
  }catch(e){this.tell(String(e),true);}finally{this.busy=false;}
 }
 private updateSelection(){
  if(this.selectBox){this.selectBox.removeFromParent();this.selectBox.geometry.dispose();(this.selectBox.material as Material).dispose();this.selectBox=null;}
  const mesh=this.furnitureMeshes.get(this.selected)?.group;
  if(this.edit&&mesh){this.selectBox=new BoxHelper(mesh,0xf4c978);this.scene.add(this.selectBox);}
 }
 private syncFurniture(){
  const ids=new Set(this.furniture.map(p=>p.id));
  for(const [id,m] of this.furnitureMeshes){if(!ids.has(id)){this.disposeGeometry(m.group);m.group.removeFromParent();this.furnitureMeshes.delete(id);}}
  for(const p of this.furniture){
   const key=p.kind+':'+p.finish;let m=this.furnitureMeshes.get(p.id);
   if(m&&m.key!==key){this.disposeGeometry(m.group);m.group.removeFromParent();this.furnitureMeshes.delete(p.id);m=undefined;}
   if(!m){m={key,group:furnitureModel(p,this.mats)};this.furnitureMeshes.set(p.id,m);this.furnitureGroup.add(m.group);}
   m.group.position.set(p.x,0,p.z);m.group.rotation.y=p.yaw;
  }
  const rack=this.furniture.find(p=>p.kind==='rack');
  const doc=this.h.save.doc,st=lifeOf(doc),w=st.displayWeapon&&doc.weapons.includes(st.displayWeapon)?this.c.weapons.get(st.displayWeapon):undefined,a=st.displayArmor&&doc.armor.includes(st.displayArmor)?this.c.armor.get(st.displayArmor):undefined;
  if(rack&&(w||a)){
   if(!this.displayRig){const rig=new HunterRig();rig.setPose(emptyPose());if(w){const family=this.c.families.get(w.family);if(family){rig.setFamily(w.family,family.offhand,w.assetId);rig.weaponToSocket('back');}}else{rig.weapon.visible=false;rig.shield.visible=false;}if(a)rig.setArmor({[a.slot]:armorTierOf(a.assetId)});rig.root.scale.setScalar(.78);this.displayRig=rig;this.scene.add(rig.root);}
   this.displayRig.root.visible=true;this.displayRig.root.position.set(rack.x,.20,rack.z);this.displayRig.root.rotation.y=rack.yaw;
  }else if(this.displayRig)this.displayRig.root.visible=false;
  this.updateSelection();
 }
 private node(){return this.id==='home'?undefined:zoneNodeNear(ZONES[this.id],this.pos.x,this.pos.z,this.level);}
 private resource(){return HUB_RESOURCE_POINTS.find(p=>p.id===(this.id==='pond'?'fish':'mine'))!;}
 private updatePrompt(){
  if(this.id==='home')return;
  const p=this.resource(),st=resourceStatus(this.h.save.doc,this.c,p),near=this.node(),op=this.operation,now=performance.now();
  const timing=op&&this.id==='pond'?(now-op.start>=HUB_FISH_BITE.from*1000/60?'食いついた！ 引き上げる':'浮きを見守る'):null;
  const msg=this.busy?'保存中…':op?(this.id==='mine'?'採掘中…':timing!):near?near.name+(st.action==='gather'?(this.id==='mine'?'・採掘':'・釣り開始'):'・採取済み'):'採取点の輪に近づいてください';
  const key=msg+st.summary+this.level;
  if(key!==this.lastPrompt){this.lastPrompt=key;this.prompt.textContent=msg;this.info.textContent=st.summary+'｜設備Lv.'+this.level;this.prompt.disabled=this.busy||!near||(!!op&&this.id==='mine')||st.action!=='gather';}
 }
 private interact(){
  if(this.id==='home'||this.busy)return;const near=this.node(),p=this.resource(),st=resourceStatus(this.h.save.doc,this.c,p);
  if(!near||st.action!=='gather')return;
  const op=this.operation,now=performance.now();
  if(this.id==='pond'&&op){
   this.operation=null;
   if(op.node!==near.id||op.token!==st.token||now-op.start<HUB_FISH_BITE.from*1000/60||now-op.start>=HUB_FISH_BITE.to*1000/60){this.tell('魚が逃げました。もう一度試してください。',true);this.updatePrompt();return;}
   this.h.playEstateSound?.('fish',.7);void this.collect(op.token);return;
  }
  if(op)return;
  this.operation={node:near.id,token:st.token,start:now,kind:this.id};
  this.h.playEstateSound?.(this.id==='mine'?'mine':'fish',.7);
  this.tell(this.id==='mine'?'岩を叩いている…':'浮きを見て、食いついたら引き上げてください。');this.updatePrompt();
 }
 private async collect(token:string){
  if(this.busy)return;this.busy=true;this.updatePrompt();
  const p=this.resource(),reward=resourceReward(this.h.save.doc,this.c,p);
  try{const r=await this.h.save.useHubResource(p.id,token);if(!this.active)return;
   if(r.ok){this.h.playEstateSound?.('reward',.55);this.tell(reward?(this.c.materials.get(reward.itemId)?.name??reward.itemId)+' ×'+reward.count+'を入手':'回収しました');}
   else this.tell(r.message,true);
  }catch(e){if(this.active)this.tell(String(e),true);}finally{this.busy=false;this.updatePrompt();}
 }
 private walkable(x:number,z:number){
  if(this.id==='home')return x>ROOM_BOUNDS.minX+.25&&x<ROOM_BOUNDS.maxX-.25&&z>ROOM_BOUNDS.minZ+.25&&z<ROOM_BOUNDS.maxZ-.25&&!this.furniture.some(p=>furnitureBlocks(p,x,z,.25));
  return zoneWalkable(ZONES[this.id],x,z,this.level);
 }
 private frame=(now:number)=>{
  if(!this.active)return;this.raf=requestAnimationFrame(this.frame);
  const dt=clamp((now-this.last)/1000,0,.05);this.last=now;
  if(document.hidden||!this.root.isConnected){this.keys.clear();this.operation=null;return;}
  this.time+=dt;
  if(!this.edit&&!this.busy&&this.operation?.kind!=='mine'){
   const f=Number(this.keys.has('w')||this.keys.has('arrowup'))-Number(this.keys.has('s')||this.keys.has('arrowdown')),s=Number(this.keys.has('d')||this.keys.has('arrowright'))-Number(this.keys.has('a')||this.keys.has('arrowleft')),v=dt*2.6/Math.max(1,Math.hypot(f,s));
   const dx=(Math.sin(this.yaw)*f+Math.cos(this.yaw)*s)*v,dz=(-Math.cos(this.yaw)*f+Math.sin(this.yaw)*s)*v;
   if(this.walkable(this.pos.x+dx,this.pos.z))this.pos.x+=dx;if(this.walkable(this.pos.x,this.pos.z+dz))this.pos.z+=dz;
  }
  if(this.operation&&!this.busy){
   const op=this.operation,near=this.node();
   if(!near||near.id!==op.node){this.operation=null;this.tell('採取点から離れたため中止しました。');}
   else if(op.kind==='mine'&&now-op.start>=1200){this.operation=null;void this.collect(op.token);}
   else if(op.kind==='pond'&&now-op.start>=HUB_FISH_BITE.to*1000/60){this.operation=null;this.tell('魚が逃げました。もう一度試してください。');}
  }
  this.updatePrompt();this.zone?.update(this.time);
  const w=Math.max(1,this.canvas.clientWidth),h=Math.max(1,this.canvas.clientHeight);
  if(w!==this.lastWidth||h!==this.lastHeight){this.lastWidth=w;this.lastHeight=h;this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();const width=Math.max(4.1,3.75*w/h),height=width*h/w;this.planCam.left=-width;this.planCam.right=width;this.planCam.top=height;this.planCam.bottom=-height;this.planCam.updateProjectionMatrix();}
  let cam:Camera=this.camera;
  if(this.edit){this.planCam.position.set(0,14,0);this.planCam.up.set(0,0,-1);this.planCam.lookAt(0,0,0);this.planCam.updateMatrixWorld();cam=this.planCam;
   // 天井を置かず、真上の部屋全体を見られるようにしている。
  }else{this.camera.position.set(this.pos.x,1.56,this.pos.z);this.camera.lookAt(this.pos.x+Math.sin(this.yaw)*Math.cos(this.pitch),1.56+Math.sin(this.pitch),this.pos.z-Math.cos(this.yaw)*Math.cos(this.pitch));}
  this.renderer.render(this.scene,cam);
 };
 private disposeGeometry(root:Object3D){root.traverse(o=>{const m=o as Mesh;if(m.geometry)m.geometry.dispose();});}
 destroy(){
  if(!this.active)return;this.active=false;cancelAnimationFrame(this.raf);this.keys.clear();this.operation=null;for(const off of this.inputListeners)off();
  const geos=new Set<unknown>(),mats=new Set<Material>();this.scene.traverse(o=>{const m=o as Mesh;if(m.geometry&&!geos.has(m.geometry)){geos.add(m.geometry);m.geometry.dispose();}for(const v of Array.isArray(m.material)?m.material:m.material?[m.material]:[]){mats.add(v);}const sk=(m as unknown as {skeleton?:{dispose():void}}).skeleton;sk?.dispose();});
  for(const m of [...mats,...Object.values(this.mats)]){const x=m as unknown as {map?:{dispose():void};normalMap?:{dispose():void}};x.map?.dispose();x.normalMap?.dispose();m.dispose();}
  this.renderer.dispose();this.renderer.forceContextLoss();this.root.remove();
 }
}
