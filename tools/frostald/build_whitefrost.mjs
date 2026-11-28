// Independent cold field derived from the verified regional topology; all positions are transformed consistently.
import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../../public/data/',import.meta.url);
const get=p=>JSON.parse(readFileSync(new URL(p,root),'utf8'));
const write=(p,x)=>writeFileSync(new URL(p,root),JSON.stringify(x,null,2)+'\n');
function buildWhitefrost(template,oldMap,oldGather,oldQuests){
 const field=JSON.parse(JSON.stringify(template));const map=JSON.parse(JSON.stringify(oldMap));
 const catalog=JSON.parse(JSON.stringify(oldGather).replaceAll('icegorge','whitefrost').replaceAll('氷帆峡谷','白霧氷谷'));
 const rnd=n=>Math.round(n*1000)/1000;
 const names={camp:'白樺の野営地',a1:'霜雪の登り口',a2:'凍てつく湿地',a3:'凍河の渡り場',a4:'結晶氷洞',a5:'狭まりの峡谷',a6:'断崖の高台道',a7:'氷河の水際',a8:'白霧の巣域'};
 const scales={camp:1.06,a1:1.17,a2:1.14,a3:1.18,a4:1.05,a5:1.12,a6:1.15,a7:1,a8:1.12};
 const trans=new Map(template.areas.map(a=>[a.id,{x:a.center.x,z:a.center.z,X:Math.round(900+(a.center.x-900)*1.4),Z:Math.round(a.center.z*1.4),s:scales[a.id]}]));
 const p=(id,x,z)=>{const v=trans.get(id);return {x:rnd(v.X+(x-v.x)*v.s),z:rnd(v.Z+(z-v.z)*v.s)}};
 const point=(id,v)=>({...v,...p(id,v.x,v.z)});
 const bounds=(id,b)=>({minX:p(id,b.minX,b.minZ).x,maxX:p(id,b.maxX,b.maxZ).x,minZ:p(id,b.minX,b.minZ).z,maxZ:p(id,b.maxX,b.maxZ).z});
 field.id='field.whitefrost';field.name='白霧氷谷';field.legacyMapId='map.whitefrost.survey';field.note='氷帆峡谷を参考に拡張した独立寒冷狩場。雪原、氷洞、凍河、高台、巣。大型の通路と採集点を保持する。';
 field.start=point('camp',field.start);field.camp=point('camp',field.camp);field.routes={'monster.frostald':{start:'a3',roam:['a3','a2','a6','a7','a4'],nest:'a8'}};
 for(const a of field.areas){
  const id=a.id,s=scales[id];a.name=names[id];a.center=p(id,a.center.x,a.center.z);a.shape=a.shape.map(([x,z])=>{const v=p(id,x,z);return [v.x,v.z]});a.bounds=bounds(id,a.bounds);a.nav=a.nav.map(([x,z])=>{const v=p(id,x,z);return [v.x,v.z]});
  a.rocks=a.rocks.map(r=>({...point(id,r),r:rnd(r.r*s),h:rnd(r.h*(id==='a4'?1.25:1.12))}));a.platforms=a.platforms.map(t=>({...t,...bounds(id,t)}));
  a.exits=a.exits.map(e=>({...point(id,e),arrive:point(e.to,e.arrive)}));a.look={ground:[1.10,1.21,1.29],wind:id==='a6'?1.6:id==='a4'?.36:1.3};
  if(a.relief){const q=p(id,a.relief.x0,a.relief.z0);a.relief.x0=q.x;a.relief.z0=q.z;a.relief.step*=s;}
 }
 const areas=new Map(field.areas.map(a=>[a.id,a]));
 // Legal large arrivals, at least r+3 from rock and r+1.5 from every exit.
 const inPoly=(poly,x,z)=>{let inside=false;for(let i=0,k=poly.length-1;i<poly.length;k=i++){const a=poly[i],b=poly[k];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside}return inside};
 const segDist=(x,z,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t)};
 const safe=(a,x,z)=>inPoly(a.shape,x,z)&&a.shape.every((q,i)=>segDist(x,z,q,a.shape[(i+1)%a.shape.length])>1.6)&&a.rocks.every(q=>Math.hypot(x-q.x,z-q.z)>q.r+3.3)&&a.exits.every(q=>Math.hypot(x-q.x,z-q.z)>q.r+1.8);
 for(const a of field.areas)for(const e of a.exits){const b=areas.get(e.to);if(!a.large||!b.large)continue;const back=b.exits.find(x=>x.to===a.id);if(!back)throw Error('missing return');let best=null;const yaw=Math.atan2(b.center.x-back.x,b.center.z-back.z);for(let d=8;d<=45&&!best;d+=1.2){for(const off of [0,.22,-.22,.45,-.45,.7,-.7]){const x=back.x+Math.sin(yaw+off)*d,z=back.z+Math.cos(yaw+off)*d;if(safe(b,x,z)){best={x:rnd(x),z:rnd(z),yaw};break}}}if(!best)throw Error('large arrival '+a.id+' '+b.id);e.large=true;e.arriveLarge=best}
 map.id=field.legacyMapId;map.name='白霧氷谷・凍河調査区画';map.bounds=areas.get('a3').bounds;map.rocks=areas.get('a3').rocks;map.platforms=areas.get('a3').platforms;map.spawn=point('a3',map.spawn);map.monsterSpawn=point('a3',map.monsterSpawn);map.camp=point('a3',map.camp);
 catalog.pond=point(catalog.pond.areaId,catalog.pond);catalog.pond.bank=point(catalog.pond.areaId,catalog.pond.bank);
 catalog.nodes=catalog.nodes.map(n=>point(n.areaId,n));const matNames={mine:'白氷鉱',bone:'霜封骨',plant:'白霧草',insect:'雪羽虫',fish:'氷流魚'};
 for(const m of catalog.materials){if(m.id.startsWith('mat.field.whitefrost.')){const [, , ,kind,rank]=m.id.split('.');m.name=({'r1':'','r2':'厚層','r3':'晶質','r4':'星紋'}[rank]||'')+matNames[kind]}}
 for(const q of catalog.quests){q.gather.depot=point(q.gather.depot.areaId,q.gather.depot);q.summary='白霧氷谷を自由に巡って雪地・氷洞の素材を集め、野営地から帰還する。'}
 for(const b of catalog.board)b.text='白霧氷谷の雪原、凍河、氷洞での採取調査。採掘・骨・植物・虫・釣りの5種を利用できます。';
 const quests=JSON.parse(JSON.stringify(oldQuests));for(const q of quests.quests)q.monsterSpawn=map.monsterSpawn;
 return {field,map,catalog,quests}
}
if(process.argv.includes('--write')){const reg=get('regional_gathering.json');const result=buildWhitefrost(get('fields/icegorge.json'),get('maps/icegorge_survey.json'),reg.catalogs.find(x=>x.fieldId==='field.icegorge'),get('quests_frostald.json'));write('fields/whitefrost.json',result.field);write('maps/whitefrost_survey.json',result.map);write('quests_frostald.json',result.quests);reg.catalogs=reg.catalogs.filter(x=>x.fieldId!=='field.whitefrost');reg.catalogs.push(result.catalog);write('regional_gathering.json',reg);}
