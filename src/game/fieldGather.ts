import { SeededRng } from '../core/seededRng';
import { FIELD_GATHER_LABEL, type FieldGatherCatalog, type FieldGatherKind, type FieldGatherNode } from '../data/fieldGathering';
import type { ErrandTarget } from './errand';
export const FIELD_GATHER_ACTIONS:Record<FieldGatherKind,string>={
  mine:'player.common.mine',plant:'player.common.gather',bone:'player.common.field_bone',insect:'player.common.field_net',fish:'player.common.field_fish'
};
export const FIELD_NODE_REACH=2.0;
export type FieldTarget=Extract<ErrandTarget,{kind:'field_node'}>;
export interface FieldGatherHit {itemId:string;count:number;kind:FieldGatherKind;remaining:number;}
export class FieldGatherState {
  readonly nodes:readonly FieldGatherNode[];
  readonly remaining=new Map<string,number>();
  readonly discovered=new Set<string>();
  readonly toolLeft:{mine:number;insect:number};
  hookInstance=-1;
  constructor(readonly catalog:FieldGatherCatalog,readonly rankId:string,readonly seed:number) {
    this.nodes=catalog.nodes; this.toolLeft={...catalog.toolCharges};
    for(const n of this.nodes)this.remaining.set(n.id,n.uses);
  }
  left(n:FieldGatherNode):number{return this.remaining.get(n.id)??0;}
  hasTool(n:FieldGatherNode):boolean{return n.kind!=='mine'&&n.kind!=='insect'||this.toolLeft[n.kind]>0;}
  discover(area:string,x:number,z:number,range=10):void {
    for(const n of this.nodes)if(n.areaId===area&&Math.hypot(n.x-x,n.z-z)<=range)this.discovered.add(n.id);
  }
  nearby(area:string,x:number,z:number,max=FIELD_NODE_REACH):FieldGatherNode|null {
    let best:FieldGatherNode|null=null,d=max;
    for(const n of this.nodes){if(n.areaId!==area)continue;const nd=Math.hypot(n.x-x,n.z-z);if(nd<=d){best=n;d=nd;}}return best;
  }
  target(area:string,x:number,z:number,yaw:number,ground:(x:number,z:number)=>number,speed:number):FieldTarget|null {
    let best:FieldGatherNode|null=null,d=FIELD_NODE_REACH;
    const y=ground(x,z);
    for(const n of this.nodes){
      if(n.areaId!==area||this.left(n)<=0||!this.hasTool(n)||Math.abs(ground(n.x,n.z)-y)>.8)continue;
      const nd=Math.hypot(n.x-x,n.z-z);if(nd<=d){best=n;d=nd;}
    }
    if(!best)return null;
    const aim=best.kind==='fish'?this.catalog.pond:best,dx=aim.x-x,dz=aim.z-z;
    return {kind:'field_node',nodeId:best.id,source:best.kind,actionId:FIELD_GATHER_ACTIONS[best.kind],faceYaw:Math.hypot(dx,dz)>.05?Math.atan2(dx,dz):yaw,speed:best.kind==='mine'?speed:1};
  }
  bite(tick:number):boolean {return tick>=this.catalog.fish.biteFrom&&tick<this.catalog.fish.biteTo;}
  /** 乱数をノードID・出発seed・採取回数だけから決める。戦闘の乱数列とは独立。 */
  take(node:FieldGatherNode):FieldGatherHit|null {
    const left=this.left(node);
    if(left<=0||!this.hasTool(node))return null;
    const table=this.catalog.tables.find(t=>t.nodeKind===node.kind&&t.rankId===this.rankId&&t.quality===node.quality);
    if(!table||!table.entries.length)return null;
    let s=(this.seed^Math.imul(node.uses-left+1,0x9e3779b9))>>>0;
    for(let i=0;i<node.id.length;i++)s=Math.imul(s^node.id.charCodeAt(i),16777619)>>>0;
    const rng=new SeededRng(s);
    let roll=rng.int(10000),chosen=table.entries[table.entries.length-1]!;
    for(const e of table.entries){roll-=e.weightBps;if(roll<0){chosen=e;break;}}
    const count=chosen.minCount+rng.int(chosen.maxCount-chosen.minCount+1);
    this.remaining.set(node.id,left-1);this.discovered.add(node.id);
    if(node.kind==='mine'||node.kind==='insect')this.toolLeft[node.kind]--;
    return {itemId:chosen.itemId,count,kind:node.kind,remaining:left-1};
  }
  hash():string{return [...this.remaining].map(([k,v])=>k+'='+v).join(',')+'|'+this.toolLeft.mine+'|'+this.toolLeft.insect+'|'+this.hookInstance+'|'+[...this.discovered].sort().join(',');}
}
export function gatheringHint(g:FieldGatherState,n:FieldGatherNode):string{
  if(g.left(n)<=0)return FIELD_GATHER_LABEL[n.kind]+'点：枯渇';
  if(!g.hasTool(n))return (n.kind==='mine'?'採掘具':'捕虫網')+'を使い切った（次の出発で補充）';
  return FIELD_GATHER_LABEL[n.kind]+'（残り'+g.left(n)+'回）';
}
