// 追従の表（攻撃を受ける部位の形が、動きに付いて行く表。public/data/follow/）を、描画の骨から作り直す（npm run monsters:bake）。
// v0.75.0（利用者の指示。D-175）で、白紙にした 19 種（生成の体の種）を外したので、ここで作るのはガルドロスの表だけ
// （作り方は tests/galdrosFollow.ts。それまでは tests/creature-motion.test.ts が、19 種の判定の軌道と表も作っていた）。
// スパインゲイルとフロストアルドの表は、GLB の動きから ChatGPT が作ったもので、ここでは作り直せない（一覧に残す）。
// ふだんの検査（表が、作り直したものと同じ）は tests/follow.test.ts。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Content, FollowDef, FollowSetDef } from '../src/data/schemas';
import { GALDROS_ID, bakeGaldrosFollow } from './galdrosFollow';
import { loadContent } from './helpers';

const BAKE = process.env.CREATURE_BAKE === '1';
const ROOT = resolve(__dirname, '..');
let content: Content;
beforeAll(async () => {
  // 作り直す時は、古い表と合わないことを誤りにしない
  content = await loadContent({ rebake: BAKE });
});

/** 追従の表を public/data/follow/ へ書き、content.json の files.follow を合わせる */
function writeFollow(docs: Map<string, FollowDef>): void {
  const files: string[] = [];
  for (const [id, d] of docs) {
    const f = `follow/${id.split('.')[1]}.json`;
    files.push(f);
    const rows = (o: Record<string, FollowSetDef>): string[] => Object.entries(o).map(([k, v], i, all) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}${i < all.length - 1 ? ',' : ''}`);
    // 転倒・怯み・気絶の表（v0.36.0 のガルドロスから）
    const states = d.states && Object.keys(d.states).length ? [' "states": {', ...rows(d.states as Record<string, FollowSetDef>), ' }'] : [];
    const text = ['{', ` "schemaVersion": ${d.schemaVersion},`, ` "monsterId": ${JSON.stringify(d.monsterId)},`, ` "step": ${d.step},`, ` "note": ${JSON.stringify(d.note)},`,
      ' "actions": {', ...rows(d.actions), ' },', ' "poses": {', ...rows(d.poses ?? {}), states.length ? ' },' : ' }', ...states, '}', ''].join('\n');
    mkdirSync(resolve(ROOT, 'public/data/follow'), { recursive: true });
    writeFileSync(resolve(ROOT, 'public/data', f), text);
  }
  const path = resolve(ROOT, 'public/data/content.json');
  const idx = JSON.parse(readFileSync(path, 'utf8')) as { files: Record<string, unknown> };
  // この道具が作らない表（スパインゲイル・フロストアルドの、GLB の動きから作った表）は、一覧に残す（v0.73.0）
  const others = (Array.isArray(idx.files.follow) ? (idx.files.follow as string[]) : []).filter((f) => !files.includes(f));
  files.push(...others);
  if (JSON.stringify(idx.files.follow) !== JSON.stringify(files)) {
    idx.files.follow = files;
    writeFileSync(path, JSON.stringify(idx, null, 2) + '\n');
  }
}

describe('追従の表を作り直す（npm run monsters:bake）', () => {
  it(BAKE ? 'ガルドロスの表を、描画の骨から作って、public/data/follow/ へ書く' : 'ガルドロスの表が読み込まれている（作り直したものと同じことは tests/follow.test.ts が確かめる）', () => {
    if (BAKE) {
      writeFollow(new Map([[GALDROS_ID, bakeGaldrosFollow(content)]]));
      return;
    }
    expect(content.monsters.get(GALDROS_ID)!.follow).toBeDefined();
  }, 120000);
});
