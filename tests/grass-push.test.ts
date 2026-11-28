// 草の踏み分け（v0.77.0。docs/spec.md の 21.6。D-177）: 狩人と大型の足元の草が、外へ倒れて少し沈む。描画だけ。
// 地面の絵の繰り返しを崩す（同じ版）: 地面の素材が、向きと大きさを変えた絵を、大きなむらで混ぜる。
import { describe, expect, it } from 'vitest';
import { Color, MeshLambertMaterial } from 'three';
import { swayInWind } from '../src/render/envArt';
import { GRASS_PUSH, GRASS_PUSH_MAX, HUNTER_PUSH_R, MONSTER_PUSH_SCALE, PUSH_FLAT, PUSH_LEAN, grassPushAt, setGrassPushers } from '../src/render/grassPush';
import { buildGroundDetail } from '../src/render/groundDetail';
import { TILE_BREAK, applyGroundDetail } from '../src/render/groundDetailMaterial';

describe('草の踏み分け（v0.77.0）', () => {
  it('押す物は 4 つまで。先に書いた物から入り、残りの枠は強さ 0。半径は 0.05m より小さくしない。強さは 0〜1', () => {
    expect(GRASS_PUSH_MAX).toBe(4);
    expect(GRASS_PUSH.value).toHaveLength(4);
    setGrassPushers([{ x: 3, z: -2, r: HUNTER_PUSH_R }, { x: 10, z: 4, r: 1.5 * MONSTER_PUSH_SCALE, k: 2 }]);
    expect(GRASS_PUSH.value.map((v) => [v.x, v.y, v.z, v.w])).toEqual([[3, -2, 0.85, 1], [10, 4, 1.5 * 1.15, 1], [0, 0, 1, 0], [0, 0, 1, 0]]);
    setGrassPushers([1, 2, 3, 4, 5, 6].map((i) => ({ x: i, z: 0, r: 0, k: -1 })));
    expect(GRASS_PUSH.value.map((v) => [v.x, v.z, v.w])).toEqual([[1, 0.05, 0], [2, 0.05, 0], [3, 0.05, 0], [4, 0.05, 0]]);
    setGrassPushers([]);
    expect(GRASS_PUSH.value.every((v) => v.w === 0 && v.z === 1)).toBe(true);
  });

  it('草 1 本が受ける押し: 押す物の中心から半径の 0.35 倍までは強さ 1、半径で 0。向きは、押す物から外へ。2 つに挟まれると、向きは打ち消し合い、沈みは強い方', () => {
    const one = [{ x: 0, z: 0, r: 1 }];
    expect(grassPushAt(0.2, 0, one)).toEqual({ x: 1, z: 0, flat: 1 });
    expect(grassPushAt(0, -0.34, one).z).toBeCloseTo(-1, 9);
    const mid = grassPushAt(0.675, 0, one);
    expect(mid.x).toBeCloseTo(0.5, 9);
    expect(mid.flat).toBeCloseTo(0.5, 9);
    expect(grassPushAt(1, 0, one)).toEqual({ x: 0, z: 0, flat: 0 });
    expect(grassPushAt(5, 5, one)).toEqual({ x: 0, z: 0, flat: 0 });
    // 真ん中（距離 0）でも向きが決まる（数が壊れない）
    const at0 = grassPushAt(0, 0, one);
    expect(Math.hypot(at0.x, at0.z)).toBeCloseTo(1, 3);
    // 強さ 0.5 の押す物
    expect(grassPushAt(0.2, 0, [{ x: 0, z: 0, r: 1, k: 0.5 }])).toEqual({ x: 0.5, z: 0, flat: 0.5 });
    // 左右から同じ強さ: 向きは 0、沈みは 1
    const two = grassPushAt(0, 0, [{ x: -0.2, z: 0, r: 1 }, { x: 0.2, z: 0, r: 1 }]);
    expect(two.x).toBeCloseTo(0, 9);
    expect(two.flat).toBe(1);
    // 渡した値（素材が読む値）から引く時も同じ
    setGrassPushers([{ x: 7, z: 7, r: 2 }]);
    expect(grassPushAt(7.5, 7)).toEqual({ x: 1, z: 0, flat: 1 });
    expect(grassPushAt(20, 7).flat).toBe(0);
    setGrassPushers([]);
  });

  it('草の素材は、押す物の値を読み、根元から先へ向かって外へ倒し、高さを縮める（風の揺れの後に足す。根元は動かない）', () => {
    const mat = new MeshLambertMaterial();
    swayInWind(mat);
    const sh = { uniforms: {} as Record<string, unknown>, vertexShader: 'void main() {\n#include <begin_vertex>\n#include <project_vertex>\n}', fragmentShader: 'void main() {\n#include <map_fragment>\n}' };
    mat.onBeforeCompile(sh as never, undefined as never);
    expect(sh.uniforms.uPush).toBe(GRASS_PUSH);
    expect(sh.vertexShader).toContain('uniform vec4 uPush[4];');
    // 草の根元の、世界の位置で測る（エリアの入れ物が動いていても合う）
    expect(sh.vertexShader).toContain('vec3 wroot = (modelMatrix * vec4(root, 1.0)).xyz;');
    expect(sh.vertexShader).toContain(`transformed.xz += lp.xz * (${PUSH_LEAN.toFixed(2)} * ph2 * ph2);`);
    expect(sh.vertexShader).toContain(`transformed.y *= 1.0 - ${PUSH_FLAT.toFixed(2)} * min(pflat, 1.0);`);
    expect(sh.vertexShader.indexOf('transformed.xz += lw.xz * hgt;')).toBeLessThan(sh.vertexShader.indexOf('transformed.xz += lp.xz'));
    // 値は仮: 先が外へ 0.32m、高さは半分まで
    expect([PUSH_LEAN, PUSH_FLAT, HUNTER_PUSH_R, MONSTER_PUSH_SCALE]).toEqual([0.32, 0.5, 0.85, 1.15]);
  });
});

