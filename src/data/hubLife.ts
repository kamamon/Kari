// 拠点生活の保存値・定数。依存の無い層。旧schema5はこの欄が無くても読める。
import { furnitureErrors, livestockErrors, type FurniturePlacement, type Livestock } from './hubEstate';
export const RESOURCE_IDS=['farm','mine','fish','insect','bone'] as const;
export type ResourceId=typeof RESOURCE_IDS[number];
export const HUB_TABS=['map','prep','farm','economy','home','research','training','hall','world'] as const;
export type HubTab=typeof HUB_TABS[number];
export const HUB_TAB_NAMES:Record<HubTab,string>={map:'里の地図',prep:'食事・温泉',farm:'農場・採集',economy:'交易・調合・探索',home:'マイハウス・装備',research:'研究所・欲しい装備',training:'訓練所',hall:'集会所・里の依頼',world:'景観・暮らし'};
export const CROPS=['mixed','leaf','fruit'] as const;
export type Crop=typeof CROPS[number];
export const DECORS=['wood','green','bronze'] as const;
export type Decor=typeof DECORS[number];
export const MEAL_IDS=['rice','fish','stew','herbal','vegetable','feast'] as const;
export type MealId=typeof MEAL_IDS[number];
export type HuntPrep={bath:boolean;meal:MealId|null};
export type EquipmentSet={weapon:string;armor:string[];pouch:Record<string,number>|null};
export type Expedition={kind:'mine'|'plant'|'insect'|'fish'|'bone';rankId:string;readyCycle:number};
export interface HubLifeState {
  version:1; levels:Record<ResourceId,number>; crop:Crop; prep:HuntPrep;
  visited:string[]; pouch:Record<string,number>|null; sets:Record<string,EquipmentSet>;
  decor:Decor; roomLayout?:'left'|'right'; furniture?:FurniturePlacement[]; livestock?:Livestock; displayWeapon:string|null; displayArmor:string|null; wish:string|null;
  expedition:Expedition|null; tradeCycle:number; festivalCycle:number; tasks:string[];
  weather:'auto'|'clear'|'rain'|'mist'|'snow'; daylight:'auto'|'morning'|'day'|'dusk'|'night';
  season:'auto'|'spring'|'summer'|'autumn'|'winter';
  training:{weapon:string;hits:number;damage:number}|null;
}
export const freshHubLife=():HubLifeState=>({version:1,levels:{farm:1,mine:1,fish:1,insect:1,bone:1},crop:'mixed',prep:{bath:false,meal:null},visited:[],pouch:null,sets:{},decor:'wood',roomLayout:'left',displayWeapon:null,displayArmor:null,wish:null,expedition:null,tradeCycle:-1,festivalCycle:-1,tasks:[],weather:'auto',daylight:'auto',season:'auto',training:null});
export const lifeOf=(d:{hubLife?:HubLifeState}):HubLifeState=>d.hubLife??freshHubLife();
export const hasPrep=(p:HuntPrep):boolean=>p.bath||p.meal!==null;
export interface PrepBonus {hp:number;stamina:number;attack:number;defense:number;poison:number}
const BONUS:Record<MealId,PrepBonus>={
  rice:{hp:20,stamina:0,attack:1,defense:1,poison:1},fish:{hp:0,stamina:25,attack:1,defense:1,poison:1},
  stew:{hp:0,stamina:0,attack:1.03,defense:1,poison:1},herbal:{hp:0,stamina:0,attack:1,defense:1,poison:1.30},
  vegetable:{hp:0,stamina:0,attack:1,defense:1.05,poison:1},feast:{hp:15,stamina:15,attack:1.02,defense:1.03,poison:1.15}
};
export const MEAL_NAMES:Record<MealId,string>={rice:'山菜の炊き込み飯',fish:'沢魚の炭火焼き',stew:'山魚と山菜の煮込み',herbal:'山草の薬膳汁',vegetable:'岩塩の温野菜',feast:'料理人の特製御膳'};
export function prepBonus(p?:HuntPrep|null):PrepBonus{
  const q=p?.meal?BONUS[p.meal]:undefined;
  return {hp:Math.min(30,(q?.hp??0)+(p?.bath?10:0)),stamina:Math.min(35,(q?.stamina??0)+(p?.bath?10:0)),attack:q?.attack??1,defense:q?.defense??1,poison:q?.poison??1};
}
export function prepText(p:HuntPrep):string{
  if(!hasPrep(p))return '温泉・食事なし';
  const b=prepBonus(p),a=[p.bath?'湯治済み':'',p.meal?MEAL_NAMES[p.meal]:'',b.hp?'体力+'+b.hp:'',b.stamina?'スタミナ+'+b.stamina:'',b.attack>1?'攻撃力+'+Math.round((b.attack-1)*100)+'%':'',b.defense>1?'防御補正+'+Math.round((b.defense-1)*100)+'%':'',b.poison>1?'毒耐性強化':''];
  return a.filter(Boolean).join(' / ')+'（次の依頼1回）';
}
const obj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const int=(v:unknown,min=0,max=9_999_999_999):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const str=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200;
const nullableStr=(v:unknown)=>v===null||str(v);
const list=(v:unknown,max:number)=>Array.isArray(v)&&v.length<=max&&v.every(str)&&new Set(v).size===v.length;
const one=(v:unknown,values:readonly string[])=>typeof v==='string'&&values.includes(v);
const pouch=(v:unknown)=>v===null||(obj(v)&&Object.keys(v).length<=128&&Object.entries(v).every(([k,n])=>str(k)&&int(n,0,9999)));
export function hubLifeShapeErrors(v:unknown):string[]{
  if(v===undefined)return [];
  if(!obj(v)||v.version!==1)return ['里の生活データの版が不正です'];
  if(!obj(v.levels)||!RESOURCE_IDS.every(k=>int((v.levels as Record<string,unknown>)[k],1,4)))return ['里の設備レベルが不正です'];
  const p=v.prep;
  if(!obj(p)||typeof p.bath!=='boolean'||!(p.meal===null||one(p.meal,MEAL_IDS)))return ['食事・温泉の記録が不正です'];
  if(v.furniture!==undefined){const errors=furnitureErrors(v.furniture);if(errors.length)return errors;}
  {const errors=livestockErrors(v.livestock);if(errors.length)return errors;}
  if(v.roomLayout!==undefined&&!one(v.roomLayout,['left','right']))return ['家具の配置が不正です'];
  if(!one(v.crop,CROPS)||!one(v.decor,DECORS)||!list(v.visited,256)||!list(v.tasks,64)||!pouch(v.pouch))return ['里の生活記録が不正です'];
  if(!obj(v.sets)||Object.entries(v.sets).some(([k,s])=>!['1','2','3'].includes(k)||!obj(s)||!str(s.weapon)||!list(s.armor,5)||!pouch(s.pouch)))return ['装備セットが不正です'];
  if(![v.displayWeapon,v.displayArmor,v.wish].every(nullableStr)||!int(v.tradeCycle,-1)||!int(v.festivalCycle,-1))return ['里の受取記録が不正です'];
  const ex=v.expedition;
  if(ex!==null&&(!obj(ex)||!one(ex.kind,['mine','plant','insect','fish','bone'])||!str(ex.rankId)||!int(ex.readyCycle)))return ['探索隊の記録が不正です'];
  const tr=v.training;
  if(tr!==null&&(!obj(tr)||!str(tr.weapon)||!int(tr.hits)||!int(tr.damage)))return ['訓練記録が不正です'];
  if(!one(v.weather,['auto','clear','rain','mist','snow'])||!one(v.daylight,['auto','morning','day','dusk','night'])||!one(v.season,['auto','spring','summer','autumn','winter']))return ['景観設定が不正です'];
  return [];
}
