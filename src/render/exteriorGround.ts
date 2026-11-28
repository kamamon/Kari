// 崖の向こうの地面（盆地。v0.78.0。docs/spec.md の 21.7、D-178）。描画だけ。
// それまで、盆地の外側の丘は、明るさだけの細かな絵に 1 色（くすんだ黄緑）を掛けたもので、内側の地面（描いた草地の絵）と色も模様も違い、
// 崖の上の線から先が「何も無い丘」に見えていた。外側にも、内側と同じ地面の絵（1 枚 = 6m）を貼り、同じ色むら（湿った所は濃い緑・乾いた所は明るい黄み）を
// 頂点の色で掛ける。絵の繰り返しは、内側（src/render/groundDetailMaterial.ts の TILE_BREAK）と同じやり方で崩す。
// 形（起伏・格子）は src/render/fieldLandscape.ts（ChatGPT の #43）のまま。ほかの狩場の外側は、これまでどおり。
import { Color, DataTexture, type MeshLambertMaterial, RedFormat, type Texture, UnsignedByteType } from 'three';
import { ENV_TILES, tileMaterial } from './envArt';
import { baseTone, toneTint } from './groundDetail';

/** 外側の地面の絵 1 枚の大きさ（m。内側の草の地面と同じ） */
export const OUTER_TILE = ENV_TILES.grass.tile;
/** 外側の地面の明るさ（内側の地面 = src/render/arena.ts の GROUND_GAIN と同じ値。検査が確かめる） */
export const OUTER_GAIN = 1.25;
/** 急な斜面（草が薄く、土と岩が見える所）の色の倍率 */
export const OUTER_ROCKY: readonly [number, number, number] = [0.96, 0.88, 0.83];
/** エリアごとの外側の色（涸れ沢は乾いた色、晶窪は青み）を、盆地のふつうの色からの倍率にする時の、効かせ方（0 = 効かせない … 1 = そのまま） */
export const OUTER_LAND_KEEP = 0.55;

/**
 * 急な斜面で、地面の絵の模様を薄める割合（0 = そのまま … 1 = 絵の平均の色だけ）。
 * 絵は真上から貼るので、急な斜面では模様が縦に伸びて、縞に見える。急な所ほど、模様を平均の色へ寄せる。
 */
export const OUTER_STEEP_FLAT = 0.8;
/** 斜面の傾き（高さ ÷ 水平の距離）から、模様を薄める量（0〜1）。傾き 0.55（29°）から薄め始め、1.4（54°）で最大 */
export function outerSteep(slope: number): number {
  const t = Math.max(0, Math.min(1, (slope - 0.55) / (1.4 - 0.55)));
  return t * t * (3 - 2 * t);
}

