// 物語「帰り道の灯」（v0.23.0。ChatGPT のストーリー設計 v1 の S0: 序章と第 1 章）。
// 受入条件（docs/source/chatgpt-story-20261125/implementation_handoff_v1.md の 9 章）のうち、S0 に当たるものを、データと計算で確かめる。
// 会話の窓・依頼板の欄・帰還の後に開くことは、ブラウザ検査（tools/smoke.mjs）で見る。
import { describe, expect, it } from 'vitest';
import { lineFace, lineText, scenesUnlocked, storyView, validateStory, type StoryDef } from '../src/data/story';
import { PORTRAITS, STORY_ART } from '../src/ui/artIndex';
import { Vector3 } from 'three';
import { NPC_ART } from '../src/render/npcArt';
import { buildNpcSprites, updateNpcSprites } from '../src/render/npcSprites';
import { questUnlocked } from '../src/save/profile';
import { loadContent } from './helpers';

const GALDROS = 'quest.basin.003';
const SELVARK = 'quest.selvark.r1';

describe('物語のデータ', () => {
  it('読み込みの検査を通る。顔の絵は、どの話す人にもある（v0.29.0 からセナキも。ChatGPT #13 の表情の顔）', async () => {
    const c = await loadContent();
    expect(validateStory(c.story, new Set(c.quests.keys()), new Set(Object.keys(PORTRAITS)), new Set(STORY_ART))).toEqual([]);
    expect(Object.values(c.story.speakers).filter((s) => s.portrait).map((s) => s.name).sort()).toEqual(['イサネ', 'セナキ', 'ミナギ', 'ロクハ'].sort());
    // 序章・8 章・終章。遊べるのは序章と第 1 章だけ（第 1 章は、いまある 2 つの依頼）
    expect(c.story.chapters.map((x) => x.no)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(c.story.chapters.filter((x) => x.playable).map((x) => x.id)).toEqual(['ch0', 'ch1']);
    expect(c.story.chapters[1]!.steps!.map((s) => s.questId)).toEqual([GALDROS, SELVARK]);
    // 場面は台本の 4 つ（SC00〜SC03）。どの台詞も短い（1 発言 60 文字まで。iPhone の 2〜3 行）
    expect(c.story.scenes.map((s) => s.id)).toEqual(['sc00', 'sc01', 'sc02', 'sc03']);
    for (const s of c.story.scenes) for (const l of s.lines) for (const t of [l.text, ...(l.variants ? Object.values(l.variants) : []), ...(l.choices ?? [])]) if (t) expect(t.length, `${s.id}: ${t}`).toBeLessThanOrEqual(60);
  });

  it('里に立つ人（ミナギ・ロクハ・イサネと、v0.29.0 から道守のセナキ）は、絵の板（正面と背面）と当たりの円がある', async () => {
    const c = await loadContent();
    const map = c.maps.get(c.hub.mapId)!;
    expect((c.hub.npcs ?? []).map((n) => n.name)).toEqual(['ミナギ', 'ロクハ', 'イサネ', 'セナキ']);
    for (const n of c.hub.npcs ?? []) expect(NPC_ART[n.art]!.back, `${n.id} の背面`).toBeDefined();
    for (const n of c.hub.npcs ?? []) {
      expect(NPC_ART[n.art], n.id).toBeDefined();
      expect(map.rocks.some((r) => Math.hypot(r.x - n.x, r.z - n.z) < 0.01 && r.r <= 0.6), n.id).toBe(true);
      // 背丈は 1.5〜1.9m（仮の値）。正面の絵は、縦長
      const art = NPC_ART[n.art]!;
      expect(art.height).toBeGreaterThan(1.5);
      expect(art.height).toBeLessThan(1.9);
      expect(art.front.aspect).toBeLessThan(0.6);
    }
  });

  it('表情と場面の絵（v0.29.0）: 台詞の表情は話す人の顔へ、無い表情・無い絵は検査が見つける', async () => {
    const c = await loadContent();
    const sp = c.story.speakers;
    const sc02 = c.story.scenes.find((s) => s.id === 'sc02')!;
    // 荷が通った時のイサネは安堵、ロクハは平静（表情の指定なし）、ミナギは安堵
    expect(sc02.lines.map((l) => lineFace(sp[l.who ?? ''], l) ?? '')).toEqual(['merchant_relief', 'smith', 'minagi_relief', 'minagi', 'minagi_focus']);
    expect(c.story.scenes.map((s) => s.art)).toEqual(['event_story_arrival_board_v1', 'event_story_arrival_board_v1', 'event_story_first_delivery_v1', 'event_story_arrival_board_v1']);
    // セナキの台詞は、セナキの顔（平静）
    const sc03 = c.story.scenes.find((s) => s.id === 'sc03')!;
    expect(lineFace(sp.senaki, sc03.lines.find((l) => l.who === 'senaki')!)).toBe('senaki');
    const bad = JSON.parse(JSON.stringify(c.story)) as StoryDef;
    bad.scenes[0]!.lines[0]!.face = 'anger';
    bad.scenes[1]!.art = 'event_nothing';
    bad.speakers.isane!.faces = { relief: 'portrait_nothing' };
    const e = validateStory(bad, new Set(c.quests.keys()), new Set(Object.keys(PORTRAITS)), new Set(STORY_ART)).join('\n');
    expect(e).toMatch(/表情 anger が、話す人 minagi に無い/);
    expect(e).toMatch(/場面の絵 event_nothing が無い/);
    expect(e).toMatch(/表情 relief の顔の絵 portrait_nothing が無い/);
  });

  it('検査は、まだ無い依頼を遊べる章に入れること・まだ遊べない章に狩りを入れること・使わない場面を見つける', async () => {
    const c = await loadContent();
    const bad = JSON.parse(JSON.stringify(c.story)) as StoryDef;
    bad.chapters[1]!.steps![0]!.questId = 'quest.nothing';
    bad.chapters[2]!.steps = [{ id: 'x', questId: GALDROS, label: 'x', brief: 'x' }];
    bad.scenes.push({ id: 'sc99', title: 'x', place: 'x', summary: 'x', lines: [{ who: 'minagi', text: 'x' }] });
    const e = validateStory(bad, new Set(c.quests.keys())).join('\n');
    expect(e).toMatch(/quest\.nothing が無い/);
    expect(e).toMatch(/まだ遊べない章に、狩りや場面がある/);
    expect(e).toMatch(/sc99: どの章からも使われていない/);
  });
});

describe('進み方（保存データの達成回数から。保存の形は変えない）', () => {
  it('新しい保存: 序章と出発前の話が読める。次の狩りは「岩場の足音」。第 2 章から先は、まだ遊べない', async () => {
    const c = await loadContent();
    const v = storyView(c.story, {});
    expect(v.readable).toEqual(['sc00', 'sc01']);
    expect(v.next?.step.questId).toBe(GALDROS);
    expect(v.chapters.map((x) => x.status)).toEqual(['open', 'current', 'unplayable', 'unplayable', 'unplayable', 'unplayable', 'unplayable', 'unplayable', 'unplayable', 'unplayable']);
  });

  it('ガルドロスの後: 最初の帰還が読め、次は「帆角の風」。両方の後: 第 1 章の報告が読め、次の狩りは無い（まだ遊べない章の知らせ）', async () => {
    const c = await loadContent();
    let v = storyView(c.story, { [GALDROS]: 1 });
    expect(v.readable).toEqual(['sc00', 'sc01', 'sc02']);
    expect(v.next?.step.questId).toBe(SELVARK);
    v = storyView(c.story, { [GALDROS]: 3, [SELVARK]: 1 });
    expect(v.readable).toEqual(['sc00', 'sc01', 'sc02', 'sc03']);
    expect(v.next).toBeNull();
    expect(v.chapters[1]!.status).toBe('done');
    expect(c.story.common.unplayable).toMatch(/まだ遊べません/);
  });

  it('受入 3: セルヴァルクを先に狩っても、進めなくならない（ガルドロスの後で、報告が 2 つとも読める）', async () => {
    const c = await loadContent();
    let v = storyView(c.story, { [SELVARK]: 1 });
    expect(v.next?.step.questId).toBe(GALDROS);
    expect(v.readable).toEqual(['sc00', 'sc01']);
    // ガルドロスを達成した保存の後: 最初の帰還と、第 1 章の報告の 2 つが、この順で開く
    expect(scenesUnlocked(c.story, { [SELVARK]: 1 }, { [SELVARK]: 1, [GALDROS]: 1 })).toEqual(['sc02', 'sc03']);
    v = storyView(c.story, { [SELVARK]: 1, [GALDROS]: 1 });
    expect(v.next).toBeNull();
  });

  it('受入 5・9: 帰還の報告は、達成回数が 0 → 1 になった時だけ開く。同じ結果の保存し直し・2 回目からの達成・前の版からの保存では開かない', async () => {
    const c = await loadContent();
    expect(scenesUnlocked(c.story, {}, { [GALDROS]: 1 })).toEqual(['sc02']);
    expect(scenesUnlocked(c.story, { [GALDROS]: 1 }, { [GALDROS]: 1 })).toEqual([]);
    expect(scenesUnlocked(c.story, { [GALDROS]: 1 }, { [GALDROS]: 2 })).toEqual([]);
    expect(scenesUnlocked(c.story, { [GALDROS]: 1 }, { [GALDROS]: 1, [SELVARK]: 1 })).toEqual(['sc03']);
    // ほかの依頼（中級・群れ）では開かない
    expect(scenesUnlocked(c.story, { [GALDROS]: 1 }, { [GALDROS]: 1, 'quest.basin.r2.001': 1 })).toEqual([]);
    // 極級まで進んだ前の版の保存: 読める記録はそろっているが、自動では何も開かない
    const old = { [GALDROS]: 9, 'quest.basin.r2.001': 4, 'quest.basin.r3.001': 2, 'quest.basin.r4.001': 1, [SELVARK]: 2 };
    expect(storyView(c.story, old).readable).toEqual(['sc00', 'sc01', 'sc02', 'sc03']);
    expect(scenesUnlocked(c.story, old, old)).toEqual([]);
  });

  it('受入 6・13: 物語は依頼の受けられる条件を変えない。まだ遊べない章の狩りは無い', async () => {
    const c = await loadContent();
    const doc = { progress: { questClears: {} as Record<string, number> } } as Parameters<typeof questUnlocked>[0];
    // 物語を読んでいなくても、初級の依頼と群れの依頼は、最初から受けられる。ガルドロスの段階の連なりは、これまでどおり
    for (const q of c.quests.values()) if (!q.requires?.length) expect(questUnlocked(doc, q), q.id).toBe(true);
    expect(c.quests.get('quest.basin.r2.001')!.requires).toEqual([GALDROS]);
    for (const ch of c.story.chapters.filter((x) => !x.playable)) expect(ch.steps ?? []).toEqual([]);
  });

  it('帰還の報告の言葉: 討伐・捕獲・分からない時（読み返す時）で、1 つだけを出す', async () => {
    const c = await loadContent();
    const line = c.story.scenes.find((s) => s.id === 'sc02')!.lines.find((l) => l.variants)!;
    expect(lineText(line, 'slay')).toMatch(/回収班/);
    expect(lineText(line, 'capture')).toMatch(/収容/);
    expect(lineText(line)).toMatch(/区間の安全/);
  });
});

describe('里に立つ人の板（描画）', () => {
  it('板はカメラの方を向く。カメラが後ろへ回ると背面の絵に替わる（v0.29.0 からミナギとセナキにも背面の絵）', async () => {
    const c = await loadContent();
    const g = buildNpcSprites(c.hub.npcs ?? []);
    const list = g.userData.npcs as { def: { id: string; x: number; z: number; yaw: number }; mesh: { rotation: { y: number }; material: { userData: { npc: string } } } }[];
    expect(list.length).toBe(4);
    for (const s of list) {
      const fwd = { x: Math.sin(s.def.yaw), z: Math.cos(s.def.yaw) };
      updateNpcSprites(g, new Vector3(s.def.x + fwd.x * 6, 1.6, s.def.z + fwd.z * 6));
      expect(s.mesh.material.userData.npc, s.def.id).toMatch(/_front_v1$/);
      expect(Math.abs(Math.atan2(Math.sin(s.mesh.rotation.y - s.def.yaw), Math.cos(s.mesh.rotation.y - s.def.yaw)))).toBeLessThan(1e-6);
      updateNpcSprites(g, new Vector3(s.def.x - fwd.x * 6, 1.6, s.def.z - fwd.z * 6));
      expect(s.mesh.material.userData.npc, s.def.id).toMatch(/_back_v1$/);
      // 真横では、どちらにも揺れない（替えた側のまま）
      const was = s.mesh.material.userData.npc;
      updateNpcSprites(g, new Vector3(s.def.x + fwd.z * 6, 1.6, s.def.z - fwd.x * 6));
      expect(s.mesh.material.userData.npc).toBe(was);
    }
  });
});
