// 2G基準の狩場設計から初期グレーボックスを生成。基準ファイルを別に保存して実行すること。
function generate(blue,bestiary,basin,adult,herd,errand,content,board){
const out={}, audit={fields:0,areas:0,connections:0,questHunts:0,questSurveys:0,checks:0,regions:[]};
const R=x=>Math.round(x*100)/100;
const assert=(p,m)=>{if(!p)throw Error(m);audit.checks++};
function seg(p,a,b){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.min(1,Math.max(0,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz)}
function sd(p,poly){let hit=false,d=Infinity;for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;d=Math.min(d,seg(p,a,b))}return hit?d:-d}
function lineOK(a,b,shape,margin){const n=Math.ceil(Math.hypot(a[0]-b[0],a[1]-b[1])*2);for(let i=0;i<=n;i++){let t=n?i/n:0;if(sd([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],shape)<margin)return false}return true}
const templates=Object.keys(blue.shape_templates);
const colors=[[.82,1.08,.83],[1.13,1.09,.85],[.87,.88,.9],[.83,.99,1.15],[.79,1.15,.84],[1.15,.79,.74],[.94,.88,.8],[1.04,1.03,.83],[1.13,1.03,.84],[.98,1.03,1.12],[.8,1.12,.99],[.93,1.03,1.13],[.98,.9,.82],[.82,.98,1.1],[1.04,.9,.84],[.86,.98,.95],[1.19,.83,.75],[1.02,.87,.78],[.83,1.04,.93]];
const hunts=[],materials=[],quests=[],boards=[];
const originals=[...adult.quests,...herd.quests].filter(q=>q.rankId==='rank.1'&&q.targets?.length!==2);
const proto=errand.quests.find(q=>q.gather&&q.gather.nodes.length>0);
const gatherBoard=board.quests.find(x=>x.questId===proto.id);
for(let fi=1;fi<blue.field_programs.length;fi++){
const p=blue.field_programs[fi],top=blue.topology_templates.find(t=>t.id===p.topology_template),tag=String(fi+1).padStart(2,'0'),fid='field.classic_'+tag,mid='map.classic_'+tag;
const nodes=new Map(),ports=new Map();
for(let ai=0;ai<p.areas.length;ai++){
const a=p.areas[ai],id=a.area_key,links=top.connections.filter(c=>c.areas.includes(id)).map(c=>({to:c.areas.find(i=>i!==id),large:c.large}));
const degree=links.length, cx=(ai%4)*300,cz=Math.floor(ai/4)*300, si=templates.indexOf(a.shape_template), phase=(si+fi*0.23)*0.43;
const hw=Math.max(a.footprint_m[0]/2,degree>=3?31:22),hz=Math.max(a.footprint_m[1]/2,degree>=3?26:18);
function rad(t){return (1/Math.sqrt(Math.cos(t)**2/hw**2+Math.sin(t)**2/hz**2))*(1+.10*Math.cos(3*t+phase)+.05*Math.sin(2*t+si*.7))}
const polar=(t,r)=>[R(cx+Math.cos(t)*r),R(cz+Math.sin(t)*r)];
const shape=Array.from({length:96},(_,j)=>{let t=j*Math.PI*2/96;return polar(t,rad(t))});
const local=[],used=[];
for(let j=0;j<degree;j++){const t=2*Math.PI*j/degree+phase, rr=rad(t);let exit=polar(t,rr-5),arrival=polar(t,rr-14);assert(sd(exit,shape)>2.1,fid+' '+id+' exit '+j);assert(sd(arrival,shape)>3,fid+' arrival');assert(lineOK([cx,cz],exit,shape,1.8),fid+' route');local.push({to:links[j].to,large:links[j].large,exit,arrival,yaw:R(Math.atan2(-Math.cos(t),-Math.sin(t)))});used.push(exit,arrival)}
for(let j=0;j<local.length;j++)for(let k=0;k<local.length;k++)assert(Math.hypot(local[j].arrival[0]-local[k].exit[0],local[j].arrival[1]-local[k].exit[1])>5.2,fid+' arrival collision');
const rocks=[];
if(id!=='camp')for(let j=0;j<12&&rocks.length<3;j++){let t=j*Math.PI/6+phase+.25,pt=polar(t,rad(t)*.62),r=R(1.3+(si+j)%3*.4);if(sd(pt,shape)>r+1&&Math.hypot(pt[0]-cx,pt[1]-cz)>10&&used.every(x=>Math.hypot(x[0]-pt[0],x[1]-pt[1])>r+6)&&local.every(x=>seg(pt,[cx,cz],x.exit)>r+2.2)&&rocks.every(x=>Math.hypot(x.x-pt[0],x.z-pt[1])>r+x.r+3))rocks.push({x:pt[0],z:pt[1],r,h:R(2+(fi+ai+j)%5*.7)})}
const bounds={minX:Math.min(...shape.map(x=>x[0])),maxX:Math.max(...shape.map(x=>x[0])),minZ:Math.min(...shape.map(x=>x[1])),maxZ:Math.max(...shape.map(x=>x[1]))};
const center={x:cx,z:cz},nav=[[cx,cz],...local.map(x=>x.arrival)];
const step=6,x0=Math.floor(bounds.minX)-1,z0=Math.floor(bounds.minZ)-1,nx=Math.ceil((bounds.maxX-x0)/step)+1,nz=Math.ceil((bounds.maxZ-z0)/step)+1,h=[];
const keep=[[cx,cz],[cx-7,cz],[cx+7,cz],...used];const height=Math.min(280,Math.max(40,(a.height_band_m[1]-a.height_band_m[0])*45));
for(let zi=0;zi<nz;zi++)for(let xi=0;xi<nx;xi++){let px=x0+xi*step,pz=z0+zi*step;let dist=Math.min(...keep.map(v=>Math.hypot(px-v[0],pz-v[1])));h.push(Math.round(Math.min(height,Math.max(0,(dist-9)*7))*(.75+.25*Math.cos((px-cx)*.09+(pz-cz)*.07+phase))))}
let grid=a.minimap_center_design_units||[ai%4,Math.floor(ai/4)];grid=grid.map(x=>R(x));
nodes.set(id,{id,no:a.display_no,name:a.proposed_name,kind:id==='camp'?'camp':id===top.primary_nest?'nest':a.large_allowed?'hunt':'path',large:a.large_allowed,grid,size:id==='camp'||!a.large_allowed?'narrow':hw>=45?'wide':'medium',bounds,center,stepUp:.35,look:{ground:colors[fi-1],wind:id==='camp'?.65:1},nav,shape,relief:{x0,z0,step,nx,nz,h},exits:[],rocks,platforms:[]});ports.set(id,local)
}
for(const [id,a] of nodes){a.exits=ports.get(id).map(v=>{let b=ports.get(v.to).find(x=>x.to===id);assert(b&&b.large===v.large,fid+' pair');let arrive={x:b.arrival[0],z:b.arrival[1],yaw:b.yaw};return {to:v.to,x:v.exit[0],z:v.exit[1],r:3.2,arrive,...(v.large?{large:true,arriveLarge:{...arrive}}:{})}});for(const e of a.exits)assert(a.rocks.every(r=>Math.hypot(r.x-e.x,r.z-e.z)>r.r+e.r+1),'rock exit')}
const areas=[...nodes.values()],camp=nodes.get('camp'),legacy=areas.find(x=>x.large&&x.kind==='hunt'),nest=top.primary_nest;
function reach(start,large){const set=new Set([start]),queue=[start];while(queue.length){for(const e of nodes.get(queue.shift()).exits){if((large&&!e.large)||set.has(e.to))continue;set.add(e.to);queue.push(e.to)}}return set}
assert(reach('camp',false).size===areas.length,fid+' all connected');assert(reach(legacy.id,true).has(nest),fid+' nest reachable');
let routes={},herds=[];
const native=originals.filter(q=>bestiary.species.find(m=>m.id===q.targetMonsterId)?.habitat===p.canonical_name);
for(const q of native){let m=q.targetMonsterId;if(q.targets){if(!herds.some(h=>h.monsterId===m))herds.push({monsterId:m,areas:areas.filter(a=>a.id!=='camp'&&a.kind!=='nest').slice(0,3).map(a=>a.id),native:true})}else{let walk=areas.filter(a=>a.large&&reach(legacy.id,true).has(a.id)&&a.id!==nest).map(a=>a.id);assert(walk.length>=2,fid+' roam');routes[m]={start:walk[0],roam:walk.slice(0,4),nest}}
const id='quest.native.'+m.split('.')[1]+'.r1';
const old=board.quests.find(b=>b.questId===q.id);hunts.push({...q,id,name:p.canonical_name+'・'+q.name,summary:p.canonical_name+'で'+q.name+'に挑む。',mapId:mid,fieldId:fid,requires:['quest.basin.003'],monsterSpawn:{x:legacy.center.x+7,z:legacy.center.z,yaw:3.14},fieldTimeLimitTicks:126000});boards.push({...old,questId:id,text:p.canonical_name+'での現地狩猟依頼。地形と区域のつながりを確認し、討伐目標を達成せよ。'});
audit.questHunts++}
const mat='mat.survey.classic_'+tag, qid='quest.survey.classic_'+tag,rank=fi<=5?1:fi<=10?2:fi<=15?3:4,requireId=rank===1?'quest.basin.003':rank===2?'quest.basin.003':rank===3?'quest.basin.r2.001':'quest.basin.r3.001';
const surveyNodes=areas.filter(a=>a.id!=='camp').slice(0,3).map((a,i)=>({id:'survey'+i,kind:'mine',itemId:mat,areaId:a.id,x:a.center.x,z:a.center.z}));
materials.push({id:mat,name:p.canonical_name+'の地質試料'});
quests.push({...proto,id:qid,name:p.canonical_name+'の地質調査',summary:'各区域を巡り地質試料を4個納品する。',rankId:'rank.'+rank,mapId:mid,fieldId:fid,requires:[requireId],timeLimitTicks:90000,fieldTimeLimitTicks:90000,rewards:{money:350+rank*200,items:[]},gather:{needs:[{itemId:mat,count:4}],yieldPerNode:2,encounters:'none',depot:{areaId:'camp',x:camp.center.x,z:camp.center.z},nodes:surveyNodes}});boards.push({...gatherBoard,questId:qid,stars:Math.min(8,rank*2-1),clearMinutes:[6,15],text:p.canonical_terrain+'。3区域を踏査し、地質試料を4個納品せよ。'});audit.questSurveys++;
const field={schemaVersion:1,id:fid,name:p.canonical_name,note:'設計図の区域名と接続を使用した初期グレーボックス。出口間隔のため輪郭を調整。固有背景・水域・崖登攀は未完成。',legacyMapId:mid,legacyAreaId:legacy.id,start:{areaId:'camp',x:camp.center.x-7,z:camp.center.z,yaw:1.57},camp:{...camp.center,r:3.5},timeLimitScale:1.5,roam:{...basin.roam},routes,herds,areas};
const map={schemaVersion:1,id:mid,name:p.canonical_name+'・旧式単一区画',bounds:legacy.bounds,stepUp:legacy.stepUp,spawn:{x:legacy.center.x-7,z:legacy.center.z,yaw:1.57},camp:{x:legacy.center.x-10,z:legacy.center.z,r:3.5},monsterSpawn:{x:legacy.center.x+7,z:legacy.center.z,yaw:-1.57},rocks:legacy.rocks,platforms:legacy.platforms};
out['public/data/fields/classic_'+tag+'.json']=field;out['public/data/maps/classic_'+tag+'.json']=map;
bestiary.fields.find(f=>f.name===p.canonical_name).fieldId=fid;content.files.fields.push('fields/classic_'+tag+'.json');content.files.maps.push('maps/classic_'+tag+'.json');
audit.fields++;audit.areas+=areas.length;audit.connections+=top.connections.length;audit.regions.push({id:fid,name:p.canonical_name,areas:areas.length,connections:top.connections.length,native:native.length})
}
content.files.quests.push('quests_classic_regions.json');content.files.items.push('items_classic_regions.json');board.quests.push(...boards);
out['public/data/content.json']=content;out['public/data/bestiary.json']=bestiary;out['public/data/quest_board.json']=board;out['public/data/quests_classic_regions.json']={schemaVersion:1,note:'設計済み狩場の初期調査と既存実装種の現地依頼。旧依頼IDは保存。',quests:[...hunts,...quests]};out['public/data/items_classic_regions.json']={schemaVersion:1,note:'地質調査用試料',items:[],materials};
return {out,audit}
}
export {generate};
