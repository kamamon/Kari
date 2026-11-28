// Kari independent animation candidates, derived from its current rig (not PSP motion capture).
import { B, state, family, curve, r4, sheathOf } from './lib.mjs';
const clone = structuredClone;
const ID = (f,n) => 'player.'+f+'.'+n;
export function extraWeapons() {
  function kit(id, old, shape, hands) {
    const oldF = state.stances[old];
    const k = family(id, hands ?? clone(oldF.hands), shape);
    k.fam.stances = clone(oldF.stances);
    k.fam.sheath = clone(oldF.sheath);
    return {...k,id,shape,old};
  }
  // Retiming a current Kari motion also retimes feet and movement. No duplicate hit windows.
  function reuse(k,name,source,duration,opts={}) {
    const a = state.out[k.old].actions.find(x=>x.actionId===ID(k.old,source));
    if (!a) throw Error('missing motion source: '+source);
    const m=clone(state.motions[a.clip]), ratio=duration/m.dur, t=x=>r4(x*ratio);
    const clip='xw_'+k.id+'_'+name;
    m.family=k.id; m.dur=duration;
    for(const ks of Object.values(m.ch)) for(const row of ks) row[0]=t(row[0]);
    for(const ks of Object.values(m.feet)) for(const row of ks){row[0]=t(row[0]);row[1]=t(row[1]);}
    if(m.skipBody) m.skipBody=m.skipBody.map(t);
    if(m.spin) throw Error('unsupported source spin '+source);
    let root;
    if(m.root){ const keys=m.root.map(([a,b])=>[t(a),b]); root=curve(clip,keys); m.root=keys; }
    state.motions[clip]=m;
    const track=k.trackOf(clip,k.shape,m);
    const hw=a.hitWindows??[];
    const hits=opts.coefs?hw.map((h,i)=>({id:name+'_'+i,from:Math.round(t(h.from)),to:Math.round(t(h.to)),track,coef:opts.coefs[i]??opts.coefs[0],type:opts.type??h.damageType,hitstop:h.hitstopTicks})):undefined;
    const active=hits?.length?[hits[0].from,Math.max(...hits.map(h=>h.to))]:undefined;
    const cancelAt=Math.min(duration-1,Math.max(active?.[1]??0,Math.round(duration*.76)));
    k.action(name,{clip,dur:duration,track,curve:root,active,hits,
      cancels:opts.into?[[cancelAt,duration,opts.into]]:[],
      finish:opts.finish??a.onFinish,trail:!!hits?.length,
      ...(opts.sound?{sound:[Math.max(1,active?.[0]??Math.floor(duration*.45)),opts.sound]}:{}),
      ...(opts.guard?{guardWindows:[{from:0,to:duration}]}:{}),
      ...(opts.dodge?{dodge:true,invulnerable:[{from:3,to:Math.min(duration-1,16)}],staminaCost:12}:{}),
    });
  }
  // A new stationary gesture with a body anticipation, contact/recoil and recovery.
  // All keys are actor-local/chest-local data consumed by the same IK as the other families.
  function gesture(k,name,duration,keys,o={}) {
    const clip='xw_'+k.id+'_'+name;
    const idle=k.fam.stances.idle;
    const m=k.motion(clip,{dur:duration,from:o.from??idle,to:o.to??idle,root:o.root,keys,feet:o.feet,skipBody:o.skipBody});
    const track=k.trackOf(clip,k.shape,m);
    let hits;
    if(o.hit){const ht=o.hit.shape?k.trackOf(clip+'_hit',o.hit.shape,m):track;
      hits=[{id:name,track:ht,coef:o.hit.coef,type:o.hit.type,hitstop:o.hit.stop??3}];}
    const at=o.active?.[1]??Math.floor(duration*.6);
    k.action(name,{clip,dur:duration,track,curve:o.root,active:o.active,hits,
      finish:o.finish??'drawn_idle',trail:!!hits?.length&&!o.hit?.shell,
      ...(o.shoot?{shoot:o.shoot}:{}),...(o.sound?{sound:o.sound}:{}),
      ...(o.guard?{guardWindows:[{from:0,to:duration}]}:{}),
      ...(o.dodge?{dodge:true,invulnerable:[{from:3,to:Math.min(16,duration-1)}],staminaCost:12}:{}),
      ...(o.into?{cancels:[[Math.max(at,Math.floor(duration*.8)),duration,o.into]]}:{}),
    });
  }
  const shift=(ctl,n,scale=1)=>[ctl.hip[0],ctl.hip[1]-n*.05*scale,ctl.hip[2]+n*.025*scale];
  const horn=kit('hunting_horn','war_maul',{from:.95,to:1.27,radius:.20,maxTurn:1200});
  reuse(horn,'swing_left','swing',56,{coefs:[.32],type:'blunt',into:['xw_hh_right','xw_hh_slam','roll'],sound:'hb_swing_01'});
  reuse(horn,'swing_right','smash',64,{coefs:[.34],type:'blunt',into:['xw_hh_left','xw_hh_slam','roll'],sound:'hb_swing_02'});
  const h=horn.fam.stances.idle.ctl;
  gesture(horn,'poke',40,[{t:8,hip:shift(h,1),grip:[h.grip[0],h.grip[1],h.grip[2]-.06]},
    {t:15,hip:shift(h,1),grip:[h.grip[0],h.grip[1],h.grip[2]+.07]}, {t:22,hip:shift(h,1),grip:[h.grip[0],h.grip[1],h.grip[2]+.03]}],
    {active:[14,20],hit:{coef:.13,type:'blunt',shape:{from:.1,to:.45,radius:.12}},sound:[14,'hb_swing_02'],into:['xw_hh_left','roll']});
  reuse(horn,'slam','pound',102,{coefs:[.21,.62],type:'blunt',sound:'hb_swing_01',into:['roll']});
  for(const [name,dur,n,sound] of [['recital_enter',48,1,'xw_note_1'],['play_note1',60,1,'xw_note_1'],['play_note2',64,2,'xw_note_2'],['play_note3',68,3,'xw_note_3'],['recital_exit',36,0,null]]) {
    const at=Math.floor(dur*.48), amount=.025*(n+1);
    gesture(horn,name,dur,[{t:Math.floor(at*.55),hip:shift(h,1),grip:[h.grip[0]+.015,h.grip[1]+amount,h.grip[2]+.015],chest:[h.chest[0],h.chest[1]+n*2,h.chest[2]]},
      {t:at,hip:shift(h,1),grip:[h.grip[0]+.025,h.grip[1]+amount*1.4,h.grip[2]+.035],look:[0,-3]},{t:Math.floor(dur*.76),hip:shift(h,.5)}],
      {active:[at,at+1],sound:sound?[at,sound]:undefined,into:['roll']});
  }
  reuse(horn,'draw','draw',44,{sound:'hb_draw_01'});
  reuse(horn,'sheathe','sheathe',46,{sound:'hb_sheathe_01'});
  const gl=kit('gunlance','long_lance',{from:.9,to:2.36,radius:.10,maxTurn:900});
  reuse(gl,'thrust','thrust1',45,{coefs:[.42],into:['xw_gl_thrust2','xw_gl_shell','xw_gl_upper','roll'],sound:'hb_swing_02'});
  reuse(gl,'thrust2','thrust2',45,{coefs:[.46],into:['xw_gl_thrust3','xw_gl_shell','xw_gl_upper','roll'],sound:'hb_swing_02'});
  reuse(gl,'thrust3','thrust3',53,{coefs:[.6],into:['xw_gl_shell','roll'],sound:'hb_swing_02'});
  reuse(gl,'uppercut','high1',53,{coefs:[.58],into:['xw_gl_thrust','xw_gl_shell','roll'],sound:'hb_swing_02'});
  reuse(gl,'guard_thrust','guard_thrust',50,{coefs:[.34],guard:true,sound:'hb_swing_02'});
  const g=gl.fam.stances.idle.ctl;
  const gunKeys=(ctl,dur,at,force=1)=>[
    {t:Math.max(1,at-8),hip:shift(ctl,.7),grip:[ctl.grip[0],ctl.grip[1],ctl.grip[2]+.02]},
    {t:at,hip:shift(ctl,1),grip:[ctl.grip[0],ctl.grip[1],ctl.grip[2]-.025*force]},
    {t:at+Math.min(7,Math.floor((dur-at)/2)),hip:shift(ctl,1),grip:[ctl.grip[0],ctl.grip[1]+.015*force,ctl.grip[2]-.06*force]},
    {t:Math.min(dur-1,Math.floor(dur*.82)),hip:shift(ctl,.3)}
  ];
  gesture(gl,'shell',58,gunKeys(g,58,18),{active:[18,22],hit:{coef:.37,type:'shot',shape:{from:1.82,to:2.85,radius:.36},shell:true,stop:4},sound:[18,'xw_shell'],into:['xw_gl_thrust','xw_gl_shell','roll']});
  gesture(gl,'wyvern_fire',174,gunKeys(g,174,86,1.25),{active:[86,103],hit:{coef:2.5,type:'shot',shape:{from:1.85,to:3.6,radius:.62},shell:true,stop:8},sound:[86,'xw_shell_heavy']});
  gesture(gl,'reload',91,[{t:24,hip:shift(g,1),grip:[g.grip[0],g.grip[1]+.06,g.grip[2]-.05]}, {t:53,hip:shift(g,1),grip:[g.grip[0],g.grip[1]+.045,g.grip[2]-.07]}, {t:73,hip:shift(g,.5)}],{active:[53,54],sound:[53,'xw_reload']});
  gesture(gl,'guard',36,[{t:9,...gl.fam.stances.guard.ctl},{t:28,...gl.fam.stances.guard.ctl}],{guard:true});
  reuse(gl,'hop','hop',30,{dodge:true});
  reuse(gl,'backstep','backstep',38,{dodge:true});
  reuse(gl,'draw','draw',42,{sound:'hb_draw_01'});
  reuse(gl,'sheathe','sheathe',46,{sound:'hb_sheathe_01'});
  for(const heavy of [false,true]){
    const id=heavy?'heavy_bowgun':'light_bowgun', len=heavy?1.05:.78;
    const k=kit(id,'long_lance',{from:.20,to:len,radius:.065,maxTurn:900},{primary:'R',second:'along',along:.28,wrist:[0,155]});
    delete k.fam.stances.guard;
    const base=clone(state.stances.long_lance.stances.idle);
    // Both hands carry the firearm along the rig's +Y axis (world-forward when aimed).
    const options=[];
    for(const x of [-.23,-.16,-.10]) for(const y of [1.12,1.18,1.24]) for(const z of [.10,.16,.22]) for(const dy of [0,.04,.08]){
      const st=k.pose({feet:{L:[base.feet.L[0],base.feet.L[2],base.feet.L[3]],R:[base.feet.R[0],base.feet.R[2],base.feet.R[3]]},hip:base.ctl.hip,hipR:[4,-20,0],spine:[5,-4,0],chest:[2,-4,0],gripA:[x,y,z],dirA:[0,dy,1],edgeA:[0,-1,0],on:[1]},base.ctl);
      const s=B.solveBody(st.ctl,st.feet.L,st.feet.R,k.fam.hands);
      const score=B.vlen(B.vsub(s.frames.handL,s.frames.targetL))+B.vlen(B.vsub(s.frames.handR,s.frames.targetR)) + Math.abs(s.weapon.dir[0])*.2;
      options.push({st,score});
    }
    options.sort((a,b)=>a.score-b.score);
    k.fam.stances.idle=options[0].st;
    k.fam.sheath=sheathOf('chest',[-.20,.40,-.18],[.08,.995,-.06],[0,0,1]);
    const sd=k.fam.stances.sheathed; sd.ctl.on=[0];sd.ctl.grab=[0];
    const c=k.fam.stances.idle.ctl, dur=heavy?74:42, shotAt=heavy?24:14;
    const shot=(tick,coefficient)=>({tick,count:1,spreadDeg:0,speed:[heavy?46:40],coefficient:[coefficient]});
    gesture(k,'fire',dur,gunKeys(c,dur,shotAt,heavy?1.15:.7),{active:[shotAt,shotAt+1],shoot:[shot(shotAt,heavy?.98:.39)],sound:[shotAt,'xw_shot'],into:['roll']});
    if(!heavy){
      const keys=[];
      for(const tick of [14,28,42]){keys.push({t:tick-3,hip:shift(c,.5),grip:c.grip.slice()},{t:tick,hip:shift(c,1),grip:[c.grip[0],c.grip[1]+.012,c.grip[2]-.04]},{t:tick+5,grip:c.grip.slice()});}
      gesture(k,'rapid_fire',76,keys,{active:[14,43],shoot:[shot(14,.22),shot(28,.22),shot(42,.22)],sound:[14,'xw_shot'],into:['roll']});
      // All three shots receive separate sound events; the resource transaction is once per run.
      const a=state.out[id].actions.at(-1);for(const tick of [28,42]) a.events.push({tick,type:'sound',id:'xw_shot'});a.events.sort((a,b)=>a.tick-b.tick);
    } else gesture(k,'charge_stance',48,[{t:12,hip:shift(c,1.4),chest:[c.chest[0]+3,c.chest[1],c.chest[2]]},{t:28,hip:shift(c,1.4)}],{active:[28,29]});
    const rd=heavy?139:86, ra=heavy?76:48;
    gesture(k,'reload',rd,[{t:Math.floor(ra*.4),hip:shift(c,.6),grip:[c.grip[0],c.grip[1]-.05,c.grip[2]],on:[.25]},{t:ra,hip:shift(c,1),grip:[c.grip[0],c.grip[1]-.035,c.grip[2]],on:[.4]},{t:Math.floor(rd*.78),on:[1]}],{active:[ra,ra+1],sound:[ra,'xw_reload']});
    gesture(k,'aim',heavy?36:28,[{t:8,hip:shift(c,.5),grip:[c.grip[0],c.grip[1]+.035,c.grip[2]],look:[0,-2]},{t:18,hip:shift(c,.5)}],{active:[18,19]});
    const dn=heavy?'dodge':'backstep', dd=heavy?50:38, cr=curve('xw_'+id+'_dodge',[[0,0],[8,0],[dd-12,heavy?1.0:1.25],[dd,heavy?1.0:1.25]]);
    const f=k.fam.stances.idle.feet;
    gesture(k,dn,dd,[{t:8,hip:shift(c,1.5)},{t:Math.floor(dd*.6),hip:shift(c,1.2)}],{root:cr,dodge:true,feet:{L:[[5,Math.floor(dd*.55),f.L[0],f.L[2],f.L[3],.12]],R:[[8,Math.floor(dd*.64),f.R[0],f.R[2],f.R[3],.12]]}});
    gesture(k,'sheathe',heavy?60:48,[{t:14,on:[0]},{t:28,grab:[.4]}],{to:sd,skipBody:[14,heavy?60:48],finish:'sheathed_idle',sound:[28,'hb_sheathe_01']});
    // Reverse the already reach-checked sheathing path, including hand attachment.
    const rev=clone(state.motions['xw_'+id+'_sheathe']), duration=rev.dur;
    rev.base=B.evalMotion(rev,duration).ctl;
    for(const ks of Object.values(rev.ch)){for(const row of ks)row[0]=r4(duration-row[0]);ks.reverse();}
    if(rev.skipBody)rev.skipBody=[duration-rev.skipBody[1],duration-rev.skipBody[0]];
    const clip='xw_'+id+'_draw';state.motions[clip]=rev;
    const track=k.trackOf(clip,k.shape,rev);
    k.action('draw',{clip,dur:duration,track,finish:'drawn_idle',sound:[duration-28,'hb_draw_01']});
  }
}
