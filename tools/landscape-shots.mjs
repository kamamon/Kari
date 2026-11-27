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
 await page.goto('http://localhost:'+port+base+'?hub=menu');
 await page.waitForSelector('#boot-start:not([hidden])',{timeout:30000});
 await page.click('#boot-start');
 await page.waitForFunction(()=>!!window.__vh,null,{timeout:30000});
 const shots=[
  ['basin','a2','field-basin-meadow',false],['basin','a4','field-basin-high',true],['basin','a5','field-basin-exit',false],
  ['mistforest','a3','field-mistforest',false],['coast','a2','field-coast',false],['icegorge','a4','field-icegorge',false],
  ['wetland','a2','field-wetland',false],['ashmine','a2','field-ashmine',false],['buriedheat','a2','field-buriedheat',false]
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
 await ctx.close();
 if(errors.length)throw Error('browser errors: '+errors.join('\n'));
}finally{
 writeFileSync(out+'report.json',JSON.stringify({report,errors},null,2));
 if(browser)await browser.close();
 server.kill();
}
