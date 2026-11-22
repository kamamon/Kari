// 基準 GLB を作る: 1m 立方体（原点が底面中央）と、+Z（前）を指す矢印。
// Blender から書き出したモデルの「単位 m・Y 上・+Z 前」を、素材ビューアで照合するための物差し。
// 使い方: node tools/make-ref-glb.mjs  → public/assets/models/ref_cube_1m.glb
import { writeFileSync } from 'node:fs';

const positions = [];
const normals = [];
const indices = [];
function quad(a, b, c, d, n) {
  const base = positions.length / 3;
  for (const p of [a, b, c, d]) {
    positions.push(...p);
    normals.push(...n);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function box(min, max) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
}
box([-0.5, 0, -0.5], [0.5, 1, 0.5]); // 1m 立方体
box([-0.06, 0.47, 0.5], [0.06, 0.53, 1.3]); // 前（+Z）を指す矢印の軸
box([-0.16, 0.42, 1.3], [0.16, 0.58, 1.5]); // 矢印の頭

const pos = new Float32Array(positions);
const nor = new Float32Array(normals);
const idx = new Uint16Array(indices);
const pad4 = (n) => (n + 3) & ~3;
const binLength = pos.byteLength + nor.byteLength + pad4(idx.byteLength);
const bin = Buffer.alloc(binLength);
Buffer.from(pos.buffer).copy(bin, 0);
Buffer.from(nor.buffer).copy(bin, pos.byteLength);
Buffer.from(idx.buffer).copy(bin, pos.byteLength + nor.byteLength);

const min = [Infinity, Infinity, Infinity];
const max = [-Infinity, -Infinity, -Infinity];
for (let i = 0; i < positions.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], positions[i + k]);
    max[k] = Math.max(max[k], positions[i + k]);
  }
}
const gltf = {
  asset: { version: '2.0', generator: 'veilbound-hunters tools/make-ref-glb.mjs' },
  scene: 0,
  scenes: [{ name: 'ref_cube_1m', nodes: [0] }],
  nodes: [{ name: 'ref_cube_1m', mesh: 0 }],
  meshes: [{ name: 'ref_cube_1m', primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [{ name: 'ref_bronze', pbrMetallicRoughness: { baseColorFactor: [0.69, 0.55, 0.34, 1], metallicFactor: 0, roughnessFactor: 0.9 } }],
  buffers: [{ byteLength: binLength }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 },
    { buffer: 0, byteOffset: pos.byteLength, byteLength: nor.byteLength, target: 34962 },
    { buffer: 0, byteOffset: pos.byteLength + nor.byteLength, byteLength: idx.byteLength, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5123, count: idx.length, type: 'SCALAR' },
  ],
};
let json = Buffer.from(JSON.stringify(gltf), 'utf8');
json = Buffer.concat([json, Buffer.alloc(pad4(json.length) - json.length, 0x20)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
const jsonHead = Buffer.alloc(8);
jsonHead.writeUInt32LE(json.length, 0);
jsonHead.writeUInt32LE(0x4e4f534a, 4);
const binHead = Buffer.alloc(8);
binHead.writeUInt32LE(bin.length, 0);
binHead.writeUInt32LE(0x004e4942, 4);
const out = new URL('../public/assets/models/ref_cube_1m.glb', import.meta.url);
writeFileSync(out, Buffer.concat([header, jsonHead, json, binHead, bin]));
console.log(`wrote ${out.pathname} (${12 + 8 + json.length + 8 + bin.length} bytes)`);
