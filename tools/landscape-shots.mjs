// 本番ビルドから地域ごとの実際のWebGL画面を撮る。外周の描画・素材・フレームの量も検査。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
const out=new URL('./out/landscape/',import.meta.url).pathname;
mkdirSync(out,{recursive:true});
const port=4186,base='/Kari/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--port',String(port),'--strictPort','--base',base],{stdio:'pipe'});
let browser;
const report=[],errors=[];
try{
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('preview startup')),20000);server.stdout.on('data',d=>{if(String(d).includes('Local')){clearTimeout(t);resolve();}});server.on('error',reject);});
 browser=await chromium.launch({executablePath:process.env.CHROME??'/usr/bin/google-chrome',args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
 const ctx=await browser.newContext({viewport:{width:960,height:440},deviceScaleFactor:1});
 const page=await ctx.newPage();
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
 await page.goto('http://localhost:'+port+base+'?hub=menu&frostaldQuality=game');
 await page.waitForSelector('#boot-start:not([hidden])',{timeout:30000});
 await page.click('#boot-start');
 await page.waitForFunction(()=>!!window.__vh,null,{timeout:30000});
 const shots=[
  ['basin','a2','field-basin-meadow',false],['basin','a4','field-basin-high',true],['basin','a5','field-basin-exit',false],
  ['mistforest','a3','field-mistforest',false],['coast','a2','field-coast',false],['icegorge','a4','field-icegorge',false],
  ['whitefrost','a2','field-whitefrost-wetland',false],['whitefrost','a3','field-whitefrost-river',false],['whitefrost','a4','field-whitefrost-cave',false],['wetland','a2','field-wetland',false],['ashmine','a2','field-ashmine',false],['buriedheat','a2','field-buriedheat',false]
 ];
 let current='';
 for(const [region,areaId,name,high] of shots){
  const q='quest.explore.'+region+'.r1';
  if(current!==region){
   await page.evaluate(q=>window.__vh.startHunt(q),q);
   await page.waitForFunction(q=>window.__vh.sim.hunt?.quest.id===q&&window.__vh.sim.tick>3,q,{timeout:45000});
   current=region;
  }
  await page.evaluate(({areaId,high})=>{
   const app=window.__vh,s=app.sim,p=s.player,a=s.field.areas.find(a=>a.id===areaId)??s.field.areas[1];
   for(const m of s.monsters)m.aiEnabled=false;
   const center=a.center??{x:(a.bounds.minX+a.bounds.maxX)/2,z:(a.bounds.minZ+a.bounds.maxZ)/2};
   let x=center.x,z=center.z;
   const exit=a.exits[0],dx=exit?exit.x-x:0,dz=exit?exit.z-z:1,L=Math.hypot(dx,dz)||1;
   let yaw=Math.atan2(dx,dz);
   if(high&&a.platforms.length){const top=[...a.platforms].sort((a,b)=>b.h-a.h)[0];x=(top.minX+top.maxX)/2;z=(top.minZ+top.maxZ)/2;}
   else if(exit&&L>10){const xx=exit.x-dx/L*11,zz=exit.z-dz/L*11;if(s.world.inArea(a,xx,zz,1.5)&&!a.rocks.some(r=>Math.hypot(xx-r.x,zz-r.z)<r.r+.8)){x=xx;z=zz;}}
   if(s.areaId!==a.id)s.areaId=a.id;
   p.pos={x,y:s.world.groundHeight(x,z),z};p.prevPos={...p.pos};p.drawn=false;p.yaw=yaw;p.prevYaw=yaw;
   app.view.cam.snap(yaw);app.view.cam.pitch=high?.16:-.06;
  },{areaId,high});
  await page.waitForFunction(areaId=>{
   const v=window.__vh.view,g=v.areaGroups.get(window.__vh.sim.areaId),ext=g?.getObjectByName('field-natural-exterior'),floor=ext?.getObjectByName('field-exterior-relief');
   return !!g?.visible&&!!ext?.userData.landscape&&!!floor?.material.map&&window.__vh.sim.areaId===areaId;
  },areaId,{timeout:45000});
  await page.waitForTimeout(550);
  const data=await page.evaluate(()=>{
   const app=window.__vh,s=app.sim,v=app.view,g=v.areaGroups.get(s.areaId),ext=g.getObjectByName('field-natural-exterior');
   return{field:s.field.id,area:s.areaId,landscape:ext.userData.landscape,camera:v.cam.camera.position.toArray(),visible:[...v.areaGroups.values()].filter(g=>g.visible).length,...v.stats()};
  });
  if(data.visible!==1||data.landscape.outerMax-data.landscape.outerMin<9||data.calls>100||data.triangles>200000)throw Error(name+' '+JSON.stringify(data));
  const path=out+name+'.jpg',bytes=await page.screenshot({path,type:'jpeg',quality:65});
  report.push({name,...data});
  console.log('LANDSCAPE_OK '+name+' '+JSON.stringify(data));
  if(['field-basin-high','field-mistforest','field-coast','field-icegorge'].includes(name))console.log('LANDSCAPE_JPEG_'+name+' '+bytes.toString('base64'));
 }
 // 実ゲームのGLB読み込み・3つの狩猟開始も確認。進行条件の準備と移動だけテスト用に行う。
 for(const rank of [1,2,3]){
   const q='quest.spinegale.r'+rank;
   await page.evaluate(q=>{
     const app=window.__vh;
     for(const req of app.content.quests.get(q).requires??[])app.save.doc.progress.questClears[req]=1;
     app.startHunt(q);
   },q);
   await page.waitForFunction(q=>window.__vh.sim.hunt?.quest.id===q&&window.__vh.sim.tick>3,q,{timeout:60000});
   await page.evaluate(()=>{
     const app=window.__vh,s=app.sim,m=s.monsters.find(x=>x.def.id==='monster.spinegale'),p=s.player;
     const a=s.monsterArea(m);
     if(a)s.areaId=a.id;
     m.aiEnabled=false;
     const x=m.pos.x,z=m.pos.z-6;
     p.pos={x,y:s.world.groundHeight(x,z),z};p.prevPos={...p.pos};p.yaw=0;p.prevYaw=0;
     app.view.cam.snap(0);
   });
   await page.waitForFunction(()=>{
     const v=window.__vh.view,rig=v.monsterRig;
     return !!rig?.root.visible && !!rig.root.getObjectByName('tail_05');
   },null,{timeout:45000});
   await page.waitForTimeout(300);
   const data=await page.evaluate(()=>{
     const app=window.__vh,m=app.sim.monsters.find(x=>x.def.id==='monster.spinegale'),rig=app.view.monsterRig;
     let joints=0,triangles=0;
     rig.root.traverse(o=>{if(o.isSkinnedMesh){joints=Math.max(joints,o.skeleton.bones.length);triangles+=o.geometry.index.count/3;}});
     return{quest:app.sim.hunt.quest.id,hp:m.def.hp,joints,triangles,visible:rig.root.visible};
   });
   if(data.joints!==77||data.triangles!==171772||data.hp!==[1450,3200,5800][rank-1])throw Error('Spinegale '+JSON.stringify(data));
   await page.screenshot({path:out+'spinegale-r'+rank+'.jpg',type:'jpeg',quality:80});
   report.push({name:'spinegale-r'+rank,...data});
   console.log('SPINEGALE_OK '+JSON.stringify(data));
 }
 // Frostald: real renderer, three hunt ranks, full bone/mesh count, and active cold recharge animation.
 const checkFrostald=async(page,rank,master=false)=>{
   const q='quest.frostald.r'+rank;
   await page.evaluate(q=>{
     const app=window.__vh;
     for(const req of app.content.quests.get(q).requires??[])app.save.doc.progress.questClears[req]=1;
     app.startHunt(q);
   },q);
   await page.waitForFunction(q=>window.__vh.sim.hunt?.quest.id===q&&window.__vh.sim.tick>3,q,{timeout:120000});
   await page.evaluate(()=>{
     const app=window.__vh,s=app.sim,m=s.monsters.find(x=>x.def.id==='monster.frostald'),p=s.player;
     const a=s.monsterArea(m);if(a)s.areaId=a.id;
     m.aiEnabled=false;
     const x=m.pos.x+6,z=m.pos.z-5,yaw=Math.atan2(m.pos.x-x,m.pos.z-z);
     p.pos={x,y:s.world.groundHeight(x,z),z};p.prevPos={...p.pos};p.yaw=yaw;p.prevYaw=yaw;
     app.view.cam.snap(yaw);
   });
   await page.waitForFunction(()=>{
     const rig=window.__vh.view.monsterRig;
     return !!rig?.root.visible && !!rig.root.getObjectByName('mane_l_01') && !!rig.clips?.get('fa_recharge');
   },null,{timeout:120000,polling:100});
   const data=await page.evaluate(()=>{
     const app=window.__vh,m=app.sim.monsters.find(x=>x.def.id==='monster.frostald'),rig=app.view.monsterRig;
     let joints=0,triangles=0,eyeRoughness=null,blueIris=false,roundPupil=false;const surfaces={};
     rig.root.traverse(o=>{
       if(!o.isSkinnedMesh)return;
       joints=Math.max(joints,o.skeleton.bones.length);triangles+=o.geometry.index.count/3;
       const material=o.material;
       if(material?.map&&material.normalMap&&material.roughnessMap&&material.aoMap){
         surfaces[material.name]={size:material.map.image.width,normal:material.normalMap.image.width,rough:material.roughnessMap.image.width,clearcoat:material.clearcoat??0};
       }
       if(o.material?.name==='eye'){
         eyeRoughness=o.material.roughness;const color=o.geometry.attributes.color;
         if(color){let r=0,b=0;for(let i=0;i<color.count;i++){r+=color.getX(i);b+=color.getZ(i);}blueIris=b>r*1.5;}
       }
       if(o.material?.name==='pupil'){
         const pos=o.geometry.attributes.position,ys=[],zs=[];
         for(let i=0;i<pos.count;i++)if(pos.getX(i)>0&&pos.getY(i)>1.5){ys.push(pos.getY(i));zs.push(pos.getZ(i));}
         if(ys.length){const ratio=(Math.max(...ys)-Math.min(...ys))/(Math.max(...zs)-Math.min(...zs));roundPupil=ratio>.85&&ratio<1.15;}
       }
     });
     return {quest:app.sim.hunt.quest.id,field:app.sim.field.id,area:app.sim.areaId,hp:m.def.hp,joints,triangles,clips:rig.clips.size,visible:rig.root.visible,eyeRoughness,blueIris,roundPupil,surfaces};
   });
   if(data.field!=='field.whitefrost'||data.joints!==79||data.clips!==56||(master?(data.triangles<2400000||data.triangles>2850000):(data.triangles<300000||data.triangles>500000))||data.hp!==[1750,3700,6400][rank-1]||!data.blueIris||!data.roundPupil||Math.abs(data.eyeRoughness-.32)>.001)throw Error('Frostald '+JSON.stringify(data));
   const expected={hide:2048,head_skin:2048,limb_skin:1024,belly_skin:1024,keratin:2048,ice_plate:1024,claw:1024,feather:2048,membrane:1024,mouth:1024};
   for(const [mat,res] of Object.entries(expected)){
     const x=data.surfaces[mat],size=master?res:res/2;
     if(!x||x.size!==size||x.normal!==size||x.rough!==size||!(x.clearcoat>0))throw Error('Frostald texture binding '+mat+' '+JSON.stringify(x));
   }
   const name=(master?'frostald-master':'frostald-game')+'-r'+rank;
   const image=await page.screenshot({path:out+name+'.jpg',type:'jpeg',quality:80,timeout:120000});
   if(master)console.log('FROSTALD_PBR_JPEG '+image.toString('base64'));
   report.push({name,...data});console.log('FROSTALD_OK '+JSON.stringify(data));
   // Play recharge on the actual displayed model, including the default HD model.
   {
     await page.evaluate(()=>{
       const app=window.__vh,m=app.sim.monsters.find(x=>x.def.id==='monster.frostald');
       m.aware=true;m.aiEnabled=true;m.action=null;m.cooldown=0;m.frostald.charge=20;
     });
     await page.waitForFunction(()=>window.__vh.view.monsterRig.active?.getClip().name==='fa_recharge',null,{timeout:45000});
     await page.screenshot({path:out+name+'-recharge.jpg',type:'jpeg',quality:80});
   }
 };
 for(const rank of [1,2,3])await checkFrostald(page,rank);
 // The published build must contain the full-density assets already; no test-only asset install.
 await page.close();
 const hp=await ctx.newPage();await hp.setViewportSize({width:640,height:360});
 hp.on('pageerror',e=>errors.push(String(e)));hp.on('console',m=>{if(m.type()==='error')errors.push(m.text());});hp.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
 await hp.goto('http://localhost:'+port+base+'?hub=menu');
 await hp.waitForSelector('#boot-start:not([hidden])',{timeout:30000});await hp.click('#boot-start');
 await hp.waitForFunction(()=>!!window.__vh,null,{timeout:30000});
 await checkFrostald(hp,1,true);
 await hp.close();
 const vp=await ctx.newPage();await vp.setViewportSize({width:960,height:540});
 vp.on('pageerror',e=>errors.push(String(e)));vp.on('console',m=>{if(m.type()==='error')errors.push(m.text())});vp.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url())});
 await vp.goto('http://localhost:'+port+base+'?hub=menu');
 await vp.waitForSelector('#boot-start:not([hidden])',{timeout:30000});await vp.click('#boot-start');
 await vp.waitForFunction(()=>!!window.__vh,null,{timeout:30000});
 await vp.evaluate(()=>{const a=window.__vh,q='quest.venolka.r1';for(const r of a.content.quests.get(q).requires??[])a.save.doc.progress.questClears[r]=1;a.startHunt(q)});
 await vp.waitForFunction(()=>window.__vh.sim.hunt?.quest.id==='quest.venolka.r1'&&window.__vh.sim.tick>3,null,{timeout:120000});
 await vp.evaluate(()=>{const a=window.__vh,s=a.sim,m=s.monsters.find(x=>x.def.id==='monster.venolka'),p=s.player;const z=s.monsterArea(m);if(z)s.areaId=z.id;m.aiEnabled=false;const x=m.pos.x+8,zz=m.pos.z+5,yaw=Math.atan2(m.pos.x-x,m.pos.z-zz);p.pos={x,y:s.world.groundHeight(x,zz),z:zz};p.prevPos={...p.pos};p.yaw=yaw;p.prevYaw=yaw;a.view.cam.snap(yaw)});
 await vp.waitForFunction(()=>{const r=window.__vh.view.monsterRig;return r?.root.visible&&r.root.getObjectByName('wing_wrist_l')&&r.clips?.get('vn_refill')},null,{timeout:120000,polling:100});
 const vdata=await vp.evaluate(()=>{const a=window.__vh,r=a.view.monsterRig;let bones=0,tris=0,textures=0;const layouts={};r.root.traverse(o=>{if(o.isSkinnedMesh){bones=Math.max(bones,o.skeleton.bones.length);tris+=o.geometry.index.count/3;if(o.material.map&&o.material.normalMap&&o.material.roughnessMap){textures++;layouts[o.material.name]={layout:o.material.userData.layout,base:o.material.map.image.width,normal:o.material.normalMap.image.width}}}});return{field:a.sim.field.id,bones,tris,clips:r.clips.size,textures,layouts}});
 if(vdata.field!=='field.wetland'||vdata.bones!==111||vdata.clips!==56||vdata.tris!==2298702||vdata.textures!==10||vdata.layouts.wing?.layout!=='3x2'||vdata.layouts.feather?.layout!=='4x2'||vdata.layouts.face?.layout!=='2x1'||vdata.layouts.leg?.base!==2048||vdata.layouts.leg?.normal!==2048)throw Error('Venolka '+JSON.stringify(vdata));
 await vp.screenshot({path:out+'venolka-master-r1.jpg',type:'jpeg',quality:85,timeout:120000});report.push({name:'venolka-master-r1',...vdata});console.log('VENOLKA_OK '+JSON.stringify(vdata));
 await ctx.close();
 if(errors.length)throw Error('browser errors: '+errors.join('\n'));
}finally{
 writeFileSync(out+'report.json',JSON.stringify({report,errors},null,2));
 if(browser)await browser.close();
 server.kill();
}
