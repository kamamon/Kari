#!/usr/bin/env python3
"""Render reviewable Japanese catalogs from the same JSON used by the reference engine."""
import json
from pathlib import Path
from generate_catalog import PACKAGE, FAMILIES, FAMILY_NAMES, SLOTS, read

RANKS={1:'初級',2:'中級',3:'上級',4:'極級'}
SLOT_NAMES=dict(zip(SLOTS,['頭','胴','腕','腰','脚']))
STATS={'rawPct':'物理ダメージ','elementPct':'属性ダメージ','statusPct':'状態蓄積','partPct':'破壊・切断蓄積','stunPct':'気絶蓄積','affinityPoints':'会心pt','guardCostPct':'ガード消費','dodgeCostPct':'回避消費','edgeWearPct':'刃消耗','staminaRecoveryPct':'スタミナ自然回復','incomingDamagePct':'被ダメージ','itemUseTicksPct':'整備使用時間'}
EVENTS={'hit':'命中','guard':'通常ガード成功','parry':'受け流し・受け返し成功','dodge':'敵の接触を回避無敵で避けた時','charge_release':'1段以上の溜め解放','sheathe':'明示的な納刀完了','draw':'抜刀完了','part_break':'部位破壊','status_inflicted':'状態異常を新しく発症させた時','damage_taken':'生存する直接非ガード被弾','item_used':'整備アイテムの実消費'}

def md(path,lines): (PACKAGE/path).write_text('\n'.join(lines).rstrip()+'\n')
def effect_text(m):
    return '、'.join(f'{STATS[e["stat"]]} {e["values"][0]:+g}/{e["values"][1]:+g}'+('pt' if e['stat']=='affinityPoints' else '%') for e in m['effects'])

def mechanic(lines,title,m):
    t=m['trigger'];lines += [f'### {title}：{m["name"]}', '', m['explanation'], '',
        '| 条件・挙動 | 定義 |','|---|---|',f'| 起点 | {EVENTS[t["event"]]} |',
        f'| 必須タグ / いずれかのタグ | {", ".join(t["tagsAll"]) or "なし"} / {", ".join(t["tagsAny"]) or "なし"} |',
        f'| HP / スタミナ残量 | {t["hpMin"]}〜{t["hpMax"]}% / {t["staminaMin"]}〜{t["staminaMax"]}% |',
        f'| 必要な別行動 / 集計窓 | {m["hitsRequired"]}行動 / {m["windowTicks"]/60:g}秒 |',
        f'| 効果（Lv1 / Lv2） | {effect_text(m)} |',
        f'| 持続 / 再発動待ち | {m["durationTicks"]/60:g}秒 / {m["cooldownTicks"]/60:g}秒 |',
        f'| 1行動消費 / 同じ個体への限定 | {"あり" if m["consumeOnHit"] else "なし"} / {"あり" if m["sameTarget"] else "なし"} |',
        f'| 解除 | {", ".join(m["resetOn"]) or "時間切れのみ"}。再発動待ちは戻さない |','']