describe('地面の絵の繰り返しを崩す（v0.77.0）', () => {
  it('地面の素材は、同じ絵を、向き 37°・大きさ 1.23 倍でもう 1 度読み、8〜25m のむらで混ぜる（道・陰・色むらは、これまでどおり）', () => {
    const d = buildGroundDetail({ bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 }, exits: [{ x: 0, z: -20 }], rocks: [], platforms: [], kind: 'hunt', seed: 5 });
    const mat = new MeshLambertMaterial();
    const tex = applyGroundDetail(mat, d.mask, 'self', new Color(0xffffff), 'grass');
    const sh = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: 'void main() {\n#include <uv_vertex>\n}', fragmentShader: 'void main() {\n#include <map_fragment>\n}' };
    mat.onBeforeCompile(sh as never, undefined as never);
    expect(sh.uniforms.uGdBreak!.value).toBe(TILE_BREAK);
    expect(TILE_BREAK).toBe(1);
    const f = sh.fragmentShader;
    expect(f).toContain('uniform float uGdBreak;');
    // 回して縮める行列: cos 37° / 1.23 = 0.6493、sin 37° / 1.23 = 0.4893
    expect(f).toContain('mat2( 0.6493, 0.4893, -0.4893, 0.6493 ) * vMapUv');
    expect(Math.cos((37 * Math.PI) / 180) / 1.23).toBeCloseTo(0.6493, 4);
    expect(Math.sin((37 * Math.PI) / 180) / 1.23).toBeCloseTo(0.4893, 4);
    // 混ぜるのは、絵を読んだ後・色むらと道を混ぜる前
    expect(f.indexOf('texture2D( map, vMapUv )')).toBeLessThan(f.indexOf('gdB * uGdBreak'));
    expect(f.indexOf('gdB * uGdBreak')).toBeLessThan(f.indexOf('vec3 gdBase ='));
    expect(mat.customProgramCacheKey()).toBe('ground-detail');
    tex.dispose();
  });
});
