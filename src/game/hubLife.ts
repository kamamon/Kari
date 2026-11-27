// 拠点生活: 保存済みの素材・通貨と進行だけを使い、取引はすべてSaveManager経由。
import { ARMOR_SLOTS, recipeResult, type Content, type ItemStack } from '../data/schemas';
import { CROPS, DECORS, MEAL_IDS, RESOURCE_IDS, freshHubLife, lifeOf, hasPrep, type Crop, type Decor, type HubLifeState, type HubTab, type MealId, type ResourceId, type Expedition } from '../data/hubLife';
import { cloneSave, MAX_COUNT, RuleError, wornArmor, pouchOf, playWeaponId, type SaveDoc } from '../save/profile';
import { HUB_RESOURCE_POINTS, resourceCycle, resourceRank, resourceStatus, useHubResource } from './hubResources';
import { nearestFacility } from './hub';
import { ANIMALS, furnitureErrors, type AnimalKind, type FurniturePlacement, type ZoneId } from '../data/hubEstate';
import type { V3 } from '../core/math';
import type { World } from './world';
import { pouchStacks, setPouchCount } from '../save/classicBox';

export type HubService={id:string;name:string;tab:HubTab;x:number;z:number;r:number;floor:number;detail:string;zone?:ZoneId};
export const HUB_SERVICES:readonly HubService[]=[
 {id:'dining',name:'山里の食事処',tab:'prep',x:5,z:-1,r:2.2,floor:0,detail:'食事で次の狩りを強化'},
 {id:'bath',name:'水音の湯',tab:'prep',x:2,z:-36,r:2.4,floor:-10,detail:'湯治と休憩'},
 {id:'trade',name:'山越えの交易所',tab:'economy',x:-24,z:-30,r:2,floor:-10,detail:'交易と行商人'},
 {id:'mix',name:'炉の調合工房',tab:'economy',x:-29,z:-1,r:2.1,floor:-3,detail:'道具の調合'},
 {id:'home',name:'狩人の宿・自室',tab:'home',x:-28,z:24,r:2,floor:8,detail:'装備・家具・展示'},
 {id:'research',name:'灯見の研究所',tab:'research',x:-15,z:51,r:2,floor:22,detail:'生態・肉質・狩猟記録'},
 {id:'hall',name:'灯見の集会所',tab:'hall',x:-25,z:48,r:2,floor:22,detail:'住民依頼・昇級・催し'},
 {id:'training',name:'稽古場',tab:'training',x:7,z:-12,r:2,floor:0,detail:'武器別の訓練'},
 {id:'expedition',name:'山道の探索隊詰所',tab:'economy',x:11,z:-32,r:2,floor:-10,detail:'探索隊を派遣'},
 {id:'farmdesk',name:'段々農場・管理小屋',tab:'farm',x:-20,z:33,r:1.3,floor:8,detail:'設備投資と栽培計画'},
 {id:'gallery',name:'狩人の展示室',tab:'home',x:-19,z:26,r:1.5,floor:8,detail:'装備と狩猟の記録'},
 {id:'mine_zone',name:'灰層の坑道入口',tab:'farm',x:-32,z:2,r:1.4,floor:-3,detail:'専用の坑道を歩く',zone:'mine'},
 {id:'pond_zone',name:'沢鏡の養魚池入口',tab:'farm',x:-32,z:-35,r:1.5,floor:-10,detail:'専用の養魚池を歩く',zone:'pond'},
 {id:'ranch',name:'山里の畜産場',tab:'farm',x:1,z:27.5,r:1.4,floor:8,detail:'家畜を世話する'},
];
export const serviceNear=(w:World,pos:V3):HubService|null=>nearestFacility(HUB_SERVICES,w,pos);
export interface HubDestination {id:string;name:string;x:number;z:number;floor:number;detail:string;tab?:HubTab}
export function destinations(c:Content,w:World):HubDestination[]{
 return [
 ...c.hub.facilities.map(f=>({id:'facility.'+f.id,name:f.name,x:f.x,z:f.z,floor:w.groundHeight(f.x,f.z),detail:f.summary})),
 ...HUB_RESOURCE_POINTS.map(p=>({id:'resource.'+p.id,name:p.name,x:p.x,z:p.z,floor:p.floor,detail:'採集・栽培',tab:'farm' as const})),
 ...HUB_SERVICES.map(p=>({id:'service.'+p.id,name:p.name,x:p.x,z:p.z,floor:p.floor,detail:p.detail,tab:p.tab}))
 ];
}
export function validDestinationIds(c:Content):Set<string>{return new Set([...c.hub.facilities.map(f=>'facility.'+f.id),...HUB_RESOURCE_POINTS.map(p=>'resource.'+p.id),...HUB_SERVICES.map(p=>'service.'+p.id)]);}
type Cost={money:number;items:ItemStack[]};
const stack=(itemId:string,count=1):ItemStack=>({itemId,count});
const cost=(money:number,...items:ItemStack[]):Cost=>({money,items});
const LEAF='mat.gather.flatnagi_leaf',FRUIT='mat.gather.dewbreak_fruit',IRON='mat.ore.basin_iron',STONE='mat.ore.layered_ashstone',FISH='mat.fish.streamfin',FIBER='mat.gather.threadbind_fiber',BUG='mat.equip.insect.gap_beetle_shell',BONE='mat.bone.weathered_fragment';
export const MEAL_COST:Record<MealId,Cost>={rice:cost(25,stack(LEAF)),fish:cost(30,stack(FISH)),stew:cost(50,stack(FISH),stack(LEAF)),herbal:cost(35,stack(LEAF),stack(FRUIT)),vegetable:cost(40,stack(FRUIT)),feast:cost(85,stack(LEAF),stack(FRUIT),stack(FISH))};
export const MIXES=[
 {id:'heal',name:'回復液',cost:cost(5,stack(LEAF,2)),out:stack('item.heal_tonic',2)},
 {id:'trap',name:'拘束罠',cost:cost(20,stack(IRON),stack(FIBER)),out:stack('item.bind_trap')},
 {id:'calm',name:'鎮静玉',cost:cost(12,stack(FRUIT),stack(BUG)),out:stack('item.calm_orb',2)},
 {id:'whet',name:'研磨石',cost:cost(0,stack(STONE)),out:stack('item.whetstone',2)},
];
export const VILLAGE_TASKS=[
 {id:'waterway',name:'水路の補修',text:'ロクハに鉄鉱と層灰石を届け、洗い場の水路を直す。',cost:cost(0,stack(IRON,2),stack(STONE)),reward:160},
 {id:'garden',name:'苗床を増やす',text:'里の畑へ葉と実を届ける。',cost:cost(0,stack(LEAF,3),stack(FRUIT,2)),reward:180},
 {id:'fishing',name:'水音の食卓',text:'沢魚を住民に届ける。',cost:cost(0,stack(FISH,3)),reward:220},
 {id:'lookout',name:'灯見の台の修繕',text:'骨材と鉄鉱で手すりを補修。',cost:cost(0,stack(BONE,3),stack(IRON,3)),reward:300},
 {id:'market',name:'山の交易路',text:'糸・翅鞘・鉱石を交易所へ。',cost:cost(0,stack(FIBER),stack(BUG,2),stack(IRON,2)),reward:380},
];
export function rankOrder(d:SaveDoc,c:Content):number{return c.ranks.get(resourceRank(d,c))?.order??1}
export function villageLevel(d:SaveDoc,c:Content):number{
 const s=lifeOf(d),points=Object.values(s.levels).reduce((n,x)=>n+x-1,0)+s.tasks.length*2+Math.min(6,Math.floor(resourceCycle(d,c)/3));
 return points>=18?4:points>=10?3:points>=4?2:1;
}
export function upgradeQuote(d:SaveDoc,c:Content,id:ResourceId):{level:number;cost:Cost;unlocked:boolean;condition:string}{
 const level=lifeOf(d).levels[id],next=level+1;
 const minClears=[0,0,2,6,12][next]??99999;
 return {level,cost:cost(90*level*level,stack(IRON,level),stack(level%2?BONE:STONE,level)),unlocked:level<4&&rankOrder(d,c)>=next&&resourceCycle(d,c)>=minClears,condition:level>=4?'最大レベル':(c.ranks.get('rank.'+next)?.name??'上位')+'の依頼達成・累計'+minClears+'回'};
}
export function afford(d:SaveDoc,c:Cost):boolean{return d.money>=c.money&&c.items.every(s=>(d.items[s.itemId]??0)>=s.count)}
function spend(n:SaveDoc,c:Cost):void{
 if(!afford(n,c))throw new RuleError('insufficient','素材または通貨が足りません');
 n.money-=c.money;for(const s of c.items){const v=(n.items[s.itemId]??0)-s.count;if(v===0)delete n.items[s.itemId];else n.items[s.itemId]=v;}
}
function gain(n:SaveDoc,c:Content,s:ItemStack):void{
 if(!c.materials.has(s.itemId)&&!c.items.has(s.itemId))throw new RuleError('unknown','素材が未登録です');
 if(!Number.isInteger(s.count)||s.count<1||(n.items[s.itemId]??0)+s.count>MAX_COUNT)throw new RuleError('full','これ以上は持てません');
 n.items[s.itemId]=(n.items[s.itemId]??0)+s.count;
}
export const chosenPouch=(d:SaveDoc,c:Content):ItemStack[]=>{
 if(d.classicBox)return pouchStacks(d);
 const p=lifeOf(d).pouch,all=pouchOf(d,c);
 return p===null?all:all.map(s=>({...s,count:Math.min(s.count,p[s.itemId]??0)})).filter(s=>s.count>0);
};
export function tradeOffer(d:SaveDoc,c:Content):{cost:Cost;out:ItemStack;cycle:number}|null{
 const cycle=resourceCycle(d,c),kinds=['mine','fish','insect','plant','bone'] as const;
 const t=c.fieldGathering?.tables.find(t=>t.nodeKind===kinds[cycle%kinds.length]&&t.quality==='ordinary'&&t.rankId===resourceRank(d,c));
 if(!t?.entries.length)return null;
 return {cost:cost(45*rankOrder(d,c),stack(cycle%2?LEAF:IRON)),out:stack(t.entries[0]!.itemId,2),cycle};
}
export function expeditionReward(c:Content,ex:Expedition):ItemStack|null{
 const t=c.fieldGathering?.tables.find(t=>t.nodeKind===ex.kind&&t.rankId===ex.rankId&&t.quality==='ordinary');
 return t?.entries.length?stack(t.entries[0]!.itemId,3):null;
}
export function festival(d:SaveDoc,c:Content):{cycle:number;active:boolean;kind:'fish'|'cook';cost:Cost;reward:number;name:string}{
 const n=resourceCycle(d,c),cycle=Math.floor(n/5),kind=cycle%2?'fish':'cook';
 return {cycle,active:n>=5&&n%5<2&&lifeOf(d).festivalCycle!==cycle,kind,cost:kind==='fish'?cost(0,stack(FISH,3)):cost(0,stack(LEAF,2),stack(FRUIT,2)),reward:180+40*rankOrder(d,c),name:kind==='fish'?'沢魚の釣果祭':'山菜料理祭'};
}
export type LifeCommand=
 |{kind:'visit';id:string}
 |{kind:'bath'}|{kind:'meal';id:MealId}|{kind:'consumePrep'}
 |{kind:'upgrade';id:ResourceId}|{kind:'crop';id:Crop}|{kind:'collect'}
 |{kind:'mix';id:string}|{kind:'trade'}|{kind:'dispatch';source:Expedition['kind']}|{kind:'receive'}
 |{kind:'saveSet'|'applySet'|'deleteSet';slot:string}|{kind:'pouch';itemId:string;count:number}|{kind:'autoPouch'}
 |{kind:'furniture';items:FurniturePlacement[]}|{kind:'animalBuy'|'animalFeed'|'animalCollect';id:AnimalKind}
 |{kind:'roomLayout';id:'left'|'right'}|{kind:'decor';id:Decor}|{kind:'displayWeapon'|'displayArmor';id:string|null}|{kind:'wish';id:string|null}
 |{kind:'task';id:string}|{kind:'festival';score:number}
 |{kind:'weather';id:HubLifeState['weather']}|{kind:'daylight';id:HubLifeState['daylight']}|{kind:'season';id:HubLifeState['season']}
 |{kind:'training';weapon:string;hits:number;damage:number};

