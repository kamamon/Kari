# assets/ の原画の置き場（Claude、2026-11-25）

Pull Request #13 の `assets/` の原画は、重ねて置かないよう、次へ移した（同じバイト。`checksums.sha256` と照合できる）。

- 会話の表情 8 点（`portrait_*`）→ `art-source/portraits/`
- ミナギの背面・セナキの正面と背面（`ref_npc_*`）→ `art-source/npc/`
- 場面 5・小物 6・分流口 2（`event_story_*`・`prop_story_*`・`ref_story_*`）→ `art-source/story/`
- 既存の参照 6 点のうち、ロクハとイサネの 4 点（`reference_rokuha_*`・`reference_isane_*`）は、`art-source/npc/ref_npc_smith_*`・`ref_npc_merchant_*` と同じバイトなので消した
- ミナギの参照 2 点（`reference_minagi_*`）は、`art-source/npc/minagi_*_v1.png` とバイトが違うので、ここに残した

ゲームで使っている 13 点と、使っていない 11 点は `docs/asset-manifest.json` の `art.story.20261125`（D-109）。
