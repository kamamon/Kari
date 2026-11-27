import {state,count,transfer,grant,spend,swap,sortSlots,expand,migrateLegacy,reclaim,mix,totals,settle} from './classic-box.mjs';
function invariant(ok,msg){if(!ok)throw new Error(msg)}
function tests(){const L={heal:10,ore:99,herb:10,tonic:5},O={heal:1,ore:2,herb:3,tonic:4};let passed=[];const test=(name,fn)=>{fn();passed.push(name)},eq=(a,b)=>invariant(JSON.stringify(a)===JSON.stringify(b),`expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`),reject=fn=>{let failed=false;try{fn()}catch{failed=true}invariant(failed,"expected rejection")};
test("800 slots and 24 pouch slots",()=>{const s=state();eq([s.box.length,s.pouch.length],[800,24])});
test("1000 maximum",()=>{const s=expand(expand(state()));eq(s.box.length,1000);reject(()=>expand(s))});
test("99 stack split",()=>{const s=grant(state(),"box","ore",100,L);eq(s.box.slice(0,2).map(x=>x.count),[99,1])});
test("move and conservation",()=>{let s=grant(state(),"box","heal",100,L);const before=totals(s);s=transfer(s,"box",0,10,L);eq(s.pouch[0].count,10);eq(totals(s),before);s=transfer(s,"pouch",0,7,L);eq(totals(s),before)});
test("selected slot only",()=>{const s=grant(state(),"box","heal",100,L);reject(()=>transfer(s,"box",1,2,L))});
test("carry cap rollback",()=>{const s=grant(state(),"box","heal",20,L);const before=JSON.stringify(s);reject(()=>transfer(s,"box",0,11,L));eq(JSON.stringify(s),before)});
test("24 kinds and no auto extra",()=>{let s=state();let limits={};for(let i=0;i<25;i++)limits["x"+i]=1;for(let i=0;i<24;i++)s=grant(s,"pouch","x"+i,1,limits);reject(()=>grant(s,"pouch","x24",1,limits))});
test("full box and merge",()=>{let s=grant(state(),"box","ore",800*99,L);reject(()=>grant(s,"box","heal",1,L));s=spend(s,"box","ore",1);eq(grant(s,"box","ore",1,L).box[0].count,99)});
test("migration preserves unknowns and overflow",()=>{const s=migrateLegacy({ore:100000,unknown:3,heal:12},{heal:7},L);eq(totals(s).ore,100000);eq(totals(s).unknown,3);eq(totals(s).heal,12);eq(s.pouch[0].count,7);invariant(s.overflow.length>0,"overflow missing")});
test("overflow reclaim atomic",()=>{let s=migrateLegacy({ore:800*99+10},{},L);reject(()=>reclaim(s,0,1));s=expand(s);const a=reclaim(s,0,10);eq(a.overflow.length,0);eq(totals(a),totals(s))});
test("manual swap and sort",()=>{let s=grant(grant(state(),"box","ore",100,L),"box","heal",3,L);s=swap(s,"box",0,5);const a=sortSlots(s,"box",O,L);eq(a.box.slice(0,3).map(x=>[x.itemId,x.count]),[["heal",3],["ore",99],["ore",1]])});
test("box mix consumes only box",()=>{let s=grant(grant(state(),"box","herb",3,L),"pouch","herb",2,L);const a=mix(s,"box",[{itemId:"herb",count:2}],{itemId:"tonic",count:1},L);eq([count(a.box,"herb"),count(a.pouch,"herb"),count(a.box,"tonic")],[1,2,1])});
test("mix failure rollback",()=>{const s=grant(state(),"box","herb",2,L);const before=JSON.stringify(s);reject(()=>mix(s,"box",[{itemId:"herb",count:1},{itemId:"herb",count:2}],{itemId:"tonic",count:1},L));eq(JSON.stringify(s),before)});
test("retire restores and idempotence",()=>{const s=grant(state(),"pouch","heal",3,L);const r=settle(s,[],{runId:"r",result:"retire",spentOwn:[{itemId:"heal",count:2}]},L);eq(totals(r.state),totals(s));eq(settle(r.state,r.settledRuns,{runId:"r",result:"retire"},L).duplicate,true)});
test("failure consumes only own",()=>{const s=grant(state(),"pouch","heal",3,L);const r=settle(s,[],{runId:"r",result:"failed",spentOwn:[{itemId:"heal",count:1}],rewardToBox:[{itemId:"ore",count:3}]},L);eq(totals(r.state),{heal:2})});
test("success and reward retry atomic",()=>{const s=grant(grant(state(),"box","ore",800*99,L),"pouch","heal",3,L);const run={runId:"r",result:"success",spentOwn:[{itemId:"heal",count:1}],rewardToBox:[{itemId:"herb",count:3}]};reject(()=>settle(s,[],run,L));eq(count(s.pouch,"heal"),3);const r=settle(expand(s),[],run,L);eq([count(r.state.pouch,"heal"),count(r.state.box,"herb")],[2,3]);eq(settle(r.state,r.settledRuns,run,L).duplicate,true)});
test("carried loot respects pouch",()=>{const s=grant(state(),"pouch","heal",10,L);reject(()=>settle(s,[],{runId:"r",result:"success",carriedLoot:[{itemId:"heal",count:1}]},L));eq(count(s.pouch,"heal"),10)});
return passed}
console.log(tests());
