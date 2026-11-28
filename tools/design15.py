"""ChatGPT の全装備四級版（Pull Request #15）の設計データを読む共通の道具（v0.34.0）。

tools/gen-equipment.py（上の級の装備・強化のレシピ）と、v0.74.0 までの tools/gen-monsters.py（上の級の素材・剥ぎ取り・依頼。v0.75.0 で外した）が、
同じ「上の級の素材の恒久 ID と名前」を使うために、ここで 1 回だけ決める。設計の JSON は資料（runtimeImportable: false）で、
値を読むだけ（中のスクリプトは走らせない）。
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'docs/source/chatgpt-equipment-20261125/data/all-equipment.json')

# 中級〜極級を入れる種（設計の requiredField が、いまある狩場「風礫盆地」の種。ガルドロスは前から 4 段ある）。
# ほかの種は、設計の狩場（根絡み湿原・灰鐘鉱山・硝砂海岸・霧灯樹海・氷帆峡谷）ができてから（盆地で代わりにしない）
# v0.75.0 で、白紙にした 3 種（帆角・幼岩・幼帆）を外した（利用者の指示。D-175）。いまは無い
RANK_SPECIES = []
RANKS = [2, 3, 4]
FIELD = '風礫盆地'

_DESIGN = None


def design():
    global _DESIGN
    if _DESIGN is None:
        with open(SRC, encoding='utf-8') as f:
            _DESIGN = json.load(f)
        if _DESIGN.get('runtimeImportable') is not False:
            sys.exit('設計のデータの runtimeImportable が false でない（形が変わった？）')
    return _DESIGN


def variant(sp, rank):
    for v in design()['rankVariants']:
        if v['seriesId'] == f'series.{sp}' and v['rank'] == rank:
            return v
    sys.exit(f'設計に series.{sp} の級 {rank} が無い')


def rank_materials(sp):
    """上の級の素材: [{designId, id, name, rank, role, baseId}]。恒久 ID は「級 1 の同じ役の素材の ID + .r<級>」。
    名前は設計のまま（「帆膜［中級］」）。設計の狩場が風礫盆地でなければ止まる"""
    names = {m['id']: m for m in design()['materials']}
    v1 = variant(sp, 1)['materialRoles']
    out, seen = [], {}
    for r in RANKS:
        v = variant(sp, r)
        if v['requiredField'] != FIELD:
            sys.exit(f'series.{sp} の級 {r} の狩場が {v["requiredField"]}（{FIELD} ではない）')
        for i, did in enumerate(v['materialRoles']):
            parts = did.split('.')
            if parts[:3] != ['proposal', 'material', sp] or parts[4] != f'r{r}':
                sys.exit(f'{did}: 上の級の素材の ID の形が違う')
            base = v1[i]
            if not base.startswith(f'mat.{sp}.'):
                sys.exit(f'{base}: 級 1 の素材の ID の形が違う')
            pid = f'{base}.r{r}'
            if did in seen:
                if seen[did] != pid:
                    sys.exit(f'{did}: 同じ設計の素材が、違う恒久 ID になる（{seen[did]} と {pid}）')
                continue
            seen[did] = pid
            m = names.get(did)
            if not m or m.get('rankOrder') != r or m.get('sourceSpeciesId') != f'monster.{sp}' or m.get('fieldName') != FIELD:
                sys.exit(f'{did}: 設計の素材の表と合わない')
            out.append({'designId': did, 'id': pid, 'name': m['name'], 'rank': r, 'role': parts[3], 'baseId': base})
    return out


def design_material_map():
    """設計の上の級の素材 ID → 恒久 ID（RANK_SPECIES の全部）"""
    return {m['designId']: m['id'] for sp in RANK_SPECIES for m in rank_materials(sp)}
