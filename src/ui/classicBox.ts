// The same item box is available from the existing chest/shop/farm/life panels.
import type { Content } from '../data/schemas';
import { BOX_EXPANSION_COST, BOX_PAGE, POUCH_PAGE, boxRoom, boxView, pouchRoom, pouchSlots, carryLimit, type BoxCommand, type BoxZone, type BoxSlot } from '../save/classicBox';
import type { SaveManager, SaveResult } from '../save/saveManager';
import { MIXES, afford } from '../game/hubLife';
import { lifeOf } from '../data/hubLife';
import { iconEl } from './icons';
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',txt=''):HTMLElementTagNameMap[K]=>{const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=txt;return e;};
export class ClassicBoxPanel{
 readonly root=el('details','base-section classic-box');
 private body=el('div','classic-box-body');
 private status=el('p','classic-box-status');
 private page={box:0,pouch:0};private zone:BoxZone='box';private index=0;
 private busy=false;private swapFrom:{zone:BoxZone;index:number;revision:number}|null=null;
 private equipment=false;
 constructor(private c:Content,private save:SaveManager,private changed:()=>void){
  this.root.append(el('summary','','アイテムボックス'),this.status,this.body);
  this.status.setAttribute('role','status');
  this.root.addEventListener('toggle',()=>{if(this.root.open)this.render(this.equipment);});
 }
 private name(id:string){return this.c.items.get(id)?.name??this.c.materials.get(id)?.name??id+'（未収録）';}
 private button(txt:string,fn:()=>void,disabled=false){const b=el('button','classic-box-btn',txt);b.type='button';b.disabled=disabled||this.busy;b.onclick=()=>{if(!this.busy&&!b.disabled)fn();};return b;}
 private async run(op:()=>Promise<SaveResult>,message:string){
  if(this.busy)return;this.busy=true;this.status.textContent='保存中…';this.render(this.equipment);
  let r:SaveResult;try{r=await op();}catch(e){r={ok:false,reason:'failed',message:String(e)};}
  this.busy=false;this.status.textContent=r.ok?message:r.message;this.status.classList.toggle('bad',!r.ok);if(r.ok)this.changed();this.render(this.equipment);
 }
 private cmd(cmd:BoxCommand,label:string){const rev=this.save.doc.revision;void this.run(()=>this.save.box(cmd,rev),label);}
 private grid(zone:BoxZone,slots:BoxSlot[],size:number){
  const n=Math.ceil(slots.length/size),pane=el('section','classic-zone '+zone),nav=el('div','classic-box-nav');
  this.page[zone]=Math.max(0,Math.min(n-1,this.page[zone]));
  const page=this.page[zone],change=(v:number)=>{this.page[zone]=v;this.zone=zone;this.index=v*size;this.swapFrom=null;this.render(this.equipment);};
  nav.append(this.button('◀',()=>change((page+n-1)%n)),el('b','',(zone==='box'?'ボックス':'ポーチ')+' '+(page+1)+' / '+n),this.button('▶',()=>change((page+1)%n)));
  const grid=el('div','classic-grid');
  for(let i=page*size;i<Math.min(slots.length,(page+1)*size);i++){
   const x=slots[i],b=this.button('',()=>{this.zone=zone;this.index=i;this.render(this.equipment);});
   b.className='classic-slot'+(this.zone===zone&&this.index===i?' selected':'')+(this.swapFrom?.zone===zone&&this.swapFrom.index===i?' marked':'');
   b.dataset.zone=zone;b.dataset.index=String(i);b.setAttribute('aria-label',x?this.name(x.itemId)+' '+x.count+'個':'空き枠 '+(i+1));
   if(x){const icon=iconEl(x.itemId,'classic-icon');b.append(icon??el('span','classic-fallback',this.c.items.has(x.itemId)?'道':'材'),el('small','classic-count',String(x.count)));}
   grid.append(b);
  }
  pane.append(nav,grid);return pane;
 }
 render(equipment=false){
  this.equipment=equipment;if(!this.root.open)return;
  const d=this.save.doc,view=boxView(d),p=pouchSlots(d),slots=this.zone==='box'?view.slots:p,x=slots[this.index],pages=d.classicBox?.pages??8;
  this.body.replaceChildren();
  const top=el('div','classic-box-top');
  top.append(el('b','','収納 '+view.slots.filter(Boolean).length+' / '+view.slots.length+'　｜　ポーチ '+p.filter(Boolean).length+' / 24'),el('small','','通貨 '+d.money));
  if(view.overflow.length)top.append(el('p','classic-warning','旧データの容量超過 '+view.overflow.reduce((n,s)=>n+s.count,0)+'個。拡張・整理で順次表示されます。消去されません。'));
  this.body.append(top);
  const main=el('div','classic-box-main');main.append(this.grid('box',view.slots,BOX_PAGE),this.grid('pouch',p,POUCH_PAGE));
  const info=el('section','classic-box-info');info.append(el('h4','',x?this.name(x.itemId):'空き枠'));
  if(x){
   const it=this.c.items.get(x.itemId),m=this.c.materials.get(x.itemId);
   info.append(el('p','','選択枠 '+x.count+'個 ｜ 携帯上限 '+carryLimit(this.c,x.itemId)),el('p','',it?.summary??(m?'素材・希少度 '+(m.rarity??'—'):'この版では使えない品です。')));
   const room=this.zone==='box'?pouchRoom(d,this.c,x.itemId):boxRoom(d,x.itemId),max=Math.min(room,x.count);
   const qty=el('input','classic-qty');qty.type='number';qty.min='1';qty.max=String(x.count);qty.step='1';qty.value='1';qty.setAttribute('aria-label','移動・売却数量');qty.disabled=this.busy;
   const val=()=>Number(qty.value);
   const controls=el('div','classic-qty-row');controls.append(this.button('−',()=>qty.value=String(Math.max(1,val()-1))),qty,this.button('＋',()=>qty.value=String(Math.min(x.count,val()+1))),this.button('最大',()=>qty.value=String(max||x.count)));
   info.append(controls,this.button(this.zone==='box'?'取り出す →':'← しまう',()=>this.cmd({kind:'move',from:this.zone,index:this.index,itemId:x.itemId,count:val()},'移動しました'),max<=0));
   const price=this.c.shop.sell.find(g=>g.itemId===x.itemId)?.price??(this.c.shop.goods.find(g=>g.itemId===x.itemId)?Math.max(1,Math.floor(this.c.shop.goods.find(g=>g.itemId===x.itemId)!.price/10)):0);
   if(price)info.append(this.button('売却 '+price+' / 個',()=>{const n=val();if(Number.isInteger(n)&&n>0&&window.confirm(this.name(x.itemId)+'を'+n+'個売却しますか？'))this.cmd({kind:'sell',zone:this.zone,index:this.index,itemId:x.itemId,count:n},'売却しました');}));
  }
  const old=this.swapFrom;
  info.append(this.button(old?'この枠と入れ替える':'並び替え元に指定',()=>{if(!old){this.swapFrom={zone:this.zone,index:this.index,revision:d.revision};this.render(this.equipment);}else{this.swapFrom=null;if(old.zone===this.zone&&old.revision===d.revision)this.cmd({kind:'swap',zone:this.zone,a:old.index,b:this.index},'枠を交換しました');else this.render(this.equipment);}},!!old&&(old.zone!==this.zone||old.revision!==d.revision)));
  if(old)info.append(this.button('入れ替え取消',()=>{this.swapFrom=null;this.render(this.equipment);}));
  main.append(info);this.body.append(main);
  const actions=el('div','classic-box-actions');
  actions.append(this.button('ボックス整頓',()=>this.cmd({kind:'sort',zone:'box'},'整頓しました')),this.button('ポーチ整頓',()=>this.cmd({kind:'sort',zone:'pouch'},'整頓しました')),this.button('すべてしまう',()=>this.cmd({kind:'depositAll'},'すべてしまいました'),p.every(x=>x===null)));
  if(pages<10){const cost=BOX_EXPANSION_COST[pages-8];actions.append(this.button('収納拡張 +100枠（'+cost+'）',()=>{if(window.confirm(cost+'通貨で収納を拡張しますか？'))this.cmd({kind:'expand'},'100枠拡張しました');},d.money<cost));}
  this.body.append(actions);
  const mix=el('details','classic-mix');mix.append(el('summary','','ボックス内調合'));
  for(const m of MIXES){const row=el('div','classic-mix-row');row.append(el('span','',m.name+' ×'+m.out.count+'　'+m.cost.items.map(s=>this.name(s.itemId)+' '+(d.items[s.itemId]??0)+' / '+s.count).join('、')+'　'+m.cost.money+'通貨'),this.button('調合',()=>void this.run(()=>this.save.hubLife({kind:'mix',id:m.id},d.revision),'調合しました'),!afford(d,m.cost)));mix.append(row);}
  this.body.append(mix);
  if(equipment){
   const sets=el('details','classic-sets');sets.append(el('summary','','装備マイセット（20組）・武器／防具 '+(d.weapons.length+d.armor.length)+' / '+pages*100));
   for(let i=1;i<=20;i++){const slot=String(i),set=lifeOf(d).sets[slot],r=el('div','classic-mix-row');r.append(el('span','','セット '+slot+'　'+(set?this.c.weapons.get(set.weapon)?.name??set.weapon:'未登録')),this.button('登録',()=>void this.run(()=>this.save.hubLife({kind:'saveSet',slot},d.revision),'登録しました')),this.button('装備',()=>void this.run(()=>this.save.hubLife({kind:'applySet',slot},d.revision),'装備しました'),!set),this.button('解除',()=>void this.run(()=>this.save.hubLife({kind:'deleteSet',slot},d.revision),'解除しました'),!set));sets.append(r);}
   this.body.append(sets);
  }
 }
}
