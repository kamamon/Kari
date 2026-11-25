"""Deterministic proposal builder. Writes only this inbox; never imports into Kari."""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
from collections import Counter
import copy, hashlib, json, gzip, subprocess

PACKAGE=Path(__file__).resolve().parents[1]
REPO=PACKAGE.parents[1]
COMMIT='1e078bfce1e68f287ae577cf41d2fe5bafb94afa'
RANKS={1:'初級',2:'中級',3:'上級',4:'極級'}
FAMILIES=['heavy_blade','guard_blade','war_maul','twin_blades','long_blade','long_lance','ring_bow']
FAMILY_NAMES=dict(zip(FAMILIES,['断岳剣','護刃','大槌','双剣','太刀','長尖槍','環弓']))
SLOTS=['head','chest','arms','waist','legs']
SLOT_NAMES=dict(zip(SLOTS,['頭','胴','腕','腰','脚']))
ELEMENTS=['fire','thunder','ice','water','wind','mist']
ELEMENT_NAMES=dict(zip(ELEMENTS,['火','雷','氷','水','風','霧']))
STATUS_NAMES={'poison':'毒','paralysis':'麻痺','sleep':'睡眠','stun':'気絶'}
PROFILE_RULES={
 'raw':dict(rawRatio=1.0,affinity=0,elementRatio=0,statusRatio=0),
 'precision':dict(rawRatio=.94,affinity=25,elementRatio=0,statusRatio=0),
 'single':dict(rawRatio=.92,affinity=0,elementRatio=.28,statusRatio=0),
 'status':dict(rawRatio=.94,affinity=0,elementRatio=0,statusRatio=.10),
 'compound':dict(rawRatio=.88,affinity=0,elementRatio=.28,statusRatio=0),
}
SKILLS={
 'guard_economy':dict(name='受け支え',values=[8,14,20],unit='%',effect='ガード時のスタミナ消費を軽減。削りダメージや防御範囲は変えない。'),
 'edge_keep':dict(name='刃持ち',values=[5,9,13],unit='%',effect='刃・打面の消耗を軽減。弓には効果なし。'),
 'dodge_economy':dict(name='身軽',values=[5,9,13],unit='%',effect='回避スタミナ消費を軽減。無敵時間・移動距離は変えない。'),
 'stamina_recovery':dict(name='息継ぎ',values=[4,7,10],unit='%',effect='自然スタミナ回復速度を増す。回復開始までの遅延は変えない。'),
 'part_damage':dict(name='砕き',values=[5,9,13],unit='%',effect='破壊・切断専用の蓄積を増す。HP、通常怯み、気絶は増やさない。'),
 'element_tuning':dict(name='属性調律',values=[4,7,10],unit='%',effect='属性部分だけを増す。'),
 'status_tuning':dict(name='状態調律',values=[4,7,10],unit='%',effect='毒・麻痺・睡眠の蓄積を増す。気絶は対象外。'),
 'weak_crit':dict(name='急所観察',values=[4,7,10],unit='会心ポイント',effect='物理肉質0.55以上の命中に加算。会心は物理部分のみ、合計上限60%。'),
 'stun_tuning':dict(name='響打',values=[4,7,10],unit='%',effect='気絶判定のある打撃技が頭部へ命中した時だけ蓄積を増す。'),
 'item_efficiency':dict(name='道具整備',values=[5,9,13],unit='%',effect='許可した整備用アイテムの使用時間だけを短縮。回復量や無敵時間は増やさない。'),
 'status_resistance':dict(name='個別状態耐性',values=[20,35,50],unit='%',effect='指定した状態異常の必要蓄積を増す。対象status必須。'),
 'element_resistance':dict(name='個別属性耐性',values=[3,6,9],unit='耐性ポイント',effect='指定した属性の防具耐性へ加算。対象element必須。'),
 'gather_haste':dict(name='採集手際',values=[8,14,20],unit='%',effect='非戦闘中の植物採集動作を短縮。抽選回数・レア率は増やさない。'),
 'mining_haste':dict(name='採掘手際',values=[8,14,20],unit='%',effect='非戦闘中の採掘動作を短縮。抽選回数・レア率は増やさない。'),
 'insect_haste':dict(name='虫取り手際',values=[8,14,20],unit='%',effect='非戦闘中の虫取り後の収納動作を短縮。捕獲範囲・成功率・レア率は増やさない。'),
 'gather_sense':dict(name='素材観察',values=[4,7,10],unit='m',effect='既知の採取点を近距離で示す。敵・未解放地点・レア素材の確定位置を示さない。'),
}

