import { AnimationMixer, type AnimationAction, Group, LoopOnce, Mesh, SkinnedMesh, Vector3, MeshStandardMaterial, SphereGeometry } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl } from '../core/assets';
import { renderTick } from '../game/action';
import { activeControl } from '../game/ailment';
import type { MonsterState } from '../game/monster';
import type { MonsterRig, MonsterRigCtx } from './monsterRig';
let cached: Promise<GLTF> | null = null;
function load(): Promise<GLTF> {
  // The full 2.28M-triangle model is the default, also on the public Pages build.
  // Explicit ?venolkaQuality=game (or low) retains the lighter model for devices that need it.
  const quality = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('venolkaQuality') : null;
  const low = quality === 'game' || quality === 'low';
  const path = low ? 'assets/models/monsters/venolka_game.glb' : 'assets/models/monsters/venolka_hd/venolka.gltf';
  if (!cached) cached = new GLTFLoader().loadAsync(assetUrl(path)).catch(err => { cached = null; throw err; });
  return cached;
}
/** モデルが読めなければ出発を開始しない。 */
export async function preloadVenolka(): Promise<void> { await load(); }
export class VenolkaRig implements MonsterRig {
  readonly root = new Group();
  private readonly pending = new Mesh(new SphereGeometry(.35, 12, 8), new MeshStandardMaterial({color: 0x999999}));
  private model: Group | null = null;
  private mixer: AnimationMixer | null = null;
  private clips = new Map<string, AnimationAction>();
  private active: AnimationAction | null = null;
  private cycle = 0;
  private lastPos: Vector3 | null = null;
  private flash = 0;
  private readonly flashMaterials: MeshStandardMaterial[] = [];
  constructor() {
    this.pending.position.y = 1.2; this.root.add(this.pending);
    // Transfer ownership of the preloaded scene to this rig, rather than cloning >1M vertices.
    // Each subsequent individual gets its own load; disposed views never share GPU resources.
    const owned = load();
    cached = null;
    void owned.then(g => {
      const model = g.scene;
      model.traverse(o => {
        if (!(o instanceof Mesh)) return;
        o.castShadow = true; o.receiveShadow = true;
        // This scene owns its geometry and materials. Deduplicate shared material references.
        for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
          if (mat instanceof MeshStandardMaterial && !this.flashMaterials.includes(mat)) this.flashMaterials.push(mat);
        }
        if(o instanceof SkinnedMesh) o.frustumCulled = false;
      });
      this.root.remove(this.pending); this.pending.geometry.dispose(); this.pending.material.dispose();
      this.model = model; this.root.add(model); this.mixer = new AnimationMixer(model);
      for (const clip of g.animations) this.clips.set(clip.name, this.mixer.clipAction(clip));
    }).catch(e => { this.root.userData.assetError = String(e); console.error('Venolka model missing or invalid', e); });
  }
  hitFlash(_partIndex: number): void { this.flash = .12; }
  update(m: MonsterState,c: MonsterRigCtx): void {
    const p = new Vector3(m.pos.x, m.pos.y, m.pos.z);
    const moved = this.lastPos ? Math.hypot(p.x-this.lastPos.x,p.z-this.lastPos.z) : 0;
    this.lastPos = p; this.cycle += moved;
    if(!this.mixer || !this.model) return;
    let name='vn_idle', tick=0, loop=true;
    const ail=m.ailments.ticks;
    if(m.dead) { name='vn_death'; tick=m.deadTicks; loop=false; }
    else if(m.captured) { name='vn_capture'; tick=120; loop=false; }
    else if(m.staggerTicks>0 && m.staggerKind) {
      name=m.staggerKind==='topple'?'vn_fall_l':'vn_flinch_body';
      const dur=this.clips.get(name)?.getClip().duration ?? .8;
      tick=(1-m.staggerTicks/Math.max(1,m.staggerTotal))*dur*60; loop=false;
    } else if(m.trapTicks>0){name='vn_trap';tick=c.time*60;}
    else if(['para','paralysis'].includes(String(activeControl(m.ailments)))){name='vn_paralysis';tick=c.time*60;}
    else if(ail.stun>0){name='vn_stun';tick=ail.stun%150;loop=true;} // Hold the downed pose; matching 164-tick follow table.
    else if(m.asleep || ail.sleep>0){name='vn_sleep_loop';tick=c.time*60;}
    else if(m.action) {
      name=m.action.def.clip; tick=Math.max(0,renderTick(m.action,c.alpha)); loop=false;
    } else if(moved>.001){
      const speed=moved/Math.max(c.dt,.001);
      name=m.roam?.limping?'vn_limp':speed>5?'vn_sprint':speed>3.2?'vn_trot':'vn_walk';
      const stride=name==='vn_sprint'?2.9:name==='vn_trot'?2.1:1.65;
      tick=this.cycle/stride*(this.clips.get(name)?.getClip().duration??.8)*60;
    } else tick=c.time*60;
    const action=this.clips.get(name)??this.clips.get('vn_idle'); if(!action) return;
    if(this.active!==action){this.active?.stop();this.active=action;action.reset().setLoop(LoopOnce,1);action.clampWhenFinished=true;action.play();}
    const duration=action.getClip().duration;
    action.enabled=true;action.paused=false;action.time=loop?(tick/60)%duration:Math.min(duration-0.00001,Math.max(0,tick/60));this.mixer.update(0);
    const broken=(id:string)=>{const i=m.def.parts.findIndex(x=>x.id===id);return i>=0&&!!m.parts[i]?.broken;};
    // Keep the articulated wing skeleton intact; damage reduces airborne moves in simulation.
    for(const side of ['l','r']){
      const sac=this.model.getObjectByName('sac_'+side);if(sac&&broken('sac'))sac.scale.multiplyScalar(.65);
      for(let k=1;k<=5;k++)this.model.getObjectByName('crest_'+k+'_'+side)?.scale.setScalar(broken('crest')?.64:1);
      for(let k=1;k<=3;k++)this.model.getObjectByName('tail_fan_'+k+'_'+side)?.scale.setScalar(broken('tail')?.52:1);
    }
    this.flash=Math.max(0,this.flash-c.dt);
    for (const mat of this.flashMaterials) mat.emissive.setRGB(this.flash*2,this.flash*.8,this.flash*.35);
  }
}
