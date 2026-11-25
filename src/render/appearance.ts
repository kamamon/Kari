// ハンターの外見を描く（v0.28.0。ChatGPT のキャラメイク設計 #10、docs/spec.md の 28 章）。描く側だけ（simulation には渡さない）。
//
// 肌と髪の色: 体の絵（hunter_body_v1.webp）の、印（hunter_mask_v1.png。R = 肌、G = 髪。npm run hunter:masks）のある所だけを替える。
//   印の無い所（服・革・金具・目）は替えない。耳・親指（aPart = 1）と髪の束（aPart = 2）は、絵の代わりに部品の番号で決める。
//   替え方: 画素の明るさ ÷ 元の色（A の平均）の明るさ = 塗りの陰影。新しい色 × 陰影に、元の画素の色合いのずれを一部だけ残す（唇・鼻・目の周りの立体感）。
//   A のまま（null）の所は、何も替えない（絵そのまま）。
// 体型: 骨の位置・長さ・socket は変えず、体の皮と防具の頂点を、同じ決まりで外へ広げる・内へ寄せる（deformBody）。
//   50 が A の形。軸ごとの効き方（何 % 広がるか）は、この版で決めた仮の値。
import { Color, type BufferGeometry, type MeshLambertMaterial, type Texture } from 'three';
import { REST } from './bodySolve';

export interface LookColors {
  /** 肌・髪の新しい色（sRGB 0〜1）。null は A のまま */
  skin: readonly [number, number, number] | null;
  hair: readonly [number, number, number] | null;
}

const LUMA = [0.2126, 0.7152, 0.0722] as const;

/** 色替えの uniform（1 つの体の素材に 1 組） */
export interface AppearanceUniforms {
  uSkinOn: { value: number };
  uSkin: { value: Color };
  uSkinBase: { value: Color };
  uHairOn: { value: number };
  uHair: { value: Color };
  uHairBase: { value: Color };
  appearanceMask: { value: Texture | null };
}

const linear = (rgb: readonly [number, number, number]): Color => new Color().setRGB(rgb[0], rgb[1], rgb[2], 'srgb');

/**
 * 体の素材（MeshLambertMaterial。絵は uv1）に、肌と髪の色替えを足す。返した uniform を変えると、次のフレームから替わる。
 * base は A の平均の色（sRGB 0〜1）。mask は肌と髪の印（読み込み中は null = 何も替えない）。
 */
