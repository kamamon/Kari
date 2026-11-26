// 個体差は狩猟seedから決まり、フレームレートや抽選順序から独立する。
import type {V3} from '../core/math';
import type {MonsterDef} from '../data/schemas';
export function individualScale(seed:number,id:string):number{
 let h=seed>>>0;for(const c of id){h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;}return (92+(h%21))/100;
}
export function sizeMonster(def:MonsterDef,scale:number):MonsterDef{
 if(scale===1)return def;const size=(n:number)=>n*scale;
 return {...def,bodyRadius:size(def.bodyRadius),collision:def.collision?.map(c=>({z:size(c.z),r:size(c.r)})),approach:def.approach?{...def.approach,stopDist:size(def.approach.stopDist)}:undefined,ai:{...def.ai,choices:def.ai.choices.map(c=>({...c,minDist:size(c.minDist),maxDist:size(c.maxDist),...(c.clearAhead===undefined?{}:{clearAhead:size(c.clearAhead)})}))}};
}
export function scalePoint(p:V3,origin:V3,s:number):V3{return {x:origin.x+(p.x-origin.x)*s,y:origin.y+(p.y-origin.y)*s,z:origin.z+(p.z-origin.z)*s}}
/** 既存の低空滑翔・跳躍技について、接地していない区間だけを明示する。新種の長時間飛行は未実装。 */
export const AIR_WINDOWS:Readonly<Record<string,readonly [number,number]>>={
 'monster.ashreia.glide':[40,68],
 'monster.ashreia.leap_dive':[30,56],
 'monster.lumisca.leap_in':[34,44],
 'monster.lumisca.leap_kick':[30,46]
};
export function isAirborneAction(id:string|undefined,tick:number):boolean{
 const r=id?AIR_WINDOWS[id]:undefined;return !!r&&tick>=r[0]&&tick<r[1];
}