function requireIt(ok:unknown,message:string):asserts ok{if(!ok)throw new RuleError('locked',message);}
export function applyHubLife(doc:SaveDoc,c:Content,cmd:LifeCommand):SaveDoc|null{
 let n=cloneSave(doc);const s=n.hubLife??=freshHubLife(),cycle=resourceCycle(doc,c);
 switch(cmd.kind){
 case 'visit': requireIt(validDestinationIds(c).has(cmd.id),'施設が見つかりません'); if(s.visited.includes(cmd.id))return null;requireIt(s.visited.length<256,'訪問記録がいっぱいです');s.visited.push(cmd.id);break;
 case 'bath':requireIt(!s.prep.bath,'すでに湯治済みです');s.prep.bath=true;break;
 case 'meal':requireIt(MEAL_IDS.includes(cmd.id)&&!s.prep.meal,'食事は次の出発まで1回です');spend(n,MEAL_COST[cmd.id]);s.prep.meal=cmd.id;break;
 case 'consumePrep':if(!hasPrep(s.prep))return null;s.prep={bath:false,meal:null};break;
 case 'upgrade':{
  requireIt(RESOURCE_IDS.includes(cmd.id),'設備が見つかりません');const q=upgradeQuote(doc,c,cmd.id);requireIt(q.unlocked,q.condition);spend(n,q.cost);s.levels[cmd.id]++;break;
 }
 case 'crop':{
  requireIt(CROPS.includes(cmd.id),'作物が見つかりません');const p=HUB_RESOURCE_POINTS.find(p=>p.id==='farm')!;
  requireIt(resourceStatus(doc,c,p).action==='sow','生育中・収穫待ちの作物は変えられません');requireIt(cmd.id!=='fruit'||s.levels.farm>=2,'段々畑Lv2で解放');s.crop=cmd.id;break;
 }
 case 'collect':{
  let used=0;
  // 釣りはタイミング操作を残す。作付け・釣りは代行しない。Lv2以上かつ訪問した設備のみ。
  for(const p of HUB_RESOURCE_POINTS){if(p.id==='fish'||s.levels[p.id as ResourceId]<2||!s.visited.includes('resource.'+p.id))continue;
   for(let i=0;i<8;i++){const st=resourceStatus(n,c,p);if(st.action!=='gather'&&st.action!=='harvest')break;n=useHubResource(n,c,p.id,st.token);used++;}
  }
  requireIt(used>0,'訪問済みLv2以上の回収可能な設備がありません');return n;
 }
 case 'mix':{const m=MIXES.find(x=>x.id===cmd.id);requireIt(m,'調合レシピがありません');spend(n,m.cost);gain(n,c,m.out);break;}
 case 'trade':{const t=tradeOffer(doc,c);requireIt(t&&s.tradeCycle!==cycle,'今の行商品は購入済みです');spend(n,t.cost);gain(n,c,t.out);s.tradeCycle=cycle;break;}
 case 'dispatch':{
  requireIt(['mine','plant','insect','fish','bone'].includes(cmd.source)&&!s.expedition,'探索隊はすでに出発中です');
  requireIt(cycle>=2,'依頼を2回達成すると派遣可能');spend(n,cost(75*rankOrder(doc,c)));
  s.expedition={kind:cmd.source,rankId:resourceRank(doc,c),readyCycle:cycle+2};break;
 }
 case 'receive':{const ex=s.expedition;requireIt(ex&&cycle>=ex.readyCycle,'探索隊はまだ帰還していません');const r=expeditionReward(c,ex);requireIt(r,'素材表がありません');gain(n,c,r);s.expedition=null;break;}
 case 'saveSet':case 'applySet':case 'deleteSet':{
  requireIt(/^(?:[1-9]|1[0-9]|20)$/.test(cmd.slot),'セット番号が不正です');
  if(cmd.kind==='saveSet'){s.sets[cmd.slot]={weapon:playWeaponId(doc,c),armor:wornArmor(doc,c).map(a=>a.id),pouch:null};break;}
  if(cmd.kind==='deleteSet'){delete s.sets[cmd.slot];break;}
  const set=s.sets[cmd.slot];requireIt(set&&doc.weapons.includes(set.weapon)&&c.weapons.has(set.weapon),'セットの武器が現在ありません');
  requireIt(set.armor.every(id=>doc.armor.includes(id)&&c.armor.has(id)),'セットの防具が現在ありません（強化済みの可能性）');
  const slots=set.armor.map(id=>c.armor.get(id)!.slot);requireIt(new Set(slots).size===slots.length&&slots.every(x=>ARMOR_SLOTS.includes(x)),'防具の部位が不正です');
  n.equippedWeaponId=set.weapon;n.equippedArmorIds=[...doc.equippedArmorIds.filter(id=>!c.armor.has(id)),...set.armor];break;
 }
 case 'pouch':return setPouchCount(doc,c,cmd.itemId,cmd.count);
 case 'autoPouch':throw new RuleError('locked','道具は物品箱からポーチに移してください。');
 case 'furniture':{const errors=furnitureErrors(cmd.items);requireIt(!errors.length,errors.join('、'));s.furniture=cmd.items.map(p=>({...p}));break;}
 case 'animalBuy':case 'animalFeed':case 'animalCollect':{
  requireIt(Object.prototype.hasOwnProperty.call(ANIMALS,cmd.id),'家畜の種類が不正です');
  const def=ANIMALS[cmd.id],stock=s.livestock??={},a=stock[cmd.id];
  if(cmd.kind==='animalBuy'){
   requireIt((a?.count??0)<3,'1種につき3頭までです');
   requireIt(a?.fedCycle==null,'世話の途中では増やせません');spend(n,cost(def.price));
   stock[cmd.id]={count:(a?.count??0)+1,fedCycle:null,lastHarvest:a?.lastHarvest??-1};
  }else if(cmd.kind==='animalFeed'){
   requireIt(a&&a.fedCycle===null&&cycle>a.lastHarvest,'今は給餌できません。回収または次の依頼を待ってください');
   spend(n,cost(0,stack(def.feed,a.count)));a.fedCycle=cycle;
  }else{
   requireIt(a&&a.fedCycle!==null&&cycle>a.fedCycle,'依頼を1回達成すると回収できます');
   gain(n,c,stack(def.product,def.yield*a.count));a.fedCycle=null;a.lastHarvest=cycle;
  }
  break;
 }
 case 'roomLayout':requireIt(['left','right'].includes(cmd.id),'家具の配置が不正です');s.roomLayout=cmd.id;delete s.furniture;break;
 case 'decor':requireIt(DECORS.includes(cmd.id),'家具の種類が不正です');s.decor=cmd.id;break;
 case 'displayWeapon':requireIt(cmd.id===null||(doc.weapons.includes(cmd.id)&&c.weapons.has(cmd.id)),'所持している武器を選んでください');s.displayWeapon=cmd.id;break;
 case 'displayArmor':requireIt(cmd.id===null||(doc.armor.includes(cmd.id)&&c.armor.has(cmd.id)),'所持している防具を選んでください');s.displayArmor=cmd.id;break;
 case 'wish':requireIt(cmd.id===null||c.recipes.has(cmd.id),'製作レシピがありません');s.wish=cmd.id;break;
 case 'task':{const t=VILLAGE_TASKS.find(t=>t.id===cmd.id);requireIt(t&&!s.tasks.includes(t.id),'依頼は完了済みです');spend(n,t.cost);n.money=Math.min(MAX_COUNT,n.money+t.reward);s.tasks.push(t.id);break;}
 case 'festival':{requireIt(Number.isInteger(cmd.score)&&cmd.score>=2&&cmd.score<=3,'3回のうち2回以上成功してください');const f=festival(doc,c);requireIt(f.active,'催しは開催期間外または受取済みです');spend(n,f.cost);n.money=Math.min(MAX_COUNT,n.money+f.reward);s.festivalCycle=f.cycle;break;}
 case 'weather':requireIt(['auto','clear','rain','mist','snow'].includes(cmd.id),'天候が不正です');s.weather=cmd.id;break;
 case 'daylight':requireIt(['auto','morning','day','dusk','night'].includes(cmd.id),'時刻が不正です');s.daylight=cmd.id;break;
 case 'season':requireIt(['auto','spring','summer','autumn','winter'].includes(cmd.id),'季節が不正です');s.season=cmd.id;break;
 case 'training':requireIt(c.weapons.has(cmd.weapon)&&Number.isSafeInteger(cmd.hits)&&cmd.hits>=0&&cmd.hits<=MAX_COUNT&&Number.isSafeInteger(cmd.damage)&&cmd.damage>=0&&cmd.damage<=MAX_COUNT,'訓練結果が不正です');s.training={weapon:cmd.weapon,hits:cmd.hits,damage:cmd.damage};break;
 }
 return n;
}
export function desiredGear(c:Content,d:SaveDoc):{name:string;missing:{itemId:string;count:number}[];money:number;questNames:string[]}|null{
 const r=lifeOf(d).wish?c.recipes.get(lifeOf(d).wish!):undefined;if(!r)return null;
 const id=recipeResult(r),missing=r.cost.items.map(s=>({itemId:s.itemId,count:Math.max(0,s.count-(d.items[s.itemId]??0))})).filter(s=>s.count>0);
 const ids=new Set(missing.map(x=>x.itemId));const names=new Set<string>();
 for(const q of c.quests.values()){
  const rankId=q.rankId;
  if(c.fieldGathering&&q.fieldId===c.fieldGathering.fieldId&&c.fieldGathering.tables.some(t=>t.rankId===rankId&&t.entries.some(e=>ids.has(e.itemId))))names.add(q.name);
  const monster=q.targetMonsterId?c.monsters.get(q.targetMonsterId):undefined,lootId=monster?.lootByRank?.[rankId]??monster?.lootId,loot=lootId?c.loot.get(lootId):undefined;
  if(loot&&[loot.carve,loot.capture,...Object.values(loot.severed??{}),...Object.values(loot.breaks??{})].some(t=>t?.table.some(x=>ids.has(x.itemId))))names.add(q.name);
 }
 return {name:c.weapons.get(id)?.name??c.armor.get(id)?.name??id,missing,money:Math.max(0,r.cost.money-d.money),questNames:[...names].slice(0,12)};
}
