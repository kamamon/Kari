// 原創音源「灯の尾根」。独自の旋律・弦の倍音・息のノイズ・木の打音をPCMへ合成。
// 既存ゲームの曲やサンプル音源は用いない。決定的な16kHz波形をWebAudioに渡す。
export type HubSample='goat'|'hen'|'ox'|'mine'|'fish'|'thunder'|'door'|'feed'|'reward';
const SR=16000,TAU=Math.PI*2;
const noise=(n:number)=>{let x=Math.imul(n+379,1103515245);x=Math.imul(x^(x>>>13),2246822519);return ((x^(x>>>16))>>>0)/2147483648-1;};
const hz=(midi:number)=>440*2**((midi-69)/12);
const soft=(x:number)=>Math.tanh(x);
function string(f:number,t:number):number{
 if(t<0||t>1.85)return 0;const env=Math.min(1,t/.018)*Math.exp(-t*3.4)*Math.min(1,(1.85-t)/.08);
 return env*(Math.sin(TAU*f*t)+.23*Math.sin(TAU*f*2.002*t)+.11*Math.sin(TAU*f*3.008*t)+.05*Math.sin(TAU*f*4.017*t));
}
function flute(f:number,t:number,d:number):number{
 if(t<0||t>=d)return 0;const env=Math.min(1,t/.16)*Math.min(1,(d-t)/.20);
 return env*(Math.sin(TAU*f*t+.11*Math.sin(TAU*4.8*t))+.16*Math.sin(TAU*f*2*t)+.034*noise(Math.floor(t*SR)));
}
export const HUB_SAMPLE_RATE=SR;
export function hubScore(watch=false):Float32Array{
 const bars=8,beat=.64,len=bars*4*beat,N=Math.round(len*SR),out=new Float32Array(N);
 // 32 beat original phrase, independently arranged in calm / watch variants.
 const phrase=[62,69,67,64,62,57,60,64,65,69,72,69,67,64,60,57,62,65,69,67,64,60,57,60,62,64,67,65,64,60,57,62];
 const root=[50,53,55,48,50,53,55,50];
 for(let i=0;i<N;i++){
  const t=i/SR,b=Math.floor(t/beat),bar=Math.floor(b/4),phase=t-b*beat;let y=0;
  for(let prev=0;prev<3;prev++){const index=(b-prev+phrase.length)%phrase.length;
   const midi=watch?phrase[index]!-([3,7,11,15,19,23,27,31].includes(index)?2:0):phrase[index]!;
   y+=.13*string(hz(midi),phase+prev*beat);
  }
  for(let prev=0;prev<2;prev++){const ii=(bar-prev+bars)%bars,age=t-bar*4*beat+prev*4*beat;
   y+=.09*string(hz(root[ii]!),age)+.052*string(hz(root[ii]!+(watch?7:12)),age-.04);
  }
  const cell=Math.floor(b/2)*2,fl=t-cell*beat;
  y+=.047*flute(hz(phrase[(cell+6)%32]!+12),fl,2*beat-.02);
  if(watch)y+=.034*Math.sin(TAU*hz(root[bar]!-12)*t)*Math.sin(Math.PI*(t% (4*beat))/(4*beat))**2;
  if(b%4===0)y+=.06*noise(i)*Math.exp(-phase*23)*Math.min(1,phase/.01);
  const fade=Math.min(1,t/.15,(len-t)/.15);
  out[i]=fade<=0?0:soft(y)*fade;
 }
 return out;
}
export function hubSample(kind:HubSample):Float32Array{
 const dur:Record<HubSample,number>={goat:1.3,hen:.55,ox:1.5,mine:.65,fish:.72,thunder:3.2,door:.48,feed:.5,reward:1.1};
 const out=new Float32Array(Math.round(SR*dur[kind]));
 for(let i=0;i<out.length;i++){
  const t=i/SR,u=t/dur[kind],n=noise(i),env=Math.min(1,t/.012)*Math.max(0,Math.min(1,(1-u)*7));let y=0;
  if(kind==='goat'||kind==='ox'){
   const f=kind==='goat'?245:110,v=TAU*(f*t+22*Math.sin(t*4)*t);
   y=(Math.sin(v+.22*Math.sin(TAU*9*t))+.36*Math.sin(v*2.05)+.16*Math.sin(v*3.08)+.08*n)*(.5+.5*Math.sin(Math.PI*u))*env*.25;
  }else if(kind==='hen'){
   const f=760-240*u,env2=Math.max(0,Math.sin(t*TAU*7));y=(Math.sin(TAU*f*t)+.27*Math.sin(TAU*f*2.14*t))*env*env2*.19;
  }else if(kind==='mine'){
   y=(.23*Math.sin(TAU*920*t)*Math.exp(-t*22)+.16*Math.sin(TAU*1547*t)*Math.exp(-t*16)+.21*n*Math.exp(-t*35))*env;
  }else if(kind==='fish'){
   y=(.11*n+.13*Math.sin(TAU*(420*t-150*t*t)))*Math.exp(-u*4)*env*(.6+.4*Math.sin(t*40)**2);
  }else if(kind==='thunder'){
   y=(.25*Math.sin(TAU*37*t+.5*Math.sin(t*7))+.14*Math.sin(TAU*53*t)+.10*n)*env*Math.exp(-u*3.2)*Math.min(1,t/.12);
  }else if(kind==='door'){
   y=(.11*Math.sin(TAU*(168*t+85*t*t))+.12*n)*env*Math.exp(-u*5);
  }else if(kind==='feed'){
   y=.15*n*env*Math.sin(t*TAU*8)**2*Math.exp(-u*3);
  }else{
   y=.2*string(hz(69),t)+.16*string(hz(74),t-.16)+.13*string(hz(77),t-.32);
  }
  out[i]=soft(y);
 }
 return out;
}
export class HubSoundtrack{
 private score:AudioBufferSourceNode[]=[];private gain:GainNode[]=[];private samples=new Map<HubSample,AudioBuffer>();
 private active=false;private watch=false;
 constructor(private ctx:AudioContext,private music:AudioNode,private env:AudioNode,private effects:AudioNode){}
 private buffer(data:Float32Array):AudioBuffer{const b=this.ctx.createBuffer(1,data.length,SR);b.getChannelData(0).set(data);return b;}
 set(active:boolean,watch:boolean){
  if(!this.score.length&&active){
   for(let i=0;i<2;i++){const src=this.ctx.createBufferSource(),g=this.ctx.createGain();src.buffer=this.buffer(hubScore(i===1));src.loop=true;g.gain.value=0;src.connect(g).connect(this.music);src.start();this.score.push(src);this.gain.push(g);}
  }
  if(this.active===active&&this.watch===watch)return;
  this.active=active;this.watch=watch;
  for(let i=0;i<this.gain.length;i++)this.gain[i]!.gain.setTargetAtTime(active&&i===Number(watch)?.48:0,this.ctx.currentTime,.50);
 }
 play(kind:HubSample,intensity=1){
  if(this.ctx.state!=='running')return;
  let b=this.samples.get(kind);if(!b){b=this.buffer(hubSample(kind));this.samples.set(kind,b);}
  const source=this.ctx.createBufferSource(),g=this.ctx.createGain();source.buffer=b;g.gain.value=Math.min(1,Math.max(0,intensity));source.connect(g).connect(['goat','hen','ox','thunder'].includes(kind)?this.env:this.effects);source.start();source.onended=()=>{source.disconnect();g.disconnect();};
 }
}
