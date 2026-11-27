function sculptV4(gltf){
 const add=(a,b)=>a.map((x,i)=>x+b[i]),sub=(a,b)=>a.map((x,i)=>x-b[i]),mul=(a,k)=>a.map(x=>x*k),mix=(a,b,t)=>add(mul(a,1-t),mul(b,t)),len=a=>Math.hypot(...a),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>mul(a,1/(len(a)||1)),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),PI=Math.PI;
 const names=new Map(gltf.nodes.map((n,i)=>[n.name,i])),jointMap=new Map(gltf.skins[0].joints.map((n,i)=>[n,i])),parent=new Int32Array(gltf.nodes.length).fill(-1);gltf.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>parent[c]=i));let wp=[];function world(i){return wp[i]??(wp[i]=parent[i]<0?(gltf.nodes[i].translation||[0,0,0]):add(world(parent[i]),gltf.nodes[i].translation||[0,0,0]))}const P=n=>world(names.get(n)),J=n=>{if(!names.has(n)||!jointMap.has(names.get(n)))throw Error("joint "+n);return jointMap.get(names.get(n))};
 const gs=Array.from({length:8},()=>({p:[],n:[],uv:[],uv1:[],j:[],w:[],idx:[]}));const stats={scutes:0,metalEdgeSections:0,teeth:0,membranePanels:0};
 function weights(a,b,t){return a===b?{[a]:1}:{[a]:1-t,[b]:t}}
 function blendWeights(a,b,t){let w={};for(let [n,x] of Object.entries(a))w[n]=(w[n]||0)+(1-t)*x;for(let [n,x] of Object.entries(b))w[n]=(w[n]||0)+t*x;return w}
 function v(m,p,w,uv,uv1=uv){let g=gs[m],i=g.p.length/3,a=Object.entries(w).filter(x=>x[1]>1e-8).sort((a,b)=>b[1]-a[1]).slice(0,4),s=a.reduce((s,x)=>s+x[1],0);if(!s)throw Error("zero weight");while(a.length<4)a.push(["root",0]);g.p.push(...p);g.n.push(0,0,0);g.uv.push(...uv);g.uv1.push(...uv1);g.j.push(...a.map(([n])=>J(n)));g.w.push(...a.map(x=>x[1]/s));return i}
 function tri(m,a,b,c){let g=gs[m];if(a!==b&&b!==c&&a!==c)g.idx.push(a,b,c)}
 function cr(a,b,c,d,t){return a.map((x,i)=>.5*((2*b[i])+(-x+c[i])*t+(2*x-5*b[i]+4*c[i]-d[i])*t*t+(-x+3*b[i]-3*c[i]+d[i])*t*t*t))}
 function tube(m,pts,rx,bs,opt={}){
  if(pts.length!==rx.length||pts.length!==bs.length)throw Error("tube mismatch "+bs.join());
  let R=opt.radial??22,D=opt.steps??5,flat=opt.flat??1,segments=(pts.length-1)*D,total=0,rings=[];
  for(let k=0;k<=segments;k++){let v0=k/segments*(pts.length-1),i=Math.min(pts.length-2,Math.floor(v0)),t=v0-i,p=cr(pts[Math.max(0,i-1)],pts[i],pts[i+1],pts[Math.min(pts.length-1,i+2)],t),r0=Array.isArray(rx[i])?rx[i]:[rx[i],rx[i]*flat],r1=Array.isArray(rx[i+1])?rx[i+1]:[rx[i+1],rx[i+1]*flat],r=mix(r0,r1,t);if(k>0)total+=len(sub(p,rings.at(-1).p));rings.push({p,r,w:weights(bs[i],bs[i+1],t),dist:total})}
  let prev=null;for(let k=0;k<rings.length;k++){let r=rings[k],d=norm(sub(rings[Math.min(k+1,rings.length-1)].p,rings[Math.max(0,k-1)].p)),u=prev?norm(sub(prev,mul(d,dot(prev,d)))):norm(cross(Math.abs(d[1])>.94?[0,0,1]:[0,1,0],d));if(len(u)<.5)u=norm(cross([0,0,1],d));let b=norm(cross(d,u));r.d=d;r.u=u;r.b=b;prev=u}
  let meanR=rings.reduce((s,r)=>s+(r.r[0]+r.r[1])/2,0)/rings.length,tex=opt.tex??(m===3?.7:m===2?.58:.65),uRepeat=Math.max(1,Math.round(2*PI*meanR/tex)),vRepeat=Math.max(.8,total/tex),start=gs[m].p.length/3;
  const point=(r,th)=>{let a=Math.cos(th),b=Math.sin(th),rib=opt.rib??0,f=1+rib*(.55*Math.cos(th*4)+.45*Math.cos(th*7+r.dist*2.3));return add(r.p,add(mul(r.u,r.r[0]*a*f),mul(r.b,r.r[1]*b*f)))};
  for(let k=0;k<rings.length;k++)for(let j=0;j<=R;j++){let u=j/R,r=rings[k],t=k/segments;v(m,point(r,u*2*PI),r.w,[u,t],[u*uRepeat,r.dist/tex])}
  for(let k=0;k<segments;k++)for(let j=0;j<R;j++){let a=start+k*(R+1)+j,b=a+R+1;tri(m,a,a+1,b);tri(m,b,a+1,b+1)}
  // Closed tube ends. Tiny end caps avoid open silhouettes.
  for(let k of [0,segments]){let r=rings[k],c=v(m,r.p,r.w,[.5,k/segments],[.5,k/segments]),off=start+k*(R+1);for(let j=0;j<R;j++)if(k===0)tri(m,c,off+j+1,off+j);else tri(m,c,off+j,off+j+1)}
  return {surface(t,th){let k=clamp(t,0,1)*segments,i=Math.min(segments-1,Math.floor(k)),u=k-i,a=rings[i],b=rings[i+1],p=mix(point(a,th),point(b,th),u),center=mix(a.p,b.p,u);return {p,n:norm(sub(p,center)),d:norm(mix(a.d,b.d,u)),w:blendWeights(a.w,b.w,u)}},length:total}
 }
 function ell(m,p,sz,b,opt={}){let steps=opt.steps??16,pts=[],rx=[];for(let i=0;i<=steps;i++){let a=-PI/2+PI*i/steps;pts.push(add(p,[0,0,sz[2]*Math.sin(a)]));rx.push([Math.max(.003,sz[0]*Math.cos(a)),Math.max(.003,sz[1]*Math.cos(a))])}return tube(m,pts,rx,pts.map(()=>b),{radial:opt.radial??24,steps:1,tex:opt.tex??.7,rib:opt.rib??.025})}
 function line(m,a,b,ra,rb,ba,bb,opt={}){return tube(m,[a,b],[ra,rb],[ba,bb],{radial:opt.radial??12,steps:opt.steps??5,flat:opt.flat??1,tex:opt.tex??.4})}
 // A sculpted leaf scute with layered raised center, tapered rear tip and real edge thickness.
 function plate(m,at,out,axis,width,length,height,w,opt={}){
  stats.scutes++;let N=opt.rows??7,M=opt.cols??6,n=norm(out),d=norm(sub(axis,mul(n,dot(axis,n)))),side=norm(cross(d,n));if(len(side)<.9)throw Error("plate frame");let start=gs[m].p.length/3,verts=[],tex=opt.tex??.48;
  function pt(t,u,back=false){let env=(.18+.82*Math.sin(PI*(t*.94+.055)))*Math.pow(1-t*.90,.46),half=width*env,bulge=height*(.20+.80*Math.sin(PI*t))*(1-.70*Math.abs(u)**1.65),tip=height*.95*t**2,notch=.075*length*(1-u*u)*Math.sin(PI*t);return add(at,add(mul(d,(t-.36)*length+notch),add(mul(side,u*half),mul(n,back?-.018:bulge+tip))))}
  for(let i=0;i<=N;i++)for(let j=0;j<=M;j++){let t=i/N,u=j/M*2-1,p=pt(t,u);verts.push(p);v(m,p,w,[j/M,t],[j/M*Math.max(1,width*2/tex),t*Math.max(1,length/tex)])}
  for(let i=0;i<N;i++)for(let j=0;j<M;j++){let a=start+i*(M+1)+j,b=a+M+1;tri(m,a,a+1,b);tri(m,b,a+1,b+1)}
  // narrow beveled trim along the selected edges; color arises from a separate physical bronze layer.
  if(opt.trim){stats.metalEdgeSections+=2;for(let s of [-1,1]){let st=gs[3].p.length/3;for(let i=0;i<=N;i++){let t=i/N;for(let u of [s*.81,s*.99]){let p=add(pt(t,u),mul(n,.012));v(3,p,w,[u===s*.81?0:1,t],[u===s*.81?0:.22,t*length/.55])}}for(let i=0;i<N;i++){let a=st+2*i,b=a+2;if(s===1){tri(3,a,a+1,b);tri(3,b,a+1,b+1)}else{tri(3,a,b,a+1);tri(3,b,b+1,a+1)}}}}
  // close the outside edge against the skin, not a floating paper shell.
  let boundary=[];for(let j=0;j<=M;j++)boundary.push([0,j]);for(let i=1;i<=N;i++)boundary.push([i,M]);for(let j=M-1;j>=0;j--)boundary.push([N,j]);for(let i=N-1;i>0;i--)boundary.push([i,0]);let st=gs[m].p.length/3;
  for(let [i,j] of boundary){let t=i/N,u=j/M*2-1;v(m,pt(t,u),w,[j/M,t]);v(m,pt(t,u,true),w,[j/M,t])}for(let i=0;i<boundary.length;i++){let a=st+i*2,b=st+((i+1)%boundary.length)*2;tri(m,a,b,a+1);tri(m,a+1,b,b+1)}
 }
 function on(s,t,theta,width,length,height,opt={}){let x=s.surface(t,theta);plate(opt.m??1,add(x.p,mul(x.n,.01)),x.n,mul(x.d,opt.forward?1:-1),width,length,height,x.w,opt)}
 const spine=["pelvis","spine_01","spine_02","spine_03","spine_04","spine_05","chest","neck_01","neck_02","neck_03","neck_04","head"];
 let trunk=tube(0,[[0,3.25,-2.25],...spine.map(P),[0,5.54,5.2]],[.10,[1.00,.92],[1.30,1.05],[1.50,1.20],[1.61,1.36],[1.72,1.52],[1.68,1.52],[1.52,1.44],[1.01,.96],[.84,.79],[.70,.72],[.65,.65],[.70,.63],[.40,.30]],["pelvis",...spine,"head"],{radial:36,steps:6,rib:.04,tex:.70});
 // Dark flank scutes and plated dorsal crest follow the actual skin, not world-space boxes.
 for(let i=0;i<13;i++){let t=.12+i*.061,neck=t>.56;for(let a of [24,58,91,124,157]){let theta=(a+(i%2?6:-5))*PI/180,s=neck?.70:1;on(trunk,t,theta,(neck?.22:.33)*(a===91?1.12:1),(neck?.75:.96)*(a===91?1.17:1),neck?.15:.18,{trim:(a===91||i%3===0),rows:6,cols:5})}}
 // Pale ventral scutes wrap underneath the chest/neck with a central keel.
 for(let i=0;i<14;i++){let t=.12+i*.059,neck=t>.55;for(let a of [218,270,322]){let s=neck?.72:1;on(trunk,t,a*PI/180,(a===270?.46:.30)*s,(neck?.64:.82),.11*s,{m:2,rows:6,cols:5})}}
 // Skull and lower mandible: sharper snout, brow, recessed mouth, discrete upper/lower teeth.
 let skull=tube(0,[[0,5.48,4.35],[0,5.61,4.75],[0,5.63,5.12],[0,5.49,5.52],[0,5.43,5.91],[0,5.39,6.25]],[ [.22,.26],[.64,.63],[.71,.56],[.62,.40],[.44,.24],[.09,.10]],Array(6).fill("head"),{radial:36,steps:6,rib:.05,tex:.32});
 let jaw=tube(0,[[0,5.18,4.92],[0,5.02,5.25],[0,5.00,5.67],[0,5.12,6.08]],[ [.51,.23],[.54,.24],[.39,.17],[.10,.07]],Array(4).fill("jaw"),{radial:28,steps:6,tex:.32});
 tube(5,[[0,5.24,5.0],[0,5.22,5.54],[0,5.24,6.01]],[[.42,.10],[.35,.075],[.06,.025]],["jaw","jaw","jaw"],{radial:20,steps:5,tex:.4});
 for(let a of [28,65,115,152])for(let t of [.27,.48,.66,.82])on(skull,t,a*PI/180,.17,.43,.09,{trim:t<.5,rows:5,cols:5});
 for(let l of ["l","r"]){let s=l==="l"?-1:1,p=(x,y,z)=>[s*x,y,z],n=x=>x+"_"+l;
  ell(5,p(.665,5.70,5.39),[.135,.22,.30],"head",{radial:20,tex:.3});
  ell(6,p(.735,5.72,5.46),[.075,.115,.145],n("eye"),{radial:24,tex:.3});
  ell(5,p(.798,5.72,5.48),[.014,.095,.038],n("eye"),{radial:12,tex:.2});
  plate(1,p(.58,5.93,5.34),norm(p(.62,.50,.22)),p(.12,.04,-1),.22,.82,.12,{head:1},{trim:true});
  plate(1,p(.66,5.45,4.96),norm(p(.88,.12,.05)),p(.10,-.14,-1),.29,.99,.19,{head:1},{trim:true});
  plate(1,p(.53,5.26,4.67),norm(p(.70,-.40,-.10)),p(.08,.08,-1),.21,.71,.10,{jaw:1});
  ell(5,p(.36,5.53,5.98),[.052,.07,.10],"head",{radial:12,tex:.2});
  for(let i=0;i<9;i++){let z=5.18+i*.098,x=.42-.18*(i/8),length=i===2||i===6?.20:.105+.028*Math.sin(i*1.7);tube(2,[p(x,5.36,z),p(x*.94,5.36-length*.65,z-.025),p(x*.82,5.36-length,z-.06)],[.055,.029,.005],["head","head","head"],{radial:10,steps:3,tex:.2});tube(2,[p(x*.94,5.15,z-.025),p(x*.89,5.15+length*.5,z-.05),p(x*.80,5.15+length*.68,z-.08)],[.047,.023,.004],["jaw","jaw","jaw"],{radial:10,steps:3,tex:.2});stats.teeth+=2}
  // Two real crown horns; ridge scutes on their surface create the ancient layered silhouette.
  let horn=tube(3,[P(n("crown")),p(.70,6.18,4.58),p(1.02,6.47,3.84),p(1.36,6.77,2.78),p(1.73,6.80,1.80),p(1.89,6.57,1.15)],[[.29,.25],[.38,.28],[.31,.23],[.23,.16],[.11,.075],[.004,.004]],Array(6).fill(n("crown")),{radial:28,steps:7,tex:.46,rib:.08});for(let t of [.17,.36,.55,.73])for(let a of [53,124,200,318])on(horn,t,a*PI/180,.13*(1-t)+.04,.50*(1-t)+.18,.09*(1-t)+.03,{m:3,forward:true,rows:5,cols:4});
  // Mineralized chest mantle; overlapping chest plates obscure the toy-like isolated spheres.
  let sac=n("charge_sac"),cp=p(.82,3.67,2.23),c=ell(0,cp,[.83,.84,1.0],sac,{radial:26,tex:.56});for(let t of [.30,.48,.65])for(let a of [15,55,115,155])on(c,t,a*PI/180,.30,.72,.15,{trim:t!==.48,rows:6,cols:5});ell(7,p(.69,3.45,2.94),[.22,.25,.135],sac,{radial:20,tex:.35});
  plate(2,p(.33,3.33,2.96),norm(p(.4,-.10,.9)),p(.08,-1,-.20),.30,.93,.13,{[sac]:.55,sternum:.45},{m:2,trim:false});
  let arm=[n("scapula"),n("humerus"),n("humerus_twist"),n("forearm"),n("forearm_twist"),n("wrist")],wingArm=tube(0,arm.map(P),[[.65,.57],[.88,.67],[.58,.49],[.42,.36],[.33,.27],[.30,.25]],arm,{radial:28,steps:7,tex:.54,rib:.04});
  for(let i=0;i<9;i++){let t=.11+i*.098;for(let a of [35,82,135])on(wingArm,t,a*PI/180,.22*(1-.5*t),.64*(1-.35*t),.11*(1-.45*t),{trim:a===82||i%2===0,rows:5,cols:5})}
  // Two continuous conductive channels, split into short overlapping scales so joints stay flexible.
  for(let lane of [-1,1])for(let i=0;i<8;i++){let t=.13+i*.105,x=wingArm.surface(t,(90+lane*29)*PI/180);plate(3,add(x.p,mul(x.n,.012)),x.n,x.d,.10,.67*(1-.28*t),.09,x.w,{rows:5,cols:4})}
  let thumb=[n("wrist"),n("thumb_01"),n("thumb_02")];tube(0,thumb.map(P),[.19,.17,.09],thumb,{radial:18,steps:5,tex:.4});tube(3,[P(n("thumb_02")),add(P(n("thumb_02")),p(.02,-.13,.23)),add(P(n("thumb_02")),p(-.10,-.40,.18))],[.14,.075,.004],Array(3).fill(n("thumb_02")),{radial:16,steps:5,tex:.35});
  let fingers=[];for(let f=2;f<=5;f++){let chain=[n("wrist"),...Array.from({length:3},(_,i)=>n("wing_digit_"+f+"_0"+(i+1)))];fingers.push(chain);let digit=tube(0,chain.map(P),[[.23,.20],[.20,.16],[.125,.10],[.012,.01]],chain,{radial:18,steps:8,tex:.55,rib:.04});if(f===2)for(let i=0;i<12;i++)on(digit,.07+i*.077,PI/2,.12*(1-i*.04),.76*(1-i*.045),.095*(1-i*.045),{m:3,forward:true,rows:5,cols:4});else for(let t of [.22,.49,.74])on(digit,t,PI/2,.11,.49,.07,{forward:true,rows:5,cols:4})}
  function membrane(a,b){stats.membranePanels++;let N=24,M=18,st=gs[4].p.length/3;function sample(ch,t){let v=t*(ch.length-1),i=Math.min(ch.length-2,Math.floor(v)),f=v-i,pts=ch.map(P);return [cr(pts[Math.max(0,i-1)],pts[i],pts[i+1],pts[Math.min(pts.length-1,i+2)],f),weights(ch[i],ch[i+1],f)]}for(let i=0;i<=N;i++){let t=i/N,[pa,wa]=sample(a,t),[pb,wb]=sample(b,t);for(let j=0;j<=M;j++){let u=j/M,p=mix(pa,pb,u),en=Math.sin(PI*u)*Math.sin(PI*t);p[1]-=.55*en+.07*en*Math.sin(PI*(u*4+t*2));if(i>0)p[2]+=.48*Math.sin(PI*u)*t**5;v(4,p,blendWeights(wa,wb,u),[u,t],[u*1.25,t*2.5])}}for(let i=0;i<N;i++)for(let j=0;j<M;j++){let a=st+i*(M+1)+j,b=a+M+1;if(i!==0)tri(4,a,b,a+1);tri(4,a+1,b,b+1)}}
  for(let i=0;i<3;i++)membrane(fingers[i],fingers[i+1]);membrane(fingers[3],[n("wrist"),n("forearm"),"sternum",n("thigh")]);
  // Muscular hindquarters and tapered digitigrade shins.
  let leg=[n("thigh"),n("thigh_twist"),n("shin"),n("hock"),n("foot")],L=tube(0,leg.map(P),[[.79,.69],[.84,.78],[.53,.43],[.31,.27],[.39,.32]],leg,{radial:30,steps:7,tex:.55,rib:.035});for(let i=0;i<7;i++){let t=.14+i*.115;for(let a of [8,50,110,155])on(L,t,a*PI/180,.23*(1-.40*t),.59*(1-.20*t),.105,{trim:i<4&&a<100,rows:6,cols:5})}
  for(let k=1;k<=3;k++){let b=n("toe_"+k);tube(0,[P(n("foot")),P(b),add(P(b),p((k-2)*.07,-.012,.20))],[.19,.20,.13],[n("foot"),b,b],{radial:20,steps:5,tex:.28});tube(3,[add(P(b),[0,.04,.13]),add(P(b),p((k-2)*.07,-.02,.38)),add(P(b),p((k-2)*.10,-.10,.60))],[.15,.08,.004],[b,b,b],{radial:18,steps:5,tex:.33})}
  let b=n("toe_rear");tube(3,[P(b),add(P(b),[0,-.035,-.2]),add(P(b),[0,-.075,-.39])],[.13,.07,.004],[b,b,b],{radial:14,steps:4,tex:.3})
 }
 let tails=["pelvis",...Array.from({length:12},(_,i)=>"tail_"+String(i+1).padStart(2,"0"))],tail=tube(0,tails.map(P),tails.map((_,i)=>{let r=.83*Math.pow(1-i/14,1.34)+.035;return[r,r*.88]}),tails,{radial:30,steps:5,tex:.62,rib:.035});for(let i=0;i<18;i++){let t=.08+i*.049,scale=.95-.65*t;for(let a of [25,62,92,123,158])on(tail,t,a*PI/180,.29*scale,.77*scale,.14*scale,{trim:a===92||i%4===0,forward:true,rows:5,cols:5});if(i%2===0)on(tail,t,270*PI/180,.36*scale,.7*scale,.07*scale,{m:2,forward:true,rows:5,cols:5})}
 // Exactly three spear blades, overlapping like the source concept.
 let tp=P("tail_12");for(let d of [-1,0,1]){let m=d===0?3:1,axis=[d*.10,.04,-1];plate(m,add(tp,[d*.20,d===0?.18:-.05,-.45]),norm([d*.36,d===0?1:.58,-.12]),axis,.26,1.82,.23,{tail_12:1},{trim:true,rows:10,cols:8,tex:.45})}
 // Accumulate normals; skip tiny degenerate triangles (collapsed membrane root).
 let removed=0;
 for(let g of gs){let kept=[];for(let i=0;i<g.idx.length;i+=3){let a=g.idx[i],b=g.idx[i+1],c=g.idx[i+2],pa=g.p.slice(a*3,a*3+3),pb=g.p.slice(b*3,b*3+3),pc=g.p.slice(c*3,c*3+3),n=cross(sub(pb,pa),sub(pc,pa));if(len(n)<1e-10){removed++;continue}kept.push(a,b,c);for(let j of [a,b,c])for(let k=0;k<3;k++)g.n[j*3+k]+=n[k]}g.idx=kept;for(let i=0;i<g.n.length;i+=3){let n=norm(g.n.slice(i,i+3));if(len(n)<.5)n=[0,1,0];g.n.splice(i,3,...n)}}
 // Preserve old animation and inverse-bind accessors byte-for-byte; add a separate buffer per material.
 let out=JSON.parse(JSON.stringify(gltf)),binaries={},old=out.buffers[0].uri;out.buffers[0].uri="orzelion_v4_motion.bin";binaries["orzelion_v4_motion.bin"]={base64:old.split(",")[1]};
 out.asset.generator="Kari Orzelion V4 layered sculpt";out.asset.extras={status:"procedural sculpt candidate; rig and clips preserved",units:"m",forward:"+Z"};
 function pack(g,i){let chunks=[],size=0,buffer=out.buffers.length;function acc(a,type,comp,target,range=false){let C=comp===5126?Float32Array:comp===5125?Uint32Array:Uint16Array,arr=new C(a),raw=new Uint8Array(arr.buffer),pad=(4-size%4)%4;if(pad){chunks.push(new Uint8Array(pad));size+=pad}let vi=out.bufferViews.length;out.bufferViews.push({buffer,byteOffset:size,byteLength:raw.length,target});chunks.push(raw);size+=raw.length;let width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type],ac={bufferView:vi,componentType:comp,count:a.length/width,type};if(range){ac.min=Array(width).fill(Infinity);ac.max=Array(width).fill(-Infinity);for(let j=0;j<a.length;j++){let k=j%width;ac.min[k]=Math.min(ac.min[k],a[j]);ac.max[k]=Math.max(ac.max[k],a[j])}}out.accessors.push(ac);return out.accessors.length-1}
  let p={attributes:{POSITION:acc(g.p,"VEC3",5126,34962,true),NORMAL:acc(g.n,"VEC3",5126,34962),TEXCOORD_0:acc(g.uv,"VEC2",5126,34962),TEXCOORD_1:acc(g.uv1,"VEC2",5126,34962),JOINTS_0:acc(g.j,"VEC4",5123,34962),WEIGHTS_0:acc(g.w,"VEC4",5126,34962)},indices:acc(g.idx,"SCALAR",g.p.length/3>65535?5125:5123,34963),material:i};let data=new Uint8Array(size),o=0;for(let c of chunks){data.set(c,o);o+=c.length}let uri=`orzelion_v4_mesh_${i}.bin`;out.buffers.push({uri,byteLength:size});binaries[uri]=data;return p
 }
 out.meshes[0].name="Orzelion_V4_Armored";out.meshes[0].primitives=gs.map(pack);
 let materialSpecs=[
 ["hide","hide",[.74,.84,1],0,.88],["scale","scute",[.83,.91,1],.10,.75],["ivory","ivory",[1,.96,.86],0,.92],["bronze","bronze",[1,.96,.86],.94,.72],["membrane","membrane",[1,.93,.81],0,.92],["shadow",null,[.035,.019,.016],0,.82],["eye",null,[.36,.72,.96],.08,.22],["crystal",null,[.10,.30,.48],.3,.28]];
 out.images=[];out.textures=[];out.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
 out.materials=materialSpecs.map(([name,set,tint,metal,rough],i)=>{let pbr={baseColorFactor:[...tint,1],metallicFactor:metal,roughnessFactor:rough},m={name,pbrMetallicRoughness:pbr,doubleSided:i===4};if(set){let refs=[];for(let kind of ["base","normal","orm"]){let image=out.images.length;out.images.push({uri:`../textures/${set}_${kind}.png`,name:`${set}_${kind}`});refs.push(out.textures.length);out.textures.push({sampler:0,source:image})}pbr.baseColorTexture={index:refs[0],texCoord:1};pbr.metallicRoughnessTexture={index:refs[2],texCoord:1};m.normalTexture={index:refs[1],texCoord:1,scale:i===4?.65:.85};m.occlusionTexture={index:refs[2],texCoord:1,strength:.72}}if(i===6)m.emissiveFactor=[.18,.42,.7];return m});
 const validation={baseJoints:gltf.skins[0].joints.length,joints:out.skins[0].joints.length,animationCount:out.animations.length,sockets:out.nodes.filter(n=>n.name.startsWith("socket_")).length,animationMetadataUnchanged:JSON.stringify(out.animations)===JSON.stringify(gltf.animations),jointHierarchyUnchanged:JSON.stringify(out.nodes)===JSON.stringify(gltf.nodes),scuteCount:stats.scutes,metalEdgeSections:stats.metalEdgeSections,teeth:stats.teeth,membranePanels:stats.membranePanels,vertices:gs.reduce((s,g)=>s+g.p.length/3,0),triangles:gs.reduce((s,g)=>s+g.idx.length/3,0),removedDegenerateTriangles:removed,perMaterial:gs.map((g,i)=>({i,vertices:g.p.length/3,triangles:g.idx.length/3,bytes:out.buffers[i+1].byteLength})),bounds:[0,1,2].map(k=>{let lo=Infinity,hi=-Infinity;for(let g of gs)for(let i=k;i<g.p.length;i+=3){lo=Math.min(lo,g.p[i]);hi=Math.max(hi,g.p[i])}return[lo,hi]}),validWeights:gs.every(g=>g.w.every(Number.isFinite)&&g.j.every(j=>j>=0&&j<95)&&Array.from({length:g.w.length/4},(_,i)=>Math.abs(g.w.slice(i*4,i*4+4).reduce((a,b)=>a+b,0)-1)).every(x=>x<1e-6)),validIndices:gs.every(g=>g.idx.every(i=>i>=0&&i<g.p.length/3)),finite:gs.every(g=>g.p.every(Number.isFinite)&&g.n.every(Number.isFinite)&&g.uv1.every(Number.isFinite))};
 if(!validation.animationMetadataUnchanged||!validation.jointHierarchyUnchanged||!validation.validWeights||!validation.validIndices||!validation.finite)throw Error(JSON.stringify(validation));
 return {gltf:out,binaries,geometry:gs,validation}
}
export {sculptV4};