def main():
    index=read(PACKAGE/'data/index.json'); commons={x['id']:x['name'] for x in read(PACKAGE/'data/design-contract.json')['commonSkills']}
    groups={g['seriesId']:g for g in (read(PACKAGE/'data'/x['path']) for x in index['series'])}
    summary=['# 全86種：装備特化カタログ','','各行から、全7武器・防具5部位・各級の数値・固有スキル・制作仕様へ進めます。数値は初期調整案、ゲーム本体への適用は未実施です。', '',
             '| No | 系列 / モンスター | 役割 | 固有防具スキル | 初登場級 |','|---:|---|---|---|---|']
    for path in sorted((PACKAGE/'data/species').glob('*.json')):
        b=read(path);n=b['no'];slug=b['speciesId'].split('.')[-1];g=groups['series.'+slug];a=b['appearance'];s=b['stats']
        filename=f'{n:03d}-{slug}.md'
        summary.append(f'| {n:03d} | [{g["seriesName"]} / {b["name"]}](catalog/{filename}) | {b["identity"]["role"]} | {b["signature"]["name"]} | {RANKS[b["nativeRank"]]} |')
        lines=[f'# {n:03d} {b["name"]} — {g["seriesName"]}', '', f'原種ID `{b["speciesId"]}`。{RANKS[b["nativeRank"]]}〜極級。 [JSON原本](../data/species/{path.name}) / [全級の装備・レシピ](../data/equipment/{path.name}) / [比較原画の復元と目録](../ART.md)', '',
               '## 戦い方','',f'**{b["identity"]["role"]}**','',b['identity']['ecologyBasis'],'',b['identity']['combatLoop'],'',
               f'- 得意：{b["identity"]["strength"]}',f'- 代償：{b["identity"]["weakness"]}',
               '- 推奨：'+'、'.join(FAMILY_NAMES[FAMILIES.index(f)] for f in b['identity']['recommendedFamilies']),
               f'- 避けたい状況：{b["identity"]["avoidUse"]}','',
               '## 基準との差','', '| 物理倍率 | 会心 | 属性倍率 | 状態倍率 | 刃容量 | 刃消耗 | 戦闘スタミナ | 防御倍率 |', '|---:|---:|---:|---:|---:|---:|---:|---:|',
               '| '+' | '.join(str(s[k]) for k in ['rawScale','affinity','elementScale','statusScale','edgeCapacityScale','edgeWearScale','staminaCostScale','defenseScale'])+' |','',
               '物理は同じ級・武器種の従来ガルドロス基準×物理倍率×武器種補正。属性・状態倍率はPR15の同系列・同級基準。刃容量は最大値と段階境界の両方を変える。戦闘スタミナは回避・ガード・溜めなど既存の有料行動だけに適用する。','',
               '## 武器：全級の具体値','', '| 級 | 武器 | 攻撃 | 会心% | 属性 / 値 | 状態 / 蓄積 |','|---|---|---:|---:|---|---|']
        for w in g['weapons']:
            lines.append(f'| {RANKS[w["rank"]]} | {FAMILY_NAMES[FAMILIES.index(w["family"])]} | {w["attack"]} | {w["affinity"]} | {"・".join(w["elements"]) or "なし"} / {w["elementValue"]} | {w["status"] or "なし"} / {w["statusPotency"]} |')
        lines += ['', '## 防具：全級の具体値','', '| 級 | 頭 | 胴 | 腕 | 腰 | 脚 | 合計防御 |','|---|---:|---:|---:|---:|---:|---:|']
        for v in g['ranks']: lines.append('| '+RANKS[v['rank']]+' | '+' | '.join(str(v['defenseBySlot'][k]) for k in SLOTS)+f' | {v["setDefense"]} |')
        lines += ['', '一式耐性：'+ '、'.join(f'{e} {v:+}' for e,v in s['setResistances'].items())+'。各部位はその1/5。同じ個別属性耐性スキルを含め、最終値は現行仕様の−30〜+30に制限。','',
                  '| 部位 | 共通スキル（各1点） | 外形 |','|---|---|---|']
        for slot in SLOTS:
            skill=b['commonSkills'][slot];param=' / '.join(skill.get('parameters',{}).values())
            lines.append(f'| {SLOT_NAMES[slot]} | {commons[skill["id"]]}'+(f'（{param}）' if param else '')+f' | {a["armorParts"][slot]} |')
        lines += ['','## 固有技能','', '同系列の異なる2部位でLv1、4部位でLv2。級が混じっても数える。5部位目に隠し効果はない。武器は部位数へ含めない。','']
        mechanic(lines,'防具固有',b['signature']);mechanic(lines,'武器主題（Lv1固定）',b['weaponTrait'])
        lines += ['武器主題は系統ごとに実行可能な行動・効果へ適合済み。実装では `weapon_trait.<種>.<武器種>` を読む。上表の主題の条件を全武器へ直結しない。','',
                  '## 見た目と制作','',a['silhouette'],'','配色：'+' / '.join(a['palette']),'','### 器官の転用','']+['- '+x for x in a['organTranslation']]
        lines += ['', '### 武器7系統の形','', '| 武器 | 独自形状 |','|---|---|']
        for f,label in zip(FAMILIES,FAMILY_NAMES): lines.append(f'| {label} | {a["weaponShapes"][f]} |')
        lines += ['', '### 級別の形状発達','']+[f'- {RANKS[int(r)]}：{v}' for r,v in a['gradeEvolution'].items()]
        lines += ['', '### モデル制作の固定条件','']+[f'- {key}：{value}' for key,value in a['production'].items()]
        cue=a['skillCue'];lines += ['', f'技能の合図は{cue["location"]}。平常：{cue["inactive"]}。発動：{cue["active"]}。点灯面積は全身の{cue["maxLitSurfacePercent"]}%以下。', '', '避ける形：','']+['- '+x for x in a['avoid']]
        lines += ['', '## 生産と実装の状態','', '全装備の材料ID・必要数・通貨・強化前IDは上の全級JSONの `recipes` に記録。既存レシピはそのまま保持。未実装級は指定狩場・該当級個体・素材供給の実装後に解放する。見た目は比較原画と形状指定までで、正式3D、各級別の専用絵、リグ可動域、iPhone実機での確認は未実施。']
        md(Path('catalog')/filename,lines)
    summary += ['', '## 採集・採掘・虫取りの9系列','', 'この432装備はPR15から保持。固有モンスタースキルの対象には含めず、既存の採集向け技能案と素材経路を維持する。','', '| 系列 | 全4級データ |','|---|---|']
    for entry in index['series']:
        if entry['category']=='gathering':
            g=groups[entry['seriesId']];summary.append(f'| {g["seriesName"]} / {g["name"]} | [武器28・防具20・レシピ48](data/{entry["path"]}) |')
    md(Path('CATALOG.md'),summary)

if __name__=='__main__':main()