/** 外側に、内側と同じ地面の絵を貼る狩場（盆地だけ。ほかの狩場は、地面の絵が狩場ごとで、外側の色は景観の定義が持つ） */
export function paintsOuter(p: { fieldId: string }): boolean {
  return p.fieldId === 'field.basin';
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 外側の地面の頂点の色（絵に掛ける倍率）を作る関数を返す。
 *  n     = 濃淡（src/render/noise.ts の patchNoise。0〜1。大きい所 = 湿って濃い）
 *  rocky = 斜面の急さと雑音から決めた、土と岩の見える割合（0〜1）
 *  far   = 遠くの霧の色へ寄せる割合（0〜1）
 * refLand は、盆地のふつうの外側の色（景観の定義の meadow の land）。
 */
export function outerPaint(p: { land: number; sky: { horizon: number } }, refLand: number): (out: Color, n: number, rocky: number, far: number) => void {
  const ref = new Color(refLand), land = new Color(p.land);
  const mul = [1 + (land.r / ref.r - 1) * OUTER_LAND_KEEP, 1 + (land.g / ref.g - 1) * OUTER_LAND_KEEP, 1 + (land.b / ref.b - 1) * OUTER_LAND_KEEP];
  // 霧の色を、絵に掛ける倍率へ直す（絵の平均の色 × 明るさ で割る）
  const mean = new Color(ENV_TILES.grass.mean).multiplyScalar(OUTER_GAIN), fog = new Color(p.sky.horizon);
  const fogMul = [fog.r / mean.r, fog.g / mean.g, fog.b / mean.b];
  return (out, n, rocky, far) => {
    // 内側の地面と同じ: 頂点の明るさ 1 - 0.2n と、色むら（湿った所は濃い緑、乾いた所は明るい黄み）
    const t = toneTint('grass', baseTone(n)), k = 1 - 0.2 * n;
    let r = t[0] * k * mul[0]!, g = t[1] * k * mul[1]!, b = t[2] * k * mul[2]!;
    r *= lerp(1, OUTER_ROCKY[0], rocky);
    g *= lerp(1, OUTER_ROCKY[1], rocky);
    b *= lerp(1, OUTER_ROCKY[2], rocky);
    out.setRGB(lerp(r, fogMul[0]!, far), lerp(g, fogMul[1]!, far), lerp(b, fogMul[2]!, far));
  };
}

let blank: DataTexture | null = null;
/** 影の無い絵（1 画素。影の絵が付くまで、素材が読む） */
function blankShade(): DataTexture {
  if (!blank) {
    blank = new DataTexture(new Uint8Array([0]), 1, 1, RedFormat, UnsignedByteType);
    blank.unpackAlignment = 1;
    blank.needsUpdate = true;
  }
  return blank;
}

const SHADE_VERT = 'attribute vec2 aShade;\nvarying vec2 vExShade;\n';
const SHADE_FRAG = 'uniform sampler2D tExShade;\nvarying vec2 vExShade;\n';

/**
 * 外側の地面の素材へ、木と岩の影の絵（src/render/exteriorShade.ts。v0.79.0）を付ける。地面の色に（1 - 絵の値）を掛ける。
 * 地面の板の頂点に、絵の座標 aShade が要る（setShadeUv）。盆地の素材（outerGroundMaterial）は、はじめから読む形になっている。
 * ほかの狩場の素材（画像の材質）は、ここで、絵を読む計算を足す。
 */
export function setOuterShade(mat: MeshLambertMaterial, tex: Texture): void {
  const held = mat.userData.exShade as { value: Texture } | undefined;
  if (held) {
    held.value = tex;
    return;
  }
  const uni = { value: tex };
  mat.userData.exShade = uni;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tExShade = uni;
    sh.vertexShader = SHADE_VERT + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vExShade = aShade;');
    sh.fragmentShader = SHADE_FRAG + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb *= 1.0 - texture2D( tExShade, vExShade ).r;');
  };
  mat.customProgramCacheKey = () => 'outer-shade';
  mat.needsUpdate = true;
}

/**
 * 外側の地面の素材（内側と同じ草の地面の絵。頂点の色を掛ける）。uv は「m ÷ OUTER_TILE」。
 * 絵の繰り返しを崩す: 同じ絵を、向き（37°）と大きさ（1.23 倍）を変えてもう 1 度読み、8〜25m の大きなむらで混ぜる（内側と同じ）。
 * 急な斜面（頂点の aSteep。無ければ 0）では、模様を平均の色へ寄せる。木と岩の影の絵（頂点の aShade の所）を、色に掛ける（v0.79.0。setOuterShade で付ける）。
 */
export function outerGroundMaterial(): MeshLambertMaterial {
  const mat = tileMaterial('grass', 0xffffff, { vertexColors: true, gain: OUTER_GAIN });
  mat.userData.outerGround = true;
  const mean = new Color(ENV_TILES.grass.mean);
  // 木と岩の影の絵（v0.79.0）。付くまでは、影の無い絵
  const shade = { value: blankShade() as Texture };
  mat.userData.exShade = shade;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uExMean = { value: mean };
    sh.uniforms.tExShade = shade;
    sh.vertexShader = 'attribute float aSteep;\nvarying float vExSteep;\n' + SHADE_VERT + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vExSteep = aSteep;\n  vExShade = aShade;');
    sh.fragmentShader = SHADE_FRAG +
      `uniform vec3 uExMean;
varying float vExSteep;
float exHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float exNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(exHash(i), exHash(i + vec2(1.0, 0.0)), f.x), mix(exHash(i + vec2(0.0, 1.0)), exHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
` +
      sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec2 exAt = vMapUv * ${OUTER_TILE.toFixed(1)};
  float exB = smoothstep( 0.36, 0.64, exNoise( exAt * 0.12 + 17.0 ) * 0.7 + exNoise( exAt * 0.37 + 5.0 ) * 0.3 );
  sampledDiffuseColor = mix( sampledDiffuseColor, texture2D( map, mat2( 0.6493, 0.4893, -0.4893, 0.6493 ) * vMapUv + vec2( 0.37, 0.11 ) ), exB );
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, uExMean, vExSteep * ${OUTER_STEEP_FLAT.toFixed(2)} );
  diffuseColor *= sampledDiffuseColor;
  diffuseColor.rgb *= 1.0 - texture2D( tExShade, vExShade ).r;
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'outer-ground';
  return mat;
}
