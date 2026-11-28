// Quest-local, deterministic weapon state. No wall clock or random input.
import type { ActionRun } from './action';
export const EXTRA_FAMILIES = ['hunting_horn','gunlance','light_bowgun','heavy_bowgun'] as const;
export type ExtraFamily = typeof EXTRA_FAMILIES[number];
export const AMMO_NAMES = ['通常弾','貫通弾','散弾'] as const;
export interface ExtraWeaponState {
  family: ExtraFamily;
  loaded: number;
  ammo: number;
  loadedKind: number;
  reserve: number[];
  cooldown: number;
  recital: boolean;
  notes: number[];
  buff: number;
  buffKind: 'attack'|'stamina'|'none';
  aiming: boolean;
  brace: boolean;
}
export function makeExtraWeapon(id: string): ExtraWeaponState | null {
  if(!(EXTRA_FAMILIES as readonly string[]).includes(id))return null;
  const family=id as ExtraFamily;
  const s:ExtraWeaponState={family,loaded:0,ammo:0,loadedKind:0,reserve:[0,0,0],cooldown:0,recital:false,notes:[],buff:0,buffKind:'none',aiming:false,brace:false};
  s.loaded=capacity(s);
  if(isBowgun(s))s.reserve=family==='light_bowgun'?[60-s.loaded,30,24]:[48-s.loaded,30,20];
  return s;
}
export const isBowgun=(s:ExtraWeaponState|null|undefined):boolean=>!!s&&(s.family==='light_bowgun'||s.family==='heavy_bowgun');
export function capacity(s:ExtraWeaponState):number {
  if(s.family==='gunlance')return 3;
  if(s.family==='light_bowgun')return [6,3,4][s.ammo]??6;
  if(s.family==='heavy_bowgun')return [5,4,3][s.ammo]??5;
  return 0;
}
const prefix=(s:ExtraWeaponState)=>'player.'+s.family+'.';
export function resolveExtra(s:ExtraWeaponState|null|undefined,id:string):string {
  if(!s||!id.startsWith(prefix(s)))return id;
  const key=id.slice(prefix(s).length), to=(n:string)=>prefix(s)+n;
  if(s.family==='hunting_horn'&&s.recital) {
    const map:Record<string,string>={swing_left:'play_note1',swing_right:'play_note1',poke:'play_note2',slam:'play_note3',recital_enter:'recital_exit'};
    if(map[key])return to(map[key]!);
  }
  if(s.family==='gunlance'){
    if(key==='shell'&&s.loaded===0)return to('reload');
    if(key==='wyvern_fire'&&s.cooldown>0)return to('guard');
  }
  if(isBowgun(s)&&(key==='fire'||key==='rapid_fire')){
    if(s.loaded===0||s.loadedKind!==s.ammo)return to('reload');
    if(key==='rapid_fire'&&s.ammo!==0)return to('fire');
  }
  return id;
}
export function changeAmmo(s:ExtraWeaponState,delta:number):void {
  if(!isBowgun(s))return;
  s.ammo=(s.ammo+delta+3)%3;
}
export function tickExtra(s:ExtraWeaponState,drawn:boolean,mode:string):void {
  if(s.cooldown>0)s.cooldown--;
  if(s.buff>0&&--s.buff===0)s.buffKind='none';
  if(!drawn||mode==='hurt'||mode==='dead'||mode==='climb'||mode==='vault'){
    s.recital=false;s.notes=[];s.aiming=false;s.brace=false;
  }
  if(mode==='dead'){s.buff=0;s.buffKind='none';}
}
export function shellAction(id:string):boolean {
  return id==='player.gunlance.shell'||id==='player.gunlance.wyvern_fire';
}
// One transaction on the contact tick; an interrupted reload/note does not commit.
export function extraEvent(s:ExtraWeaponState|null|undefined,run:ActionRun,t:number):void {
  if(!s||!run.def.actionId.startsWith(prefix(s)))return;
  const key=run.def.actionId.slice(prefix(s).length);
  if(key==='sheathe'&&t===0){s.recital=false;s.notes=[];s.aiming=false;s.brace=false;}
  if(key==='draw'||key==='sheathe')return;
  const at=run.def.phases.find(p=>p.id==='active')?.from??run.def.phases.find(p=>p.id==='recovery')?.from;
  if(t!==at||run.extraDone)return;
  run.extraDone=true;run.extraAllowed=true;
  if(s.family==='hunting_horn'){
    if(key==='recital_enter'){s.recital=true;s.notes=[];return;}
    if(key==='recital_exit'){s.recital=false;s.notes=[];return;}
    if(key.startsWith('play_note')){
      if(!s.recital){run.extraAllowed=false;return;}
      const n=Number(key.slice(-1));s.notes.push(n);if(s.notes.length>3)s.notes.shift();
      const chord=s.notes.join('');
      if(chord==='123'||chord==='111'||chord==='231'){
        s.buff=60*60;s.buffKind=chord==='231'?'stamina':'attack';s.notes=[];
      }
    }
    return;
  }
  if(s.family==='gunlance'){
    if(key==='shell'){
      run.extraAllowed=s.loaded>0;if(run.extraAllowed)s.loaded--;
    }else if(key==='wyvern_fire'){
      run.extraAllowed=s.cooldown===0;if(run.extraAllowed)s.cooldown=60*75;
    }else if(key==='reload')s.loaded=capacity(s);
    return;
  }
  if(key==='aim'){s.aiming=!s.aiming;if(!s.aiming)s.brace=false;return;}
  if(key==='charge_stance'){s.aiming=true;s.brace=true;return;}
  if(key==='reload'){
    if(s.loadedKind!==s.ammo){s.reserve[s.loadedKind]=(s.reserve[s.loadedKind]??0)+s.loaded;s.loaded=0;s.loadedKind=s.ammo;}
    const take=Math.max(0,Math.min(capacity(s)-s.loaded,s.reserve[s.ammo]??0));
    s.loaded+=take;s.reserve[s.ammo]=(s.reserve[s.ammo]??0)-take;return;
  }
  if(key==='fire'||key==='rapid_fire'){
    run.extraAllowed=s.loaded>0&&s.loadedKind===s.ammo;
    if(run.extraAllowed){s.loaded--;run.extraAmmo=s.ammo;run.extraScale=s.brace?1.12:1;s.brace=false;}
  }
}
export function extraText(s:ExtraWeaponState):string {
  if(s.family==='hunting_horn')return (s.recital?'演奏 '+(s.notes.join('・')||'―'):'演奏待機')+(s.buff>0?' / '+(s.buffKind==='stamina'?'持久':'攻撃')+' '+Math.ceil(s.buff/60)+'秒':'');
  if(s.family==='gunlance')return '砲弾 '+s.loaded+'/'+capacity(s)+' / '+(s.cooldown?'冷却 '+Math.ceil(s.cooldown/60)+'秒':'大砲撃可');
  return AMMO_NAMES[s.ammo]+' '+(s.loadedKind===s.ammo?s.loaded:0)+'/'+capacity(s)+' / 予備 '+(s.reserve[s.ammo]??0)+(s.aiming?' / 照準':'')+(s.brace?'・構え':'');
}
