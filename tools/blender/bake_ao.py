"""ガルドロスの仮モデルの陰（アンビエントオクルージョン）を Blender の Cycles で焼き、頂点ごとの値を
src/render/galdrosAo.ts へ書き出す。

使い方（リポジトリの直下で）:
    pip install bpy            # Blender を Python の部品として入れる（約 430MB）
    npm run build && node tools/export-galdros-mesh.mjs
    python3 tools/blender/bake_ao.py

形（src/render/galdrosRig.ts）を変えたら、この 3 つをやり直す。頂点の数が合わない間、ゲームは陰を掛けずに描く。
"""
import base64
import json
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "out" / "galdros_mesh.json"
DST = ROOT / "src" / "render" / "galdrosAo.ts"
SAMPLES = 128
AO_DISTANCE = 1.1          # これより遠い物は陰に数えない (m)
SMOOTH = {"hide", "glow"}  # なめらかな面として扱うメッシュ（岩は面ごとに平ら）
# 壊れた後にだけ見える「core」は、背殻が無い状態で焼く
BAKE = [
    ("hide", {"core"}),
    ("rock", {"core"}),
    ("cap", {"core"}),
    ("dome", {"core"}),
    ("core", {"dome", "domeRim"}),
]


def main() -> None:
    data = json.loads(SRC.read_text())["meshes"]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.world = bpy.data.worlds.new("world")
    scene.world.light_settings.distance = AO_DISTANCE
    scene.render.bake.target = "VERTEX_COLORS"

    mat = bpy.data.materials.new("plain")
    objs = {}
    for name, m in data.items():
        verts = np.asarray(m["position"], dtype=np.float32).reshape(-1, 3)
        faces = np.asarray(m["index"], dtype=np.int32).reshape(-1, 3)
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(verts.tolist(), [], faces.tolist())
        mesh.update()
        mesh.polygons.foreach_set("use_smooth", [name in SMOOTH] * len(mesh.polygons))
        mesh.materials.append(mat)
        attr = mesh.color_attributes.new(name="AO", type="FLOAT_COLOR", domain="POINT")
        mesh.color_attributes.active_color = attr
        obj = bpy.data.objects.new(name, mesh)
        scene.collection.objects.link(obj)
        objs[name] = obj
        assert len(mesh.vertices) == len(verts), f"{name}: 頂点の数が変わった"

    # 地面（データは Y が上）。腹と足の裏に地面からの陰を付ける。
    ground = bpy.data.meshes.new("ground")
    s = 40.0
    ground.from_pydata([(-s, 0, -s), (s, 0, -s), (s, 0, s), (-s, 0, s)], [], [(0, 3, 2, 1)])
    ground.update()
    gobj = bpy.data.objects.new("ground", ground)
    scene.collection.objects.link(gobj)

    out = {}
    for name, hidden in BAKE:
        for other, o in objs.items():
            o.hide_render = other in hidden
            o.select_set(False)
        obj = objs[name]
        obj.hide_render = False
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type="AO")
        n = len(obj.data.vertices)
        cols = np.zeros(n * 4, dtype=np.float32)
        obj.data.color_attributes["AO"].data.foreach_get("color", cols)
        ao = np.clip(cols.reshape(-1, 4)[:, 0], 0.0, 1.0)
        out[name] = ao
        print(f"{name}: {n} 頂点  平均 {ao.mean():.3f}  最小 {ao.min():.3f}  0.2 未満 {(ao < 0.2).mean() * 100:.1f}%")

    lines = [
        "// 自動生成（tools/blender/bake_ao.py）。手で書き換えない。",
        "// ガルドロスの仮モデルの、頂点ごとの陰（周りに囲まれている所ほど暗い）。Blender の Cycles で焼いた値。",
        f"// Blender {bpy.app.version_string} / {SAMPLES} samples / 距離 {AO_DISTANCE}m",
        "export const GALDROS_AO: Record<string, { count: number; data: string }> = {",
    ]
    for name, ao in out.items():
        b = base64.b64encode(np.round(ao * 255).astype(np.uint8).tobytes()).decode("ascii")
        lines.append(f"  {name}: {{ count: {len(ao)}, data: '{b}' }},")
    lines.append("};")
    DST.write_text("\n".join(lines) + "\n")
    print("書き出し:", DST.relative_to(ROOT), f"{DST.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    sys.exit(main())
