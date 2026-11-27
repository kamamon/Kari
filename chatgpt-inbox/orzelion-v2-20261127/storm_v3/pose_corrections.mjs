function solvePose(g,parents,tr,rot,name,t,duration,mat,mul){
 const A=(a,b)=>a.map((v,i)=>v+b[i]),B=(a,b)=>a.map((v,i)=>v-b[i]),M=(a,k)=>a.map(v=>v*k),L=a=>Math.hypot(...a),N=a=>M(a,1/(L(a)||1)),D=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),C=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],mix=(a,b,t)=>A(M(a,1-t),M(b,t)),cl=(x,a,b)=>Math.max(a,Math.min(b,x)),smooth=x=>x*x*(3-2*x),qm=(a,b)=>[a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1],a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0],a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3],a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2]];
 let ix=new Map(g.nodes.map((n,i)=>[n.name,i])),idx=n=>ix.get(n),world=[];function refresh(){world=[];function f(i){if(world[i])return world[i];let q=mat(rot[i],tr[i]);return world[i]=parents[i]<0?q:mul(f(parents[i]),q)}for(let i=0;i<g.nodes.length;i++)f(i)}
 const pos=i=>[world[i][3],world[i][7],world[i][11]],local=(i,v)=>{if(i<0)return v;let a=world[i];return [a[0]*v[0]+a[4]*v[1]+a[8]*v[2],a[1]*v[0]+a[5]*v[1]+a[9]*v[2],a[2]*v[0]+a[6]*v[1]+a[10]*v[2]]};
 function fromTo(a,b){a=N(a);b=N(b);let d=cl(D(a,b),-1,1);if(d<-.9999){let v=N(C(a,Math.abs(a[0])<.9?[1,0,0]:[0,1,0]));return [...v,0]}return N([...C(a,b),1+d])}
 let gait=["walk","run","limp"].includes(name),air=["takeoff","flight_loop","low_pass","intro"].includes(name),rest=["fall","death","capture","sleep","wake","getup"].includes(name),land=name==="land",root=idx("root");
 let speed=gait?(name==="run"?2.6:name==="limp"?.8:1.3):0,phase=t/duration%1;if(gait)tr[root]=[tr[root][0],0,speed*t];
 refresh();let metrics={feet:[],gait,rootZ:tr[root][2],airborne:air||(land&&tr[root][1]>.12)};
 if(!air&&!rest&&(!land||tr[root][1]<.55)){
 let strength=land?1-cl(tr[root][1]/.55,0,1):1;
 for(let side of ["l","r"]){
 let s=side==="l"?-1:1,chain=["thigh","shin","hock","foot"].map(n=>idx(n+"_"+side)),[hip,knee,hock,foot]=chain;
 let a=pos(root),rootMat=world[root],p=gait?(phase+(side==="l"?0:.5))%1:0,stance=!gait||p<.62,stride=speed*duration,localZ=-.64,y=.34;
 if(gait){if(stance)localZ+=stride*(.31-p);else{let u=(p-.62)/.38;localZ+=stride*(-.31+.62*smooth(u));y+=(name==="run"?.48:.28)*Math.sin(Math.PI*u)}}
 let target=[a[0]+rootMat[0]*(s*1.62)+rootMat[2]*localZ,y,a[2]+rootMat[8]*(s*1.62)+rootMat[10]*localZ];target=mix(pos(foot),target,strength);let points=chain.map(pos),lens=points.slice(1).map((v,i)=>L(B(v,points[i]))),base=[...points[0]],range=lens.reduce((a,b)=>a+b,0),d=L(B(target,base));
 if(d>=range-.002){let unit=N(B(target,base));points=[base];for(let len of lens)points.push(A(points.at(-1),M(unit,len)))}else for(let iter=0;iter<32;iter++){points[3]=target;for(let i=2;i>=0;i--)points[i]=A(points[i+1],M(N(B(points[i],points[i+1])),lens[i]));points[0]=base;for(let i=1;i<4;i++)points[i]=A(points[i-1],M(N(B(points[i],points[i-1])),lens[i-1]));if(L(B(points[3],target))<.0003)break}
 for(let i=0;i<3;i++){let j=chain[i],k=chain[i+1],pidx=parents[j],current=local(pidx,B(pos(k),pos(j))),desired=local(pidx,B(points[i+1],pos(j)));rot[j]=N(qm(fromTo(current,desired),rot[j]));refresh()}
 let pidx=parents[foot],parentUp=local(pidx,[0,1,0]),fm=mat(rot[foot],[0,0,0]),curUp=[fm[1],fm[5],fm[9]],q=N(qm(fromTo(curUp,parentUp),rot[foot]));if(D(q,rot[foot])<0)q=M(q,-1);rot[foot]=N(mix(rot[foot],q,strength));refresh();
 let socket=pos(idx("socket_foot_contact_"+side));metrics.feet.push({side,stance,error:L(B(pos(foot),target)),groundY:socket[1],target,actual:pos(foot),lengths:lens,solvedLengths:chain.slice(1).map((v,i)=>L(B(pos(v),pos(chain[i]))))});
 }
 }
 return {world,metrics}
}
export {solvePose};
