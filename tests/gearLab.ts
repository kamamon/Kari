// 検査のための、試しの装備（v0.75.0。D-175）。
// 白紙にした 19 種の系列の装備を外したので、遊べるデータに残っている装備は、武器が無属性・氷（フロストアルド）・会心（スパインゲイル）、
// 防具の技能が 受け支え・刃持ち・身軽・息継ぎ・属性調律・個別属性耐性（氷）と採集の技能だけ（毒・麻痺・睡眠の武器、風・水などの属性、拡散型・貫通型の環弓、
// 砕き・状態調律・急所観察・響打・道具整備・個別状態耐性の防具が無い）。これらの計算は、これからの種の装備で使うので、
// 計算そのものは、ここの試しの装備で確かめ続ける（tests/fixtures/gear-lab.json。値は、外す前の初級の 9 系列 = 設計 #15 の値のまま。
// ID は weapon.<系統>.lab.<組>・armor.<部位>.lab.<組>。組: wind・water・ice・poison・sleep・para・crit・weak・break）。
// 遊べるデータへは足さない（読み込んだ内容の写しに足すだけ。作るレシピ・素材・依頼は無い）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ArmorDef, Content, WeaponDef } from '../src/data/schemas';

export type LabSet = 'wind' | 'water' | 'ice' | 'poison' | 'sleep' | 'para' | 'crit' | 'weak' | 'break';
const SLOTS = ['head', 'chest', 'arms', 'waist', 'legs'] as const;

/** 読み込んだ内容に、試しの装備を足した写し */
export function labContent(content: Content): Content {
  const doc = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/gear-lab.json'), 'utf8')) as { weapons: WeaponDef[]; armor: ArmorDef[] };
  const c: Content = { ...content, weapons: new Map(content.weapons), armor: new Map(content.armor) };
  for (const w of doc.weapons) c.weapons.set(w.id, w);
  for (const a of doc.armor) c.armor.set(a.id, a);
  return c;
}

/** 試しの防具の 5 部位（頭・胴・腕・腰・脚） */
export const labArmor = (set: LabSet): string[] => SLOTS.map((s) => `armor.${s}.lab.${set}`);
/** 試しの武器の ID */
export const labWeapon = (family: string, set: LabSet): string => `weapon.${family}.lab.${set}`;