export function addAppearanceShader(mat: MeshLambertMaterial, base: { skin: readonly [number, number, number]; hair: readonly [number, number, number] }): AppearanceUniforms {
  const u: AppearanceUniforms = {
    uSkinOn: { value: 0 },
    uSkin: { value: linear(base.skin) },
    uSkinBase: { value: linear(base.skin) },
    uHairOn: { value: 0 },
    uHair: { value: linear(base.hair) },
    uHairBase: { value: linear(base.hair) },
    appearanceMask: { value: null },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vTint;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTint = aPart;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vTint;
uniform float uSkinOn;
uniform vec3 uSkin;
uniform vec3 uSkinBase;
uniform float uHairOn;
uniform vec3 uHair;
uniform vec3 uHairBase;
uniform sampler2D appearanceMask;
// 元の色の明るさで陰影を取り、新しい色に掛ける。元の画素の色合いのずれは keep だけ残す
vec3 retint(vec3 c, vec3 target, vec3 base, float keep) {
  float l = dot(c, vec3(${LUMA.join(', ')}));
  float lb = max(dot(base, vec3(${LUMA.join(', ')})), 1e-4);
  vec3 tone = target * (l / lb);
  vec3 dev = (c / max(l, 1e-4)) / max(base / lb, vec3(1e-4));
  return tone * mix(vec3(1.0), dev, keep);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec4 am = texture2D(appearanceMask, vMapUv);
  float mSkin = max(am.r, (1.0 - step(1.5, vTint)) * step(0.5, vTint));
  float mHair = max(am.g, step(1.5, vTint));
  if (uSkinOn > 0.5 && mSkin > 0.002) diffuseColor.rgb = mix(diffuseColor.rgb, retint(diffuseColor.rgb, uSkin, uSkinBase, 0.45), mSkin);
  if (uHairOn > 0.5 && mHair > 0.002) diffuseColor.rgb = mix(diffuseColor.rgb, retint(diffuseColor.rgb, uHair, uHairBase, 0.25), mHair);
}`,
      );
  };
  mat.customProgramCacheKey = () => 'hunter-appearance-v1';
  return u;
}

/** 色を uniform へ（null は A のまま = 替えない） */
export function setLookColors(u: AppearanceUniforms, look: LookColors): void {
  u.uSkinOn.value = look.skin ? 1 : 0;
  if (look.skin) u.uSkin.value.setRGB(look.skin[0], look.skin[1], look.skin[2], 'srgb');
  u.uHairOn.value = look.hair ? 1 : 0;
  if (look.hair) u.uHair.value.setRGB(look.hair[0], look.hair[1], look.hair[2], 'srgb');
}

// ---- 体型 ----

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** y が a〜b で 1、その外へ w だけなめらかに 0 へ */
const band = (a: number, b: number, w: number, y: number): number => smooth(a - w, a, y) * (1 - smooth(b, b + w, y));

/** 軸の値（0〜100）→ -1〜1（50 が 0） */
const f = (axes: Readonly<Record<string, number>>, id: string): number => Math.max(-1, Math.min(1, ((axes[id] ?? 50) - 50) / 50));

/** 骨の番号（bodySolve の JOINTS の順）ごとの種類 */
const TORSO = new Set([0, 1, 2, 3]); // 骨盤・背・胸・首（頭 4 は変えない）
const ARM_UP = new Set([5, 8]), ARM_FORE = new Set([6, 9]), HAND = new Set([7, 10]);
const THIGH = new Set([11, 14]), SHIN = new Set([12, 15]), FOOT = new Set([13, 16]);

/**
 * 体の 1 点（静止姿勢・root の座標）を、骨 bone の決まりで動かした位置。骨・関節・socket は動かさない（骨の位置は変えない）。
 * 胴: 高さごとに、左右（肩・腰）と前（胸・腹）と後ろ（厚み）を広げる。首は 1.5m より上で効かない（頭とつながる所）。
 * 腕・脚: 骨の線（腕は x = ±肩、脚は x = ±股）から外へ、太さを広げる。手と足は、ほとんど変えない。
 */
export function deformPoint(x: number, y: number, z: number, bone: number, axes: Readonly<Record<string, number>>): [number, number, number] {
  const sh = f(axes, 'shoulderWidth'), dep = f(axes, 'torsoDepth'), che = f(axes, 'chestVolume'), hip = f(axes, 'hipWidth');
  const abd = f(axes, 'abdomenVolume'), limb = f(axes, 'limbThickness'), mus = f(axes, 'muscleAmount'), soft = f(axes, 'softness');
  if (TORSO.has(bone)) {
    const top = 1 - smooth(1.47, 1.53, y); // 首より上は変えない
    const wSh = band(1.32, 1.47, 0.08, y), wChest = band(1.22, 1.4, 0.06, y), wBelly = band(1.0, 1.18, 0.07, y), wHip = band(0.84, 1.04, 0.07, y);
    const sx = 1 + top * (0.2 * sh * wSh + 0.08 * mus * wSh + 0.15 * hip * wHip + 0.06 * soft * (wBelly + wHip) + 0.06 * abd * wBelly);
    const front = 1 + top * (0.16 * dep + 0.28 * che * wChest + 0.35 * abd * wBelly + 0.05 * soft);
    const back = 1 + top * (0.16 * dep + 0.06 * soft * wHip + 0.05 * mus * wSh);
    return [x * sx, y, z * (z >= 0 ? front : back)];
  }
  const armR = (k: number): number => 1 + 0.25 * limb * k + 0.15 * mus * k + 0.06 * soft;
  const legR = (k: number): number => 1 + 0.22 * limb * k + 0.12 * mus * k + 0.08 * hip * k + 0.06 * soft;
  let r = 1, cx = 0;
  if (ARM_UP.has(bone) || ARM_FORE.has(bone) || HAND.has(bone)) {
    cx = x >= 0 ? REST.shoulderX : -REST.shoulderX;
    r = HAND.has(bone) ? 1 + 0.03 * limb : armR(ARM_UP.has(bone) ? 1 : 0.6);
  } else if (THIGH.has(bone) || SHIN.has(bone) || FOOT.has(bone)) {
    cx = x >= 0 ? REST.hipX : -REST.hipX;
    r = FOOT.has(bone) ? 1 : legR(THIGH.has(bone) ? 1 : 0.6);
  } else return [x, y, z];
  return [cx + (x - cx) * r, y, z * r];
}

/**
 * 体の皮・防具の形（静止姿勢）を、体型の軸で動かす（その場で書き換える）。頂点ごとに、重みの付いた骨の決まりを重みで混ぜる
 * （関節の所で、腕と胴の決まりが段にならないように）。法線は、そのまま（広げる量が小さいので）。
 */
export function deformBody(geo: BufferGeometry, axes: Readonly<Record<string, number>>): void {
  const pos = geo.getAttribute('position');
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let ox = 0, oy = 0, oz = 0, wsum = 0;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w <= 0) continue;
      const [dx, dy, dz] = deformPoint(x, y, z, si.getComponent(i, k), axes);
      ox += dx * w;
      oy += dy * w;
      oz += dz * w;
      wsum += w;
    }
    if (wsum > 0) pos.setXYZ(i, ox / wsum, oy / wsum, oz / wsum);
  }
  pos.needsUpdate = true;
  geo.computeBoundingSphere();
}
