// Classic-style persistent storage. items is the authoritative BOX total; layout is its ordered projection.
// Pouch is independent: an item is removed from items when transferred to the pouch.
import type { Content, ItemStack } from '../data/schemas';
import type { SaveDoc } from './profile';
export type BoxSlot = ItemStack | null;
export type BoxZone = 'box' | 'pouch';
export interface ClassicBox { pages: number; layout: BoxSlot[]; pouch: BoxSlot[] }
export const BOX_PAGE = 100, POUCH_PAGE = 8, POUCH_SLOTS = 24, BOX_STACK = 99;
export const BOX_EXPANSION_COST = [1000, 3000] as const;
const empty = (n:number):BoxSlot[] => Array.from({length:n},()=>null);
const clone = <T>(x:T):T => JSON.parse(JSON.stringify(x)) as T;
const valid = (n:unknown):n is number => typeof n==='number' && Number.isSafeInteger(n) && n>0;
export class BoxRuleError extends Error {}
const requireBox = (ok:unknown,message:string):void => {if(!ok)throw new BoxRuleError(message);};
export const freshClassicBox = ():ClassicBox => ({pages:8,layout:empty(800),pouch:empty(24)});
const object = (v:unknown):v is Record<string,unknown> => typeof v==='object' && v!==null && !Array.isArray(v);
export function boxShapeErrors(v:unknown):string[]{
 if(v===undefined)return [];
 if(!object(v)||![8,9,10].includes(Number(v.pages))||typeof v.pages!=='number')return ['物品箱のページ数が不正です'];
 const slots=(a:unknown,n:number,limit:number)=>Array.isArray(a)&&a.length===n&&a.every(x=>x===null||(object(x)&&typeof x.itemId==='string'&&x.itemId.length>0&&valid(x.count)&&x.count<=limit));
 if(!slots(v.layout,Number(v.pages)*BOX_PAGE,BOX_STACK)||!slots(v.pouch,POUCH_SLOTS,9999))return ['物品箱の枠が不正です'];
 const ids=(v.pouch as BoxSlot[]).flatMap(x=>x?[x.itemId]:[]);
 return new Set(ids).size===ids.length?[]:['ポーチの同じ品が重複しています'];
}
export function pouchSlots(d:SaveDoc):BoxSlot[]{return clone(d.classicBox?.pouch??empty(POUCH_SLOTS));}
export function pouchStacks(d:SaveDoc):ItemStack[]{return pouchSlots(d).filter((x):x is ItemStack=>x!==null);}
export const pouchCount=(d:SaveDoc,id:string)=>pouchStacks(d).find(x=>x.itemId===id)?.count??0;
export function carryLimit(c:Content,id:string):number{return c.items.get(id)?.carryMax??(c.materials.has(id)?99:0);}
export function sortOrder(c:Content):Map<string,number>{return new Map([...c.items.keys(),...c.materials.keys()].map((id,i)=>[id,i]));}
export function boxView(d:SaveDoc,order?:Map<string,number>):{slots:BoxSlot[];overflow:ItemStack[]}{
 const n=(d.classicBox?.pages??8)*BOX_PAGE, remaining=new Map(Object.entries(d.items).filter(([,v])=>v>0));
 const slots=empty(n);
 if(!order)for(let i=0;i<n;i++){
  const x=d.classicBox?.layout[i];if(!x)continue;
  const v=Math.min(remaining.get(x.itemId)??0,x.count,BOX_STACK);
  if(v>0){slots[i]={itemId:x.itemId,count:v};remaining.set(x.itemId,(remaining.get(x.itemId)??0)-v);}
 }
 if(!order)for(const x of slots){if(!x)continue;const v=Math.min(BOX_STACK-x.count,remaining.get(x.itemId)??0);x.count+=v;remaining.set(x.itemId,(remaining.get(x.itemId)??0)-v);}
 const ids=[...remaining.keys()];if(order)ids.sort((a,b)=>(order.get(a)??Infinity)-(order.get(b)??Infinity)||a.localeCompare(b,'ja'));
 const overflow:ItemStack[]=[];let next=0;
 for(const id of ids){let v=remaining.get(id)??0;while(v>0){while(next<n&&slots[next]!==null)next++;if(next===n)break;const k=Math.min(v,BOX_STACK);slots[next++]={itemId:id,count:k};v-=k;}if(v>0)overflow.push({itemId:id,count:v});}
 return {slots,overflow};
}
export function boxRoom(d:SaveDoc,id:string):number{
 const v=boxView(d);if(v.overflow.length)return 0;
 return v.slots.reduce((n,x)=>n+(x===null?BOX_STACK:x.itemId===id?BOX_STACK-x.count:0),0);
}
export function pouchRoom(d:SaveDoc,c:Content,id:string):number{
 const slots=pouchSlots(d),x=slots.find(v=>v?.itemId===id),limit=carryLimit(c,id);
 return Math.max(0,x?limit-x.count:slots.includes(null)?limit:0);
}
function ensure(d:SaveDoc):ClassicBox{return d.classicBox??=freshClassicBox();}
function addTotal(d:SaveDoc,id:string,delta:number){
 const n=(d.items[id]??0)+delta;requireBox(Number.isSafeInteger(n)&&n>=0&&n<=9_999_999,'収納数が不正です');
 if(n===0)delete d.items[id];else d.items[id]=n;
}
export function addPouch(d:SaveDoc,id:string,n:number,limit:number):void{
 requireBox(valid(n)&&valid(limit),'携帯できない品です');
 const p=ensure(d).pouch,x=p.find(s=>s?.itemId===id);
 if(x){requireBox(x.count+n<=limit,'携帯上限を超えます');x.count+=n;return;}
 const i=p.indexOf(null);requireBox(i>=0&&n<=limit,'ポーチが満杯、または携帯上限を超えます');p[i]={itemId:id,count:n};
}
export function removePouch(d:SaveDoc,id:string,n:number):void{
 const p=ensure(d).pouch,i=p.findIndex(s=>s?.itemId===id),x=p[i];
 requireBox(valid(n)&&x&&x.count>=n,'ポーチの品が足りません。内容を確認してください。');
 if(!x)return;x.count-=n;if(x.count===0)p[i]=null;
}
const overflowCount=(d:SaveDoc)=>boxView(d).overflow.reduce((n,x)=>n+x.count,0);
/** All persisted economy paths pass here; imported legacy overflow is preserved, never silently truncated. */
export function finishBox(before:SaveDoc,out:SaveDoc,replacing=false):void{
 const b=ensure(out),v=boxView(out),overflow=v.overflow.reduce((n,x)=>n+x.count,0);
 if(!replacing)requireBox(overflow<=overflowCount(before),'物品箱が満杯です。整理・売却・拡張してからお試しください。');
 if(!replacing)requireBox(out.weapons.length+out.armor.length<=Math.max(b.pages*BOX_PAGE,before.weapons.length+before.armor.length),'装備箱が満杯です。');
 b.layout=v.slots;
}
export type BoxCommand=
 |{kind:'move';from:BoxZone;index:number;itemId:string;count:number}
 |{kind:'swap';zone:BoxZone;a:number;b:number}
 |{kind:'sort';zone:BoxZone}
 |{kind:'depositAll'}|{kind:'expand'}
 |{kind:'buyPouch';itemId:string;count:number}
 |{kind:'sell';zone:BoxZone;index:number;itemId:string;count:number};
