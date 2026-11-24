// 空（v0.19.0。docs/spec.md の 21 章）。大きな球の内側に、空の色の移り・太陽のにじみ・流れる雲を、描画の側だけで描く。
// 遠景の絵（envArt.buildBackdrop）は、空の部分を透明にしてあり、この空の手前に山だけが立つ。
// 地平線の色は霧の色と同じにして、遠くの地面・遠景の山すそ・空が、つなぎ目なく溶けるようにする。
// 雲は、空の上の平らな面に、なめらかな雑音を重ねたもの（時間で少しずつ流れる）。戦闘の計算には関わらない。
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

export interface SkyLook {
  /** 真上の色・地平線の色（霧の色と同じにする）・太陽の光の色 */
  zenith: number;
  horizon: number;
  sun: number;
  /** 雲の明るい所・陰の所の色 */
  cloudLit: number;
  cloudShade: number;
  /** 雲の量（0 = 空いっぱい、1 = 雲なし。0.45〜0.6 くらい） */
  coverage: number;
}

export const SKY_LOOKS: Record<'basin' | 'village', SkyLook> = {
  // 霧の盆地: 地平線は霧の色、上は少し青い灰色。雲は多め
  basin: { zenith: 0x7d9ab3, horizon: 0xaebcab, sun: 0xfff1d6, cloudLit: 0xf1f0ea, cloudShade: 0x9aa5a8, coverage: 0.5 },
  village: { zenith: 0x7f9fba, horizon: 0xaebcab, sun: 0xfff1d6, cloudLit: 0xf4f2ea, cloudShade: 0xa2aaa9, coverage: 0.56 },
};

/** 空の球の半径（カメラの奥の面 400m より内側、遠景の筒 300m より外側） */
const RADIUS = 360;

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform float uCoverage;
uniform float uTime;
varying vec3 vDir;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  // 空の色: 地平線（霧の色）から真上へ。地平線のそばは長く霧の色のまま
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  float sd = max(dot(d, uSunDir), 0.0);
  // 太陽のにじみ（霧の中なので、広く柔らかく）と、ぼやけた日の円
  col += uSun * (pow(sd, 5.0) * 0.16 + pow(sd, 48.0) * 0.32);
  col = mix(col, uSun * 1.25, smoothstep(0.9986, 0.9994, sd) * 0.85);
  // 雲: 空の上の平らな面に、なめらかな雑音。地平線へ近いほど薄く（霧に溶ける）
  if (h > 0.0) {
    vec2 p = d.xz / (h + 0.12) * 1.1 + vec2(uTime * 0.004, uTime * 0.0016);
    float n = fbm(p * 1.4);
    float dens = smoothstep(uCoverage, uCoverage + 0.3, n);
    // 太陽の側へ少しずらした所の雲の濃さで、明るい面と陰の面を分ける
    float n2 = fbm(p * 1.4 + uSunDir.xz * 0.08);
    float lit = clamp(0.62 + (n - n2) * 3.2, 0.0, 1.0);
    vec3 cc = mix(uCloudShade, uCloudLit, lit);
    cc += uSun * pow(sd, 6.0) * 0.22;
    float fade = smoothstep(0.0, 0.3, h);
    col = mix(col, cc, dens * fade * 0.92);
  }
  // 地平線のすぐ上と、地平線より下は、霧の色
  col = mix(uHorizon, col, smoothstep(-0.01, 0.12, h));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** 空の球。カメラと一緒に動かす（view が毎フレーム置く）。setTime で雲を流す。 */
export class SkyDome {
  readonly mesh: Mesh;
  private readonly mat: ShaderMaterial;

  constructor(look: SkyLook, sunDir: Vector3) {
    this.mat = new ShaderMaterial({
      uniforms: {
        uZenith: { value: new Color(look.zenith) },
        uHorizon: { value: new Color(look.horizon) },
        uSun: { value: new Color(look.sun) },
        uSunDir: { value: sunDir.clone().normalize() },
        uCloudLit: { value: new Color(look.cloudLit) },
        uCloudShade: { value: new Color(look.cloudShade) },
        uCoverage: { value: look.coverage },
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(RADIUS, 32, 16), this.mat);
    this.mesh.renderOrder = -20;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }

  setTime(t: number): void {
    this.mat.uniforms.uTime!.value = t;
  }
}
