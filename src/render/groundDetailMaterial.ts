// 地面の作り込み（src/render/groundDetail.ts）の絵を、地面の素材へ混ぜる（v0.74.0）。
// 道は、別の地面の絵（砂利）を、ふちを不ぞろいにして混ぜる。道のふちの草は、少し枯れた色にする。陰は、色を暗くする。
// 地面の板の頂点に、絵のどこを読むか（aMask）を持たせる。絵が届くまで・画面の無い所（Node の検査）では、これまでの地面のまま。
import { type BufferGeometry, ClampToEdgeWrapping, Color, DataTexture, Float32BufferAttribute, LinearFilter, type MeshLambertMaterial, RGBAFormat, RepeatWrapping, type Texture, UnsignedByteType } from 'three';
import { ENV_TILES, loadEnvTexture, type EnvTile } from './envArt';
import type { GroundMask } from './groundDetail';

/** 陰のいちばん濃い所で、地面の色に掛ける減らし分 */
export const GROUND_SHADE = 0.52;

/** 地面の板の頂点へ、絵の座標を付ける */
export function setMaskUv(geo: BufferGeometry, mask: GroundMask): void {
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - mask.minX) / mask.sizeX;
    uv[i * 2 + 1] = (pos.getZ(i) - mask.minZ) / mask.sizeZ;
  }
  geo.setAttribute('aMask', new Float32BufferAttribute(uv, 2));
}

export function maskTexture(mask: GroundMask): DataTexture {
  const t = new DataTexture(mask.data, mask.width, mask.height, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.magFilter = t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/**
 * 地面の素材へ、道と陰を足す。trail は道の絵（地面の絵と同じ 1 枚 = 6m）、color は道の絵に掛ける色。
 * 返すのは、絵（エリアを捨てる時に dispose する）。
 */
export function applyGroundDetail(mat: MeshLambertMaterial, mask: GroundMask, trail: EnvTile, color: Color): DataTexture {
  const tMask = maskTexture(mask);
  const uni = {
    tGdMask: { value: tMask as Texture },
    tGdTrail: { value: null as Texture | null },
    uGdOn: { value: 0 },
    uGdColor: { value: color },
    uGdRect: { value: [mask.minX, mask.minZ, mask.sizeX, mask.sizeZ] },
    uGdShade: { value: GROUND_SHADE },
  };
  loadEnvTexture(
    ENV_TILES[trail].file,
    (t) => {
      t.wrapS = t.wrapT = RepeatWrapping;
      t.anisotropy = 4;
    },
    (t) => {
      uni.tGdTrail.value = t;
      uni.uGdOn.value = 1;
    },
  );
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'attribute vec2 aMask;\nvarying vec2 vGdMask;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vGdMask = aMask;');
    sh.fragmentShader =
      `uniform sampler2D tGdMask;
uniform sampler2D tGdTrail;
uniform float uGdOn;
uniform vec3 uGdColor;
uniform vec4 uGdRect;
uniform float uGdShade;
varying vec2 vGdMask;
float gdHash(vec2 p) { p = fract(p * vec2(0.1031, 0.1030)); p += dot(p, p.yx + 33.33); return fract((p.x + p.y) * p.x); }
float gdNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gdHash(i), gdHash(i + vec2(1.0, 0.0)), f.x), mix(gdHash(i + vec2(0.0, 1.0)), gdHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
` +
      sh.fragmentShader.replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  vec4 gdMask = texture2D( tGdMask, vGdMask );
  // 世界の座標（m）で作る、ふちの不ぞろい
  vec2 gdAt = uGdRect.xy + vGdMask * uGdRect.zw;
  float gdN = gdNoise( gdAt * 0.9 ) * 0.6 + gdNoise( gdAt * 3.1 ) * 0.4;
  float gdW = smoothstep( 0.34, 0.6, gdMask.r + ( gdN - 0.5 ) * 0.36 ) * uGdOn;
  vec3 gdBase = diffuseColor.rgb * sampledDiffuseColor.rgb;
  // 道のふちの草は、踏まれて少し枯れた色
  gdBase *= mix( vec3( 1.0 ), vec3( 1.1, 1.02, 0.8 ), smoothstep( 0.03, 0.5, gdMask.r ) * 0.6 * uGdOn );
  vec3 gdTrail = texture2D( tGdTrail, vMapUv ).rgb * uGdColor;
  diffuseColor.rgb = mix( gdBase, gdTrail, gdW ) * ( 1.0 - uGdShade * gdMask.g * ( 0.8 + 0.4 * gdN ) );
  diffuseColor.a *= sampledDiffuseColor.a;
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'ground-detail';
  return tMask;
}
