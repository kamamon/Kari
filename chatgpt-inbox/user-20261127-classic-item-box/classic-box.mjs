function invariant(ok,msg){if(!ok)throw new Error(msg)}

function validCount(n){return Number.isSafeInteger(n)&&n>0}

function copy(s){return JSON.parse(JSON.stringify(s))}

function count(slots,id){return slots.reduce((n,x)=>n+(x?.itemId===id?x.count:0),0)}

function state(pages=8){invariant([8,9,10].includes(pages),"ページ数不正");return {version:1,pages,box:Array(pages*100).fill(null),pouch:Array(24).fill(null),overflow:[]}}

function capacity(slots,id,limit,single=false){const existing=slots.find(x=>x?.itemId===id);return single?(existing?limit-existing.count:(slots.includes(null)?limit:0)):slots.reduce((n,x)=>n+(x===null?limit:x.itemId===id?limit-x.count:0),0)}

function insert(slots,id,n,limit,single=false){invariant(typeof id==="string"&&id.length>0&&validCount(n)&&validCount(limit),"個数またはID不正");invariant(capacity(slots,id,limit,single)>=n,"収納先が満杯または携帯上限");let left=n;for(let i=0;i<slots.length&&left;i++){const x=slots[i];if(x?.itemId===id){const k=Math.min(left,limit-x.count);x.count+=k;left-=k}}for(let i=0;i<slots.length&&left;i++){if(slots[i]===null){const k=Math.min(left,limit);slots[i]={itemId:id,count:k};left-=k;if(single)break}}invariant(left===0,"収納計算不正")}

function take(slots,index,n){invariant(Number.isInteger(index)&&index>=0&&index<slots.length&&validCount(n),"枠または個数不正");const x=slots[index];invariant(x&&x.count>=n,"選んだ枠に十分な個数がありません");const id=x.itemId;x.count-=n;if(x.count===0)slots[index]=null;return id}

function remove(slots,id,n){invariant(validCount(n)&&count(slots,id)>=n,"素材不足");let left=n;for(let i=0;i<slots.length&&left;i++){const x=slots[i];if(x?.itemId===id){const k=Math.min(left,x.count);take(slots,i,k);left-=k}}}

function transfer(s,from,index,n,limits){invariant(from==="box"||from==="pouch","移動元不正");const a=copy(s),id=take(a[from],index,n),to=from==="box"?"pouch":"box",limit=to==="box"?99:limits[id];insert(a[to],id,n,limit,to==="pouch");return a}

function grant(s,to,id,n,limits){invariant(to==="box"||to==="pouch","収納先不正");const a=copy(s);insert(a[to],id,n,to==="box"?99:limits[id],to==="pouch");return a}

function spend(s,from,id,n){invariant(from==="box"||from==="pouch","消費元不正");const a=copy(s);remove(a[from],id,n);return a}

function swap(s,zone,i,j){invariant(zone==="box"||zone==="pouch","対象不正");const a=copy(s),v=a[zone];invariant([i,j].every(k=>Number.isInteger(k)&&k>=0&&k<v.length),"枠不正");[v[i],v[j]]=[v[j],v[i]];return a}

function sortSlots(s,zone,order,limits){invariant(zone==="box"||zone==="pouch","対象不正");const a=copy(s),v=a[zone],tot=new Map();for(const x of v)if(x)tot.set(x.itemId,(tot.get(x.itemId)||0)+x.count);const ids=[...tot.keys()].sort((x,y)=>(order[x]??Number.MAX_SAFE_INTEGER)-(order[y]??Number.MAX_SAFE_INTEGER)||(x<y?-1:x>y?1:0));v.fill(null);for(const id of ids)insert(v,id,tot.get(id),zone==="box"?99:limits[id],zone==="pouch");return a}

function expand(s){invariant(s.pages<10,"最大拡張済み");const a=copy(s);a.pages++;a.box.push(...Array(100).fill(null));return a}

function migrateLegacy(items,preferred,limits,order={}){const a=state();const ids=Object.keys(items).sort((x,y)=>(order[x]??Number.MAX_SAFE_INTEGER)-(order[y]??Number.MAX_SAFE_INTEGER)||(x<y?-1:x>y?1:0));for(const id of ids){const n=items[id];if(n===0)continue;invariant(validCount(n),"旧データの個数不正");const want=preferred===null?(limits[id]||0):(preferred?.[id]||0);const p=Math.min(n,want,limits[id]||0);let left=n;if(p>0&&a.pouch.includes(null)){insert(a.pouch,id,p,limits[id],true);left-=p}const fit=Math.min(left,capacity(a.box,id,99));if(fit>0)insert(a.box,id,fit,99);left-=fit;if(left>0)a.overflow.push({itemId:id,count:left})}return a}

function reclaim(s,index,n){const a=copy(s),x=a.overflow[index];invariant(x&&validCount(n)&&n<=x.count,"移行保留数不正");insert(a.box,x.itemId,n,99);x.count-=n;if(!x.count)a.overflow.splice(index,1);return a}

function mix(s,zone,ingredients,out,limits){invariant(zone==="box"||zone==="pouch","調合場所不正");invariant(Array.isArray(ingredients)&&ingredients.length>0&&out,"レシピ不正");const a=copy(s);for(const x of ingredients)remove(a[zone],x.itemId,x.count);insert(a[zone],out.itemId,out.count,zone==="box"?99:limits[out.itemId],zone==="pouch");return a}

function totals(s){const t=new Map();for(const x of [...s.box,...s.pouch,...s.overflow])if(x)t.set(x.itemId,(t.get(x.itemId)||0)+x.count);return Object.fromEntries(t)}

function settle(s,settledRuns,run,limits){invariant(typeof run.runId==="string"&&run.runId.length>0,"依頼ID不正");if(settledRuns.includes(run.runId))return {state:s,settledRuns,duplicate:true};invariant(["success","failed","retire"].includes(run.result),"依頼結果不正");let a=copy(s);if(run.result!=="retire"){for(const x of run.spentOwn??[])a=spend(a,"pouch",x.itemId,x.count);if(run.result==="success"){for(const x of run.carriedLoot??[])a=grant(a,"pouch",x.itemId,x.count,limits);for(const x of run.rewardToBox??[])a=grant(a,"box",x.itemId,x.count,limits)}}return {state:a,settledRuns:[...settledRuns,run.runId],duplicate:false}}

export {state,count,capacity,transfer,grant,spend,swap,sortSlots,expand,migrateLegacy,reclaim,mix,totals,settle};
