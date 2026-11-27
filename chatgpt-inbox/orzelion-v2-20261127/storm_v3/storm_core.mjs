function stormKernel(){
 const RATE=60,clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),lerp=(a,b,t)=>a+(b-a)*t,rad=Math.PI/180;
 const spec={
 ground_dual_arc:{start:164,end:179,warning:75,recovery:210,angles:[-28,28],width:20,length:12,inner:2.2,damage:62},
 sky_crown:{start:189,end:219,warning:75,recovery:312,angles:[-45,0,45],width:20,length:14,inner:2.4,damage:82},
 wing_thunder_l:{start:89,end:101,warning:42,recovery:132,angles:[-77],width:26,length:8,inner:1.7,damage:50},
 wing_thunder_r:{start:89,end:101,warning:42,recovery:132,angles:[77],width:26,length:8,inner:1.7,damage:50},
 tail_pin:{start:129,end:144,warning:50,recovery:144,shape:"circle",radius:2,damage:54},
 low_pass:{start:120,end:186,warning:54,recovery:276,angles:[0],width:14,length:6.5,inner:.8,damage:60}
 };
 function transform(p,o,yaw){let c=Math.cos(yaw),s=Math.sin(yaw);return [o[0]+p[0]*c+p[1]*s,o[2]-p[0]*s+p[1]*c]}
 function polar(d,a){return [d*Math.sin(a),d*Math.cos(a)]}
 function make(name,origin=[0,0,3.4],yaw=0,instance=1,tailPoint=null){
  let s=spec[name];if(!s)return null;if(!origin.every(Number.isFinite)||!Number.isFinite(yaw))throw Error("nonfinite aim");
  let regions=[];
  if(s.shape==="circle"){let p=tailPoint||transform([0,-5],origin,yaw);regions.push({id:"tail_ground",type:"circle",polygon:Array.from({length:40},(_,i)=>[p[0]+s.radius*Math.sin(i/40*2*Math.PI),p[1]+s.radius*Math.cos(i/40*2*Math.PI)]),center:p,radius:s.radius})}
  else for(let i=0;i<s.angles.length;i++){let a=s.angles[i]*rad,d=s.width*rad/2,polygon=[polar(s.inner,a-d),polar(s.length,a-d),polar(s.length,a+d),polar(s.inner,a+d)].map(p=>transform(p,origin,yaw));regions.push({id:"lane"+i,type:"lane",polygon,from:transform(polar(s.inner*Math.cos(d),a),origin,yaw),to:transform(polar(s.length*Math.cos(d),a),origin,yaw),angle:a+yaw,inner:s.inner,length:s.length,halfWidth:d})}
  return {name,instance,origin:[...origin],yaw,regions,start:s.start,end:s.end,warning:s.warning,recovery:s.recovery,damage:s.damage}
 }
 function segDist2(x,z,a,b){let dx=b[0]-a[0],dz=b[1]-a[1],q=clamp(((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1),0,1);return (x-a[0]-q*dx)**2+(z-a[1]-q*dz)**2}
 function overlaps(poly,x,z,r=0){let sign=0,inside=true;for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length],d=(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);if(Math.abs(d)<1e-8)continue;let s=Math.sign(d);if(sign&&s!==sign)inside=false;sign=s}return inside||(r>0&&poly.some((a,i)=>segDist2(x,z,a,poly[(i+1)%poly.length])<=r*r+1e-10))}
 // The exact convex polygon used by collision also bounds all decorative ground branches.
 function constrain(region,p){let poly=region.polygon;if(overlaps(poly,p[0],p[2]))return p;let c=poly.reduce((a,b)=>[a[0]+b[0]/poly.length,a[1]+b[1]/poly.length],[0,0]),lo=0,hi=1;for(let i=0;i<28;i++){let u=(lo+hi)/2;if(overlaps(poly,lerp(c[0],p[0],u),lerp(c[1],p[2],u)))lo=u;else hi=u}return [lerp(c[0],p[0],lo*.999),p[1],lerp(c[1],p[2],lo*.999)]}
 function snapshot(a,tick){tick=Math.floor(tick);if(!a)return {phase:"idle",regions:[],damaging:false,energy:0,tick};let active=tick>=a.start&&tick<a.end,warning=tick>=a.warning&&tick<a.start,residual=tick>=a.end&&tick<a.end+18;return {phase:active?"active":warning?"warning":residual?"residual":tick>=a.end?"recovery":"charge",tick,regions:a.regions,damaging:active,energy:active?1:warning?.18+.64*(tick-a.warning)/(a.start-a.warning):residual?.4*(1-(tick-a.end)/18):0,chargeProgress:clamp(tick/a.start,0,1),instance:a.instance}}
 function hit(a,s,target,seen){if(!a||!s.damaging||s.instance!==a.instance||s.tick<a.start||s.tick>=a.end||target.y>1.1||target.y<-.5)return null;let key=a.instance+":"+target.id;if(seen.has(key))return null;let region=a.regions.find(r=>overlaps(r.polygon,target.x,target.z,target.radius??.35));if(!region)return null;seen.add(key);return {type:"thunder_hit",instance:a.instance,target:target.id,tick:s.tick,region:region.id,damage:a.damage}}
 function rng(seed){let n=seed>>>0||1;return ()=>{n^=n<<13;n^=n>>>17;n^=n<<5;return (n>>>0)/4294967296}}
 function arc(a,b,seed,amp=.25,level=5){let random=rng(seed),points=[a,b];for(let k=0;k<level;k++){let next=[points[0]];for(let j=0;j<points.length-1;j++){let p=points[j],q=points[j+1],mid=p.map((x,i)=>(x+q[i])*.5),d=q.map((x,i)=>x-p[i]),n=[-d[2],.2*(d[0]+d[2]),d[0]],l=Math.hypot(...n)||1,m=amp*.58**k*(random()*2-1);mid=mid.map((x,i)=>x+n[i]/l*m);mid[1]+=(random()-.5)*amp*.6*.63**k;next.push(mid,q)}points=next}return points}
 function regionArcs(region,tick,seed,quality=2){let random=rng(seed+Math.floor(tick/3)*65537),out=[],add=(points,width,energy,kind)=>out.push({points:points.map(p=>constrain(region,p)),width,energy,kind});if(region.type==="lane"){let a=region.from,b=region.to,dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),nx=-dz/l,nz=dx/l,pt=(u,v,y)=>[lerp(a[0],b[0],u)+nx*v,y,lerp(a[1],b[1],u)+nz*v],main=Array.from({length:25},(_,i)=>{let u=i/24,width=Math.tan(region.halfWidth)*lerp(region.inner,region.length,u)*.65;return pt(u,(random()-.5)*width,.08+random()*.18)});add(main,.085,1,"core");for(let j=0;j<quality*4;j++){let k=2+Math.floor(random()*19),u=k/24,end=clamp(u+.06+random()*.15,0,1),width=Math.tan(region.halfWidth)*lerp(region.inner,region.length,end)*.63;add(arc(main[k],pt(end,(random()<.5?-1:1)*width*(.5+random()*.4),.06+random()*.2),seed+j*655+tick,.12,3),.025,.58,"branch")}}else{let p=region.center;for(let i=0;i<quality*5;i++){let a=i/(quality*5)*Math.PI*2+random()*.12;add(arc([p[0],.2,p[1]],[p[0]+Math.sin(a)*region.radius*.94,.07,p[1]+Math.cos(a)*region.radius*.94],seed+i+tick,.12,4),.05,.75,"core")}}return out}
 return {RATE,spec,make,snapshot,hit,overlaps,constrain,arc,regionArcs,rng}
}
export {stormKernel};
