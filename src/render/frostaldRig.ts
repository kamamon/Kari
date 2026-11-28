import { AnimationMixer, type AnimationAction, Group, LoopOnce, Mesh, SkinnedMesh, Vector3, MeshStandardMaterial, SphereGeometry } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { assetUrl } from '../core/assets';
import { renderTick } from '../game/action';
import { activeControl } from '../game/ailment';
import type { MonsterState } from '../game/monster';
import type { MonsterRig, MonsterRigCtx } from './monsterRig';
let cached: Promise<GLTF> | null = null;
function load(): Promise<GLTF> {
  // High-density master is opt-in; never load the 172 MB file on a normal mobile hunt.
  // npm run frostald:master installs it for a local dev/build; the standard public build contains only the game LOD.
  const master = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('frostaldQuality') === 'master';
  const path = 'assets/models/monsters/frostald_' + (master ? 'master' : 'game') + '.glb';
  if (!cached) cached = new GLTFLoader().loadAsync(assetUrl(path)).catch(err => { cached = null; throw err; });
  return cached;
}
/** モデルが読めなければ出発を開始しない。 */
export async function preloadFrostald(): Promise<void> { await load(); }
export class FrostaldRig implements MonsterRig {
  readonly root = new Group();
  private readonly pending = new Mesh(new SphereGeometry(.35, 12, 8), new MeshStandardMaterial({color: 0x999999}));
  private model: Group | null = null;
  private mixer: AnimationMixer | null = null;
  private clips = new Map<string, AnimationAction>();
  private active: AnimationAction | null = null;
  private cycle = 0;
  private lastPos: Vector3 | null = null;
  private flash = 0;
  private tail = false;
  private readonly flashMaterials: MeshStandardMaterial[] = [];
  constructor() {
    this.pending.position.y = 1.2; this.root.add(this.pending);
    void load().then(g => {
      const model = clone(g.scene) as Group;
      model.traverse(o => {
        if (!(o instanceof Mesh)) return;
        o.castShadow = true; o.receiveShadow = true;
        // 個体の破棄・被弾発光がキャッシュ元の材質を変更しないようにする。
        o.geometry = o.geometry.clone();
        const duplicate = (mat: import('three').Material): import('three').Material => {
          const m = mat.clone(); if (m instanceof MeshStandardMaterial) this.flashMaterials.push(m);
          return m;
        };
        o.material = Array.isArray(o.material) ? o.material.map(duplicate) : duplicate(o.material);
        if(o instanceof SkinnedMesh) o.frustumCulled = false;
      });
      this.root.remove(this.pending); this.pending.geometry.dispose(); this.pending.material.dispose();
      this.model = model; this.root.add(model); this.mixer = new AnimationMixer(model);
      for (const clip of g.animations) this.clips.set(clip.name, this.mixer.clipAction(clip));
    }).catch(e => { this.root.userData.assetError = String(e); console.error('Frostald model missing or invalid', e); });
  }
  hitFlash(_partIndex: number): void { this.flash = .12; }
  update(m: MonsterState,c: MonsterRigCtx): void {
    const p = new Vector3(m.pos.x, m.pos.y, m.pos.z);
    const moved = this.lastPos ? Math.hypot(p.x-this.lastPos.x,p.z-this.lastPos.z) : 0;
    this.lastPos = p; this.cycle += moved;
    if(!this.mixer || !this.model) return;
    let name='fa_idle', tick=0, loop=true;
    const ail=m.ailments.ticks;
    if(m.dead) { name='fa_death'; tick=m.deadTicks; loop=false; }
    else if(m.captured) { name='fa_capture'; tick=120; loop=false; }
    else if(m.staggerTicks>0 && m.staggerKind) {
      name=m.staggerKind==='topple'?'fa_fall_l':'fa_flinch_body';
      const dur=this.clips.get(name)?.getClip().duration ?? .8;
      tick=(1-m.staggerTicks/Math.max(1,m.staggerTotal))*dur*60; loop=false;
    } else if(m.trapTicks>0){name='fa_trap';tick=c.time*60;}
    else if(['para','paralysis'].includes(String(activeControl(m.ailments)))){name='fa_paralysis';tick=c.time*60;}
    else if(ail.stun>0){name='fa_stun';tick=ail.stun%164;loop=true;} // Hold the downed pose; matching 164-tick follow table.
    else if(m.asleep || ail.sleep>0){name='fa_sleep_loop';tick=c.time*60;}
    else if(m.action) {
      name=m.action.def.clip; tick=Math.max(0,renderTick(m.action,c.alpha)); loop=false;
    } else if(moved>.001){
      const speed=moved/Math.max(c.dt,.001);
      name=m.roam?.limping?'fa_limp':speed>5?'fa_sprint':speed>3.2?'fa_trot':'fa_walk';
      const stride=name==='fa_sprint'?2.9:name==='fa_trot'?2.1:1.65;
      tick=this.cycle/stride*(this.clips.get(name)?.getClip().duration??.8)*60;
    } else tick=c.time*60;
    const action=this.clips.get(name)??this.clips.get('fa_idle'); if(!action) return;
    if(this.active!==action){this.active?.stop();this.active=action;action.reset().setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();}
    const duration=action.getClip().duration;
    action.enabled=true;action.paused=false;action.time=loop?(tick/60)%duration:Math.min(duration-0.00001,Math.max(0,tick/60));this.mixer.update(0);
    const ti=m.def.parts.findIndex(x=>x.id==='tail');const cut=ti>=0&&m.parts[ti]?.severed===true;
    this.tail=cut; this.model.getObjectByName('tail_05')?.scale.setScalar(cut ? .001 : 1);
    const mi=m.def.parts.findIndex(x=>x.id==='mane'); const broken=mi>=0&&!!m.parts[mi]?.broken;
    const charge=m.frostald ? m.frostald.charge/Math.max(1,m.frostald.capacity) : 1;
    for(const side of ['l','r'])for(let i=1;i<=6;i++)this.model.getObjectByName('mane_'+side+'_'+String(i).padStart(2,'0'))?.scale.setScalar((broken?.68:1)*(.82+.18*charge));
    this.flash=Math.max(0,this.flash-c.dt);
    for (const mat of this.flashMaterials) mat.emissive.setRGB(this.flash*2,this.flash*.8,this.flash*.35);
  }
}
