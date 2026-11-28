// 里の機能を、横画面・タッチ操作で使う専用パネル。HTMLにユーザー文字列を挿入しない。
import { assetUrl } from '../core/assets';
import type { Content, ItemStack } from '../data/schemas';
import { recipeResult } from '../data/schemas';
import { HUB_TABS,HUB_TAB_NAMES,MEAL_IDS,MEAL_NAMES,RESOURCE_IDS,lifeOf,prepText,type HubTab,type HubLifeState,type ResourceId } from '../data/hubLife';
import { afford,chosenPouch,desiredGear,expeditionReward,festival,MEAL_COST,MIXES,rankOrder,tradeOffer,upgradeQuote,villageLevel,VILLAGE_TASKS,type LifeCommand,type HubDestination } from '../game/hubLife';
import { HUB_RESOURCE_POINTS,resourceCycle,resourceStatus } from '../game/hubResources';
import type { SaveManager,SaveResult } from '../save/saveManager';
import type { SaveDoc } from '../save/profile';
import { HubEstatePanel } from './hubEstate';
import { ANIMALS, type AnimalKind, type ZoneId } from '../data/hubEstate';
import { hubReports,hubThreat } from '../data/hubNarrative';
import type { HubSample } from '../core/hubSoundtrack';
import { ClassicBoxPanel } from './classicBox';