def read(path):return json.loads((REPO/path).read_text())
def rounded(value,places=0):return float(Decimal(str(value)).quantize(Decimal('1').scaleb(-places),rounding=ROUND_HALF_UP)) if places else int(Decimal(str(value)).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
def write(name,obj):
    (PACKAGE/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
def slug(source_id):return source_id.split('.')[-1]
def rank_int(v):return int(str(v).split('.')[-1])
def named_status(s):return 'paralysis' if s=='para' else s
def material_text(value):
    if isinstance(value,dict):return ' / '.join(str(v) for v in value.values())
    if isinstance(value,list):return ' / '.join(map(str,value))
    return str(value)

def main():
    actual=subprocess.check_output(['git','rev-parse','HEAD'],cwd=REPO,text=True).strip()
    if actual!=COMMIT and subprocess.run(['git','merge-base','--is-ancestor',COMMIT,'HEAD'],cwd=REPO).returncode:
        raise RuntimeError('Unexpected repository base; review current source before regenerating')
    baseline_w=read('public/data/weapons.json'); baseline_a=read('public/data/armor.json'); recipes_old=read('public/data/recipes.json')['recipes']
    monsters=read('public/data/bestiary.json')['species']; monster_by_id={x['id']:x for x in monsters}
    live_materials=read('public/data/items.json')['materials']+read('public/data/items_creatures.json')['materials']
    live_by_id={x['id']:x for x in live_materials}; live_by_name={x['name']:x for x in live_materials}
    source_resources=read('docs/source/chatgpt-quest-design-20261125/resources_v2.json')['resources']
    resource_by_id={x['id']:x for x in source_resources}
    series=[]
    for name in ['series-001-029.json','series-030-058.json','series-059-086.json','gathering-series.json']:
        series+=json.loads((PACKAGE/'data'/name).read_text())
    assert len(series)==95
    for s in series:
        s['nativeRank']=rank_int(s['nativeRank'])
        s['status']=named_status(s.get('status'))
        if s.get('sourceSpeciesId'):
            src=monster_by_id[s['sourceSpeciesId']]
            s['category']='monster';s['source']=copy.deepcopy(src)
            s['sourceSpeciesClass']=src['class'];s['weak']=src['weak'];s['resist']=src['resist'];s['habitat']=src['habitat']
            assert s['nativeRank']==rank_int(src['rank']) and s['name']==src['name'] and s['no']==src['no']
        else:
            s['sourceSpeciesClass']=None;s['weak']=[];s['resist']=[];s['habitat']=' / '.join(dict.fromkeys(m['fieldName'] for m in s['materialChain']))
        s['elements']=[x for x in s.get('elements',[]) if x!='none']
        if s['weaponProfile'] in ['raw','precision','status']: s['elements']=[]
        if s['weaponProfile']!='status':s['status']=None
        for sk in [s['primarySkill'],s['secondarySkill']]:assert sk in SKILLS,(s['name'],sk)
        for sk,param in s.get('skillParameters',{}).items():
            if 'status' in param:param['status']=named_status(param['status'])
        for sk in [s['primarySkill'],s['secondarySkill']]:
            if sk=='element_resistance':assert s['skillParameters'][sk]['element'] in ELEMENTS
            if sk=='status_resistance':assert s['skillParameters'][sk]['status'] in STATUS_NAMES
    series.sort(key=lambda s:s['no'])
    by_id={s['id']:s for s in series}
    wbase={(w['family'],int(w['id'].split('.')[-1])-1):w for w in baseline_w['weapons'] if not w.get('starter')}
    abase={(a['slot'],int(a['id'].split('.')[-1])-1):a for a in baseline_a['armor'] if not a.get('starter')}
    old_recipe_by_result={(r.get('resultWeaponId') or r.get('resultArmorId')):r for r in recipes_old}
    materials={}
    def register(m):
        if m['id'] in materials:
            assert materials[m['id']]['name']==m['name']
        else:materials[m['id']]=m
        return m['id']
    # Existing source objects remain verbatim, alongside explicit provenance fields.
    for m in live_materials:
        register(dict(id=m['id'],name=m['name'],acquisition='monster',isImplemented=True,sourceRecord=m,rankOrder=None,fieldName=None))
    for s in series:
        if s['category']=='monster':continue
        for m in s['materialChain']:
            register(dict(id=m['id'],name=m['name'],acquisition=s['category'],isImplemented=False,rankOrder=m['rank'],fieldName=m['fieldName'],
                          sourceRecord=resource_by_id.get(m['id']),sourceProposalExists=m['id'] in resource_by_id,
                          unlock='該当級と狩場の解放。高級の採取点・虫種・加工は新設計。',unit='束' if '繊維' in m['name'] or '糸' in m['name'] else '個'))
    by_key={s['id'].split('.')[-1]:s for s in series if s['category']!='monster'}
    binding={m['rank']:m['id'] for m in by_key['woven_grass']['materialChain']}
    metal={m['rank']:m['id'] for m in by_key['forged_iron']['materialChain']}
    material_identity={}
    def roles(s,rank):
        if s.get('sourceSpeciesId')=='monster.galdros':
            return [x['itemId'] for x in old_recipe_by_result[f'weapon.heavy_blade.{rank+1:03}']['cost']['items']]
        if s['category']!='monster':return [s['materialChain'][rank-1]['id'],binding[rank],metal[rank]]
        src=monster_by_id[s['sourceSpeciesId']];out=[]
        for role,key in [('main','mainMaterial'),('support','supportMaterial'),('organ','organMaterial')]:
            name=material_text(s[key]); existing=live_by_name.get(name)
            identity=(src['id'],rank,name)
            if identity in material_identity:
                mid=material_identity[identity]
            elif rank==s['nativeRank'] and existing:
                mid=existing['id']
            else:
                mid=f'proposal.material.{slug(src["id"])}.{role}.r{rank}'
                display=name if rank==s['nativeRank'] else f'{name}［{RANKS[rank]}］'
                register(dict(id=mid,name=display,baseMaterialName=name,sourceSpeciesId=src['id'],rankOrder=rank,acquisition='monster',isImplemented=False,fieldName=src['habitat'],
                              unlock=f'{RANKS[rank]}の{src["name"]}から得る候補。個体・依頼・ドロップの実装が必要。',sourceProposalExists=False))
            material_identity[identity]=mid
            out.append(mid)
        return out
    def ingredients(ids,counts):
        c=Counter()
        for a,b in zip(ids,counts):c[a]+=b
        return [dict(materialId=k,name=materials[k]['name'],count=v) for k,v in c.items() if v>0]
    weapons=[];armor=[];recipes=[];variants=[]
    for s in series:
        is_galdros=s.get('sourceSpeciesId')=='monster.galdros'
        is_juvenile=s['sourceSpeciesClass']=='juvenile';nonhunt=s['category']!='monster'
        for rank in range(s['nativeRank'],5):
            mids=roles(s,rank)
            base_def={1:30,2:65,3:105,4:150}[rank]
            classfactor={'heavy':1,'medium':.95,'light':.90}[s['armorClass']]
            availabilityFactor=.9 if is_juvenile or nonhunt else 1
            set_def=base_def if is_galdros else rounded(base_def*classfactor*availabilityFactor)
            quotient,remainder=divmod(set_def,5)
            defense={slot:quotient for slot in SLOTS}
            for slot in ['chest','legs','head','arms','waist'][:remainder]:defense[slot]+=1
            resistance={e:(3 if e in s['resist'] else -2 if e in s['weak'] else 0) for e in ELEMENTS}
            variants.append(dict(seriesId=s['id'],rank=rank,rankId=f'rank.{rank}',rankName=RANKS[rank],materialRoles=mids,setDefense=set_def,
                                 armorClass=s['armorClass'],defenseBySlot=defense,resistancePerPiece=resistance,appearance=s['gradeAppearance'][str(rank)],
                                 appearanceArt='系列原画は初登場級。高級の形状差はこの仕様で定義。',runtimeExists=is_galdros,
                                 requiredField=s['habitat'],unlock='該当級・狩場・素材供給の解放。星数を級へ変換しない。'))
            for family in FAMILIES:
                base=wbase[(family,rank)];A=base['attack'];profile=s['weaponProfile'];rule=PROFILE_RULES[profile]
                raw=rule['rawRatio'];crit=rule['affinity'];er=rule['elementRatio'];sr=rule['statusRatio']
                if nonhunt:raw=s['rawRatio'];crit=s['affinity'];er=0;sr=0
                elif is_juvenile:raw*=.94;er*=.85;sr*=.85
                single_value=rounded(A*er);E=single_value*1.5 if profile=='compound' else single_value
                wid=base['id'] if is_galdros else f'proposal.weapon.{slug(s.get("sourceSpeciesId") or s["id"])}.{family}.r{rank}'
                name=base['name'] if is_galdros else f'{s["seriesName"]}の{FAMILY_NAMES[family]}【{RANKS[rank]}】'
                w=dict(id=wid,seriesId=s['id'],sourceSpeciesId=s.get('sourceSpeciesId'),seriesName=s['seriesName'],family=family,familyName=FAMILY_NAMES[family],rank=rank,rankName=RANKS[rank],name=name,
                       attack=base['attack'] if is_galdros else rounded(A*raw),referenceAttack=A,rawRatio=raw,affinity=crit,profile=profile,
                       elements=s['elements'],elementValue=E,status=s['status'],statusPotency=rounded(A*sr,1),sharpnessModifier=1,
                       sourceRecord=copy.deepcopy(base) if is_galdros else None,runtimeExists=is_galdros,artFile=s['artFile'],artRank=s['nativeRank'],
                       shape=s['weapons'][family]['shape'],materialDesign=s['weapons'][family]['material'],gradeAppearance=s['weapons'][family]['gradeEvolution'][str(rank)])
                weapons.append(w)
                if is_galdros:
                    old=copy.deepcopy(old_recipe_by_result[wid]);cost=old['cost'];parent=old.get('fromWeaponId')
                    ing=[dict(materialId=x['itemId'],name=live_by_id[x['itemId']]['name'],count=x['count']) for x in cost['items']]
                    recipe=dict(id=old['id'],sourceRecord=old,kind='existing_upgrade',fromId=parent,money=cost['money'],ingredients=ing,runtimeExists=True)
                else:
                    count_main=4+(rank-1)+{'heavy_blade':1,'war_maul':1,'twin_blades':1,'long_lance':2}.get(family,0)
                    count_support=2+int(rank>=3)+({'guard_blade':1,'long_lance':1,'ring_bow':2}.get(family,0))
                    count_organ=1+int(rank>=3)
                    parent=None if rank==s['nativeRank'] else wid.rsplit('.',1)[0]+f'.r{rank-1}'
                    recipe=dict(id='recipe.'+wid,sourceRecord=None,kind='craft' if parent is None else 'upgrade',fromId=parent,
                                money=rounded([0,120,400,900,1800][rank]*(.70 if nonhunt else .85 if is_juvenile else 1)),
                                ingredients=ingredients(mids,[count_main,count_support,count_organ]),runtimeExists=False)
                recipe.update(resultId=wid,itemType='weapon',seriesId=s['id'],rank=rank,nonHuntMaterialsOnly=nonhunt,consumesPrevious=recipe['fromId'] is not None,
                              note='既存レシピをそのまま保持' if is_galdros else '材料・工房操作・解放条件を採用後に実装する候補')
                recipes.append(recipe)
            for slot in SLOTS:
                base=abase[(slot,rank)];aid=base['id'] if is_galdros else f'proposal.armor.{slug(s.get("sourceSpeciesId") or s["id"])}.{slot}.r{rank}'
                skill=s['primarySkill'] if slot in ['head','arms','legs'] else s['secondarySkill']
                a=dict(id=aid,seriesId=s['id'],sourceSpeciesId=s.get('sourceSpeciesId'),seriesName=s['seriesName'],slot=slot,slotName=SLOT_NAMES[slot],rank=rank,rankName=RANKS[rank],
                       name=base['name'] if is_galdros else f'{s["seriesName"]}の{SLOT_NAMES[slot]}装備【{RANKS[rank]}】',defense=base['defense'] if is_galdros else defense[slot],
                       armorClass=s['armorClass'],resistances=resistance,skill=dict(id=skill,name=SKILLS[skill]['name'],points=1,parameters=s.get('skillParameters',{}).get(skill,{})),
                       shape=s['armorParts'][slot],gradeAppearance=s['gradeAppearance'][str(rank)],sourceRecord=copy.deepcopy(base) if is_galdros else None,
                       runtimeExists=is_galdros,proposedAdditions='技能・耐性は既存岩殻装備にも追加する未採用の設計',artFile=s['artFile'],artRank=s['nativeRank'])
                armor.append(a)
                if is_galdros:
                    old=copy.deepcopy(old_recipe_by_result[aid]);cost=old['cost'];parent=old.get('fromArmorId')
                    ing=[dict(materialId=x['itemId'],name=live_by_id[x['itemId']]['name'],count=x['count']) for x in cost['items']]
                    recipe=dict(id=old['id'],sourceRecord=old,kind='existing_upgrade',fromId=parent,money=cost['money'],ingredients=ing,runtimeExists=True)
                else:
                    parent=None if rank==s['nativeRank'] else aid.rsplit('.',1)[0]+f'.r{rank-1}'
                    counts=[{'head':2,'chest':4,'arms':3,'waist':3,'legs':4}[slot]+rank-1,2 if slot in ['chest','legs'] else 1,1 if slot in ['head','chest','legs'] else 0]
                    recipe=dict(id='recipe.'+aid,sourceRecord=None,kind='craft' if parent is None else 'upgrade',fromId=parent,
                                money=rounded([0,80,250,550,1100][rank]*(.70 if nonhunt else .85 if is_juvenile else 1)),ingredients=ingredients(mids,counts),runtimeExists=False)
                recipe.update(resultId=aid,itemType='armor',seriesId=s['id'],rank=rank,nonHuntMaterialsOnly=nonhunt,consumesPrevious=recipe['fromId'] is not None,
                              note='既存レシピをそのまま保持' if is_galdros else '材料・工房操作・解放条件を採用後に実装する候補')
                recipes.append(recipe)
    rules=dict(profiles=PROFILE_RULES,skills=SKILLS,
      ranks=[dict(order=r,id=f'rank.{r}',name=RANKS[r],galdrosTier=r+1) for r in RANKS],
      weapons=dict(reference='現行同武器種・同級のガルドロス攻撃力A。既存35武器の全フィールドはbaselineで保持。',rounding='正数の四捨五入、.5は切上げ。複合Eは丸め済み単属性E×1.5の.5を保持。',
                   elementMotion='各ヒットの最終物理モーション係数を属性・状態異常の係数へ使う。溜め・勢い・弓の距離補正は一回だけ適用。コンボ合計を各ヒットへ重ねない。',
                   damage='floor((A*motion*sharpness*physicalZone*critical + E*effectiveMotion*elementZone)*quest). 無効0、それ以外は既存の最小1。',
                   compound='上級・極級（既存T4/T5）のみ。2属性の部位係数の大きい方を使う。2つのどちらも攻撃対象モンスターのweak指定でない時だけ、属性項を0.5倍にする。片方でも弱点なら半減しない。',
                   affinity='物理だけ。会心1.25、負会心0.75。装備・技能の合計上限60%。',
                   smallSeries='幼体はraw係数へ0.94、属性/状態係数へ0.85、防御へ0.90。全7種を成人の装備として小片の接合で作る。'),
      armor=dict(defense='100/(100+5部位防御合計)。重装100%、中装95%、軽装90%。幼体と非狩猟系列はさらに90%。合計を四捨五入後5等分、余りは胴→脚→頭→腕→腰。',
                 skillBudget='1部位1点、全級5点。主技能=頭腕脚3点、副技能=胴腰2点。各技能上限Lv3、同系列5部位の特別ボーナスなし。',
                 typedSkills='耐性技能は(id,element)または(id,status)で集計。IDだけを合算し複数の属性/状態へ同時に高レベルを付与しない。',
                 resistance='素材元のweakを各部位-2、resistを+3。他0。合計と技能を足して[-30,30]へ制限。属性項のみへ(1-resistance/100)。',
                 incoming='(物理+属性*(1-耐性/100))*防御補正*rank*既存経路のrage を小数のままresolveIncomingHitへ。通常/防御崩れは分岐後floorで最小1、削りはfloorで0可、受け流し/返し0。既存hazardへ新たにrageを掛けない。'),
      statuses=dict(potency='基礎蓄積×最終モーション係数×状態部位係数×技能。固定小数1000単位。武器の接触タグが該当する命中のみ。',
                    threshold='毒/麻痺/睡眠は初回100、n回発症後ceil(100*1.35^n)。最後の蓄積から5秒後、毎秒2減衰。',
                    effects='麻痺2.5秒。睡眠8秒、起こす最初の物理命中のみ1.5倍。同tickは固定命中順。毒は最大HP2%切捨てを15秒10回へ商と余りで分配。',
                    stun='頭部タグへの許可された打撃だけ。初回100、ceil(100*1.5^n)、2.5秒。素材がstunでも斬撃へ自動付与しない。',
                    control='麻痺・睡眠・気絶は重複不可。継続中と終了後180tickは他硬直ゲージを閾値1000単位-1へ制限。猶予終了だけでは発症せず、次の有効命中が必要。毒は別。',
                    active='同じ状態の継続中は蓄積しない。発症時の超過分は破棄。部位怯み・転倒との競合は実機で追加確認。'),
      acquisition=dict(nonhunt='9系列の全レシピは採集・採掘・虫取り素材だけ。貸与貨物と討伐素材を使用しない。級・狩場解放は通常進行。',
                       sameGrade='上位素材点はその級の許可と狩場解放で利用可。作ろうとする同級装備や同級採取道具を前提にしない。初期貸与道具で採取できる。',
                       ecology='虫は小型の環境生物。12虫素材は新設計。灯虫の光を雷/霧属性ダメージに読み替えない。樹脂反射は自発光ではない。',
                       materialUpgrade='高級のモンスター素材は同種のその級個体から。素材を下級から無制限に変換するレシピは設けない。',
                       crafting='新系列は解放級で直接生産し、以降は同系列・同武器/部位を一方向に強化。前装備は消費する。横派生なし。直接生産は現行に未実装。'),
      handoff=dict(save='現行schema4。既存IDを保持。新所持品・技能・採取進行の追加はClaudeが版管理し、復元と重複を検査。',
                   noImport='このJSONは設計用。bestiary importer/現行weapons loaderへ直接渡さない。画像は比較原画で、正投影/3D/全級個別画像ではない。'))
    counts={str(r):dict(monsterSeries=sum(s['category']=='monster' and s['nativeRank']<=r for s in series),nonhuntSeries=9,
                           weapons=sum(w['rank']==r for w in weapons),armor=sum(a['rank']==r for a in armor)) for r in RANKS}
    doc=dict(documentType='all-rank-equipment-design-proposal',version='2.0',sourceCommit=COMMIT,date='2026-11-25',runtimeImportable=False,
             status='未採用の設計候補。既存装備の参照行を含む。素材/採取/生産/技能/状態異常/高級個体の追加実装が必要。',
             counts=dict(series=95,monsterSeries=86,nonhuntSeries=9,seriesRanks=len(variants),weapons=len(weapons),armor=len(armor),recipes=len(recipes),byRank=counts),
             series=series,rankVariants=variants,weaponCandidates=weapons,armorCandidates=armor,recipes=recipes,materials=list(materials.values()),rules=rules)
    item_ids={x['id'] for x in weapons+armor};baseline_ids={x['id'] for x in baseline_w['weapons']+baseline_a['armor']}
    checks=[]
    def ck(name,passed):checks.append(dict(name=name,passed=bool(passed)));assert passed,name
    ck('86 original species IDs preserved', {s['sourceSpeciesId'] for s in series if s['category']=='monster'}==set(monster_by_id))
    ck('9 non-hunt series, 3 per acquisition group',Counter(s['category'] for s in series if s['category']!='monster')==dict(gather=3,mining=3,insect=3))
    ck('250 series-rank variants',len(variants)==250)
    ck('1750 weapons and 1250 armor',len(weapons)==1750 and len(armor)==1250)
    ck('3000 unique equipment IDs',len(item_ids)==3000)
    ck('3000 complete unique recipes',len(recipes)==3000 and len({r['id'] for r in recipes})==3000 and {r['resultId'] for r in recipes}==item_ids)
    ck('no equipment below source native rank',all(x['rank']>=by_id[x['seriesId']]['nativeRank'] for x in weapons+armor))
    ck('rank-wise monster coverage 21 41 66 86',[counts[str(r)]['monsterSeries'] for r in RANKS]==[21,41,66,86])
    ck('all seven weapon types and all five slots per variant',all(sum(w['seriesId']==v['seriesId'] and w['rank']==v['rank'] for w in weapons)==7 and sum(a['seriesId']==v['seriesId'] and a['rank']==v['rank'] for a in armor)==5 for v in variants))
    ck('five slot defenses exactly sum to declared total',all(sum(a['defense'] for a in armor if a['seriesId']==v['seriesId'] and a['rank']==v['rank'])==v['setDefense'] for v in variants))
    ck('skill budget five with typed resistance parameters',all(sum(a['skill']['points'] for a in armor if a['seriesId']==v['seriesId'] and a['rank']==v['rank'])==5 for v in variants))
    ck('compound only high ranks and exactly two elements',all(w['rank']>=3 and len(w['elements'])==2 for w in weapons if w['profile']=='compound'))
    ck('one elemental or one status output; no all-weapon stun',all(not (w['elements'] and w['status']) and w['status']!='stun' for w in weapons))
    ck('nonhunt recipes contain no monster or loaned-cargo inputs',all(materials[i['materialId']]['acquisition'] in ['gather','mining','insect'] for r in recipes if r['nonHuntMaterialsOnly'] for i in r['ingredients']))
    ck('all recipe inputs resolved with positive counts',all(i['materialId'] in materials and isinstance(i['count'],int) and i['count']>0 for r in recipes for i in r['ingredients']))
    ck('same material has one combined recipe entry',all(len(r['ingredients'])==len({i['name'] for i in r['ingredients']}) for r in recipes))
    ck('parents resolve and no sideways branches',all(r['fromId'] is None or r['fromId'] in item_ids|baseline_ids for r in recipes) and max(Counter(r['fromId'] for r in recipes if r['fromId']).values())==1)
    ck('native direct crafts and same-series sequential upgrades',all(r['fromId'] is None if r['rank']==by_id[r['seriesId']]['nativeRank'] else r['fromId'] is not None for r in recipes if not r['runtimeExists']))
    ck('all 48 existing recipes identical to source',len([r for r in recipes if r['runtimeExists']])==48 and all(r['sourceRecord']==old_recipe_by_result[r['resultId']] for r in recipes if r['runtimeExists']))
    ck('existing 28 ranked weapons and 20 armor base fields identical',all(w['sourceRecord']==wbase[(w['family'],w['rank'])] and w['attack']==w['sourceRecord']['attack'] for w in weapons if w['runtimeExists']) and all(a['sourceRecord']==abase[(a['slot'],a['rank'])] and a['defense']==a['sourceRecord']['defense'] for a in armor if a['runtimeExists']))
    ck('full shape and grade descriptions',all(set(s['armorParts'])==set(SLOTS) and set(s['weapons'])==set(FAMILIES) and set(s['gradeAppearance'])=={str(r) for r in range(s['nativeRank'],5)} for s in series))
    ck('candidate file explicitly non-importable',doc['runtimeImportable'] is False)
    write('data/all-equipment.json',doc)
    write('data/series-catalog.json',series)
    write('data/baseline-equipment.json',dict(sourceCommit=COMMIT,weapons=baseline_w['weapons'],armor=baseline_a['armor'],recipes=recipes_old))
    write('data/rules.json',rules)
    write('analysis/data-validation.json',dict(sourceCommit=COMMIT,checks=checks,passed=all(x['passed'] for x in checks),scope='Static design consistency. No runtime implementation or playtest.',counts=doc['counts']))
    payload=json.dumps(doc,ensure_ascii=False,separators=(',',':')).encode()
    (PACKAGE/'data/all-equipment.json.gz').write_bytes(gzip.compress(payload,compresslevel=9,mtime=0))
    sources=['AGENTS.md','docs/chatgpt-board.md','public/data/bestiary.json','public/data/ranks.json','public/data/weapons.json','public/data/armor.json','public/data/recipes.json','public/data/items.json','public/data/items_creatures.json','public/data/quests.json','public/data/quests_creatures.json','public/data/quests_herds.json','docs/elements.md','src/game/combat.ts','src/game/player.ts','src/save/profile.ts','src/render/hunterArmor.ts','docs/source/chatgpt-quest-design-20261125/resources_v2.json']
    write('references/sources.json',dict(sourceCommit=COMMIT,files=[dict(path=x,url=f'https://github.com/kamamon/Kari/blob/{COMMIT}/{x}',sha256=hashlib.sha256((REPO/x).read_bytes()).hexdigest()) for x in sources]))
    print(json.dumps(dict(counts=doc['counts'],checks=len(checks),passed=True,materials=len(materials)),ensure_ascii=False))

if __name__=='__main__':main()
