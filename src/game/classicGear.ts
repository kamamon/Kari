// Runtime slice of #31: signed points and decoration slots for the effects with implemented hooks.
// Original design thresholds retained; legacy armor is adapted from its existing head/chest skills.
import type { ArmorDef, ArmorSkill, Content } from '../data/schemas';
export interface ClassicGearState { stock: Record<string,number>; sockets: Record<string,string[]>; fortify: Record<string,number> }
export interface ClassicSkillRule { name:string; effect:string; positive:{threshold:number;value:number}[];negative:{threshold:number;value:number}[] }
export interface JewelDef { id:string;name:string;cost:number;rank:string;points:Record<string,number>;materials:{itemId:string;count:number}[];money:number }
export const CLASSIC_SKILL_RULES: Record<string,ClassicSkillRule> = {
  "guard_economy": {
    "name": "受け支え",
    "effect": "ガードのスタミナ消費軽減率。削りや後退と別。",
    "positive": [
      {
        "threshold": 10,
        "value": 8
      },
      {
        "threshold": 15,
        "value": 14
      },
      {
        "threshold": 20,
        "value": 20
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -8
      },
      {
        "threshold": -15,
        "value": -14
      }
    ]
  },
  "edge_keep": {
    "name": "刃持ち",
    "effect": "刃・打面の消耗軽減率。連続消費は端数を保持。",
    "positive": [
      {
        "threshold": 10,
        "value": 5
      },
      {
        "threshold": 15,
        "value": 9
      },
      {
        "threshold": 20,
        "value": 13
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -10
      },
      {
        "threshold": -15,
        "value": -20
      }
    ]
  },
  "dodge_economy": {
    "name": "身軽",
    "effect": "回避とステップのスタミナ消費軽減率。",
    "positive": [
      {
        "threshold": 10,
        "value": 5
      },
      {
        "threshold": 15,
        "value": 9
      },
      {
        "threshold": 20,
        "value": 13
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -10
      },
      {
        "threshold": -15,
        "value": -20
      }
    ]
  },
  "stamina_recovery": {
    "name": "息継ぎ",
    "effect": "自然スタミナ回復速度の増加率。回復遅延は不変。",
    "positive": [
      {
        "threshold": 10,
        "value": 4
      },
      {
        "threshold": 15,
        "value": 7
      },
      {
        "threshold": 20,
        "value": 10
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -8
      },
      {
        "threshold": -15,
        "value": -15
      }
    ]
  },
  "part_damage": {
    "name": "砕き",
    "effect": "破壊・切断蓄積の増加率。HP・怯み・気絶は対象外。",
    "positive": [
      {
        "threshold": 10,
        "value": 5
      },
      {
        "threshold": 15,
        "value": 9
      },
      {
        "threshold": 20,
        "value": 13
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -8
      },
      {
        "threshold": -15,
        "value": -15
      }
    ]
  },
  "element_tuning": {
    "name": "属性調律",
    "effect": "属性ダメージ増加率。盾打ち・無属性は対象外。",
    "positive": [
      {
        "threshold": 10,
        "value": 4
      },
      {
        "threshold": 15,
        "value": 7
      },
      {
        "threshold": 20,
        "value": 10
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -8
      },
      {
        "threshold": -15,
        "value": -15
      }
    ]
  },
  "status_tuning": {
    "name": "状態調律",
    "effect": "毒・麻痺・睡眠蓄積増加率。気絶除外。",
    "positive": [
      {
        "threshold": 10,
        "value": 4
      },
      {
        "threshold": 15,
        "value": 7
      },
      {
        "threshold": 20,
        "value": 10
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -8
      },
      {
        "threshold": -15,
        "value": -15
      }
    ]
  },
  "weak_crit": {
    "name": "急所観察",
    "effect": "物理肉質0.55以上で会心率に加算するポイント。",
    "positive": [
      {
        "threshold": 10,
        "value": 4
      },
      {
        "threshold": 15,
        "value": 7
      },
      {
        "threshold": 20,
        "value": 10
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -5
      },
      {
        "threshold": -15,
        "value": -10
      }
    ]
  },
  "stun_tuning": {
    "name": "響打",
    "effect": "頭部への気絶蓄積増加率。打撃タグ必須。",
    "positive": [
      {
        "threshold": 10,
        "value": 4
      },
      {
        "threshold": 15,
        "value": 7
      },
      {
        "threshold": 20,
        "value": 10
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -8
      },
      {
        "threshold": -15,
        "value": -15
      }
    ]
  },
  "item_efficiency": {
    "name": "道具整備",
    "effect": "整備タグのアイテム時間の短縮率。",
    "positive": [
      {
        "threshold": 10,
        "value": 5
      },
      {
        "threshold": 15,
        "value": 9
      },
      {
        "threshold": 20,
        "value": 13
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -10
      },
      {
        "threshold": -15,
        "value": -20
      }
    ]
  },
  "status_resistance": {
    "name": "個別状態耐性",
    "effect": "対象状態の発症閾値増加率。対象別、毒/麻痺/睡眠/気絶。",
    "positive": [
      {
        "threshold": 10,
        "value": 20
      },
      {
        "threshold": 15,
        "value": 35
      },
      {
        "threshold": 20,
        "value": 50
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -15
      },
      {
        "threshold": -15,
        "value": -30
      }
    ]
  },
  "element_resistance": {
    "name": "個別属性耐性",
    "effect": "対象属性の耐性ポイント。火/雷/氷/水/風/霧。",
    "positive": [
      {
        "threshold": 10,
        "value": 3
      },
      {
        "threshold": 15,
        "value": 6
      },
      {
        "threshold": 20,
        "value": 9
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -4
      },
      {
        "threshold": -15,
        "value": -8
      }
    ]
  },
  "raw_power": {
    "name": "武威",
    "effect": "物理攻撃力増加率。属性・固定ダメージ除外。",
    "positive": [
      {
        "threshold": 10,
        "value": 4
      },
      {
        "threshold": 15,
        "value": 7
      },
      {
        "threshold": 20,
        "value": 11
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -5
      },
      {
        "threshold": -15,
        "value": -9
      },
      {
        "threshold": -20,
        "value": -14
      }
    ]
  },
  "defense": {
    "name": "堅身",
    "effect": "防御合計への固定ポイント加算。防御の下限0。",
    "positive": [
      {
        "threshold": 10,
        "value": 8
      },
      {
        "threshold": 15,
        "value": 14
      },
      {
        "threshold": 20,
        "value": 22
      }
    ],
    "negative": [
      {
        "threshold": -10,
        "value": -8
      },
      {
        "threshold": -15,
        "value": -14
      },
      {
        "threshold": -20,
        "value": -22
      }
    ]
  },
  "evade_window": {
    "name": "身かわし",
    "effect": "既存回避・ステップの無敵時間にミリ秒加算。60Hzで切り上げ4/8tick、総量上限0.42秒。",
    "positive": [
      {
        "threshold": 10,
        "value": 60
      },
      {
        "threshold": 15,
        "value": 120
      }
    ],
    "negative": []
  }
};
export const JEWELS: readonly JewelDef[] = [
  {
    "id": "jewel.proposal.guard.1",
    "name": "受け紋片",
    "cost": 1,
    "rank": "rank.1",
    "points": {
      "guard_economy": 2,
      "dodge_economy": -1
    },
    "materials": [
      {
        "itemId": "mat.ore.basin_iron",
        "count": 2
      }
    ],
    "money": 120
  },
  {
    "id": "jewel.proposal.edge.1",
    "name": "刃守紋片",
    "cost": 1,
    "rank": "rank.1",
    "points": {
      "edge_keep": 2,
      "stamina_recovery": -1
    },
    "materials": [
      {
        "itemId": "mat.ore.basin_iron",
        "count": 2
      }
    ],
    "money": 120
  },
  {
    "id": "jewel.proposal.evade.1",
    "name": "歩影紋片",
    "cost": 1,
    "rank": "rank.1",
    "points": {
      "evade_window": 1,
      "guard_economy": -1
    },
    "materials": [
      {
        "itemId": "mat.ore.basin_iron",
        "count": 2
      }
    ],
    "money": 120
  },
  {
    "id": "jewel.proposal.evade.2",
    "name": "歩影紋石",
    "cost": 2,
    "rank": "rank.2",
    "points": {
      "evade_window": 3,
      "guard_economy": -1
    },
    "materials": [
      {
        "itemId": "mat.ore.deepcopper",
        "count": 3
      }
    ],
    "money": 240
  },
  {
    "id": "jewel.proposal.evade.3",
    "name": "歩影紋晶",
    "cost": 3,
    "rank": "rank.3",
    "points": {
      "evade_window": 5,
      "guard_economy": -2
    },
    "materials": [
      {
        "itemId": "mat.ore.crystalseam_steel",
        "count": 4
      }
    ],
    "money": 360
  },
  {
    "id": "jewel.proposal.power.2",
    "name": "武威紋石",
    "cost": 2,
    "rank": "rank.2",
    "points": {
      "raw_power": 3,
      "defense": -1
    },
    "materials": [
      {
        "itemId": "mat.ore.deepcopper",
        "count": 3
      }
    ],
    "money": 240
  }
];
const TEMPLATES: Record<number,{main:number[];secondary:number[];negative:number[];sockets:number[]}> = {"1":{"main":[3,2,3,1,2],"secondary":[1,3,1,3,2],"negative":[-2,-2,-2,-2,-2],"sockets":[1,0,1,0,1]},"2":{"main":[4,2,4,2,3],"secondary":[1,3,1,3,2],"negative":[-2,-2,-2,-2,-2],"sockets":[1,1,1,1,1]},"3":{"main":[4,3,4,2,3],"secondary":[2,3,2,3,2],"negative":[-2,-3,-2,-3,-2],"sockets":[2,1,2,1,1]},"4":{"main":[5,3,5,3,4],"secondary":[2,4,2,4,3],"negative":[-2,-3,-2,-3,-2],"sockets":[2,2,2,1,2]}};
export function emptyClassicGear():ClassicGearState{return {stock:{},sockets:{},fortify:{}}}
export function classicRank(a:{id:string;rankId?:string}):number{
 const n=Number(a.rankId?.split('.').pop()??0);
 if(n>=1&&n<=4)return n;
 const l=/\.(00[1-5])$/.exec(a.id);
 return l?Math.max(1,Math.min(4,Number(l[1])-1)):1;
}
const SLOTS=['head','chest','arms','waist','legs'];
export function socketCapacity(c:Content,id:string):number{
 const a=c.armor.get(id);if(a)return a.starter?0:TEMPLATES[classicRank(a)]!.sockets[SLOTS.indexOf(a.slot)]??0;
 const w=c.weapons.get(id);return w&&!w.starter?Math.min(3,classicRank(w)):0;
}
export function armorPoints(c:Content,a:ArmorDef):ArmorSkill[]{
 if(a.starter)return [];
 if(a.skillPoints)return a.skillPoints.map(p=>({...p}));
 const find=(slot:string)=>c.armor.get(a.id.replace(/^armor\.[^.]+\./,'armor.'+slot+'.'))?.skill;
 let main=find('head')??a.skill,secondary=find('chest')??a.skill;
 let penalty='guard_economy';
 if(a.series==='series.selvark'){main={id:'evade_window',points:1};secondary={id:'dodge_economy',points:1};}
 if(a.series==='gathering.bone_only'){main={id:'part_damage',points:1};secondary={id:'edge_keep',points:1};penalty='defense';}
 if(a.series==='gathering.ore_only'){main={id:'mining_haste',points:1};secondary={id:'gather_sense',points:1};penalty='dodge_economy';}
 if(!main&&!secondary)return [];
 if(main?.id===penalty||secondary?.id===penalty)penalty='dodge_economy';
 if(main?.id===penalty||secondary?.id===penalty)penalty='edge_keep';
 if(main?.id===penalty||secondary?.id===penalty)penalty='stamina_recovery';
 const t=TEMPLATES[classicRank(a)]!,i=SLOTS.indexOf(a.slot);
 const out:ArmorSkill[]=[];
 if(main&&c.skills.has(main.id))out.push({...main,points:t.main[i]??0});
 if(secondary&&c.skills.has(secondary.id))out.push({...secondary,points:t.secondary[i]??0});
 if(c.skills.has(penalty))out.push({id:penalty,points:t.negative[i]??0});
 return out.filter(p=>p.points!==0);
}
export function classicSkillPoints(c:Content,pieces:readonly ArmorDef[],weaponId:string,state:ClassicGearState):Map<string,number>{
 const points=new Map<string,number>();const add=(k:string,v:number)=>points.set(k,(points.get(k)??0)+v);
 for(const a of pieces)for(const p of armorPoints(c,a))add(p.element?p.id+':'+p.element:p.status?p.id+':'+p.status:p.id,p.points);
 for(const id of [...pieces.map(a=>a.id),weaponId]){
  let used=0;for(const jid of state.sockets[id]??[]){const j=JEWELS.find(x=>x.id===jid);if(!j||used+j.cost>socketCapacity(c,id))continue;used+=j.cost;for(const [k,v]of Object.entries(j.points))if(c.skills.has(k))add(k,v);}
 }
 return points;
}
export function classicSkillLevel(key:string,points:number):number{
 const r=CLASSIC_SKILL_RULES[key.split(':')[0]!];const positives=r?.positive??[{threshold:10,value:1},{threshold:15,value:2},{threshold:20,value:3}];const negatives=r?.negative??[];
 let lv=0;for(let i=0;i<positives.length;i++)if(points>=positives[i]!.threshold)lv=i+1;
 for(let i=0;i<negatives.length;i++)if(points<=negatives[i]!.threshold)lv=-(i+1);
 return lv;
}
export function classicNegativeValue(key:string,level:number):number{return CLASSIC_SKILL_RULES[key.split(':')[0]!]?.negative[-level-1]?.value??0;}
export function registerClassicSkills(c:Content):void{
 for(const [id,r] of Object.entries(CLASSIC_SKILL_RULES)){if(c.skills.has(id))continue;const v=r.positive.map(p=>p.value);c.skills.set(id,{id,name:r.name,effect:r.effect,unit:id==='evade_window'?'ms':id==='defense'?'点':'%',values:[v[0]??0,v[1]??v[0]??0,v[2]??v[1]??v[0]??0]});}
}
export function fortifyBonus(ids:readonly string[],state?:ClassicGearState):number{return [...new Set(ids)].reduce((sum,id)=>sum+2*Math.min(5,Math.max(0,state?.fortify[id]??0)),0)}
export function installedSlots(id:string,state:ClassicGearState):number{return (state.sockets[id]??[]).reduce((sum,j)=>sum+(JEWELS.find(x=>x.id===j)?.cost??0),0)}