export function applyBox(d:SaveDoc,c:Content,cmd:BoxCommand):SaveDoc{
 const n=clone(d),b=ensure(n);b.layout=boxView(n).slots;
 switch(cmd.kind){
  case 'move':{
   const from=cmd.from==='box'?b.layout:b.pouch,x=from[cmd.index];
   requireBox(Number.isInteger(cmd.index)&&x&&x.itemId===cmd.itemId&&valid(cmd.count)&&x.count>=cmd.count,'選択した枠に品がありません。');
   if(!x)break;
   if(cmd.from==='box'){addPouch(n,x.itemId,cmd.count,carryLimit(c,x.itemId));addTotal(n,x.itemId,-cmd.count);}
   else addTotal(n,x.itemId,cmd.count);
   x.count-=cmd.count;if(!x.count)from[cmd.index]=null;break;
  }
  case 'swap':{
   const a=cmd.zone==='box'?b.layout:b.pouch;
   requireBox([cmd.a,cmd.b].every(i=>Number.isInteger(i)&&i>=0&&i<a.length),'枠が不正です');
   [a[cmd.a],a[cmd.b]]=[a[cmd.b],a[cmd.a]];break;
  }
  case 'sort':{
   const order=sortOrder(c);
   if(cmd.zone==='box')b.layout=boxView(n,order).slots;
   else{const p=b.pouch.filter((x):x is ItemStack=>x!==null).sort((a,b)=>(order.get(a.itemId)??Infinity)-(order.get(b.itemId)??Infinity)||a.itemId.localeCompare(b.itemId,'ja'));b.pouch=[...p,...empty(POUCH_SLOTS-p.length)];}
   break;
  }
  case 'depositAll':for(const x of b.pouch)if(x)addTotal(n,x.itemId,x.count);b.pouch=empty(POUCH_SLOTS);break;
  case 'expand':{
   requireBox(b.pages<10,'最大容量です');const price=BOX_EXPANSION_COST[b.pages-8];
   requireBox(n.money>=price,'通貨が足りません');n.money-=price;b.pages++;b.layout.push(...empty(BOX_PAGE));break;
  }
  case 'buyPouch':{
   const g=c.shop.goods.find(x=>x.itemId===cmd.itemId);requireBox(g&&valid(cmd.count),'購入できない品です');if(!g)break;
   const price=g.price*cmd.count;requireBox(Number.isSafeInteger(price)&&n.money>=price,'通貨が足りません');addPouch(n,cmd.itemId,cmd.count,carryLimit(c,cmd.itemId));n.money-=price;break;
  }
  case 'sell':{
   const a=cmd.zone==='box'?b.layout:b.pouch,x=a[cmd.index],g=c.shop.sell.find(q=>q.itemId===cmd.itemId),buy=c.shop.goods.find(q=>q.itemId===cmd.itemId);
   const price=g?.price??(buy?Math.max(1,Math.floor(buy.price/10)):0);
   requireBox(x&&x.itemId===cmd.itemId&&valid(cmd.count)&&cmd.count<=x.count&&price>0,'売却できません');
   if(!x)break;requireBox(n.money+price*cmd.count<=9_999_999,'通貨が満杯です');
   if(cmd.zone==='box')addTotal(n,x.itemId,-cmd.count);x.count-=cmd.count;if(!x.count)a[cmd.index]=null;n.money+=price*cmd.count;break;
  }
 }
 finishBox(d,n);return n;
}
/** Old count-selector command now performs an actual transfer, not a loadout preference. */
export function setPouchCount(d:SaveDoc,c:Content,id:string,number:number):SaveDoc{
 requireBox(Number.isInteger(number)&&number>=0&&number<=carryLimit(c,id)&&carryLimit(c,id)>0,'持ち込み数が不正です');
 const n=clone(d),current=pouchCount(n,id),delta=number-current;
 if(delta>0){requireBox((n.items[id]??0)>=delta,'ボックスの在庫が足りません');addPouch(n,id,delta,carryLimit(c,id));addTotal(n,id,-delta);}
 else if(delta<0){removePouch(n,id,-delta);addTotal(n,id,-delta);}
 finishBox(d,n);return n;
}
export function isCarriedLoot(source:string):boolean{return source==='gather'||source==='carve'||source.startsWith('carve:')||source.startsWith('severed:')||source.startsWith('field_');}