const el=<K extends keyof HTMLElementTagNameMap>(tag:K,cls='',txt=''):HTMLElementTagNameMap[K]=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e;};
const STAGES:Record<ResourceId,string[]>={farm:['小さな畑','段々畑','育苗小屋','大規模農園'],mine:['露出鉱脈','採掘坑','深層坑道','晶脈採掘所'],fish:['川岸','釣り桟橋','養魚池','大型釣り堀'],insect:['草むら','昆虫樹','飼育場','希少昆虫園'],bone:['骨置き場','発掘場','化石層','深層発掘場']};
const KIND_NAMES={mine:'鉱石',plant:'植物',insect:'昆虫',fish:'魚',bone:'骨'};
const FLOOR_NAMES:Record<number,string>={'-10':'水音の庭','-3':'炉の段',0:'灯の広場',8:'暮らしの段',22:'灯見の台'};
const DRILLS:Record<string,string>={heavy_blade:'溜め斬り・抜刀斬り・回避後の納刀',guard_blade:'短い連撃・盾での防御・差し込み',long_lance:'上中段突き・防御・ステップ',ring_bow:'溜め段階・射撃・ビン切替',war_maul:'溜め移動・頭部への一撃',twin_blades:'猛り・連ね斬り・スタミナ管理',long_blade:'気の管理・気合い斬り連係',hunting_horn:'左右の振り・演奏の音の並び・旋律の維持',gunlance:'突きと砲撃・装填・構えからの大砲撃',light_bowgun:'狙い・装填・弾の選び直し・速射',heavy_bowgun:'狙い・据え構えの一発・装填の間合い'};
export interface HubLifeHost {
 save:SaveManager; hubWalk:boolean;
 lifeDestinations():HubDestination[]; lifePosition():{x:number;y:number;z:number}|null;
 lifeTravel(id:string):void; openLooks():void; startTraining():void; saveChanged():void; openStory(sceneIds:string[]):void; playEstateSound?(id:HubSample,k?:number):void;
}
export class HubLifePanel {
 readonly root=el('div','hub-life');
 private tabs=el('nav','life-tabs');private body=el('div','life-body');private notice=el('p','life-notice');
 private estate:HubEstatePanel|null=null;
 private classicBox:ClassicBoxPanel;
 get estateActive():boolean{return !!this.estate;}
 closeEstate(){if(!this.estate)return;this.estate.destroy();this.estate=null;this.root.classList.remove('life-estate-open');this.tabs.hidden=false;this.body.hidden=false;this.notice.hidden=false;}
 openEstate(id:ZoneId){
  this.closeEstate();
  try{const p=new HubEstatePanel(this.c,this.h,id,()=>{this.closeEstate();this.refresh();});this.estate=p;this.root.classList.add('life-estate-open');this.tabs.hidden=true;this.body.hidden=true;this.notice.hidden=true;this.root.append(p.root);p.start();}
  catch(e){this.closeEstate();this.notice.textContent='3D区画を開けませんでした。ブラウザの3D描画を確認してください。'+String(e);this.notice.classList.add('bad');}
 }
 private tab:HubTab='map'; private busy=false; private search='';private researchSearch='';
 constructor(private c:Content,private h:HubLifeHost){
   this.classicBox=new ClassicBoxPanel(c,h.save,()=>h.saveChanged());
   this.root.dataset.sec='life';this.root.hidden=true;this.notice.setAttribute('role','status');this.root.append(this.tabs,this.notice,this.body);
 }
 open(tab:HubTab){this.closeEstate();this.tab=tab;this.notice.textContent='';this.refresh();}
 refresh(){
   if(this.root.hidden)return;
   if(this.estate){this.estate.sync();return;}
   const scroll=this.body.scrollTop;this.tabs.replaceChildren();this.body.replaceChildren();
   for(const t of HUB_TABS){const b=this.button(HUB_TAB_NAMES[t],()=>{this.tab=t;this.notice.textContent='';this.body.scrollTop=0;this.refresh();},this.busy);b.classList.toggle('on',this.tab===t);this.tabs.appendChild(b);}
   const d=this.h.save.doc,s=lifeOf(d);
   const top=el('p','life-summary','里 Lv.'+villageLevel(d,this.c)+'　｜　通貨 '+d.money.toLocaleString()+'　｜　'+resourceCycle(d,this.c)+'回達成');
   this.body.appendChild(top);
   if(this.h.save.mode!=='persistent')this.body.appendChild(el('p','life-warn','この環境は端末への永続保存ができません。'));
   switch(this.tab){
    case 'map':this.map(d,s);break;case 'prep':this.prep(d,s);break;case 'farm':this.farm(d,s);break;case 'economy':this.economy(d,s);break;
    case 'home':this.home(d,s);break;case 'research':this.research(d,s);break;case 'training':this.training(d,s);break;case 'hall':this.hall(d,s);break;case 'world':this.world(s);break;
   }
   if(['home','farm','economy','hall'].includes(this.tab)){this.body.append(this.classicBox.root);this.classicBox.render(false);}
   this.body.scrollTop=scroll;
 }
 private button(txt:string,fn:()=>void,disabled=false){const b=el('button','life-button',txt);b.type='button';b.disabled=disabled;b.addEventListener('click',()=>{if(!this.busy&&!b.disabled)fn();});return b;}
 private cmd(txt:string,command:LifeCommand,disabled=false){return this.button(txt,()=>void this.run(command),disabled||this.busy);}
 private async run(command:LifeCommand){
   if(this.busy)return;this.busy=true;this.notice.textContent='保存中…';this.refresh();
   let r:SaveResult;
   try{r=await this.h.save.hubLife(command,this.h.save.doc.revision);}
   catch(e){r={ok:false,reason:'failed',message:String(e)};}
   this.busy=false;this.notice.textContent=r.ok?(this.h.save.mode==='persistent'?'変更を保存しました':'変更しました（端末保存なし）'):r.message;this.notice.classList.toggle('bad',!r.ok);
   if(r.ok&&command.kind==='applySet')this.h.saveChanged();
   if(r.ok&&command.kind==='animalFeed')this.h.playEstateSound?.('feed',.55);
   if(r.ok&&command.kind==='animalCollect')this.h.playEstateSound?.('reward',.6);
   this.refresh();
 }
 private name(id:string){return this.c.materials.get(id)?.name??this.c.items.get(id)?.name??this.c.weapons.get(id)?.name??this.c.armor.get(id)?.name??id;}
 private quote(c:{money:number;items:ItemStack[]},d:SaveDoc){return [c.money?'通貨 '+c.money:'',...c.items.map(x=>this.name(x.itemId)+' '+(d.items[x.itemId]??0)+' / '+x.count)].filter(Boolean).join('　')||'無料';}
 private section(title:string,desc=''){const s=el('section','life-section');s.appendChild(el('h3','',title));if(desc)s.appendChild(el('p','life-text',desc));this.body.appendChild(s);return s;}
 private row(s:HTMLElement,title:string,desc:string,...controls:HTMLElement[]){const r=el('div','life-row'),tx=el('div','life-row-text');tx.append(el('b','',title),el('small','',desc));const a=el('div','life-actions');a.append(...controls);r.append(tx,a);s.appendChild(r);return r;}
 private select<T extends string>(items:readonly {id:T;name:string}[],selected:T,fn:(id:T)=>void){const e=el('select','life-select');for(const i of items){const o=el('option','',i.name);o.value=i.id;e.append(o);}e.value=selected;e.disabled=this.busy;e.addEventListener('change',()=>fn(e.value as T));return e;}
 private map(d:SaveDoc,s:HubLifeState){
   const dst=this.h.lifeDestinations(),p=this.h.lifePosition(),a=this.section('五段の里・施設案内','現在地と施設。訪問した場所へ移動できます。未訪問の場所へは歩いて向かってください。');
   const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 330 380');svg.setAttribute('role','img');svg.setAttribute('aria-label','拠点の平面地図、上が+Z');svg.classList.add('life-map');
   const point=(x:number,z:number)=>[28+(x+46)/70*274,20+(62-z)/106*340] as const;
   const zone=(x0:number,z0:number,x1:number,z1:number,col:string,label:string)=>{const [x,y]=point(x0,z1),[xx,yy]=point(x1,z0),r=document.createElementNS(ns,'rect');for(const [k,v] of Object.entries({x,y,width:xx-x,height:yy-y,fill:col,stroke:'#ac9471','stroke-width':'.8'}))r.setAttribute(k,String(v));svg.append(r);const t=document.createElementNS(ns,'text');t.setAttribute('x',String(x+4));t.setAttribute('y',String(y+12));t.setAttribute('fill','#f0dfbf');t.setAttribute('font-size','10');t.textContent=label;svg.append(t);};
   zone(-42,-44,24,-17,'#384e4d','水音 -10m');zone(-40,-17,-23.7,15,'#73563d','炉 -3m');zone(-23.7,-17,24,17,'#67654d','広場 0m');zone(-42,17,24,40,'#506145','暮らし +8m');zone(-42,40,24,62,'#464d59','灯見 +22m');
   dst.forEach((f,i)=>{const [x,y]=point(f.x,f.z),g=document.createElementNS(ns,'g'),circle=document.createElementNS(ns,'circle'),label=document.createElementNS(ns,'text');circle.setAttribute('cx',String(x));circle.setAttribute('cy',String(y));circle.setAttribute('r','5.7');circle.setAttribute('fill',s.visited.includes(f.id)?'#f4b66b':f.id.startsWith('resource.')?'#85bc96':'#d8d4c2');label.setAttribute('x',String(x));label.setAttribute('y',String(y+2.6));label.setAttribute('text-anchor','middle');label.setAttribute('font-size','7');label.setAttribute('fill','#252d28');label.textContent=String(i+1);g.append(circle,label);svg.append(g);});
   if(p){const [x,y]=point(p.x,p.z),m=document.createElementNS(ns,'circle');m.setAttribute('cx',String(x));m.setAttribute('cy',String(y));m.setAttribute('r','8');m.setAttribute('stroke','#fff');m.setAttribute('stroke-width','2');m.setAttribute('fill','#4c9ce2');svg.append(m);a.appendChild(el('p','life-text','現在の高さ '+p.y.toFixed(1)+'m（青点）'));}
   a.appendChild(svg);
   for(const [i,f] of dst.entries()){const visited=s.visited.includes(f.id),r=this.row(a,(i+1)+'. '+f.name,(FLOOR_NAMES[f.floor]??'高さ'+f.floor+'m')+'｜'+f.detail,this.button(visited?'移動':'未訪問',()=>this.h.lifeTravel(f.id),!visited||!this.h.hubWalk||!p));if(f.id.startsWith('resource.')){const q=HUB_RESOURCE_POINTS.find(q=>'resource.'+q.id===f.id);if(q)r.appendChild(el('p','life-text',resourceStatus(d,this.c,q).summary));}}
 }
 private prep(d:SaveDoc,s:HubLifeState){
   const a=this.section('湯治と食事','強化は次の依頼1回限り。食事1品と温泉は併用可。');
   a.appendChild(el('p','life-highlight',prepText(s.prep)));
   this.row(a,'水音の湯','最大体力+10・最大スタミナ+10。無料で1回。',this.cmd(s.prep.bath?'入浴済み':'温泉に入る',{kind:'bath'},s.prep.bath));
   const effect=['最大体力+20','最大スタミナ+25','物理攻撃+3%','毒の発症閾値+30%','受けるダメージ軽減（防御補正+5%）','体力+15、スタミナ+15、攻撃+2%、防御補正+3%、毒耐性+15%'];
   for(const [i,id] of MEAL_IDS.entries())this.row(a,MEAL_NAMES[id],effect[i]+'｜'+this.quote(MEAL_COST[id],d),this.cmd(s.prep.meal===id?'食事済み':'注文する',{kind:'meal',id},!!s.prep.meal||!afford(d,MEAL_COST[id])));
 }
 private farm(d:SaveDoc,s:HubLifeState){
   const a=this.section('農場と採集施設','設備Lvは進行・通貨・素材で上げます。高レア素材の抽選率は据え置き。釣りは現地で行います。');
   for(const p of HUB_RESOURCE_POINTS){const id=p.id as ResourceId,q=upgradeQuote(d,this.c,id),st=resourceStatus(d,this.c,p);
    this.row(a,p.name+' Lv.'+q.level+'｜'+STAGES[id][q.level-1],st.summary+'｜'+(q.level===4?'最大レベル':q.condition+' / '+this.quote(q.cost,d)),this.cmd('設備を増築',{kind:'upgrade',id},!q.unlocked||!afford(d,q.cost)));
   }
   const entrances=this.section('専用採集区画','里の採集回数を共有します。設備Lvに応じて奥まで歩けます。');
   this.row(entrances,'灰層の坑道','露出鉱脈・支坑・深層の晶脈へ歩いて採掘',this.button('坑道へ入る',()=>this.openEstate('mine')));
   this.row(entrances,'沢鏡の養魚池','岸・桟橋・いけすからタイミング操作で釣る',this.button('養魚池へ入る',()=>this.openEstate('pond')));
   this.animals(d,s);
   const farm=HUB_RESOURCE_POINTS[0]!,st=resourceStatus(d,this.c,farm);
   const crop=this.select([{id:'mixed',name:'混植（抽選）'},{id:'leaf',name:'葉物'},{id:'fruit',name:'果樹（Lv2）'}] as const,s.crop,id=>void this.run({kind:'crop',id}));crop.disabled=this.busy||st.action!=='sow';
   this.row(a,'栽培品種','作付け前に選択。希少種は混植で抽選。',crop);
   const ready=HUB_RESOURCE_POINTS.some(p=>p.id!=='fish'&&s.levels[p.id as ResourceId]>=2&&s.visited.includes('resource.'+p.id)&&['gather','harvest'].includes(resourceStatus(d,this.c,p).action));
   this.row(a,'一括回収','訪問済みLv2以上・準備できた設備のみ。釣りと作付けを除く。',this.cmd('回収する',{kind:'collect'},!ready));
 }
 private animals(d:SaveDoc,s:HubLifeState){
   const a=this.section('里の家畜','暮らしの段に家畜を飼う。給餌の後に依頼を1回達成すると生産物を回収。狩りをしなくても動物は傷つかない。');
   const cycle=resourceCycle(d,this.c);
   for(const [key,def] of Object.entries(ANIMALS)){
    const id=key as AnimalKind,o=s.livestock?.[id],count=o?.count??0;
    const feed=!!o&&o.fedCycle===null&&cycle>o.lastHarvest&&(d.items[def.feed]??0)>=count,ready=!!o&&o.fedCycle!==null&&cycle>o.fedCycle;
    this.row(a,def.name+' '+count+'/3頭',def.description+'｜'+(o?.fedCycle!=null?(ready?'回収可能':'世話中・依頼を1回達成'):'餌：'+this.name(def.feed)+' '+count+'個')+'｜'+this.name(def.product)+' ×'+def.yield*count,
      this.cmd('飼う（'+def.price+'）',{kind:'animalBuy',id},count>=3||o?.fedCycle!=null||d.money<def.price),this.cmd('餌を与える',{kind:'animalFeed',id},!feed),this.cmd('回収',{kind:'animalCollect',id},!ready));
   }
 }
 private economy(d:SaveDoc,s:HubLifeState){
   const a=this.section('行商人・交易所','依頼達成ごとに商品が入れ替わる。入手済みの級の通常素材のみ。');
   const offer=tradeOffer(d,this.c);
   if(offer)this.row(a,this.name(offer.out.itemId)+' ×'+offer.out.count,this.quote(offer.cost,d),this.cmd(s.tradeCycle===offer.cycle?'購入済み':'交換する',{kind:'trade'},s.tradeCycle===offer.cycle||!afford(d,offer.cost)));
   const b=this.section('調合工房','採集素材から持ち込み道具を作る。');
   for(const m of MIXES)this.row(b,m.name+' ×'+m.out.count,this.quote(m.cost,d),this.cmd('調合する',{kind:'mix',id:m.id},!afford(d,m.cost)));
   const x=this.section('山道の探索隊','依頼2回で帰還。通常素材3個。派遣中は追加派遣できません。');
   if(s.expedition){const e=s.expedition,r=expeditionReward(this.c,e),left=Math.max(0,e.readyCycle-resourceCycle(d,this.c));this.row(x,KIND_NAMES[e.kind]+'の探索隊',left?'あと'+left+'回の依頼達成で帰還':(r?this.name(r.itemId)+' ×'+r.count:'受取可能'),this.cmd('報酬を受取',{kind:'receive'},left>0));}
   else for(const k of ['mine','plant','insect','fish','bone'] as const)this.row(x,KIND_NAMES[k]+'の探索','通貨 '+75*rankOrder(d,this.c),this.cmd('派遣する',{kind:'dispatch',source:k},resourceCycle(d,this.c)<2||d.money<75*rankOrder(d,this.c)));
 }
 private preview(id:string):HTMLAnchorElement{
   const a=el('a','life-button','3Dで見る'),w=this.c.weapons.get(id),arm=this.c.armor.get(id);
   const q=new URLSearchParams({bones:'0',shapes:'0',stance:'idle',yaw:'0.5'});if(w)q.set('previewWeapon',id);if(arm)q.set('previewArmor',id);
   a.href=assetUrl('viewer.html')+'?'+q.toString();a.target='_blank';a.rel='noopener';return a;
 }
 private home(d:SaveDoc,s:HubLifeState){
   const a=this.section('狩人の自室','部屋の家具と展示を選択。外見編集と3D装備閲覧もここから。');
   const room=el('div','life-room '+s.decor+' layout-'+(s.roomLayout??'left'));
   room.append(el('span','room-window','灯継ぎの里'),el('span','room-bed','寝台'),el('span','room-chest','装備箱'),el('span','room-shelf',s.displayArmor?this.name(s.displayArmor):'防具展示'),el('span','room-rack',s.displayWeapon?this.name(s.displayWeapon):'武器展示'));a.append(room);
   this.row(a,'家具の調度','木・緑・青銅の3種を無料で切替',this.select([{id:'wood',name:'木の調度'},{id:'green',name:'緑の帆布'},{id:'bronze',name:'青銅の調度'}] as const,s.decor,id=>void this.run({kind:'decor',id})));
   this.row(a,'家具を自由に配置','12種・最大24点。任意の位置・回転・材質・撤去と保存。室内の歩行と展示を確認できます。',this.button('自室に入る・家具を編集',()=>this.openEstate('home')));
   const weaponIds=d.weapons.filter(id=>this.c.weapons.has(id)),armorIds=d.armor.filter(id=>this.c.armor.has(id));
   const selectDisplay=(kind:'displayWeapon'|'displayArmor',ids:string[],value:string|null)=>this.select([{id:'',name:'展示しない'},...ids.map(id=>({id,name:this.name(id)}))],value&&ids.includes(value)?value:'',id=>void this.run({kind,id:id||null}));
   this.row(a,'武器の展示','所持品から選択',selectDisplay('displayWeapon',weaponIds,s.displayWeapon),...(s.displayWeapon&&weaponIds.includes(s.displayWeapon)?[this.preview(s.displayWeapon)]:[]));
   this.row(a,'防具の展示','所持品から選択',selectDisplay('displayArmor',armorIds,s.displayArmor),...(s.displayArmor&&armorIds.includes(s.displayArmor)?[this.preview(s.displayArmor)]:[]));
   this.row(a,'外見の変更','既存のキャラメイクを開く',this.button('外見を変える',()=>this.h.openLooks()));
   const sets=this.section('装備セット','武器・防具を20組保存。ポーチは装備セットとは独立。装備を強化して元の品が無くなった場合は再登録。');
   for(const slot of Array.from({length:20},(_,i)=>String(i+1))){const set=s.sets[slot];this.row(sets,'セット '+slot,set?this.name(set.weapon)+' / '+set.armor.length+'部位':'未登録',this.cmd('現在の装備を登録',{kind:'saveSet',slot}),this.cmd('装備する',{kind:'applySet',slot},!set),this.cmd('解除',{kind:'deleteSet',slot},!set));}
   const g=this.section('装備展示目録',weaponIds.length+'武器・'+armorIds.length+'防具を所持。');
   for(const id of [...weaponIds,...armorIds].slice(0,30))this.row(g,this.name(id),'所持装備',this.preview(id));
 }
 private research(d:SaveDoc,s:HubLifeState){
   const a=this.section('欲しい装備','レシピをお気に入りにすると不足素材と入手候補を確認できます。');
   const wish=desiredGear(this.c,d);
   if(wish){this.row(a,wish.name,wish.missing.length?wish.missing.map(m=>this.name(m.itemId)+' ×'+m.count).join('、')+' / 不足通貨 '+wish.money:'素材が揃っています（級・前装備は工房で確認）',this.cmd('登録解除',{kind:'wish',id:null}));if(wish.questNames.length)a.append(el('p','life-text','入手候補：'+wish.questNames.join('、')));}
   const input=el('input','life-search');input.placeholder='武器・防具名で検索';input.value=this.search;const searchBtn=this.button('検索',()=>{this.search=input.value;this.refresh();});a.append(input,searchBtn);
   const query=this.search.trim().toLowerCase();
   const recipes=[...this.c.recipes.values()].filter(r=>!query||this.name(recipeResult(r)).toLowerCase().includes(query)).slice(0,24);
   for(const r of recipes){const id=recipeResult(r);this.row(a,this.name(id),this.quote(r.cost,d),this.cmd(s.wish===r.id?'登録済み':'欲しい装備に登録',{kind:'wish',id:r.id},s.wish===r.id),this.preview(id));}
   const book=this.section('モンスター研究所','実装済みモンスターのデータ。討伐・捕獲の区別は旧セーブにないため依頼達成数で表示。');
   const ri=el('input','life-search');ri.placeholder='モンスター名を検索';ri.value=this.researchSearch;book.append(ri,this.button('検索',()=>{this.researchSearch=ri.value;this.refresh();}));
   for(const m of [...this.c.monsters.values()].filter(m=>!this.researchSearch||m.name.includes(this.researchSearch)).slice(0,32)){
    const qs=[...this.c.quests.values()].filter(q=>q.targetMonsterId===m.id||q.targets?.some(t=>t.monsterId===m.id)),clears=qs.reduce((n,q)=>n+(d.progress.questClears[q.id]??0),0);
    const f=el('details','life-monster');f.appendChild(el('summary','',m.name+'｜依頼達成 '+clears+'回'));
    f.append(el('p','life-text','基礎体力 '+m.hp+' / 弱点 '+(m.weak?.join('・')??'なし')+' / 捕獲 '+(m.captureAllowed?'可能':'不可')));
    for(const p of m.parts)f.appendChild(el('p','life-text',p.name+'：'+Object.entries(p.hitzone).map(([k,v])=>k+' '+v).join(' / ')+'｜属性係数 '+p.elementZone));
    book.append(f);
   }
   const b=this.section('生態登録簿','未実装の種は計画として区別。既存の図鑑で原画を閲覧できます。');
   b.appendChild(el('p','life-text','登録 '+this.c.bestiary.species.length+'種 / 実装 '+this.c.monsters.size+'体の定義'));
 }
 private training(d:SaveDoc,s:HubLifeState){
   const a=this.section('武器別の稽古','現在の武器で既存訓練場へ出る。帰還時に命中回数と合計ダメージを記録。');
   const w=this.c.weapons.get(d.equippedWeaponId);
   this.row(a,w?.name??'装備中の武器',DRILLS[w?.family??'']??'攻撃・回避・納刀を確認',this.button('訓練場へ',()=>this.h.startTraining()));
   if(s.training)this.row(a,'前回の稽古',this.name(s.training.weapon)+' / 命中 '+s.training.hits+'回 / 合計ダメージ '+s.training.damage);
   for(const [id,task] of Object.entries(DRILLS))this.row(a,this.c.families.get(id)?.name??id,task);
 }
 private hall(d:SaveDoc,s:HubLifeState){
   const a=this.section('里の発展と集会所','設備投資、依頼達成、住民への納品で発展します。');
   const lv=villageLevel(d,this.c),rank=this.c.ranks.get('rank.'+rankOrder(d,this.c));
   a.append(el('p','life-highlight','里 Lv.'+lv+'｜'+(rank?.name??'初級')+'の狩人'),el('p','life-text',lv>=4?'全盛の里：四方に灯と旗が満ちる':lv>=3?'繁栄の里：交易と灯の広場が活気づく':lv===2?'復興の里：資材と飾りが増える':'小さな山里：設備の拡張と住民依頼を進めよう'));
   for(const t of VILLAGE_TASKS)this.row(a,t.name,t.text+'｜'+this.quote(t.cost,d)+' → 報酬 '+t.reward,this.cmd(s.tasks.includes(t.id)?'修繕完了':'納品する',{kind:'task',id:t.id},s.tasks.includes(t.id)||!afford(d,t.cost)));
   const story=this.section('高地の観測記録','鳴天竜オルゼリオンと里の見張り。実在する依頼の成功保存に連動し、未実装の決戦は達成扱いにしない。');
   const reports=hubReports(this.c,d.progress.questClears);
   if(!reports.length)story.append(el('p','life-text','最初のガルドロスの依頼を達成すると新しい報告が届きます。'));
   for(const report of reports)this.row(story,report.title,report.summary,this.button('報告を読む',()=>this.h.openStory([report.id])));
   const f=festival(d,this.c),b=this.section('里の催し','依頼達成5回ごとに2回分の開催期間。素材を持ち寄る季節の催し。');
   this.row(b,f.name,f.active?this.quote(f.cost,d)+' → 報酬 '+f.reward:'現在は開催期間外または受取済み',this.button('競技に参加',()=>this.festivalGame(b,f),!f.active||!afford(d,f.cost)));
 }
 private festivalGame(section:HTMLElement,f:ReturnType<typeof festival>){
   if(section.querySelector('.life-contest'))return;
   const game=el('div','life-contest');game.append(el('h4','',f.kind==='fish'?'釣果祭・合わせの腕試し':'料理祭・火加減の腕試し'),el('p','life-text','目印が緑の範囲に来たら押してください。3回中2回以上成功で納品・報酬受取。'));
   const meter=el('div','life-timing'),target=el('span','life-timing-target'),needle=el('span','life-timing-needle'),result=el('p','life-text','準備完了');meter.append(target,needle);
   let attempts=0,score=0,start=performance.now(),center=.35,done=false;
   const setTarget=()=>{center=[.35,.68,.48][attempts]??.5;target.style.left=(center-.11)*100+'%';target.style.width='22%';};
   const read=()=>{const phase=((performance.now()-start)/((f.kind==='fish'?1700:2100)-attempts*150))%2;return phase<=1?phase:2-phase;};
   const tick=()=>{if(done||!game.isConnected||this.root.hidden||this.root.closest<HTMLElement>('#base')?.hidden)return;needle.style.left=(read()*100)+'%';requestAnimationFrame(tick);};
   const tap=this.button(f.kind==='fish'?'合わせる':'火を止める',()=>{if(done)return;if(Math.abs(read()-center)<=.11)score++;attempts++;result.textContent=attempts+'/3回　成功 '+score+'回';if(attempts===3){done=true;tap.disabled=true;result.textContent+='｜'+(score>=2?'合格':'惜しい！再挑戦できます');if(score>=2)game.append(this.cmd('納品して報酬を受け取る',{kind:'festival',score}));else game.append(this.button('再挑戦',()=>{game.remove();this.festivalGame(section,f);}));}else{start=performance.now();setTarget();}});
   game.append(meter,result,tap);section.append(game);setTarget();requestAnimationFrame(tick);
 }
 private world(s:HubLifeState){
   const a=this.section('山里の景観','自動設定では経過時間・狩猟実績で景観が変わる。自由な固定も可能。施設の営業時間による制限はありません。');
   this.row(a,'時刻','空・光・灯の見え方',this.select([{id:'auto',name:'自動'},{id:'morning',name:'朝'},{id:'day',name:'昼'},{id:'dusk',name:'夕方'},{id:'night',name:'夜'}] as const,s.daylight,id=>void this.run({kind:'daylight',id})));
   this.row(a,'天候','雨・霧・雪の演出',this.select([{id:'auto',name:'自動'},{id:'clear',name:'晴れ'},{id:'rain',name:'雨'},{id:'mist',name:'霧'},{id:'snow',name:'雪'}] as const,s.weather,id=>void this.run({kind:'weather',id})));
   this.row(a,'季節','樹木と景色の色調',this.select([{id:'auto',name:'自動'},{id:'spring',name:'新緑'},{id:'summer',name:'夏'},{id:'autumn',name:'紅葉'},{id:'winter',name:'冬'}] as const,s.season,id=>void this.run({kind:'season',id})));
 }
}
