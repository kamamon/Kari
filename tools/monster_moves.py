"""大型 11 種と幼体 8 種の技と、技以外の動き（v0.21.0。tools/gen-monsters.py が読む。手で編集してよいのは、このファイル）。

決まり（docs/decisions.md D-088。これから作る種も同じ）:
  - 大型は、ガルドロスと同じく 18 前後の技（咆哮・威嚇・退き・登録簿の 4 つ・種に固有の技）。幼体は 6〜8。
  - どの技も、その種だけの鍵の姿勢で動く（ほかの種と同じ動きを使い回さない）。予備動作 → 打つ → 振り抜き → 戻り を書く。
  - 体の部位で当てる技は、判定の形を部位に付ける（B(...)）。npm run monsters:bake が、動きの中の部位の位置から軌道を作るので、見た目と判定がずれない。
    風・音・息のように、体から離れた所へ届く判定だけ、手で軌道を書く。
  - 技以外の動き（気付く前・身構え・弱る・怒り・走る・眠る・怯み・転倒と起き上がり・倒れる・しぐさ）も、種ごとに書く。
値の決まりは tools/monster_lib.py の先頭。数値は机上の値で、人が遊んで確かめていない。
"""
from monster_lib import A, B, F, K, ai, hazard, hit, idle, lr, move, side_name, track

# =============================================================================================
# 02 帆角獣 セルヴァルク（四足軽獣。風）: 細い脚の跳躍と、頭の分割角膜。用心深く、まず横へ跳ぶ。突きは短く繰り返す
#   体: 根元 z -0.07 / 高さ 1.71、頭 z 1.62 y 2.58、鼻先 z 1.80、前脚の付け根 z 0.86、後脚 z -0.82、尾の先 z -2.90。
#   印: sp:12 = 鼻先、sp:11 = 頭、sp:9〜10 = 首、sp:7 = 胸、sp:0〜4 = 尾。
# =============================================================================================


def selvark_moves(s):
    crouch = dict(yH=-0.14, legs={'*': (0, 0.55)})
    return [
        move('roar', 90, 90, 90, A(
            K('w', 0.55, None, yH=-0.04, neckPitch=-0.25, headPitch=-0.2, crest=-0.3, legs={'F': (0.1, 0.1)}),
            K('w', 1.0, None, pitch=0.12, neckPitch=0.35, headPitch=0.25, crest=0.6, tailPitch=0.3),
            K('s', 0.4, 'o', pitch=0.16, yH=0.05, neckPitch=0.5, headPitch=0.38, crest=1.3, tailPitch=0.55, legs={'F': (-0.1, 0.25)}),
            K('r', 0.55, None, pitch=0.14, yH=0.04, neckPitch=0.45, headPitch=0.35, crest=1.2, tailPitch=0.5, legs={'F': (-0.08, 0.2)}),
            K('r', 0.85, None, neckPitch=0.1, crest=0.3, tailPitch=0.1),
            shake=0.03), sounds=[(10, 'beast_cry')]),
        move('threat', 110, 30, 80, A(
            K('w', 1.0, None, yH=-0.05, neckPitch=-0.2, headPitch=-0.25, crest=1.3, tailPitch=0.3, legs={'F.S': (0.25, 0.7)}),
            K('s', 0.25, 'i', yH=-0.06, pitch=-0.03, neckPitch=-0.22, headPitch=-0.25, crest=1.3, tailPitch=0.3, legs={'F.S': (0.15, 0.0)}),
            K('s', 0.5, None, yH=-0.05, neckPitch=-0.2, headPitch=-0.25, crest=1.35, tailPitch=0.35, legs={'F.S': (0.25, 0.7)}),
            K('s', 0.75, 'i', yH=-0.06, pitch=-0.03, neckPitch=-0.22, headPitch=-0.25, crest=1.35, tailPitch=0.35, legs={'F.S': (0.15, 0.0)}),
            K('s', 1.0, None, yH=-0.04, neckPitch=-0.28, headPitch=-0.35, headYaw=0.15, crest=1.2, tailPitch=0.3),
            K('r', 0.6, None, crest=0.4, neckPitch=-0.05)),
             sounds=[(6, 'beast_cry'), (38, 'galdros_step'), (63, 'galdros_step')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 70, 18, 36, A(
            K('w', 1.0, None, pitch=-0.06, **crouch),
            K('s', 0.4, 'o', pitch=0.22, neckPitch=0.25, crest=0.5, legs={'F': (0.6, 0.8), 'H': (-0.4, 0.3)}),
            K('s', 1.0, None, pitch=0.1, neckPitch=0.15, crest=0.3, legs={'*': (0, 0.85)}),
            K('r', 0.25, 'i', yH=-0.12, pitch=-0.05, legs={'*': (0, 0.45)}),
            K('r', 0.7, None, yH=-0.03), hop=0.25),
             curve=(-4.5, 16, 40), sounds=[(16, 'gust')], ai=ai(0, 3.0, 180, 0.8, cd=520)),
        *lr(lambda sd, n: move(f'hop_kick_{n}', 80, 30, 40, A(
            K('w', 0.6, None, roll=0.1, x=-0.04, headYaw=0.25, legs={'H.S': (0.1, 0.9)}),
            K('w', 1.0, None, yH=-0.15, roll=0.14, headYaw=0.3, legs={'*': (0, 0.5), 'H.S': (0.2, 1.0)}),
            K('s', 0.3, 'o', yH=0.02, roll=-0.22, yaw=0.1, headYaw=0.3, crest=0.6, legs={'H.S': (-0.4, 0.05, 1.1), 'F': (0, 0.6)}),
            K('s', 1.0, None, roll=-0.18, yaw=0.08, headYaw=0.25, crest=0.5, legs={'H.S': (-0.45, 0.0, 1.15), 'F': (0, 0.5)}),
            K('r', 0.3, 'i', yH=-0.1, roll=-0.05, legs={'*': (0, 0.4)}),
            K('r', 0.7, None, yH=-0.02), hop=0.28),
            side=sd, curve=(2.6, 24, 44), dirDeg=90 * sd,
            bind=[B(f'selvark_hop_kick_{n}', 'leg:H:S:1', 'leg:H:S:end', 0.42, ext=0.15)],
            hits=[hit('kick', 30, 40, f'selvark_hop_kick_{n}', 20, 'knockdown', cost=25)],
            sounds=[(4, 'galdros_warn'), (28, 'galdros_swing')], ai=ai(0, 4.4, 140, 2.5, minA=35, side=side_name(sd)))),
        move('gust', 110, 52, 62, A(
            K('w', 0.4, None, neckPitch=0.3, headPitch=0.2, pitch=0.08, crest=0.5),
            K('w', 1.0, None, neckPitch=0.45, headPitch=0.35, pitch=0.14, yH=0.03, crest=1.4, legs={'F': (-0.1, 0.1)}),
            K('s', 0.25, 'o', neckPitch=-0.25, headPitch=-0.2, pitch=-0.1, yH=-0.04, crest=0.6, legs={'F': (0.15, 0)}),
            K('s', 1.0, None, neckPitch=-0.3, headPitch=-0.22, pitch=-0.1, yH=-0.04, crest=0.8),
            K('r', 0.4, None, neckPitch=-0.28, headPitch=-0.2, pitch=-0.08, crest=0.8),
            K('r', 0.8, None, crest=0.2)), turn=(30, 90),
             tracks=[track('selvark_gust', 1.5, 6.8, [(52, [0, 2.0, 1.4], [0, -0.17, 1]), (62, [0, 1.9, 1.4], [0, -0.2, 1])])],
             hits=[hit('wind', 52, 62, 'selvark_gust', 12, 'knockdown', cost=30)],
             sounds=[(4, 'beast_cry'), (50, 'gust')], vfx=[(52, 'gust')], ai=ai(3, 9.5, 35, 2, cd=360)),
        move('lunge', 90, 34, 44, A(
            K('w', 0.7, None, yH=-0.12, pitch=-0.12, neckPitch=-0.2, headPitch=0.1, crest=-0.4, legs={'F': (0.25, 0.5), 'H': (-0.15, 0.4)}),
            K('w', 1.0, None, yH=-0.15, pitch=-0.15, z=-0.05, neckPitch=-0.25, headPitch=0.1, crest=-0.45, legs={'F': (0.25, 0.55), 'H': (-0.15, 0.45)}),
            K('s', 0.4, 'o', yH=-0.06, pitch=-0.25, z=0.12, neckPitch=-0.5, headPitch=-0.25, crest=0.3, legs={'F': (0.6, 0.2), 'H': (-0.6, 0.15)}),
            K('s', 1.0, None, yH=-0.06, pitch=-0.26, z=0.12, neckPitch=-0.52, headPitch=-0.26, crest=0.35, legs={'F': (0.6, 0.15), 'H': (-0.6, 0.1)}),
            K('r', 0.35, None, yH=-0.05, pitch=-0.2, z=0.08, neckPitch=-0.4, headPitch=-0.2, crest=0.2, legs={'F': (0.4, 0.2), 'H': (-0.4, 0.15)}),
            K('r', 0.8, None, yH=-0.01, pitch=-0.03)),
             curve=(2.8, 28, 44), turn=(24, 80),
             bind=[B('selvark_lunge', 'sp:10', 'sp:12', 0.5, ext=0.3)],
             hits=[hit('horn', 34, 44, 'selvark_lunge', 22, 'knockdown', kind='cut', cost=30)],
             sounds=[(4, 'galdros_warn'), (32, 'galdros_swing')], ai=ai(3, 5.4, 30, 2.5)),
        move('back_flip', 100, 28, 38, A(
            K('w', 1.0, None, yH=-0.16, pitch=-0.08, legs={'H': (0.35, 0.6), 'F': (0.0, 0.4)}),
            K('s', 0.4, 'o', yH=0.08, pitch=0.45, neckPitch=0.3, crest=0.7, legs={'F': (0.9, 0.8), 'H': (-0.5, 0.2)}),
            K('s', 1.0, None, yH=0.06, pitch=0.38, neckPitch=0.25, crest=0.6, legs={'F': (0.65, 0.9), 'H': (-0.3, 0.3)}),
            K('r', 0.3, 'i', yH=-0.1, pitch=0.1, legs={'F': (0.2, 0.5), 'H': (0, 0.4)}),
            K('r', 0.65, None, yH=-0.04, pitch=-0.03), hop=0.32),
             curve=(-4.0, 26, 54),
             bind=[B('selvark_back_flip', 'leg:F:L:end', 'leg:F:R:end', 0.55)],
             hits=[hit('fore', 28, 38, 'selvark_back_flip', 18, 'flinch', cost=25)],
             sounds=[(26, 'gust')], ai=ai(0, 2.9, 70, 2, cd=420)),
        move('double_thrust', 120, 30, 66, A(
            K('w', 1.0, None, yH=-0.13, pitch=-0.14, neckPitch=-0.22, headPitch=0.08, crest=-0.4, legs={'F': (0.2, 0.5)}),
            K('s', 0.18, 'o', yH=-0.06, pitch=-0.22, z=0.1, neckPitch=-0.48, headPitch=-0.25, crest=0.2, legs={'F': (0.5, 0.2)}),
            K('s', 0.45, None, yH=-0.1, pitch=-0.1, z=0.0, neckPitch=-0.1, headPitch=0.05, crest=-0.3, legs={'F': (0.2, 0.45)}),
            K('s', 0.82, 'o', yH=-0.05, pitch=-0.27, z=0.14, neckPitch=-0.56, headPitch=-0.3, crest=0.4, legs={'F': (0.6, 0.15), 'H': (-0.5, 0.1)}),
            K('s', 1.0, None, yH=-0.05, pitch=-0.27, z=0.14, neckPitch=-0.56, headPitch=-0.3, crest=0.4, legs={'F': (0.6, 0.15), 'H': (-0.5, 0.1)}),
            K('r', 0.4, None, yH=-0.04, pitch=-0.2, z=0.08, neckPitch=-0.4, headPitch=-0.2, crest=0.25, legs={'F': (0.35, 0.2)}),
            K('r', 0.85, None, yH=-0.01)),
             curve=(2.2, 26, 64), turn=(26, 70),
             bind=[B('selvark_double_thrust', 'sp:10', 'sp:12', 0.5, ext=0.3)],
             hits=[hit('horn1', 30, 37, 'selvark_double_thrust', 14, 'flinch', kind='cut', cost=20),
                   hit('horn2', 54, 62, 'selvark_double_thrust', 20, 'knockdown', kind='cut', cost=30)],
             sounds=[(4, 'galdros_warn'), (28, 'galdros_swing'), (52, 'galdros_swing')], ai=ai(2.5, 4.8, 30, 2, cd=300)),
        move('rear_kick', 96, 36, 44, A(
            K('w', 0.6, None, pitch=-0.12, yH=-0.05, neckPitch=-0.2, legs={'H': (0.25, 0.6)}),
            K('w', 1.0, None, pitch=-0.18, yH=-0.06, neckPitch=-0.25, headPitch=-0.15, tailPitch=0.4, legs={'H': (0.3, 0.7)}),
            K('s', 0.4, 'o', pitch=-0.32, yH=0.04, neckPitch=-0.3, headPitch=-0.1, tailPitch=0.7, legs={'H': (-1.1, 0.15), 'F': (-0.1, 0)}),
            K('s', 1.0, None, pitch=-0.3, yH=0.03, neckPitch=-0.28, tailPitch=0.65, legs={'H': (-1.15, 0.1), 'F': (-0.1, 0)}),
            K('r', 0.3, None, pitch=-0.05, legs={'H': (-0.2, 0.4)}),
            K('r', 0.7, None, pitch=0.0)),
             bind=[B('selvark_rear_kick', 'leg:H:L:end', 'leg:H:R:end', 0.5)],
             hits=[hit('hind', 36, 44, 'selvark_rear_kick', 22, 'knockdown', cost=30)],
             sounds=[(4, 'galdros_warn'), (34, 'galdros_swing')], ai=ai(0, 3, 180, 2.5, minA=120)),
        *lr(lambda sd, n: move(f'head_sweep_{n}', 96, 36, 48, A(
            K('w', 0.7, None, yaw=-0.25, spineYaw=-0.2, neckYaw=-0.6, headYaw=-0.3, x=-0.03, crest=0.8, legs={'F.O': (0, 0.3)}),
            K('w', 1.0, None, yaw=-0.28, spineYaw=-0.22, neckYaw=-0.65, headYaw=-0.32, x=-0.03, crest=0.9, legs={'F.O': (0, 0.3)}),
            K('s', 0.5, 'o', yaw=0.35, spineYaw=0.3, pitch=-0.1, neckYaw=0.8, headYaw=0.35, neckPitch=-0.7, headPitch=-0.2, roll=-0.1, crest=1.1, legs={'F.S': (0, 0.35)}),
            K('s', 1.0, None, yaw=0.45, spineYaw=0.35, pitch=-0.1, neckYaw=0.95, headYaw=0.4, neckPitch=-0.7, headPitch=-0.2, roll=-0.08, crest=1.0),
            K('r', 0.4, None, yaw=0.3, spineYaw=0.25, neckYaw=0.7, headYaw=0.3, crest=0.6),
            K('r', 0.85, None, neckYaw=0.1)),
            side=sd, bind=[B(f'selvark_head_sweep_{n}', 'sp:9', 'sp:12', 0.55, ext=0.25)],
            hits=[hit('head', 36, 48, f'selvark_head_sweep_{n}', 18, 'knockdown', cost=25)],
            sounds=[(4, 'galdros_warn'), (34, 'galdros_swing')], ai=ai(0, 2.8, 110, 2.2, minA=25, side=side_name(sd)))),
        move('stomp', 104, 46, 52, A(
            K('w', 0.5, None, pitch=0.35, yH=0.06, neckPitch=0.3, crest=0.6, tailPitch=0.2, legs={'F': (0.5, 0.9)}),
            K('w', 1.0, None, pitch=0.5, yH=0.1, neckPitch=0.4, headPitch=0.1, crest=0.7, tailPitch=0.3, legs={'F': (0.7, 1.0), 'H': (0.1, 0.1)}),
            K('s', 0.6, 'i', pitch=-0.06, yH=-0.08, neckPitch=-0.2, headPitch=-0.15, crest=0.9, legs={'F': (0.35, 0.0)}),
            K('s', 1.0, None, pitch=-0.08, yH=-0.1, neckPitch=-0.22, headPitch=-0.15, crest=0.9, legs={'F': (0.35, 0.0)}),
            K('r', 0.3, None, pitch=-0.06, yH=-0.08, neckPitch=-0.15, crest=0.6, legs={'F': (0.3, 0.0)}),
            K('r', 0.75, None, yH=-0.02)),
             turn=(30, 70), slamTrack='selvark_stomp',
             bind=[B('selvark_stomp', 'leg:F:L:end', 'leg:F:R:end', 0.6)],
             hits=[hit('hooves', 46, 52, 'selvark_stomp', 24, 'knockdown', cost=35)],
             sounds=[(4, 'beast_cry'), (44, 'galdros_swing')], vfx=[(50, 'ground_slam')], ai=ai(0, 3.1, 45, 2.2)),
        move('wind_spin', 130, 50, 74, A(
            K('w', 0.6, None, yH=-0.08, crest=1.2, legs={'*': (0, 0.4)}),
            K('w', 1.0, None, yaw=-0.4, spineYaw=-0.3, neckPitch=0.2, crest=1.4, yH=-0.06),
            K('s', 0.5, None, yH=0.04, pitch=0.1, crest=1.4, legs={'F': (0.2, 0.6)}),
            K('s', 1.0, None, crest=1.2, yH=0.0),
            K('r', 0.4, None, crest=0.6, yH=-0.05),
            K('r', 0.85, None, crest=0.1), spin=1),
             tracks=[track('selvark_wind_spin', 2.6, 2.4, [(50, [0, 1.0, -1.2], [0, 0, 1]), (74, [0, 1.0, -1.2], [0, 0, 1])])],
             hits=[hit('wind', 56, 70, 'selvark_wind_spin', 14, 'knockdown', cost=25)],
             sounds=[(4, 'beast_cry'), (48, 'gust'), (60, 'gust')], vfx=[(56, 'wind_ring')], ai=ai(0, 3.5, 180, 1.4, cd=600)),
        move('charge', 150, 44, 104, A(
            K('w', 0.3, None, yH=-0.04, neckPitch=-0.25, headPitch=-0.2, crest=-0.4, legs={'F.S': (0.3, 0.7)}),
            K('w', 0.55, 'i', yH=-0.06, neckPitch=-0.3, headPitch=-0.25, crest=-0.5, legs={'F.S': (0.1, 0.0)}),
            K('w', 1.0, None, yH=-0.12, pitch=-0.12, neckPitch=-0.4, headPitch=-0.3, crest=-0.6, legs={'H': (0.2, 0.5)}),
            K('s', 0.12, 'o', yH=-0.04, pitch=-0.1, neckPitch=-0.45, headPitch=-0.3, crest=-0.6),
            K('s', 0.92, None, yH=-0.04, pitch=-0.1, neckPitch=-0.45, headPitch=-0.3, crest=-0.6),
            K('r', 0.3, None, yH=-0.06, pitch=0.18, neckPitch=0.1, crest=0.3, legs={'F': (0.6, 0.1), 'H': (0.3, 0.2)}),
            K('r', 0.7, None, pitch=0.03, crest=0.1)),
             curve=(14.0, 44, 104), turn=(40, 60),
             bind=[B('selvark_charge', 'sp:7', 'sp:12', 0.62, ext=0.25)],
             hits=[hit('body', 44, 104, 'selvark_charge', 26, 'knockdown', cost=40)],
             sounds=[(4, 'beast_cry'), (40, 'galdros_charge')], ai=ai(7, 16.1, 25, 1.6, cd=520, clear=10)),
        move('leap_stomp', 120, 50, 58, A(
            K('w', 0.45, None, yH=-0.18, pitch=-0.1, neckPitch=0.1, crest=0.3, legs={'*': (0, 0.6)}),
            K('w', 0.62, 'o', yH=0.05, pitch=0.3, neckPitch=0.25, crest=0.8, legs={'F': (0.6, 0.9), 'H': (-0.5, 0.3)}),
            K('w', 0.9, None, pitch=0.2, neckPitch=0.2, crest=0.9, legs={'F': (0.8, 0.8), 'H': (-0.2, 0.7)}),
            K('s', 0.4, 'i', pitch=-0.1, yH=-0.1, neckPitch=-0.25, crest=0.9, legs={'F': (0.3, 0.0), 'H': (0, 0.4)}),
            K('s', 1.0, None, pitch=-0.1, yH=-0.12, neckPitch=-0.25, crest=0.8, legs={'F': (0.3, 0.0), 'H': (0, 0.4)}),
            K('r', 0.4, None, yH=-0.06, neckPitch=-0.1, crest=0.4),
            K('r', 0.8, None, yH=-0.01), hop=0.45),
             curve=(6.0, 30, 54), turn=(26, 80), slamTrack='selvark_leap_stomp',
             bind=[B('selvark_leap_stomp', 'leg:F:L:end', 'leg:F:R:end', 0.7)],
             hits=[hit('land', 50, 58, 'selvark_leap_stomp', 24, 'knockdown', cost=35)],
             sounds=[(4, 'beast_cry'), (30, 'gust'), (50, 'galdros_swing')], vfx=[(54, 'ground_slam')], ai=ai(5, 8.5, 30, 1.6, cd=360, clear=6)),
        *lr(lambda sd, n: move(f'tail_whip_{n}', 84, 30, 40, A(
            K('w', 1.0, None, tailYaw=-0.8, tailPitch=0.3, yaw=-0.1, spineYaw=-0.1, headYaw=0.3, neckYaw=0.2),
            K('s', 0.6, 'o', tailYaw=1.3, tailPitch=0.1, tailCurl=0.3, yaw=0.25, headYaw=0.3, neckYaw=0.2),
            K('s', 1.0, None, tailYaw=1.5, tailPitch=0.05, tailCurl=0.3, yaw=0.28, headYaw=0.25),
            K('r', 0.5, None, tailYaw=0.6, yaw=0.1)),
            side=sd, bind=[B(f'selvark_tail_whip_{n}', 'sp:3', 'sp:0', 0.35, ext=0.1)],
            hits=[hit('tail', 30, 40, f'selvark_tail_whip_{n}', 16, 'flinch', cost=20)],
            sounds=[(28, 'galdros_swing')], ai=ai(0, 3.6, 180, 1.8, minA=90, side=side_name(sd)))),
    ]


SELVARK_IDLE = idle(
    unaware=dict(neckPitch=-0.9, headPitch=-0.35, pitch=-0.03, crest=-0.3, legs={'F': (0.12, 0)}), sway=0.25, nod=0.08, rate=0.5,
    alert=dict(neckPitch=0.12, headPitch=0.05, crest=0.35, yH=-0.02, tailPitch=0.1),
    weak=dict(neckPitch=-0.25, headPitch=-0.15, crest=-0.4, tailPitch=-0.3, yH=-0.04),
    rage=dict(crest=0.6, tailPitch=0.25, neckPitch=0.08),
    run=dict(neckPitch=-0.25, headPitch=-0.2, crest=-0.55, tailPitch=0.15, pitch=-0.03),
    sleep=dict(yH=-0.42, neckPitch=-0.6, neckYaw=0.9, headPitch=-0.2, crest=-0.6, tailYaw=0.7, legs={'*': (0, 1.1, 0.15)}),
    flinch=dict(neckPitch=0.35, headPitch=0.3, pitch=0.12, yH=-0.03, crest=0.6),
    topple=dict(roll=1.2, yH=-0.45, neckPitch=-0.25, headPitch=-0.1, crest=-0.2, tailPitch=-0.2, legs={'*': (0.1, 0.3, 0.35)}),
    rise=dict(pitch=0.15, neckPitch=0.25, legs={'F': (0.3, 0.5)}),
    dead=[(15, dict(yH=-0.2, pitch=-0.15, neckPitch=-0.2, legs={'F': (0.1, 0.9)})),
          (45, dict(roll=1.25, yH=-0.45, neckPitch=-0.5, headPitch=-0.25, crest=-0.5, tailPitch=-0.25, legs={'*': (0.1, 0.35, 0.4)})),
          (90, dict(roll=1.3, yH=-0.47, neckPitch=-0.6, headPitch=-0.3, crest=-0.6, tailPitch=-0.3, legs={'*': (0.15, 0.3, 0.45)}))],
    fidgets=[
        F('crest_flick', 0.8, 'any', K('w', 0.2, None, crest=0.5), K('w', 0.4, None, crest=-0.1), K('w', 0.6, None, crest=0.4), K('w', 0.8, None, crest=0.05)),
        F('glance_back', 2.2, 'calm', K('w', 0.3, None, neckYaw=0.9, headYaw=0.4, neckPitch=0.25), K('w', 0.7, None, neckYaw=0.95, headYaw=0.4, neckPitch=0.25)),
        F('stamp', 1.2, 'aware', K('w', 0.3, None, legs={'F.S': (0.2, 0.7)}), K('w', 0.5, 'i', legs={'F.S': (0.1, 0.0)}), K('w', 0.7, None, legs={'F.S': (0.2, 0.6)}),
          K('w', 0.85, 'i', legs={'F.S': (0.1, 0.0)})),
        F('head_shake', 0.9, 'any', K('w', 0.5, None, crest=0.3, headRoll=0.15), shake=0.05),
        F('sniff_air', 2.0, 'calm', K('w', 0.4, None, neckPitch=0.5, headPitch=0.35, crest=0.2), K('w', 0.8, None, neckPitch=0.5, headPitch=0.4, crest=0.2)),
        F('tail_flick', 0.8, 'any', K('w', 0.3, None, tailYaw=0.6, tailPitch=0.3), K('w', 0.6, None, tailYaw=-0.4, tailPitch=0.2)),
        F('stretch', 2.4, 'calm', K('w', 0.4, None, pitch=-0.15, yH=-0.06, neckPitch=-0.3, headPitch=0.3, legs={'F': (0.5, 0)}),
          K('w', 0.75, None, pitch=-0.15, yH=-0.06, neckPitch=-0.3, headPitch=0.3, legs={'F': (0.5, 0)})),
    ])


# =============================================================================================
# 03 泥冠獣 ヌメラドン（四足重獣。水）: 頭頂の泥皿で泥を掬い、投げる。腹で滑る。重く、動きは遅いが大きい
#   体: 根元 z 0.21 / 高さ 1.72、頭 z 2.48 y 1.86、口先 z 3.31、前脚 z 1.24（足は x ±1.08）、後脚 z -1.32、尾の先 z -2.77。
#   泥皿は own:dish（dish + で後ろへ傾く）。印: sp:7 = 頭、sp:9 = 口先、sp:5 = 胸、sp:0〜2 = 尾。
# =============================================================================================


def numeradon_moves(s):
    dish_front = s.m(1450, 250)
    return [
        move('roar', 100, 100, 100, A(
            K('w', 0.6, None, pitch=-0.06, yH=-0.05, neckPitch=-0.15, headPitch=-0.1, dish=-0.3),
            K('w', 1.0, None, pitch=0.1, neckPitch=0.3, headPitch=0.2, dish=0.6, tailPitch=0.2),
            K('s', 0.4, 'o', pitch=0.18, yH=0.04, neckPitch=0.45, headPitch=0.35, dish=1.0, tailPitch=0.35, legs={'F': (-0.08, 0.15)}),
            K('r', 0.55, None, pitch=0.16, yH=0.03, neckPitch=0.42, headPitch=0.32, dish=0.95, tailPitch=0.3, legs={'F': (-0.06, 0.12)}),
            K('r', 0.85, None, neckPitch=0.1, dish=0.2),
            shake=0.025), sounds=[(10, 'galdros_roar')]),
        move('threat', 110, 28, 80, A(
            K('w', 1.0, None, yH=-0.03, neckPitch=0.15, headPitch=0.1, dish=0.8),
            K('s', 0.2, None, yH=-0.03, neckPitch=0.15, headYaw=0.25, headRoll=0.12, roll=-0.04, dish=1.0),
            K('s', 0.4, None, yH=-0.03, neckPitch=0.15, headYaw=-0.25, headRoll=-0.12, roll=0.04, dish=0.6),
            K('s', 0.6, None, yH=-0.03, neckPitch=0.15, headYaw=0.25, headRoll=0.12, roll=-0.04, dish=1.0),
            K('s', 0.8, None, yH=-0.03, neckPitch=0.12, headYaw=-0.2, headRoll=-0.1, roll=0.03, dish=0.6),
            K('s', 1.0, None, neckPitch=-0.1, headPitch=-0.15, dish=0.3, legs={'F.S': (0.2, 0.5)}),
            K('r', 0.35, 'i', neckPitch=-0.08, headPitch=-0.1, dish=0.2, legs={'F.S': (0.1, 0.0)}),
            K('r', 0.8, None, dish=0.05)),
             sounds=[(6, 'galdros_warn'), (40, 'splash'), (82, 'galdros_step')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 80, 20, 46, A(
            K('w', 1.0, None, yH=-0.06, pitch=0.1, neckPitch=0.15, dish=0.3, legs={'F': (0.3, 0.3)}),
            K('s', 0.5, None, yH=-0.03, pitch=0.06, neckPitch=0.1, dish=0.2, legs={'H': (-0.25, 0.3), 'F': (0.2, 0.2)}),
            K('s', 1.0, None, pitch=0.02, legs={'F': (0.1, 0.1)}),
            K('r', 0.5, None, pitch=-0.02)),
             curve=(-3.2, 18, 50), sounds=[(18, 'galdros_step')], ai=ai(0, 3.2, 180, 0.8, cd=520)),
        move('mud_ball', 100, 46, 52, A(
            K('w', 0.45, None, yH=-0.04, neckPitch=-0.25, headPitch=-0.2, dish=-0.45),
            K('w', 0.8, None, neckPitch=0.25, headPitch=0.25, pitch=0.05, dish=1.0),
            K('w', 1.0, None, neckPitch=0.35, headPitch=0.3, pitch=0.08, dish=1.1),
            K('s', 0.4, 'o', neckPitch=-0.2, headPitch=-0.25, pitch=-0.06, dish=-0.5),
            K('s', 1.0, None, neckPitch=-0.22, headPitch=-0.25, pitch=-0.06, dish=-0.5),
            K('r', 0.4, None, neckPitch=-0.15, headPitch=-0.15, dish=-0.3),
            K('r', 0.8, None, dish=0.0)), turn=(40, 60),
             hazards=[hazard(48, 3, 2.4, 1.6, 42, 8, 18, 'flinch', dish_front, 'mud', peak=4)],
             sounds=[(4, 'galdros_warn'), (46, 'splash')], ai=ai(6, 18, 45, 2.5, cd=300)),
        move('belly_slide', 110, 40, 66, A(
            K('w', 0.6, None, yH=0.06, pitch=0.12, legs={'F': (-0.1, 0.0), 'H': (0.1, 0.0)}),
            K('w', 1.0, None, yH=0.08, pitch=0.15, neckPitch=0.15, dish=0.3),
            K('s', 0.2, 'i', yH=-0.32, pitch=-0.06, neckPitch=-0.05, dish=0.2, legs={'F': (0.7, 0.5), 'H': (-0.7, 0.5)}),
            K('s', 1.0, None, yH=-0.32, pitch=-0.05, neckPitch=-0.05, dish=0.2, legs={'F': (0.7, 0.5), 'H': (-0.7, 0.5)}),
            K('r', 0.35, None, yH=-0.28, pitch=-0.03, legs={'F': (0.5, 0.5), 'H': (-0.5, 0.5)}),
            K('r', 0.8, None, yH=-0.04), wiggle=0.1),
             curve=(7.0, 40, 66), bind=[B('numeradon_belly_slide', 'sp:2', 'sp:6', 1.15)],
             hits=[hit('belly', 40, 66, 'numeradon_belly_slide', 26, 'knockdown', cost=40)],
             sounds=[(4, 'galdros_warn'), (40, 'galdros_charge')], vfx=[(42, 'mud_splash')], ai=ai(5, 9.8, 25, 2, cd=420, clear=8)),
        *lr(lambda sd, n: move(f'push_{n}', 90, 36, 46, A(
            K('w', 0.6, None, roll=-0.1, twist=-0.06, yaw=-0.08, yH=-0.06, x=-0.02, neckYaw=-0.2, legs={'F.S': (0, 0.4)}),
            K('w', 1.0, None, roll=-0.13, twist=-0.08, yaw=-0.1, yH=-0.08, x=-0.03, neckYaw=-0.22, legs={'F.S': (0, 0.5)}),
            K('s', 0.4, 'o', roll=0.06, twist=0.1, yaw=0.15, yH=-0.02, x=0.06, neckYaw=0.1, legs={'F.S': (0, 0.1, 0.3), 'F.O': (0, 0.4)}),
            K('s', 1.0, None, roll=0.06, twist=0.1, yaw=0.15, yH=-0.02, x=0.06, legs={'F.S': (0, 0.1, 0.3), 'F.O': (0, 0.3)}),
            K('r', 0.4, None, roll=0.03, yaw=0.08, x=0.03),
            K('r', 0.8, None, x=0.0)),
            side=sd, curve=(1.6, 34, 48), dirDeg=90 * sd,
            bind=[B(f'numeradon_push_{n}', 'leg:F:S:0', 'leg:H:S:0', 1.0)],
            hits=[hit('shoulder', 36, 46, f'numeradon_push_{n}', 22, 'knockdown', cost=35)],
            sounds=[(4, 'galdros_warn'), (34, 'galdros_swing')], ai=ai(0, 3.8, 135, 2.5, minA=40, side=side_name(sd)))),
        move('splash', 80, 30, 40, A(
            K('w', 0.5, None, pitch=0.08, legs={'F.S': (0.4, 0.8)}),
            K('w', 1.0, None, pitch=0.12, neckPitch=0.1, legs={'F.S': (0.6, 0.9), 'F.O': (0.1, 0.2)}),
            K('s', 0.5, 'o', pitch=0.02, legs={'F.S': (-0.2, 0.3), 'F.O': (0.5, 0.8)}),
            K('s', 1.0, None, pitch=0.04, legs={'F.S': (0.5, 0.7), 'F.O': (-0.2, 0.3)}),
            K('r', 0.4, None, legs={'F.S': (0.1, 0.2)}), paddle=1),
             tracks=[track('numeradon_splash', 1.1, 3.6, [(30, [-1.8, 0.4, 3.0], [1, 0, 0]), (40, [-1.8, 0.4, 3.2], [1, 0, 0])])],
             hits=[hit('splash', 30, 40, 'numeradon_splash', 14, 'flinch', cost=20)],
             sounds=[(28, 'splash')], vfx=[(32, 'mud_splash')], ai=ai(0, 4.6, 60, 3)),
        move('dish_slam', 110, 48, 56, A(
            K('w', 0.6, None, pitch=0.12, neckPitch=0.45, headPitch=0.35, dish=-0.6, legs={'F': (0.15, 0.3)}),
            K('w', 1.0, None, pitch=0.18, yH=0.04, neckPitch=0.55, headPitch=0.4, dish=-0.8, legs={'F': (0.15, 0.35)}),
            K('s', 0.5, 'i', pitch=-0.12, yH=-0.08, neckPitch=-0.45, headPitch=-0.35, dish=-0.9),
            K('s', 1.0, None, pitch=-0.12, yH=-0.08, neckPitch=-0.45, headPitch=-0.35, dish=-0.9),
            K('r', 0.4, None, pitch=-0.1, yH=-0.06, neckPitch=-0.35, headPitch=-0.3, dish=-0.6),
            K('r', 0.8, None, dish=-0.1)), turn=(30, 50), slamTrack='numeradon_dish_slam',
             bind=[B('numeradon_dish_slam', 'sp:6', 'sp:9', 0.9, ext=0.2)],
             hits=[hit('dish', 48, 56, 'numeradon_dish_slam', 28, 'knockdown', cost=40)],
             sounds=[(4, 'galdros_warn'), (46, 'galdros_swing')], vfx=[(54, 'ground_slam'), (54, 'mud_splash')], ai=ai(0, 4.5, 35, 2.5)),
        move('mud_volley', 130, 56, 62, A(
            K('w', 0.35, None, yH=-0.04, neckPitch=-0.3, headPitch=-0.2, dish=-0.5),
            K('w', 0.7, None, neckPitch=0.3, headPitch=0.3, pitch=0.06, dish=1.1),
            K('w', 1.0, None, neckPitch=0.4, headPitch=0.4, pitch=0.12, yH=0.03, dish=1.3),
            K('s', 0.4, 'o', neckPitch=-0.25, headPitch=-0.3, pitch=-0.08, dish=-0.6, headYaw=0.15),
            K('s', 1.0, None, neckPitch=-0.25, headPitch=-0.3, pitch=-0.08, dish=-0.6, headYaw=-0.15),
            K('r', 0.3, None, neckPitch=-0.2, headPitch=-0.2, dish=-0.4),
            K('r', 0.8, None, dish=0.0), shake=0.02, shakeIn='windup'), turn=(46, 60),
             hazards=[hazard(58, 3, 3.6, 1.6, 44, 8, 16, 'flinch', dish_front, 'mud', peak=5)],
             sounds=[(4, 'galdros_warn'), (40, 'splash'), (56, 'splash')], ai=ai(7, 20, 50, 1.6, cd=420)),
        move('pressure_jet', 120, 52, 64, A(
            K('w', 0.6, None, pitch=0.06, yH=0.03, neckPitch=-0.1, headPitch=0.1, legs={'F': (-0.15, 0.1)}),
            K('w', 1.0, None, pitch=0.1, yH=0.03, z=-0.04, neckPitch=0.05, headPitch=0.15, legs={'F': (-0.15, 0.1)}),
            K('s', 0.2, 'o', pitch=-0.02, z=-0.06, neckPitch=-0.12, headPitch=-0.08),
            K('s', 1.0, None, pitch=-0.02, z=-0.07, neckPitch=-0.12, headPitch=-0.08),
            K('r', 0.4, None, z=-0.03, neckPitch=-0.06),
            K('r', 0.8, None, z=0.0), shake=0.02, shakeIn='all'), turn=(40, 50),
             tracks=[track('numeradon_pressure_jet', 0.75, 6.4, [(52, [0, 1.5, 3.1], [0, -0.12, 1]), (64, [0, 1.4, 3.1], [0, -0.14, 1])])],
             hits=[hit('jet', 52, 64, 'numeradon_pressure_jet', 20, 'knockdown', cost=35)],
             sounds=[(4, 'galdros_warn'), (50, 'splash'), (58, 'splash')], vfx=[(52, 'water_jet')], ai=ai(4, 10.1, 25, 1.8, cd=400)),
        move('tail_slap', 100, 42, 50, A(
            K('w', 0.6, None, pitch=-0.08, yH=-0.03, neckYaw=0.2, tailPitch=0.8, tailCurl=0.3),
            K('w', 1.0, None, pitch=-0.1, yH=-0.03, neckYaw=0.25, tailPitch=1.0, tailCurl=0.4),
            K('s', 0.5, 'i', pitch=0.06, neckYaw=0.2, tailPitch=-0.6, tailCurl=-0.1),
            K('s', 1.0, None, pitch=0.06, tailPitch=-0.6, tailCurl=-0.1),
            K('r', 0.4, None, tailPitch=-0.4),
            K('r', 0.8, None, tailPitch=-0.05)),
             bind=[B('numeradon_tail_slap', 'sp:2', 'sp:0', 0.55, ext=0.2)],
             hits=[hit('tail', 42, 50, 'numeradon_tail_slap', 22, 'knockdown', cost=30)],
             sounds=[(4, 'galdros_warn'), (40, 'galdros_swing'), (48, 'splash')], vfx=[(48, 'mud_rear')], ai=ai(0, 3.8, 180, 2.5, minA=130)),
        *lr(lambda sd, n: move(f'tail_sweep_{n}', 100, 40, 56, A(
            K('w', 1.0, None, tailYaw=-0.7, yaw=-0.15, spineYaw=-0.1, neckYaw=0.3),
            K('s', 0.5, 'o', tailYaw=1.2, yaw=0.35, spineYaw=0.15, neckYaw=0.2),
            K('s', 1.0, None, tailYaw=1.35, yaw=0.4, spineYaw=0.15),
            K('r', 0.4, None, tailYaw=0.6, yaw=0.2),
            K('r', 0.8, None, tailYaw=0.1)),
            side=sd, bind=[B(f'numeradon_tail_sweep_{n}', 'sp:2', 'sp:0', 0.55, ext=0.15)],
            hits=[hit('tail', 40, 56, f'numeradon_tail_sweep_{n}', 20, 'knockdown', cost=30)],
            sounds=[(4, 'galdros_warn'), (38, 'galdros_swing')], ai=ai(0, 3.3, 180, 2, minA=70, side=side_name(sd)))),
        *lr(lambda sd, n: move(f'wallow_{n}', 120, 50, 64, A(
            K('w', 0.6, None, roll=0.15, yH=-0.06, neckYaw=-0.2, legs={'F.O': (0, 0.4), 'H.O': (0, 0.4)}),
            K('w', 1.0, None, roll=0.2, yH=-0.08, neckYaw=-0.2, legs={'F.O': (0, 0.5), 'H.O': (0, 0.5)}),
            K('s', 0.5, 'i', roll=-0.75, yH=-0.25, x=0.12, neckYaw=0.2, dish=0.4, legs={'*.O': (0, 0.6, 0.3)}),
            K('s', 1.0, None, roll=-0.8, yH=-0.28, x=0.14, neckYaw=0.2, dish=0.4, legs={'*.O': (0, 0.6, 0.3)}),
            K('r', 0.4, None, roll=-0.5, yH=-0.18, x=0.08, legs={'*.O': (0, 0.4, 0.2)}),
            K('r', 0.8, None, roll=-0.1, yH=-0.03)),
            side=sd, curve=(1.2, 48, 64), dirDeg=90 * sd,
            bind=[B(f'numeradon_wallow_{n}', 'leg:F:S:0', 'leg:H:S:0', 1.0)],
            hits=[hit('body', 52, 64, f'numeradon_wallow_{n}', 26, 'knockdown', cost=40)],
            sounds=[(4, 'galdros_warn'), (50, 'galdros_rumble'), (60, 'splash')], vfx=[(60, 'mud_splash')],
            ai=ai(0, 3.4, 130, 1.6, minA=40, side=side_name(sd), cd=300))),
        move('bite', 90, 34, 42, A(
            K('w', 0.7, None, yH=-0.03, z=-0.03, neckPitch=0.2, headPitch=0.2),
            K('w', 1.0, None, yH=-0.03, z=-0.05, neckPitch=0.25, headPitch=0.25),
            K('s', 0.5, 'o', z=0.08, pitch=-0.06, neckPitch=-0.25, headPitch=-0.2),
            K('s', 1.0, None, z=0.08, pitch=-0.06, neckPitch=-0.25, headPitch=-0.2),
            K('r', 0.4, None, z=0.04, neckPitch=-0.1),
            K('r', 0.8, None, z=0.0)),
             curve=(0.8, 30, 42), turn=(26, 60), bind=[B('numeradon_bite', 'sp:6', 'sp:9', 0.6, ext=0.2)],
             hits=[hit('mouth', 34, 42, 'numeradon_bite', 22, 'knockdown', cost=30)],
             sounds=[(4, 'galdros_warn'), (32, 'galdros_swing')], ai=ai(0, 4.8, 30, 2.5)),
        move('front_slam', 120, 54, 60, A(
            K('w', 0.5, None, pitch=0.3, yH=0.06, neckPitch=0.25, dish=0.4, legs={'F': (0.45, 0.9)}),
            K('w', 1.0, None, pitch=0.45, yH=0.1, neckPitch=0.35, dish=0.6, tailPitch=-0.2, legs={'F': (0.6, 1.0)}),
            K('s', 0.5, 'i', pitch=-0.08, yH=-0.1, neckPitch=-0.2, dish=-0.2, legs={'F': (0.3, 0.0)}),
            K('s', 1.0, None, pitch=-0.08, yH=-0.1, neckPitch=-0.2, dish=-0.2, legs={'F': (0.3, 0.0)}),
            K('r', 0.35, None, pitch=-0.06, yH=-0.08, neckPitch=-0.15, legs={'F': (0.25, 0.0)}),
            K('r', 0.8, None, yH=-0.02)), turn=(36, 50), slamTrack='numeradon_front_slam',
             bind=[B('numeradon_front_slam', 'leg:F:L:end', 'leg:F:R:end', 0.8)],
             hits=[hit('fore', 54, 60, 'numeradon_front_slam', 28, 'knockdown', cost=40)],
             sounds=[(4, 'galdros_roar'), (52, 'galdros_swing')], vfx=[(58, 'ground_slam'), (58, 'mud_splash')], ai=ai(0, 3.9, 45, 2, cd=260)),
        move('mud_rain', 150, 60, 68, A(
            K('w', 0.3, None, yH=-0.05, neckPitch=-0.35, headPitch=-0.2, dish=-0.6),
            K('w', 0.7, None, pitch=0.12, neckPitch=0.5, headPitch=0.5, dish=1.2),
            K('w', 1.0, None, pitch=0.18, yH=0.05, neckPitch=0.6, headPitch=0.6, dish=1.4),
            K('s', 0.4, 'o', pitch=0.22, yH=0.05, neckPitch=0.7, headPitch=0.7, dish=-0.3),
            K('s', 1.0, None, pitch=0.2, yH=0.04, neckPitch=0.6, headPitch=0.6, dish=-0.2),
            K('r', 0.4, None, pitch=0.08, neckPitch=0.3, headPitch=0.25, dish=0.0),
            K('r', 0.85, None, neckPitch=0.05)),
             hazards=[hazard(64, 6, 5.0, 1.5, 56, 10, 14, 'flinch', dish_front, 'mud', peak=7)],
             sounds=[(4, 'galdros_warn'), (24, 'splash'), (62, 'splash')], vfx=[(62, 'mud_up')], ai=ai(0, 20, 180, 1.2, cd=700)),
        move('charge', 170, 56, 120, A(
            K('w', 0.3, None, neckPitch=-0.2, dish=-0.3, legs={'F.S': (0.4, 0.7)}),
            K('w', 0.55, 'i', neckPitch=-0.22, dish=-0.3, legs={'F.S': (0.1, 0.0)}),
            K('w', 1.0, None, yH=-0.08, pitch=-0.08, neckPitch=-0.25, headPitch=-0.15, dish=-0.4, legs={'H': (0.2, 0.4)}),
            K('s', 0.12, 'o', yH=-0.04, pitch=-0.06, neckPitch=-0.25, headPitch=-0.12, dish=-0.4),
            K('s', 0.9, None, yH=-0.04, pitch=-0.06, neckPitch=-0.25, headPitch=-0.12, dish=-0.4),
            K('r', 0.3, None, pitch=0.12, yH=-0.03, legs={'F': (0.5, 0.1)}),
            K('r', 0.7, None, pitch=0.02)),
             curve=(12.0, 56, 120), turn=(50, 50), bind=[B('numeradon_charge', 'sp:5', 'sp:9', 1.0, ext=0.2)],
             hits=[hit('body', 56, 120, 'numeradon_charge', 28, 'knockdown', cost=45)],
             sounds=[(4, 'galdros_roar'), (52, 'galdros_charge')], ai=ai(7, 16, 25, 1.6, cd=520, clear=10)),
    ]


NUMERADON_IDLE = idle(
    unaware=dict(neckPitch=-0.35, headPitch=-0.3, pitch=-0.04, dish=-0.2), sway=0.2, nod=0.12, rate=0.4,
    alert=dict(neckPitch=0.08, dish=0.3, tailPitch=0.1),
    weak=dict(neckPitch=-0.2, headPitch=-0.15, dish=-0.3, tailPitch=-0.25, yH=-0.05),
    rage=dict(dish=0.5, neckPitch=0.1, tailPitch=0.2),
    run=dict(neckPitch=-0.12, dish=-0.3, pitch=-0.03),
    sleep=dict(yH=-0.4, neckPitch=-0.3, headRoll=0.5, dish=0.4, tailYaw=0.4, legs={'*': (0, 1.1, 0.25)}),
    flinch=dict(pitch=0.1, neckPitch=0.25, headPitch=0.2, dish=0.4),
    topple=dict(roll=1.15, yH=-0.35, neckPitch=-0.15, dish=0.3, legs={'*': (0.1, 0.25, 0.4)}),
    rise=dict(pitch=0.1, legs={'F': (0.3, 0.5)}),
    dead=[(18, dict(yH=-0.25, pitch=-0.12, neckPitch=-0.2, legs={'F': (0.1, 0.9)})),
          (55, dict(roll=1.2, yH=-0.38, neckPitch=-0.35, headPitch=-0.2, dish=0.5, tailPitch=-0.2, legs={'*': (0.1, 0.3, 0.45)})),
          (100, dict(roll=1.25, yH=-0.4, neckPitch=-0.4, headPitch=-0.25, dish=0.6, legs={'*': (0.12, 0.25, 0.5)}))],
    fidgets=[
        F('dish_drain', 2.0, 'any', K('w', 0.3, None, dish=0.9, headRoll=0.3), K('w', 0.7, None, dish=0.9, headRoll=0.35), shake=0.01),
        F('dish_fill', 2.6, 'calm', K('w', 0.35, None, neckPitch=-0.5, headPitch=-0.4, dish=-0.7), K('w', 0.75, None, neckPitch=-0.5, headPitch=-0.45, dish=-0.7)),
        F('snort', 0.8, 'any', K('w', 0.3, None, headPitch=-0.12), K('w', 0.55, None, headPitch=0.1)),
        F('tail_swish', 1.0, 'any', K('w', 0.3, None, tailYaw=0.5), K('w', 0.7, None, tailYaw=-0.5)),
        F('wallow_shift', 2.2, 'calm', K('w', 0.5, None, roll=0.06, yH=-0.04, legs={'H.S': (0, 0.4)})),
        F('stamp', 1.2, 'aware', K('w', 0.3, None, legs={'F.S': (0.2, 0.6)}), K('w', 0.5, 'i', legs={'F.S': (0.1, 0.0)}), K('w', 0.7, None, legs={'F.S': (0.2, 0.5)}),
          K('w', 0.85, 'i', legs={'F.S': (0.1, 0.0)})),
    ])


# =============================================================================================
# 04 鐘嚢獣 ボルナケル（四足重獣。気絶）: 3 つの共鳴嚢（左肩 sac0・右肩 sac1・胸 sac2）と、頭の鐘。音で打ち、鐘で叩く
#   体: 根元 z 0.40 / 高さ 1.80、頭 z 2.52 y 2.44、鐘の先 z 2.88、前脚 z 1.28、後脚 z -1.32、尾の先 z -2.46。
#   印: sp:6 = 首、sp:8 = 鐘の先、own:sac0〜2 = 嚢、sp:0〜2 = 尾と腰。
# =============================================================================================


def bornakel_moves(s):
    bell = [0, 2.3, 2.9]
    return [
        move('roar', 100, 100, 100, A(
            K('w', 0.6, None, yH=-0.04, neckPitch=-0.1, sac=0.6),
            K('w', 1.0, None, pitch=0.08, neckPitch=0.25, headPitch=0.2, sac=1.0),
            K('s', 0.4, 'o', pitch=0.12, yH=0.03, neckPitch=0.4, headPitch=0.35, sac=0.3),
            K('r', 0.5, None, pitch=0.1, neckPitch=0.35, headPitch=0.3, sac=0.2),
            K('r', 0.85, None, neckPitch=0.05), seq=True, shake=0.03), sounds=[(10, 'bell_boom')]),
        move('threat', 120, 30, 90, A(
            K('w', 1.0, None, neckPitch=0.1, headPitch=0.05, sac=0.5),
            K('s', 0.17, None, neckPitch=0.05, neckYaw=0.35, headYaw=0.2, roll=-0.03, sac=0.6),
            K('s', 0.42, None, neckPitch=0.05, neckYaw=-0.35, headYaw=-0.2, roll=0.03, sac=0.4),
            K('s', 0.67, None, neckPitch=0.05, neckYaw=0.35, headYaw=0.2, roll=-0.03, sac=0.6),
            K('s', 0.92, None, neckPitch=0.05, neckYaw=-0.3, headYaw=-0.15, roll=0.03, sac=0.4),
            K('r', 0.5, None, sac=0.1)),
             sounds=[(6, 'galdros_warn'), (40, 'bell_boom'), (70, 'bell_boom')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 90, 22, 48, A(
            K('w', 1.0, None, yH=-0.06, pitch=0.08, neckPitch=-0.15, sac=-0.2, legs={'F': (0.3, 0.3)}),
            K('s', 0.5, None, yH=-0.03, pitch=0.06, neckPitch=-0.1, legs={'H': (-0.25, 0.3), 'F': (0.2, 0.25)}),
            K('s', 1.0, None, pitch=0.02),
            K('r', 0.5, None, pitch=-0.02)),
             curve=(-3.0, 20, 52), sounds=[(20, 'galdros_step')], ai=ai(0, 3.2, 180, 0.8, cd=520)),
        move('sound_blast', 120, 56, 70, A(
            K('w', 0.3, None, neckPitch=-0.1, sac=0.4),
            K('w', 0.8, None, pitch=0.06, yH=0.03, neckPitch=0.2, headPitch=0.15, sac=1.2),
            K('w', 1.0, None, pitch=0.08, yH=0.03, neckPitch=0.25, headPitch=0.2, sac=1.3),
            K('s', 0.2, 'o', pitch=-0.06, z=0.03, neckPitch=-0.1, headPitch=-0.15, sac=-0.2),
            K('s', 1.0, None, pitch=-0.05, z=0.02, neckPitch=-0.12, headPitch=-0.15, sac=-0.1),
            K('r', 0.4, None, neckPitch=-0.05, sac=0.0),
            K('r', 0.8, None, sac=0.0), seq=True, shake=0.025, shakeIn='windup'), turn=(36, 60),
             tracks=[track('bornakel_sound_blast', 1.6, 6.6, [(56, [0, 2.1, 3.0], [0, -0.22, 1]), (70, [0, 2.0, 3.0], [0, -0.25, 1])])],
             hits=[hit('sound', 56, 70, 'bornakel_sound_blast', 10, 'flinch', cost=30, status=('stun', 55))],
             sounds=[(4, 'galdros_warn'), (54, 'bell_boom')], vfx=[(56, 'sound_wave')], ai=ai(3, 10.9, 35, 2.5, cd=300)),
        *[move(nm, 100, 38, 50, A(
            K('w', 0.6, None, yaw=0.25, twist=0.1, roll=0.05, yH=-0.04, sac=0.6, legs={'F.S': (0, 0.3)}),
            K('w', 1.0, None, yaw=0.3, twist=0.12, roll=0.05, yH=-0.04, sac=0.9, legs={'F.S': (0, 0.3)}),
            K('s', 0.4, 'o', yaw=-0.3, twist=-0.15, roll=-0.1, x=0.05, sac=1.1, legs={'F.O': (0.3, 0.2)}),
            K('s', 1.0, None, yaw=-0.32, twist=-0.15, roll=-0.08, x=0.05, sac=1.0),
            K('r', 0.4, None, yaw=-0.15, twist=-0.08, sac=0.5),
            K('r', 0.8, None, sac=0.1)),
            side=sd, curve=(3.0, 34, 52),
            bind=[B(f'bornakel_{nm}', f'own:{own}:C', 'leg:F:S:1', 0.9)],
            hits=[hit('sac', 38, 50, f'bornakel_{nm}', 26, 'knockdown', cost=40)],
            sounds=[(4, 'galdros_warn'), (36, 'galdros_charge')], ai=ai(0, 5.2, 70, 2.2, side=side_name(sd)))
          for nm, sd, own in (('sac_slam', -1, 'sac1'), ('sac_slam_l', 1, 'sac0'))],
        move('bell_slam', 110, 48, 56, A(
            K('w', 0.6, None, pitch=0.18, neckPitch=0.55, headPitch=0.45, sac=0.4, legs={'F': (0.15, 0.25)}),
            K('w', 1.0, None, pitch=0.22, yH=0.04, neckPitch=0.65, headPitch=0.5, sac=0.5, legs={'F': (0.15, 0.3)}),
            K('s', 0.5, 'i', pitch=-0.16, yH=-0.07, neckPitch=-0.55, headPitch=-0.4, sac=0.2),
            K('s', 1.0, None, pitch=-0.16, yH=-0.07, neckPitch=-0.55, headPitch=-0.4, sac=0.2),
            K('r', 0.4, None, pitch=-0.12, yH=-0.05, neckPitch=-0.45, headPitch=-0.32),
            K('r', 0.8, None, neckPitch=-0.05)), turn=(30, 50), slamTrack='bornakel_bell_slam',
             bind=[B('bornakel_bell_slam', 'sp:6', 'sp:8', 0.75, ext=0.35)],
             hits=[hit('bell', 48, 56, 'bornakel_bell_slam', 28, 'knockdown', cost=40, status=('stun', 35))],
             sounds=[(4, 'bell_boom'), (46, 'galdros_swing'), (54, 'bell_boom')], vfx=[(54, 'ground_slam')], ai=ai(0, 4.2, 35, 2.5)),
        move('shiver_step', 90, 36, 46, A(
            K('w', 0.25, None, yH=-0.03, sac=0.6),
            K('w', 0.45, None, yH=-0.02, sac=0.2),
            K('w', 0.7, None, yH=-0.03, sac=0.7),
            K('w', 0.9, None, yH=-0.02, sac=0.2),
            K('s', 0.4, 'o', z=0.06, pitch=-0.06, sac=0.8, legs={'F': (0.4, 0.2), 'H': (-0.3, 0.2)}),
            K('s', 1.0, None, z=0.06, pitch=-0.06, sac=0.7, legs={'F': (0.35, 0.15), 'H': (-0.3, 0.15)}),
            K('r', 0.5, None, z=0.02, sac=0.2), shake=0.04, shakeIn='windup'),
             curve=(2.2, 34, 46), bind=[B('bornakel_shiver_step', 'own:sac2:C', 'sp:7', 0.9)],
             hits=[hit('chest', 36, 46, 'bornakel_shiver_step', 18, 'flinch', cost=25, status=('stun', 20))],
             sounds=[(6, 'bell_boom'), (34, 'galdros_swing')], ai=ai(2, 5.8, 40, 2)),
        *lr(lambda sd, n: move(f'bell_swing_{n}', 100, 40, 52, A(
            K('w', 1.0, None, yaw=-0.18, spineYaw=-0.15, x=-0.03, neckYaw=-0.6, headYaw=-0.3, neckPitch=-0.1, sac=0.4),
            K('s', 0.5, 'o', yaw=0.28, spineYaw=0.2, roll=-0.06, neckYaw=0.75, headYaw=0.35, neckPitch=-0.3, headPitch=-0.15, sac=0.6),
            K('s', 1.0, None, yaw=0.32, spineYaw=0.22, neckYaw=0.85, headYaw=0.4, neckPitch=-0.3, headPitch=-0.15, sac=0.5),
            K('r', 0.4, None, yaw=0.18, neckYaw=0.5, neckPitch=-0.15, sac=0.3),
            K('r', 0.8, None, neckYaw=0.08)),
            side=sd, bind=[B(f'bornakel_bell_swing_{n}', 'sp:6', 'sp:8', 0.75, ext=0.35)],
            hits=[hit('bell', 40, 52, f'bornakel_bell_swing_{n}', 22, 'knockdown', cost=35, status=('stun', 20))],
            sounds=[(4, 'galdros_warn'), (38, 'galdros_swing'), (46, 'bell_boom')], ai=ai(0, 4.1, 110, 2.2, minA=25, side=side_name(sd)))),
        move('triple_boom', 150, 50, 92, A(
            K('w', 0.6, None, neckPitch=0.2, headPitch=0.15, sac=1.0),
            K('w', 1.0, None, neckPitch=0.25, headPitch=0.2, sac=1.2),
            K('s', 0.12, 'o', z=0.02, neckPitch=-0.05, headPitch=-0.05, sac=0.6),
            K('s', 0.3, None, neckPitch=0.15, headPitch=0.1, sac=1.0),
            K('s', 0.5, 'o', z=0.02, neckPitch=-0.08, headPitch=-0.08, sac=0.5),
            K('s', 0.68, None, neckPitch=0.15, headPitch=0.1, sac=1.0),
            K('s', 0.85, 'o', z=0.03, neckPitch=-0.12, headPitch=-0.1, sac=0.2),
            K('s', 1.0, None, z=0.02, neckPitch=-0.1, sac=0.1),
            K('r', 0.5, None, sac=0.0), seq=True), turn=(40, 50),
             tracks=[track('bornakel_boom1', 1.4, 3.4, [(50, [0, 2.0, 2.9], [0, -0.2, 1])]),
                     track('bornakel_boom2', 1.6, 5.0, [(66, [0, 2.0, 2.9], [0, -0.22, 1])]),
                     track('bornakel_boom3', 1.8, 6.8, [(82, [0, 2.0, 2.9], [0, -0.24, 1])])],
             hits=[hit('sound1', 50, 56, 'bornakel_boom1', 8, 'flinch', cost=20, status=('stun', 20)),
                   hit('sound2', 66, 72, 'bornakel_boom2', 10, 'flinch', cost=25, status=('stun', 25)),
                   hit('sound3', 82, 90, 'bornakel_boom3', 12, 'knockdown', cost=30, status=('stun', 35))],
             sounds=[(4, 'galdros_warn'), (50, 'bell_boom'), (66, 'bell_boom'), (82, 'bell_boom')], vfx=[(50, 'sound_wave'), (66, 'sound_wave'), (82, 'sound_wave')],
             ai=ai(3, 10, 35, 1.4, cd=600)),
        move('resonant_stomp', 130, 56, 64, A(
            K('w', 0.5, None, pitch=0.32, yH=0.05, sac=0.6, legs={'F': (0.45, 0.9)}),
            K('w', 1.0, None, pitch=0.45, yH=0.08, neckPitch=0.3, sac=1.0, legs={'F': (0.6, 1.0)}),
            K('s', 0.4, 'i', pitch=-0.08, yH=-0.08, neckPitch=-0.15, sac=0.0, legs={'F': (0.3, 0.0)}),
            K('s', 1.0, None, pitch=-0.08, yH=-0.08, neckPitch=-0.15, sac=0.0, legs={'F': (0.3, 0.0)}),
            K('r', 0.4, None, pitch=-0.05, yH=-0.05, legs={'F': (0.2, 0.0)}),
            K('r', 0.8, None, yH=-0.01), seq=True), turn=(40, 50), slamTrack='bornakel_resonant_stomp',
             bind=[B('bornakel_resonant_stomp', 'leg:F:L:end', 'leg:F:R:end', 0.8)],
             tracks=[track('bornakel_stomp_ring', 2.6, 1.6, [(58, [0, 0.6, 0.6], [0, 0, 1])])],
             hits=[hit('fore', 56, 62, 'bornakel_resonant_stomp', 20, 'knockdown', cost=35),
                   hit('ring', 58, 64, 'bornakel_stomp_ring', 8, 'flinch', cost=20, status=('stun', 30))],
             sounds=[(4, 'bell_boom'), (54, 'galdros_swing'), (58, 'bell_boom')], vfx=[(58, 'ground_slam'), (58, 'sound_ring')], ai=ai(0, 4.5, 60, 1.8, cd=360)),
        move('rump_bump', 100, 40, 48, A(
            K('w', 1.0, None, yH=-0.06, pitch=0.1, neckYaw=0.25, legs={'H': (0.3, 0.4)}),
            K('s', 0.5, 'o', pitch=-0.12, z=-0.08, neckYaw=0.2, legs={'H': (-0.3, 0.1)}),
            K('s', 1.0, None, pitch=-0.12, z=-0.08, legs={'H': (-0.3, 0.1)}),
            K('r', 0.5, None, z=-0.03, pitch=-0.04)),
             curve=(-1.2, 36, 50), bind=[B('bornakel_rump_bump', 'sp:2', 'sp:0', 1.0, ext=0.2)],
             hits=[hit('rump', 40, 48, 'bornakel_rump_bump', 22, 'knockdown', cost=30)],
             sounds=[(4, 'galdros_warn'), (38, 'galdros_swing')], ai=ai(0, 4.2, 180, 2.5, minA=120)),
        move('chest_ram', 130, 46, 84, A(
            K('w', 0.6, None, yH=-0.06, pitch=-0.05, sac=0.8, legs={'F.S': (0.3, 0.6)}),
            K('w', 1.0, None, yH=-0.1, pitch=-0.08, neckPitch=0.15, sac=1.0),
            K('s', 0.1, 'o', yH=-0.04, pitch=-0.06, neckPitch=0.2, sac=1.0),
            K('s', 0.9, None, yH=-0.04, pitch=-0.06, neckPitch=0.2, sac=1.0),
            K('r', 0.3, None, pitch=0.12, sac=0.4, legs={'F': (0.5, 0.1)}),
            K('r', 0.7, None, pitch=0.02, sac=0.1)),
             curve=(8.0, 46, 84), turn=(40, 50), bind=[B('bornakel_chest_ram', 'own:sac2:C', 'sp:7', 1.0)],
             hits=[hit('chest', 46, 84, 'bornakel_chest_ram', 26, 'knockdown', cost=40, status=('stun', 25))],
             sounds=[(4, 'bell_boom'), (44, 'galdros_charge')], ai=ai(6, 11.3, 25, 1.6, cd=420, clear=8)),
        move('sonic_ring', 140, 62, 76, A(
            K('w', 0.4, None, yH=-0.06, sac=0.6, legs={'*': (0, 0.3)}),
            K('w', 0.8, None, yH=-0.08, sac=1.4, legs={'*': (0, 0.35)}),
            K('w', 1.0, None, yH=-0.08, sac=1.5, legs={'*': (0, 0.35)}),
            K('s', 0.2, 'o', yH=0.03, pitch=0.05, neckPitch=0.3, sac=-0.3),
            K('s', 1.0, None, yH=0.02, neckPitch=0.25, sac=-0.2),
            K('r', 0.4, None, sac=0.0, neckPitch=0.1), shake=0.035, shakeIn='windup'),
             tracks=[track('bornakel_sonic_ring', 3.2, 2.0, [(62, [0, 1.0, -0.6], [0, 0, 1])])],
             hits=[hit('ring', 62, 76, 'bornakel_sonic_ring', 10, 'flinch', cost=25, status=('stun', 45))],
             sounds=[(4, 'bell_boom'), (60, 'bell_boom')], vfx=[(62, 'sound_ring')], ai=ai(0, 4, 180, 1.2, cd=640)),
        move('tap_line', 140, 60, 66, A(
            K('w', 0.2, 'i', neckPitch=-0.35, headPitch=-0.3),
            K('w', 0.35, None, neckPitch=0.1),
            K('w', 0.55, 'i', neckPitch=-0.4, headPitch=-0.32),
            K('w', 0.7, None, neckPitch=0.15),
            K('w', 1.0, 'i', neckPitch=-0.45, headPitch=-0.35, pitch=-0.05),
            K('s', 1.0, None, neckPitch=-0.45, headPitch=-0.35, pitch=-0.05),
            K('r', 0.5, None, neckPitch=-0.15)), turn=(40, 50),
             hazards=[hazard(62, 5, 0.5, 1.2, 30, 8, 16, 'flinch', [0, 0.3, 3.0], 'rock', peak=2, pattern='line', status=('stun', 20))],
             sounds=[(12, 'bell_boom'), (33, 'bell_boom'), (60, 'bell_boom')], ai=ai(5, 16, 40, 1.4, cd=420)),
        move('scoop', 90, 34, 42, A(
            K('w', 1.0, None, yH=-0.06, pitch=-0.06, neckPitch=-0.4, headPitch=-0.3),
            K('s', 0.5, 'o', yH=0.03, pitch=0.1, neckPitch=0.45, headPitch=0.35),
            K('s', 1.0, None, yH=0.03, pitch=0.1, neckPitch=0.45, headPitch=0.35),
            K('r', 0.5, None, neckPitch=0.15)),
             turn=(26, 60), bind=[B('bornakel_scoop', 'sp:6', 'sp:8', 0.7, ext=0.3)],
             hits=[hit('bell', 34, 42, 'bornakel_scoop', 22, 'knockdown', cost=30)],
             sounds=[(4, 'galdros_warn'), (32, 'galdros_swing')], ai=ai(0, 4.1, 35, 2.5)),
        move('charge', 180, 60, 124, A(
            K('w', 0.35, None, neckPitch=-0.2, sac=0.5, legs={'F.S': (0.35, 0.7)}),
            K('w', 0.55, 'i', neckPitch=-0.25, sac=0.3, legs={'F.S': (0.1, 0.0)}),
            K('w', 1.0, None, yH=-0.08, pitch=-0.06, neckPitch=-0.35, headPitch=-0.25, sac=0.6, legs={'H': (0.2, 0.4)}),
            K('s', 0.1, 'o', yH=-0.04, pitch=-0.05, neckPitch=-0.35, headPitch=-0.25, sac=0.6),
            K('s', 0.9, None, yH=-0.04, pitch=-0.05, neckPitch=-0.35, headPitch=-0.25, sac=0.6),
            K('r', 0.3, None, pitch=0.12, sac=0.2, legs={'F': (0.5, 0.1)}),
            K('r', 0.7, None, pitch=0.02)),
             curve=(13.0, 60, 124), turn=(54, 50), bind=[B('bornakel_charge', 'sp:5', 'sp:8', 0.95, ext=0.25)],
             hits=[hit('body', 60, 124, 'bornakel_charge', 28, 'knockdown', cost=45)],
             sounds=[(4, 'bell_boom'), (56, 'galdros_charge')], ai=ai(8, 16.5, 25, 1.4, cd=560, clear=11)),
    ]


BORNAKEL_IDLE = idle(
    unaware=dict(neckPitch=-0.3, headPitch=-0.25, pitch=-0.03), sway=0.15, nod=0.15, rate=0.35,
    alert=dict(neckPitch=0.1, sac=0.25),
    weak=dict(neckPitch=-0.25, headPitch=-0.2, sac=-0.3, yH=-0.05, tailPitch=-0.2),
    rage=dict(sac=0.4, neckPitch=0.1),
    run=dict(neckPitch=-0.1, pitch=-0.03, sac=-0.2),
    sleep=dict(yH=-0.4, sac=-0.6, neckPitch=-0.35, headPitch=-0.15, neckYaw=0.4, legs={'*': (0, 1.1, 0.25)}),
    flinch=dict(neckPitch=0.25, headPitch=0.2, pitch=0.08, sac=0.5),
    topple=dict(roll=1.15, yH=-0.35, neckPitch=-0.2, sac=0.3, legs={'*': (0.1, 0.25, 0.4)}),
    rise=dict(pitch=0.1, legs={'F': (0.3, 0.5)}),
    dead=[(18, dict(yH=-0.25, pitch=-0.1, neckPitch=-0.2, sac=0.6, legs={'F': (0.1, 0.9)})),
          (55, dict(roll=1.2, yH=-0.36, neckPitch=-0.3, headPitch=-0.2, sac=0.2, legs={'*': (0.1, 0.3, 0.45)})),
          (110, dict(roll=1.25, yH=-0.38, neckPitch=-0.35, headPitch=-0.25, sac=-0.5, legs={'*': (0.12, 0.25, 0.5)}))],
    fidgets=[
        F('echo_tap', 2.0, 'calm', K('w', 0.25, 'i', neckPitch=-0.4, headPitch=-0.3), K('w', 0.4, None, neckPitch=-0.1),
          K('w', 0.6, 'i', neckPitch=-0.42, headPitch=-0.32), K('w', 0.85, None, neckPitch=-0.15, headYaw=0.2)),
        F('sac_pulse', 1.6, 'any', K('w', 0.35, None, sac=0.8), K('w', 0.7, None, sac=-0.1)),
        F('head_turn', 2.2, 'calm', K('w', 0.35, None, neckYaw=0.6, headYaw=0.3), K('w', 0.75, None, neckYaw=0.6, headYaw=0.35)),
        F('body_shake', 1.0, 'any', K('w', 0.5, None, sac=0.3), shake=0.04),
        F('stamp', 1.2, 'aware', K('w', 0.3, None, legs={'F.S': (0.2, 0.6)}), K('w', 0.5, 'i', legs={'F.S': (0.1, 0.0)})),
        F('deep_breath', 3.0, 'calm', K('w', 0.45, None, sac=1.0, neckPitch=0.15, pitch=0.03), K('w', 0.8, None, sac=-0.2)),
    ])


# =============================================================================================
# 05 灰帷鳥 アシュレイア（二足翼獣。睡眠）: 長い首で探り、帷羽（翼）を広げて灰を払う。翼は跳んだ後に低く滑るためのもの
#   体: 根元 z -0.07 / 高さ 1.89、頭 z 0.76 y 3.23、嘴の先 z 1.42 y 3.00、脚 B（付け根 z -0.14）、尾の先 z -2.94。
#   印: sp:6〜7 = 首、sp:8 = 頭、sp:11 = 嘴の先、own:wing / tip:wing = 翼の付け根と先、sp:0〜3 = 尾羽。
# =============================================================================================


def ashreia_moves(s):
    return [
        move('roar', 90, 90, 90, A(
            K('w', 0.6, None, yH=-0.05, neckPitch=-0.3, headPitch=-0.2, wing=0.2),
            K('w', 1.0, None, pitch=0.1, neckPitch=0.3, headPitch=0.3, wing=0.8, tailPitch=0.2),
            K('s', 0.4, 'o', pitch=0.14, yH=0.04, neckPitch=0.5, headPitch=0.45, wing=1.4, tailPitch=0.4),
            K('r', 0.55, None, pitch=0.12, yH=0.03, neckPitch=0.45, headPitch=0.4, wing=1.3, tailPitch=0.35),
            K('r', 0.85, None, neckPitch=0.1, wing=0.3), shake=0.03), sounds=[(8, 'bird_screech')]),
        move('threat', 110, 26, 86, A(
            K('w', 1.0, None, pitch=0.06, neckPitch=0.35, headPitch=0.2, wing=1.2, tailPitch=0.3),
            K('s', 0.25, None, pitch=0.06, roll=0.06, x=0.03, neckPitch=0.3, neckYaw=0.2, wing=1.3, tailPitch=0.3),
            K('s', 0.5, None, pitch=0.06, roll=-0.06, x=-0.03, neckPitch=0.3, neckYaw=-0.2, wing=1.25, tailPitch=0.3),
            K('s', 0.75, None, pitch=0.06, roll=0.06, x=0.03, neckPitch=0.3, neckYaw=0.2, wing=1.3, tailPitch=0.3),
            K('s', 1.0, None, neckPitch=0.2, wing=1.2, tailPitch=0.2),
            K('r', 0.5, None, wing=0.4)),
             sounds=[(6, 'bird_screech'), (40, 'gust'), (70, 'gust')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 80, 18, 38, A(
            K('w', 1.0, None, yH=-0.15, pitch=-0.05, wing=0.4, legs={'B': (0.1, 0.6)}),
            K('s', 0.3, 'o', yH=0.02, pitch=0.2, neckPitch=0.2, wing=1.3, legs={'B': (0.4, 0.8)}),
            K('s', 1.0, None, pitch=0.12, wing=0.8, legs={'B': (0.3, 0.7)}),
            K('r', 0.3, 'i', yH=-0.1, wing=0.3, legs={'B': (0.0, 0.4)}),
            K('r', 0.7, None, yH=-0.02), hop=0.35),
             curve=(-5.0, 16, 44), sounds=[(16, 'gust')], ai=ai(0, 3.0, 180, 0.8, cd=520)),
        move('ash_curtain', 120, 54, 74, A(
            K('w', 0.5, None, pitch=0.1, neckPitch=0.3, headPitch=0.1, wing=1.0),
            K('w', 1.0, None, pitch=0.14, yH=0.04, neckPitch=0.35, headPitch=0.1, wing=1.4),
            K('s', 0.3, 'o', pitch=-0.12, yH=-0.03, neckPitch=-0.2, wing=0.6),
            K('s', 1.0, None, pitch=-0.12, yH=-0.03, neckPitch=-0.25, wing=0.5),
            K('r', 0.4, None, pitch=-0.1, neckPitch=-0.2, wing=0.5),
            K('r', 0.8, None, wing=0.1)), turn=(36, 70),
             tracks=[track('ashreia_ash_curtain', 1.3, 5.2, [(54, [-2.6, 1.2, 3.0], [1, 0, 0]), (74, [-2.6, 1.1, 3.4], [1, 0, 0])])],
             hits=[hit('ash', 54, 74, 'ashreia_ash_curtain', 6, 'flinch', cost=15, status=('sleep', 100))],
             sounds=[(4, 'bird_screech'), (52, 'gust')], vfx=[(54, 'ash_cloud')], ai=ai(2, 5.6, 40, 2.5, cd=360)),
        move('beak_thrust', 80, 32, 40, A(
            K('w', 0.7, None, yH=-0.06, pitch=-0.1, z=-0.06, neckPitch=-0.5, headPitch=0.55),
            K('w', 1.0, None, yH=-0.08, pitch=-0.12, z=-0.08, neckPitch=-0.6, headPitch=0.65),
            K('s', 0.4, 'o', yH=-0.1, pitch=-0.3, z=0.12, neckPitch=-0.75, headPitch=-0.2, legs={'B': (0.2, 0.2)}),
            K('s', 1.0, None, yH=-0.1, pitch=-0.3, z=0.12, neckPitch=-0.75, headPitch=-0.2, legs={'B': (0.2, 0.2)}),
            K('r', 0.4, None, yH=-0.06, pitch=-0.2, z=0.06, neckPitch=-0.5, headPitch=0.0),
            K('r', 0.8, None, pitch=-0.03)),
             curve=(1.0, 28, 40), turn=(22, 90), bind=[B('ashreia_beak_thrust', 'sp:8', 'sp:11', 0.35, ext=0.2)],
             hits=[hit('beak', 32, 40, 'ashreia_beak_thrust', 20, 'flinch', kind='cut', cost=25)],
             sounds=[(30, 'galdros_swing')], ai=ai(0, 3.1, 30, 3)),
        move('glide', 110, 40, 68, A(
            K('w', 0.7, None, yH=-0.18, pitch=-0.06, wing=0.6, legs={'B': (0, 0.7)}),
            K('w', 1.0, None, yH=-0.2, pitch=-0.06, wing=0.8, legs={'B': (0, 0.75)}),
            K('s', 0.15, 'o', yH=-0.08, pitch=-0.15, neckPitch=-0.3, wing=1.2, legs={'B': (-0.4, 0.8)}),
            K('s', 0.9, None, yH=-0.08, pitch=-0.15, neckPitch=-0.3, wing=1.2, legs={'B': (-0.4, 0.8)}),
            K('r', 0.3, 'i', yH=-0.12, wing=0.5, legs={'B': (0.1, 0.4)}),
            K('r', 0.7, None, yH=-0.02), hop=0.12),
             curve=(8.0, 40, 68), bind=[B('ashreia_glide', 'sp:3', 'sp:6', 0.95)],
             hits=[hit('body', 40, 68, 'ashreia_glide', 22, 'knockdown', cost=35)],
             sounds=[(4, 'bird_screech'), (40, 'gust')], ai=ai(6, 9.6, 25, 2, cd=420, clear=9)),
        *lr(lambda sd, n: move(f'wing_sweep_{n}', 90, 34, 44, A(
            K('w', 1.0, None, yaw=-0.2, roll=0.06, neckYaw=-0.2, wing=0.2, wingS=1.0),
            K('s', 0.5, 'o', yaw=0.4, roll=-0.08, neckYaw=0.1, wing=0.1, wingS=0.7),
            K('s', 1.0, None, yaw=0.5, roll=-0.06, wing=0.1, wingS=0.5),
            K('r', 0.4, None, yaw=0.25, wingS=0.2),
            K('r', 0.8, None, yaw=0.05)),
            side=sd, bind=[B(f'ashreia_wing_sweep_{n}', 'own:wing:S', 'tip:wing:S', 0.55, ext=0.2)],
            hits=[hit('wing', 34, 44, f'ashreia_wing_sweep_{n}', 14, 'flinch', cost=20, status=('sleep', 40))],
            sounds=[(32, 'gust')], ai=ai(0, 2.8, 150, 2.5, minA=40, side=side_name(sd)))),
        move('peck_combo', 120, 30, 78, A(
            K('w', 1.0, None, z=-0.05, neckPitch=0.3, headPitch=0.3),
            K('s', 0.08, 'o', z=0.08, yH=-0.06, pitch=-0.38, neckPitch=-1.0, headPitch=-0.3),
            K('s', 0.25, None, z=-0.03, neckPitch=0.2, headPitch=0.2),
            K('s', 0.4, 'o', z=0.09, yH=-0.06, pitch=-0.4, neckPitch=-1.02, headPitch=-0.32, headYaw=0.2),
            K('s', 0.6, None, z=-0.04, neckPitch=0.25, headPitch=0.25),
            K('s', 0.85, 'o', z=0.12, yH=-0.08, pitch=-0.42, neckPitch=-1.1, headPitch=-0.35),
            K('s', 1.0, None, z=0.12, yH=-0.08, pitch=-0.42, neckPitch=-1.1, headPitch=-0.35),
            K('r', 0.4, None, z=0.06, pitch=-0.2, neckPitch=-0.6),
            K('r', 0.8, None, z=0.0)),
             curve=(1.6, 28, 76), turn=(26, 80), bind=[B('ashreia_peck_combo', 'sp:8', 'sp:11', 0.35, ext=0.2)],
             hits=[hit('peck1', 30, 36, 'ashreia_peck_combo', 8, 'flinch', kind='cut', cost=12),
                   hit('peck2', 48, 54, 'ashreia_peck_combo', 8, 'flinch', kind='cut', cost=12),
                   hit('peck3', 68, 76, 'ashreia_peck_combo', 14, 'flinch', kind='cut', cost=20)],
             sounds=[(28, 'galdros_swing'), (46, 'galdros_swing'), (66, 'galdros_swing')], ai=ai(0, 3.5, 35, 2.2, cd=240)),
        *lr(lambda sd, n: move(f'neck_whip_{n}', 96, 36, 48, A(
            K('w', 1.0, None, yaw=-0.15, neckYaw=-0.8, headYaw=-0.3, neckPitch=-0.2, wing=0.3),
            K('s', 0.5, 'o', yaw=0.25, pitch=-0.4, yH=-0.08, neckYaw=0.9, headYaw=0.35, neckPitch=-1.2, headPitch=-0.1, wingS=0.3),
            K('s', 1.0, None, yaw=0.3, pitch=-0.4, yH=-0.08, neckYaw=1.05, headYaw=0.4, neckPitch=-1.2, headPitch=-0.1, wingS=0.3),
            K('r', 0.4, None, yaw=0.15, neckYaw=0.6, neckPitch=-0.25),
            K('r', 0.8, None, neckYaw=0.1)),
            side=sd, bind=[B(f'ashreia_neck_whip_{n}', 'sp:6', 'sp:11', 0.4, ext=0.15)],
            hits=[hit('neck', 36, 48, f'ashreia_neck_whip_{n}', 16, 'knockdown', cost=25)],
            sounds=[(4, 'bird_screech'), (34, 'galdros_swing')], ai=ai(0, 2.1, 120, 2.2, minA=20, side=side_name(sd)))),
        move('stomp_kick', 96, 40, 46, A(
            K('w', 0.6, None, pitch=0.1, roll=-0.05, neckPitch=0.15, wing=0.4, legs={'B.S': (0.6, 1.0)}),
            K('w', 1.0, None, pitch=0.14, roll=-0.05, neckPitch=0.15, wing=0.6, legs={'B.S': (0.8, 1.1)}),
            K('s', 0.5, 'i', pitch=-0.1, yH=-0.05, neckPitch=-0.2, wing=0.3, legs={'B.S': (0.6, 0.0)}),
            K('s', 1.0, None, pitch=-0.1, yH=-0.05, neckPitch=-0.2, wing=0.3, legs={'B.S': (0.6, 0.0)}),
            K('r', 0.4, None, legs={'B.S': (0.3, 0.2)}),
            K('r', 0.8, None, legs={'B.S': (0.05, 0.0)})),
             turn=(30, 80), slamTrack='ashreia_stomp_kick', bind=[B('ashreia_stomp_kick', 'leg:B:S:2', 'leg:B:S:end', 0.4, ext=0.2)],
             hits=[hit('talon', 40, 46, 'ashreia_stomp_kick', 22, 'knockdown', kind='cut', cost=30)],
             sounds=[(4, 'bird_screech'), (38, 'galdros_swing')], vfx=[(44, 'ground_slam')], ai=ai(0, 2, 40, 2.5)),
        move('leap_dive', 130, 56, 64, A(
            K('w', 0.4, None, yH=-0.2, wing=0.6, legs={'B': (0, 0.8)}),
            K('w', 0.55, 'o', yH=0.05, pitch=0.15, wing=1.4, legs={'B': (0.3, 0.9)}),
            K('w', 0.85, None, pitch=0.05, wing=1.2, legs={'B': (0.8, 0.6)}),
            K('s', 0.4, 'i', yH=-0.1, pitch=-0.2, wing=0.6, legs={'B': (0.5, 0.1)}),
            K('s', 1.0, None, yH=-0.1, pitch=-0.2, wing=0.6, legs={'B': (0.5, 0.1)}),
            K('r', 0.4, None, yH=-0.06, wing=0.3),
            K('r', 0.8, None, yH=-0.01), hop=0.6),
             curve=(6.5, 30, 58), turn=(28, 80), bind=[B('ashreia_leap_dive', 'leg:B:L:end', 'leg:B:R:end', 0.7)],
             hits=[hit('talons', 56, 64, 'ashreia_leap_dive', 24, 'knockdown', kind='cut', cost=35)],
             sounds=[(4, 'bird_screech'), (30, 'gust'), (54, 'galdros_swing')], vfx=[(60, 'dust_ring')], ai=ai(5, 7.9, 30, 1.6, cd=400, clear=6)),
        move('ash_burst', 130, 56, 76, A(
            K('w', 0.4, None, yH=-0.08, wing=0.8),
            K('w', 1.0, None, yH=-0.1, wing=1.3),
            K('s', 0.2, 'o', yH=0.02, pitch=0.08, neckPitch=0.3, wing=1.5),
            K('s', 1.0, None, pitch=0.05, neckPitch=0.25, wing=1.2),
            K('r', 0.4, None, wing=0.4), shake=0.04, shakeIn='windup'),
             tracks=[track('ashreia_ash_burst', 3.0, 1.6, [(56, [0, 1.0, -0.8], [0, 0, 1])])],
             hits=[hit('ash', 58, 76, 'ashreia_ash_burst', 6, 'flinch', cost=15, status=('sleep', 60))],
             sounds=[(4, 'bird_screech'), (54, 'gust')], vfx=[(58, 'ash_ring')], ai=ai(0, 4, 180, 1.2, cd=600)),
        move('tail_fan', 100, 40, 54, A(
            K('w', 1.0, None, yaw=-0.2, tailYaw=-0.6, tailPitch=0.3, wing=0.3, neckYaw=0.3),
            K('s', 0.5, 'o', yaw=0.35, tailYaw=1.1, tailPitch=0.1, wing=0.3),
            K('s', 1.0, None, yaw=0.4, tailYaw=1.2, tailPitch=0.1),
            K('r', 0.4, None, yaw=0.2, tailYaw=0.5),
            K('r', 0.8, None, tailYaw=0.05)),
             bind=[B('ashreia_tail_fan', 'sp:3', 'sp:0', 0.6, ext=0.2)],
             hits=[hit('tail', 40, 54, 'ashreia_tail_fan', 14, 'flinch', cost=20, status=('sleep', 30))],
             sounds=[(4, 'bird_screech'), (38, 'gust')], ai=ai(0, 3.9, 180, 2, minA=100)),
        move('wing_clap', 100, 42, 50, A(
            K('w', 1.0, None, pitch=0.12, yH=0.03, neckPitch=0.25, wing=1.3),
            K('s', 0.5, 'i', pitch=-0.12, neckPitch=-0.15, wing=-0.1),
            K('s', 1.0, None, pitch=-0.12, neckPitch=-0.15, wing=-0.1),
            K('r', 0.4, None, pitch=-0.08, wing=0.0),
            K('r', 0.8, None, wing=0.0)),
             turn=(30, 70), bind=[B('ashreia_wing_clap', 'tip:wing:L', 'tip:wing:R', 0.6)],
             hits=[hit('wings', 42, 50, 'ashreia_wing_clap', 12, 'flinch', cost=20, status=('sleep', 50))],
             sounds=[(4, 'bird_screech'), (44, 'gust')], vfx=[(46, 'ash_cloud')], ai=ai(0, 2.8, 40, 2)),
        move('ash_rain', 150, 60, 80, A(
            K('w', 0.5, None, neckPitch=0.3, wing=1.0),
            K('w', 1.0, None, pitch=0.1, neckPitch=0.35, wing=1.4),
            K('s', 0.2, None, pitch=0.08, neckPitch=0.35, wing=0.2),
            K('s', 0.4, None, pitch=0.1, neckPitch=0.35, wing=1.3),
            K('s', 0.6, None, pitch=0.08, neckPitch=0.35, wing=0.2),
            K('s', 0.8, None, pitch=0.1, neckPitch=0.35, wing=1.3),
            K('s', 1.0, None, neckPitch=0.2, wing=0.4),
            K('r', 0.5, None, wing=0.1)),
             hazards=[hazard(66, 5, 4.0, 1.4, 50, 24, 4, 'flinch', [0, 3.0, 0], 'ash', peak=4, status=('sleep', 45))],
             sounds=[(4, 'bird_screech'), (60, 'gust'), (72, 'gust')], vfx=[(62, 'ash_ring')], ai=ai(6, 18, 60, 1.2, cd=600)),
        move('wing_spin', 120, 46, 66, A(
            K('w', 1.0, None, yaw=-0.3, wing=1.1, legs={'B.S': (0, 0.5)}),
            K('s', 0.5, None, yH=0.03, wing=1.2),
            K('s', 1.0, None, wing=1.1),
            K('r', 0.4, None, wing=0.4), spin=1),
             bind=[B('ashreia_wing_spin', 'tip:wing:L', 'tip:wing:R', 0.55)],
             hits=[hit('wings', 46, 66, 'ashreia_wing_spin', 14, 'flinch', cost=20, status=('sleep', 30))],
             sounds=[(4, 'bird_screech'), (44, 'gust'), (56, 'gust')], ai=ai(0, 2.6, 180, 1.3, cd=420)),
    ]


ASHREIA_IDLE = idle(
    unaware=dict(pitch=-0.15, neckPitch=-0.8, headPitch=-0.4), sway=0.35, nod=0.15, rate=0.6,
    alert=dict(neckPitch=0.15, wing=0.2),
    weak=dict(yH=-0.05, neckPitch=-0.3, headPitch=-0.2, wing=-0.1, tailPitch=-0.2),
    rage=dict(neckPitch=0.15, wing=0.35),
    run=dict(pitch=-0.2, neckPitch=-0.35, wing=0.25),
    sleep=dict(yH=-0.38, pitch=0.06, neckYaw=1.4, neckPitch=-0.2, headPitch=-0.3, headYaw=0.6, wing=-0.1, tailPitch=0.65, legs={'B': (0, 1.2)}),
    flinch=dict(pitch=0.1, neckPitch=0.35, headPitch=0.3, wing=0.4),
    topple=dict(roll=1.3, yH=-0.5, neckPitch=-0.2, wing=0.45, legs={'B': (0.3, 0.3, 0.2)}),
    rise=dict(pitch=0.1, wing=1.0),
    dead=[(15, dict(yH=-0.2, pitch=-0.15, neckPitch=-0.3, wing=0.6, legs={'B': (0.1, 0.8)})),
          (45, dict(roll=1.3, yH=-0.5, neckPitch=-0.5, headPitch=-0.3, wing=0.4, tailPitch=-0.2, legs={'B': (0.2, 0.4, 0.2)})),
          (100, dict(roll=1.35, yH=-0.52, neckPitch=-0.6, headPitch=-0.35, wing=0.25, tailPitch=-0.25, legs={'B': (0.2, 0.35, 0.25)}))],
    fidgets=[
        F('preen', 2.4, 'calm', K('w', 0.35, None, neckYaw=1.0, neckPitch=-0.2, headPitch=-0.4, headYaw=0.5, wingS=0.3),
          K('w', 0.75, None, neckYaw=1.05, neckPitch=-0.25, headPitch=-0.45, headYaw=0.55, wingS=0.35)),
        F('head_bob', 1.0, 'any', K('w', 0.3, None, neckPitch=0.2, z=0.02), K('w', 0.6, None, neckPitch=-0.1, z=-0.02)),
        F('wing_shake', 1.0, 'any', K('w', 0.5, None, wing=0.6), shake=0.05),
        F('scratch', 1.6, 'calm', K('w', 0.3, None, pitch=0.05, legs={'B.S': (0.3, 0.7)}), K('w', 0.5, 'i', legs={'B.S': (-0.2, 0.2)}),
          K('w', 0.7, None, legs={'B.S': (0.3, 0.6)}), K('w', 0.85, 'i', legs={'B.S': (-0.2, 0.2)})),
        F('look_around', 2.0, 'aware', K('w', 0.3, None, neckPitch=0.25, neckYaw=0.6, headYaw=0.3), K('w', 0.7, None, neckPitch=0.25, neckYaw=-0.6, headYaw=-0.3)),
        F('stretch_wings', 2.2, 'calm', K('w', 0.4, None, wing=1.3, pitch=0.05), K('w', 0.7, None, wing=1.3, pitch=0.05)),
    ])


# =============================================================================================
# 06 燐尾鳥 ルミスカ（二足翼獣。雷）: 長い尾の燐節を順に光らせ、地面へ放電する。脚の蹴りと尾の払いが主な技
#   体: 根元 z 0 / 高さ 1.84、頭 z 1.12 y 2.68、嘴の先 z 1.33、脚 B（付け根 z 0.04、足 z 0.42）、尾の先 z -3.78。
#   印: sp:9 = 頭、sp:11 = 嘴の先、sp:0〜4 = 尾、leg:B:側:2〜end = 脚の先、own:wing / tip:wing = 翼。
# =============================================================================================


def lumisca_moves(s):
    return [
        move('roar', 90, 90, 90, A(
            K('w', 0.6, None, yH=-0.05, neckPitch=-0.2, tailPitch=0.2, glow=0.5),
            K('w', 1.0, None, pitch=0.1, neckPitch=0.3, headPitch=0.25, wing=0.5, tailPitch=0.6, glow=1.2),
            K('s', 0.4, 'o', pitch=0.14, yH=0.04, neckPitch=0.45, headPitch=0.4, wing=0.9, tailPitch=0.8, glow=2.0),
            K('r', 0.55, None, pitch=0.12, neckPitch=0.4, headPitch=0.35, wing=0.8, tailPitch=0.7, glow=1.8),
            K('r', 0.85, None, neckPitch=0.1, wing=0.2, tailPitch=0.15, glow=0.5), shake=0.03),
             sounds=[(8, 'bird_screech'), (40, 'zap')]),
        move('threat', 110, 28, 82, A(
            K('w', 1.0, None, neckPitch=0.2, wing=0.6, tailPitch=0.8, glow=1.0),
            K('s', 0.2, None, neckPitch=0.2, wing=0.7, tailPitch=0.85, tailWave=0.3, glow=2.0),
            K('s', 0.4, None, neckPitch=0.2, wing=0.6, tailPitch=0.8, glow=0.5),
            K('s', 0.6, None, neckPitch=0.2, wing=0.7, tailPitch=0.85, tailWave=0.3, glow=2.0),
            K('s', 0.8, None, neckPitch=0.2, wing=0.6, tailPitch=0.8, glow=0.5),
            K('s', 1.0, None, neckPitch=0.15, wing=0.5, tailPitch=0.6, glow=1.5),
            K('r', 0.5, None, tailPitch=0.2, glow=0.3)),
             sounds=[(6, 'bird_screech'), (40, 'zap'), (62, 'zap')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 80, 18, 38, A(
            K('w', 1.0, None, yH=-0.15, pitch=-0.05, wing=0.3, legs={'B': (0.1, 0.6)}),
            K('s', 0.3, 'o', yH=0.02, pitch=0.2, neckPitch=0.2, wing=1.1, tailPitch=0.4, legs={'B': (0.4, 0.8)}),
            K('s', 1.0, None, pitch=0.12, wing=0.7, tailPitch=0.3, legs={'B': (0.3, 0.7)}),
            K('r', 0.3, 'i', yH=-0.1, wing=0.2, legs={'B': (0.0, 0.4)}),
            K('r', 0.7, None, yH=-0.02), hop=0.35),
             curve=(-5.0, 16, 44), sounds=[(16, 'gust')], ai=ai(0, 3.0, 180, 0.8, cd=520)),
        move('discharge', 120, 60, 64, A(
            K('w', 0.3, None, tailPitch=0.4, glow=0.6),
            K('w', 0.7, None, neckPitch=0.15, wing=0.3, tailPitch=0.8, glow=1.4),
            K('w', 1.0, None, neckPitch=0.15, wing=0.35, tailPitch=0.9, tailWave=0.15, glow=2.0),
            K('s', 0.5, 'i', pitch=-0.05, tailPitch=-0.4, glow=2.2),
            K('s', 1.0, None, pitch=-0.05, tailPitch=-0.4, glow=1.5),
            K('r', 0.4, None, tailPitch=-0.2, glow=0.8),
            K('r', 0.8, None, glow=0.2)), turn=(40, 70),
             hazards=[hazard(60, 6, 0.3, 1.1, 30, 10, 18, 'flinch', [0, 0.2, 1.2], 'spark', peak=0, pattern='line')],
             sounds=[(6, 'zap'), (58, 'zap')], vfx=[(60, 'spark_rear')], ai=ai(4, 16, 45, 2.5, cd=360)),
        move('kick', 80, 30, 38, A(
            K('w', 0.7, None, pitch=0.08, roll=0.04, wing=0.3, legs={'B.S': (-0.5, 1.0)}),
            K('w', 1.0, None, pitch=0.1, roll=0.04, wing=0.3, legs={'B.S': (-0.6, 1.1)}),
            K('s', 0.4, 'o', pitch=-0.1, z=0.05, wing=0.5, legs={'B.S': (1.1, 0.1)}),
            K('s', 1.0, None, pitch=-0.1, z=0.05, wing=0.5, legs={'B.S': (1.0, 0.2)}),
            K('r', 0.4, None, wing=0.2, legs={'B.S': (0.4, 0.4)}),
            K('r', 0.8, None, legs={'B.S': (0.05, 0.05)})),
             side=1, curve=(0.8, 26, 38), turn=(20, 90), bind=[B('lumisca_kick', 'leg:B:S:2', 'leg:B:S:end', 0.4, ext=0.25)],
             hits=[hit('kick', 30, 38, 'lumisca_kick', 22, 'knockdown', cost=30)],
             sounds=[(28, 'galdros_swing')], ai=ai(0, 3.1, 35, 3)),
        *lr(lambda sd, n: move(f'tail_sweep_{n}', 100, 40, 54, A(
            K('w', 1.0, None, yaw=-0.2, spineYaw=-0.15, neckYaw=0.4, tailYaw=-0.9, glow=0.8),
            K('s', 0.5, 'o', yaw=0.45, spineYaw=0.2, neckYaw=0.2, tailYaw=1.2, glow=1.2),
            K('s', 1.0, None, yaw=0.55, spineYaw=0.2, tailYaw=1.4, glow=1.0),
            K('r', 0.4, None, yaw=0.3, tailYaw=0.6, glow=0.5),
            K('r', 0.8, None, tailYaw=0.08)),
            side=sd, bind=[B(f'lumisca_tail_sweep_{n}', 'sp:3', 'sp:0', 0.45, ext=0.2)],
            hits=[hit('tail', 40, 54, f'lumisca_tail_sweep_{n}', 22, 'knockdown', cost=30)],
            sounds=[(4, 'galdros_warn'), (38, 'galdros_swing')], ai=ai(0, 4.5, 180, 2.5, minA=60, side=side_name(sd)))),
        move('leap_in', 100, 44, 52, A(
            K('w', 0.5, None, yH=-0.18, wing=-0.2, legs={'B': (0, 0.7)}),
            K('w', 0.75, 'o', yH=0.05, pitch=0.15, wing=0.9, legs={'B': (0.4, 0.9)}),
            K('w', 1.0, None, pitch=0.05, wing=1.0, legs={'B': (0.6, 0.7)}),
            K('s', 0.4, 'i', yH=-0.12, pitch=-0.1, wing=0.4, legs={'B': (0.3, 0.1)}),
            K('s', 1.0, None, yH=-0.12, pitch=-0.1, wing=0.4, legs={'B': (0.3, 0.1)}),
            K('r', 0.4, None, yH=-0.06, wing=0.2),
            K('r', 0.8, None, yH=-0.01), hop=0.35),
             curve=(5.5, 34, 50), slamTrack='lumisca_leap_in', bind=[B('lumisca_leap_in', 'leg:B:L:end', 'leg:B:R:end', 0.8)],
             hits=[hit('land', 44, 52, 'lumisca_leap_in', 24, 'knockdown', cost=35)],
             sounds=[(4, 'bird_screech'), (34, 'gust')], vfx=[(50, 'ground_slam')], ai=ai(4, 7.2, 30, 2, cd=300, clear=6)),
        move('kick_double', 110, 30, 66, A(
            K('w', 1.0, None, pitch=0.08, roll=0.04, wing=0.3, legs={'B.S': (-0.5, 1.0)}),
            K('s', 0.2, 'o', pitch=-0.08, wing=0.5, legs={'B.S': (1.0, 0.1)}),
            K('s', 0.45, None, pitch=0.06, roll=-0.04, wing=0.4, legs={'B.S': (0.2, 0.3), 'B.O': (-0.5, 1.0)}),
            K('s', 0.85, 'o', pitch=-0.1, z=0.06, wing=0.6, legs={'B.O': (1.1, 0.1)}),
            K('s', 1.0, None, pitch=-0.1, z=0.06, wing=0.6, legs={'B.O': (1.0, 0.2)}),
            K('r', 0.4, None, wing=0.2, legs={'B.O': (0.3, 0.3)}),
            K('r', 0.8, None, legs={'B.O': (0.05, 0.05)})),
             side=1, curve=(1.4, 26, 62), turn=(24, 80),
             bind=[B('lumisca_kick_double_a', 'leg:B:S:2', 'leg:B:S:end', 0.4, ext=0.25), B('lumisca_kick_double_b', 'leg:B:O:2', 'leg:B:O:end', 0.4, ext=0.25)],
             hits=[hit('kick1', 30, 38, 'lumisca_kick_double_a', 14, 'flinch', cost=20), hit('kick2', 56, 64, 'lumisca_kick_double_b', 22, 'knockdown', cost=30)],
             sounds=[(28, 'galdros_swing'), (54, 'galdros_swing')], ai=ai(0, 3.7, 35, 2, cd=300)),
        move('peck', 80, 30, 36, A(
            K('w', 1.0, None, z=-0.05, neckPitch=0.3, headPitch=0.3),
            K('s', 0.5, 'o', z=0.08, yH=-0.06, pitch=-0.32, neckPitch=-0.9, headPitch=-0.4),
            K('s', 1.0, None, z=0.08, yH=-0.06, pitch=-0.32, neckPitch=-0.9, headPitch=-0.4),
            K('r', 0.4, None, z=0.04, pitch=-0.12, neckPitch=-0.4),
            K('r', 0.8, None, z=0.0)),
             curve=(0.6, 26, 36), turn=(24, 90), bind=[B('lumisca_peck', 'sp:9', 'sp:11', 0.3, ext=0.2)],
             hits=[hit('beak', 30, 36, 'lumisca_peck', 16, 'flinch', kind='cut', cost=20)],
             sounds=[(28, 'galdros_swing')], ai=ai(0, 2.4, 30, 2.5)),
        move('tail_slam', 130, 56, 62, A(
            K('w', 0.5, None, pitch=-0.1, tailPitch=0.9, glow=1.0),
            K('w', 1.0, None, pitch=-0.15, tailPitch=1.3, tailCurl=0.4, glow=1.8, legs={'B': (0.1, 0.2)}),
            K('s', 0.5, 'i', pitch=0.1, tailPitch=-0.7, tailCurl=-0.2, glow=2.0),
            K('s', 1.0, None, pitch=0.1, tailPitch=-0.75, tailCurl=-0.2, glow=1.6),
            K('r', 0.4, None, tailPitch=-0.5, glow=1.0),
            K('r', 0.8, None, tailPitch=-0.05, glow=0.3)),
             bind=[B('lumisca_tail_slam', 'sp:3', 'sp:0', 0.5, ext=0.2)],
             hits=[hit('tail', 56, 62, 'lumisca_tail_slam', 26, 'knockdown', cost=35)],
             sounds=[(4, 'zap'), (54, 'galdros_swing'), (58, 'zap')], vfx=[(60, 'spark_rear')], ai=ai(0, 4.6, 180, 2.2, minA=135)),
        move('tail_spin', 110, 44, 62, A(
            K('w', 1.0, None, yaw=-0.3, tailYaw=-0.6, glow=1.2, legs={'B': (0, 0.3)}),
            K('s', 0.5, None, tailYaw=0.3, glow=1.5),
            K('s', 1.0, None, tailYaw=0.2, glow=1.2),
            K('r', 0.4, None, tailYaw=0.1, glow=0.5), spin=1),
             bind=[B('lumisca_tail_spin', 'sp:3', 'sp:0', 0.5, ext=0.2)],
             hits=[hit('tail', 44, 62, 'lumisca_tail_spin', 18, 'knockdown', cost=30)],
             sounds=[(4, 'galdros_warn'), (42, 'galdros_swing'), (52, 'galdros_swing')], ai=ai(0, 4.2, 180, 1.4, cd=420)),
        move('spark_ring', 120, 52, 66, A(
            K('w', 0.6, None, yH=-0.05, wing=0.6, tailPitch=0.4, glow=1.5),
            K('w', 1.0, None, yH=-0.06, wing=0.8, tailPitch=0.5, glow=2.0),
            K('s', 0.2, 'o', yH=0.03, wing=1.3, tailPitch=0.6, glow=2.5),
            K('s', 1.0, None, wing=1.0, tailPitch=0.5, glow=1.5),
            K('r', 0.5, None, wing=0.3, glow=0.6), shake=0.03, shakeIn='windup'),
             tracks=[track('lumisca_spark_ring', 3.2, 2.0, [(52, [0, 1.0, -1.0], [0, 0, 1])])],
             hits=[hit('spark', 54, 66, 'lumisca_spark_ring', 16, 'knockdown', cost=30)],
             sounds=[(4, 'zap'), (52, 'zap')], vfx=[(54, 'spark_ring')], ai=ai(0, 4, 180, 1.2, cd=600)),
        move('chain_discharge', 160, 60, 96, A(
            K('w', 1.0, None, neckPitch=0.15, tailPitch=0.9, glow=2.0),
            K('s', 0.05, 'i', pitch=-0.05, tailPitch=-0.4, glow=2.2),
            K('s', 0.4, None, tailPitch=0.8, glow=2.0),
            K('s', 0.9, 'i', pitch=-0.05, tailPitch=-0.45, glow=2.2),
            K('s', 1.0, None, pitch=-0.05, tailPitch=-0.45, glow=1.6),
            K('r', 0.5, None, glow=0.5)), turn=(40, 70),
             hazards=[hazard(62, 6, 0.3, 1.1, 30, 10, 16, 'flinch', [0, 0.2, 1.2], 'spark', peak=0, pattern='line'),
                      hazard(92, 7, 0.4, 1.1, 28, 10, 18, 'flinch', [0, 0.2, 1.2], 'spark', peak=0, pattern='line')],
             sounds=[(6, 'zap'), (60, 'zap'), (90, 'zap')], vfx=[(62, 'spark_rear'), (92, 'spark_rear')], ai=ai(6, 18, 45, 1.4, cd=520)),
        move('tail_jab', 90, 34, 42, A(
            K('w', 1.0, None, z=0.04, tailPitch=0.3, tailCurl=0.5, glow=0.8),
            K('s', 0.5, 'o', z=-0.05, tailPitch=-0.1, tailCurl=-0.3, glow=1.4),
            K('s', 1.0, None, z=-0.05, tailPitch=-0.1, tailCurl=-0.3, glow=1.2),
            K('r', 0.5, None, glow=0.4)),
             bind=[B('lumisca_tail_jab', 'sp:2', 'sp:0', 0.4, ext=0.5)],
             hits=[hit('tail', 34, 42, 'lumisca_tail_jab', 18, 'flinch', cost=25)],
             sounds=[(32, 'zap')], ai=ai(0, 4.8, 180, 2, minA=150)),
        move('leap_kick', 110, 46, 54, A(
            K('w', 0.5, None, yH=-0.15, wing=0.3, legs={'B': (0, 0.7)}),
            K('w', 0.75, 'o', yH=0.05, wing=1.0, legs={'B.S': (-0.4, 1.0), 'B.O': (0.2, 0.6)}),
            K('s', 0.4, 'o', pitch=-0.05, wing=0.8, legs={'B.S': (1.2, 0.1), 'B.O': (0.2, 0.6)}),
            K('s', 1.0, None, pitch=-0.05, wing=0.7, legs={'B.S': (1.0, 0.2), 'B.O': (0.2, 0.5)}),
            K('r', 0.4, 'i', yH=-0.08, wing=0.2, legs={'B': (0.2, 0.4)}),
            K('r', 0.8, None, yH=-0.01), hop=0.3),
             side=1, curve=(4.0, 30, 50), turn=(26, 80), bind=[B('lumisca_leap_kick', 'leg:B:S:2', 'leg:B:S:end', 0.45, ext=0.25)],
             hits=[hit('kick', 46, 54, 'lumisca_leap_kick', 24, 'knockdown', cost=35)],
             sounds=[(4, 'bird_screech'), (30, 'gust'), (44, 'galdros_swing')], ai=ai(4, 6.2, 30, 1.6, cd=300, clear=5)),
        *lr(lambda sd, n: move(f'wing_slap_{n}', 84, 30, 40, A(
            K('w', 1.0, None, yaw=-0.15, roll=0.05, wingS=1.2),
            K('s', 0.5, 'o', yaw=0.35, roll=-0.06, wingS=0.3),
            K('s', 1.0, None, yaw=0.4, roll=-0.05, wingS=0.2),
            K('r', 0.4, None, yaw=0.2, wingS=0.1),
            K('r', 0.8, None, yaw=0.03)),
            side=sd, bind=[B(f'lumisca_wing_slap_{n}', 'own:wing:S', 'tip:wing:S', 0.45, ext=0.15)],
            hits=[hit('wing', 30, 40, f'lumisca_wing_slap_{n}', 14, 'flinch', cost=20)],
            sounds=[(28, 'gust')], ai=ai(0, 2.2, 120, 2, minA=30, side=side_name(sd)))),
    ]


LUMISCA_IDLE = idle(
    unaware=dict(pitch=-0.12, neckPitch=-0.6, headPitch=-0.35, glow=-0.05), sway=0.3, nod=0.2, rate=0.8,
    alert=dict(neckPitch=0.12, tailPitch=0.2, glow=0.3),
    weak=dict(yH=-0.05, neckPitch=-0.25, headPitch=-0.2, tailPitch=-0.3, glow=-0.1),
    rage=dict(tailPitch=0.4, glow=0.6, wing=0.2),
    run=dict(pitch=-0.18, neckPitch=-0.3, tailPitch=0.25, wing=0.2),
    sleep=dict(yH=-0.38, pitch=0.04, neckYaw=1.2, neckPitch=-0.25, headPitch=-0.3, tailYaw=0.9, tailPitch=0.3, glow=-0.1, legs={'B': (0, 1.2)}),
    flinch=dict(pitch=0.1, neckPitch=0.3, headPitch=0.25, wing=0.4, glow=0.6),
    topple=dict(roll=1.3, yH=-0.5, neckPitch=-0.2, wing=0.45, tailPitch=-0.1, legs={'B': (0.3, 0.3, 0.2)}),
    rise=dict(pitch=0.1, wing=0.9),
    dead=[(15, dict(yH=-0.2, pitch=-0.15, neckPitch=-0.3, wing=0.5, glow=0.5, legs={'B': (0.1, 0.8)})),
          (45, dict(roll=1.3, yH=-0.5, neckPitch=-0.5, headPitch=-0.3, wing=0.4, tailPitch=-0.2, glow=0.2, legs={'B': (0.2, 0.4, 0.2)})),
          (100, dict(roll=1.35, yH=-0.52, neckPitch=-0.6, headPitch=-0.35, wing=0.25, tailPitch=-0.25, glow=-0.1, legs={'B': (0.2, 0.35, 0.25)}))],
    fidgets=[
        F('node_flicker', 1.4, 'any', K('w', 0.2, None, glow=1.2), K('w', 0.4, None, glow=0.0), K('w', 0.6, None, glow=1.4), K('w', 0.85, None, glow=0.1)),
        F('tail_curl', 1.8, 'any', K('w', 0.4, None, tailPitch=0.5, tailCurl=0.6), K('w', 0.75, None, tailPitch=0.4, tailCurl=0.4)),
        F('preen', 2.2, 'calm', K('w', 0.35, None, neckYaw=0.9, neckPitch=-0.2, headPitch=-0.35, wingS=0.3), K('w', 0.75, None, neckYaw=0.95, neckPitch=-0.25, headPitch=-0.4, wingS=0.3)),
        F('peck_ground', 1.4, 'calm', K('w', 0.3, 'i', pitch=-0.1, neckPitch=-0.7, headPitch=-0.3), K('w', 0.45, None, neckPitch=-0.3),
          K('w', 0.65, 'i', pitch=-0.1, neckPitch=-0.72, headPitch=-0.3)),
        F('wing_shake', 1.0, 'any', K('w', 0.5, None, wing=0.5), shake=0.05),
        F('look_around', 2.0, 'aware', K('w', 0.3, None, neckPitch=0.2, neckYaw=0.6), K('w', 0.7, None, neckPitch=0.2, neckYaw=-0.6)),
    ])


# =============================================================================================
# 07 硝殻蟹 オルグラス（六脚甲殻）: 右の大鋏（clawR・指 finger_R）と左の小鋏（clawL・指 finger_L）、背の硝殻板（plates）
#   体: 根元 z 0.18 / 高さ 1.67、頭 z 1.32、大鋏の先 z 1.40 x -1.15（指の先は前へ 0.9m）、小鋏の先 z 2.02 x 0.75。歩く脚は水平に振る（M1〜M3）。
#   clawR / clawL = [上げる, 内へ振る]、finger + で指を開く。印: leg:clawR:C:1〜2・tip:finger_R:C = 大鋏、tip:finger_L:C = 小鋏。
# =============================================================================================


def orglass_moves(s):
    big = lambda n: B(n, 'leg:clawR:C:1', 'tip:finger_R:C', 0.7)
    small = lambda n: B(n, 'leg:clawL:C:1', 'tip:finger_L:C', 0.4, ext=0.1)
    return [
        move('roar', 100, 100, 100, A(
            K('w', 0.6, None, yH=-0.05, clawR=(-0.2, 0.2), clawL=(-0.2, 0.2)),
            K('w', 1.0, None, yH=0.04, plates=0.6, finger=1.0, clawR=(0.8, -0.3), clawL=(0.8, -0.3)),
            K('s', 0.4, 'o', yH=0.06, pitch=0.06, plates=1.0, finger=1.2, clawR=(1.0, -0.5), clawL=(1.0, -0.5)),
            K('r', 0.5, None, yH=0.05, pitch=0.05, plates=0.9, finger=1.1, clawR=(0.95, -0.45), clawL=(0.95, -0.45)),
            K('r', 0.85, None, plates=0.2, clawR=(0.2, 0.0)), shake=0.03),
             sounds=[(10, 'shell_clack'), (40, 'shell_clack')]),
        move('threat', 110, 28, 86, A(
            K('w', 1.0, None, yH=0.03, finger=1.0, clawR=(0.6, -0.3), clawL=(0.6, -0.3)),
            K('s', 0.15, None, yH=0.03, x=0.03, finger=-0.2, clawR=(0.6, -0.3), clawL=(0.6, -0.3)),
            K('s', 0.3, None, yH=0.03, finger=1.0, clawR=(0.65, -0.35), clawL=(0.65, -0.35)),
            K('s', 0.45, None, yH=0.03, x=-0.03, finger=-0.2, clawR=(0.6, -0.3), clawL=(0.6, -0.3)),
            K('s', 0.6, None, yH=0.03, finger=1.0, clawR=(0.65, -0.35), clawL=(0.65, -0.35)),
            K('s', 0.75, None, yH=0.03, x=0.03, finger=-0.2, clawR=(0.6, -0.3), clawL=(0.6, -0.3)),
            K('s', 0.9, None, yH=0.03, finger=1.0, clawR=(0.6, -0.3), clawL=(0.6, -0.3)),
            K('r', 0.5, None, finger=0.3, clawR=(0.2, 0.0))),
             sounds=[(6, 'shell_clack'), (38, 'shell_clack'), (52, 'shell_clack'), (66, 'shell_clack'), (80, 'shell_clack')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 80, 16, 48, A(
            K('w', 1.0, None, yH=-0.08, clawR=(0.3, 0.3), clawL=(0.3, 0.3), legs={'*': (0, 0.4)}),
            K('s', 0.2, None, yH=-0.04, clawR=(0.3, 0.3), clawL=(0.3, 0.3)),
            K('s', 0.9, None, yH=-0.04, clawR=(0.3, 0.3), clawL=(0.3, 0.3)),
            K('r', 0.5, None, clawR=(0.1, 0.1)), scurry=1),
             curve=(-3.5, 14, 50), sounds=[(14, 'shell_clack')], ai=ai(0, 3.2, 180, 0.8, cd=520)),
        move('pinch', 90, 38, 46, A(
            K('w', 0.5, None, yaw=-0.05, finger=1.2, clawR=(0.4, -0.4)),
            K('w', 1.0, None, yaw=-0.08, z=-0.03, finger=1.4, clawR=(0.5, -0.5)),
            K('s', 0.5, 'o', yaw=0.1, z=0.06, pitch=-0.04, finger=-0.3, clawR=(-0.1, 0.35)),
            K('s', 1.0, None, yaw=0.1, z=0.06, pitch=-0.04, finger=-0.3, clawR=(-0.1, 0.4)),
            K('r', 0.4, None, yaw=0.05, z=0.03, finger=0.0, clawR=(0.0, 0.2)),
            K('r', 0.8, None, clawR=(0.0, 0.05))),
             curve=(0.8, 34, 46), turn=(30, 60), bind=[big('orglass_pinch')],
             hits=[hit('claw', 38, 46, 'orglass_pinch', 28, 'knockdown', kind='cut', cost=40)],
             sounds=[(4, 'shell_clack'), (36, 'galdros_swing'), (44, 'shell_clack')], ai=ai(0, 4.7, 40, 3)),
        *lr(lambda sd, n: move(f'dash_{n}', 90, 30, 52, A(
            K('w', 1.0, None, yH=-0.12, roll=0.05, clawR=(0.1, 0.3), clawL=(0.1, 0.3), legs={'*': (0, 0.5)}),
            K('s', 0.1, None, yH=-0.04, roll=-0.06, clawR=(0.1, 0.3), clawL=(0.1, 0.3)),
            K('s', 0.9, None, yH=-0.04, roll=-0.06, clawR=(0.1, 0.3), clawL=(0.1, 0.3)),
            K('r', 0.3, None, roll=0.05, clawR=(0.05, 0.1)),
            K('r', 0.7, None, roll=0.0), scurry=1),
            side=sd, curve=(5.0, 30, 52), dirDeg=90 * sd,
            bind=[B(f'orglass_dash_{n}', 'leg:M1:S:0', 'leg:M3:S:0', 1.2)],
            hits=[hit('body', 30, 52, f'orglass_dash_{n}', 24, 'knockdown', cost=35)],
            sounds=[(4, 'shell_clack'), (30, 'galdros_charge')], ai=ai(2, 7, 135, 2.5, minA=45, side=side_name(sd), cd=240))),
        move('fan_pinch', 100, 44, 54, A(
            K('w', 1.0, None, finger=1.2, clawR=(0.4, -0.7), clawL=(0.4, -0.7)),
            K('s', 0.5, 'o', finger=-0.2, z=0.03, clawR=(0.0, 0.5), clawL=(0.0, 0.5)),
            K('s', 1.0, None, finger=-0.2, z=0.03, clawR=(0.0, 0.6), clawL=(0.0, 0.6)),
            K('r', 0.4, None, clawR=(0.0, 0.3), clawL=(0.0, 0.3)),
            K('r', 0.8, None, clawR=(0.0, 0.05), clawL=(0.0, 0.05))), turn=(30, 60),
             bind=[B('orglass_fan_pinch', 'tip:finger_R:C', 'tip:finger_L:C', 0.6)],
             hits=[hit('claws', 44, 54, 'orglass_fan_pinch', 20, 'flinch', kind='cut', cost=30)],
             sounds=[(4, 'shell_clack'), (42, 'galdros_swing'), (52, 'shell_clack')], ai=ai(0, 4, 60, 2.5)),
        move('shell_swing', 100, 40, 56, A(
            K('w', 1.0, None, yaw=-0.25, yH=0.03, plates=1.0, clawR=(0.2, 0.4), clawL=(0.2, 0.4)),
            K('s', 0.5, None, yH=0.02, plates=1.0, clawR=(0.2, 0.4), clawL=(0.2, 0.4)),
            K('s', 1.0, None, plates=0.8),
            K('r', 0.4, None, plates=0.3), spin=1),
             tracks=[track('orglass_shell_swing', 2.2, 3.2, [(40, [0, 1.6, -1.6], [0, 0, 1]), (56, [0, 1.6, -1.6], [0, 0, 1])])],
             hits=[hit('shell', 40, 56, 'orglass_shell_swing', 16, 'flinch', cost=25)],
             sounds=[(4, 'galdros_warn'), (38, 'galdros_swing')], ai=ai(0, 3.6, 180, 2, cd=300)),
        move('claw_slam', 120, 52, 58, A(
            K('w', 0.6, None, pitch=0.08, yH=0.05, finger=0.2, clawR=(1.0, 0.1)),
            K('w', 1.0, None, pitch=0.12, yH=0.06, yaw=0.05, clawR=(1.25, 0.15)),
            K('s', 0.5, 'i', pitch=-0.1, yH=-0.06, clawR=(-0.5, 0.2)),
            K('s', 1.0, None, pitch=-0.1, yH=-0.06, clawR=(-0.5, 0.2)),
            K('r', 0.4, None, pitch=-0.06, yH=-0.04, clawR=(-0.4, 0.2)),
            K('r', 0.8, None, clawR=(-0.05, 0.05))), turn=(40, 50), slamTrack='orglass_claw_slam',
             bind=[big('orglass_claw_slam')],
             hits=[hit('claw', 52, 58, 'orglass_claw_slam', 30, 'knockdown', cost=45)],
             sounds=[(4, 'shell_clack'), (50, 'galdros_swing')], vfx=[(56, 'ground_slam')], ai=ai(0, 4, 45, 2.2)),
        move('claw_sweep', 100, 42, 54, A(
            K('w', 1.0, None, yaw=-0.3, twist=0.05, clawR=(0.2, -0.8)),
            K('s', 0.5, 'o', yaw=0.35, clawR=(0.1, 0.7)),
            K('s', 1.0, None, yaw=0.4, clawR=(0.1, 0.8)),
            K('r', 0.4, None, yaw=0.2, clawR=(0.0, 0.4)),
            K('r', 0.8, None, clawR=(0.0, 0.05))), turn=(30, 60),
             bind=[big('orglass_claw_sweep')],
             hits=[hit('claw', 42, 54, 'orglass_claw_sweep', 24, 'knockdown', cost=35)],
             sounds=[(4, 'shell_clack'), (40, 'galdros_swing')], ai=ai(0, 4.1, 80, 2.2)),
        move('jab', 70, 24, 30, A(
            K('w', 1.0, None, z=-0.02, clawL=(0.3, -0.2)),
            K('s', 0.5, 'o', z=0.04, pitch=-0.08, clawL=(-0.65, 0.15)),
            K('s', 1.0, None, z=0.04, pitch=-0.08, clawL=(-0.65, 0.15)),
            K('r', 0.4, None, clawL=(0.0, 0.1))),
             turn=(20, 80), bind=[small('orglass_jab')],
             hits=[hit('claw', 24, 30, 'orglass_jab', 12, 'flinch', kind='cut', cost=15)],
             sounds=[(22, 'shell_clack')], ai=ai(0, 3.7, 35, 2.5)),
        move('jab_combo', 120, 26, 70, A(
            K('w', 1.0, None, clawL=(0.3, -0.2)),
            K('s', 0.1, 'o', z=0.03, pitch=-0.08, clawL=(-0.65, 0.2)),
            K('s', 0.4, None, finger=1.2, clawL=(0.1, 0.0), clawR=(0.4, -0.5)),
            K('s', 0.85, 'o', z=0.06, finger=-0.3, clawR=(-0.1, 0.4)),
            K('s', 1.0, None, z=0.06, finger=-0.3, clawR=(-0.1, 0.4)),
            K('r', 0.4, None, z=0.03, clawR=(0.0, 0.2)),
            K('r', 0.8, None, clawR=(0.0, 0.05))), turn=(24, 60), curve=(1.0, 24, 66),
             bind=[small('orglass_jab_combo_a'), big('orglass_jab_combo_b')],
             hits=[hit('jab', 26, 32, 'orglass_jab_combo_a', 10, 'flinch', kind='cut', cost=15), hit('pinch', 60, 68, 'orglass_jab_combo_b', 24, 'knockdown', kind='cut', cost=35)],
             sounds=[(24, 'shell_clack'), (58, 'galdros_swing'), (66, 'shell_clack')], ai=ai(0, 4.5, 40, 2, cd=240)),
        move('shell_drop', 120, 50, 56, A(
            K('w', 0.5, None, yH=0.12, pitch=0.05, plates=0.6, legs={'*': (0, -0.2)}),
            K('w', 1.0, None, yH=0.18, plates=0.9, legs={'*': (0, -0.25)}),
            K('s', 0.5, 'i', yH=-0.2, plates=0.3, legs={'*': (0, 0.6, 0.2)}),
            K('s', 1.0, None, yH=-0.2, plates=0.3, legs={'*': (0, 0.6, 0.2)}),
            K('r', 0.4, None, yH=-0.12, legs={'*': (0, 0.4, 0.1)}),
            K('r', 0.8, None, yH=-0.02)),
             tracks=[track('orglass_shell_drop', 2.4, 2.4, [(50, [0, 0.6, -1.0], [0, 0, 1])])],
             hits=[hit('shell', 52, 56, 'orglass_shell_drop', 22, 'knockdown', cost=35)],
             sounds=[(4, 'shell_clack'), (52, 'rock_impact')], vfx=[(54, 'dust_ring')], ai=ai(0, 3.4, 180, 1.6, cd=360)),
        move('glass_shards', 140, 58, 64, A(
            K('w', 0.35, None, yH=0.03, pitch=0.06, plates=0.7, clawR=(0.3, -0.3), clawL=(0.3, -0.3), legs={'*': (0, 0.2, 0.1)}),
            K('w', 1.0, 'i', yH=0.09, pitch=0.1, plates=1.4, finger=0.8, clawR=(0.55, -0.45), clawL=(0.5, -0.4), legs={'*': (0, 0.35, 0.15)}),
            K('s', 0.2, 'o', yH=-0.07, pitch=-0.06, plates=-0.3, finger=-0.2, clawR=(-0.2, 0.5), clawL=(-0.2, 0.45), legs={'*': (0, 0.0, 0.35)}),
            K('s', 1.0, None, yH=-0.05, pitch=-0.03, plates=-0.15, clawR=(-0.15, 0.4), clawL=(-0.15, 0.35), legs={'*': (0, 0.05, 0.3)}),
            K('r', 0.5, None, yH=-0.01, plates=0.0, clawR=(0, 0.1), clawL=(0, 0.1)), shake=0.03, shakeIn='windup'),
             hazards=[hazard(60, 6, 4.0, 1.2, 46, 8, 16, 'flinch', [0, 2.6, -0.5], 'ice', peak=5)],
             sounds=[(4, 'shell_clack'), (56, 'ice_crack')], vfx=[(60, 'glass_burst')], ai=ai(5, 18, 180, 1.2, cd=600)),
        move('claw_double', 150, 50, 90, A(
            K('w', 1.0, None, pitch=0.12, yH=0.06, clawR=(1.2, 0.15)),
            K('s', 0.15, 'i', pitch=-0.1, yH=-0.06, clawR=(-0.5, 0.2)),
            K('s', 0.45, None, pitch=0.1, yH=0.05, clawR=(1.1, 0.1)),
            K('s', 0.9, 'i', pitch=-0.12, yH=-0.07, clawR=(-0.55, 0.2)),
            K('s', 1.0, None, pitch=-0.12, yH=-0.07, clawR=(-0.55, 0.2)),
            K('r', 0.4, None, pitch=-0.06, clawR=(-0.4, 0.2)),
            K('r', 0.8, None, clawR=(-0.05, 0.05))), turn=(40, 50), slamTrack='orglass_claw_double',
             bind=[big('orglass_claw_double')],
             hits=[hit('claw1', 50, 56, 'orglass_claw_double', 22, 'flinch', cost=30), hit('claw2', 82, 88, 'orglass_claw_double', 30, 'knockdown', cost=45)],
             sounds=[(4, 'shell_clack'), (48, 'galdros_swing'), (80, 'galdros_swing')], vfx=[(54, 'ground_slam'), (86, 'ground_slam')], ai=ai(0, 4, 45, 1.6, cd=360)),
        move('sand_rake', 90, 34, 44, A(
            K('w', 0.5, None, pitch=0.06, legs={'M1': (0.6, 0.6)}),
            K('w', 1.0, None, pitch=0.08, legs={'M1': (0.7, 0.7)}),
            K('s', 0.5, 'o', pitch=-0.04, legs={'M1': (-0.5, 0.1)}),
            K('s', 1.0, None, pitch=-0.04, legs={'M1': (-0.55, 0.1)}),
            K('r', 0.4, None, legs={'M1': (0.2, 0.3)}),
            K('r', 0.8, None, legs={'M1': (0.05, 0.05)})), turn=(26, 70),
             tracks=[track('orglass_sand_rake', 0.9, 2.6, [(34, [0, 0.45, 2.0], [0, 0, 1])])],
             hits=[hit('sand', 34, 44, 'orglass_sand_rake', 10, 'flinch', cost=15)],
             sounds=[(32, 'galdros_scrape')], vfx=[(36, 'mud_splash')], ai=ai(0, 4.5, 40, 2)),
        move('rear_shove', 90, 34, 42, A(
            K('w', 1.0, None, pitch=-0.06, legs={'M3': (0.3, 0.6)}),
            K('s', 0.5, 'o', pitch=0.05, z=-0.04, legs={'M3': (-0.8, 0.1)}),
            K('s', 1.0, None, pitch=0.05, z=-0.04, legs={'M3': (-0.8, 0.1)}),
            K('r', 0.5, None, legs={'M3': (-0.2, 0.2)})),
             bind=[B('orglass_rear_shove', 'leg:M3:L:end', 'leg:M3:R:end', 0.6)],
             hits=[hit('legs', 34, 42, 'orglass_rear_shove', 18, 'knockdown', cost=25)],
             sounds=[(32, 'shell_clack')], ai=ai(0, 3.8, 180, 2.2, minA=120)),
        move('charge', 150, 50, 104, A(
            K('w', 1.0, None, yH=-0.08, pitch=-0.04, clawR=(0.3, 0.3), clawL=(0.3, 0.3), legs={'*': (0, 0.4)}),
            K('s', 0.1, None, yH=-0.04, clawR=(0.3, 0.3), clawL=(0.3, 0.3)),
            K('s', 0.9, None, yH=-0.04, clawR=(0.3, 0.3), clawL=(0.3, 0.3)),
            K('r', 0.3, None, pitch=0.08, clawR=(0.2, 0.1), clawL=(0.2, 0.1)),
            K('r', 0.7, None, clawR=(0.05, 0.0)), scurry=1),
             curve=(11.0, 50, 104), turn=(44, 50), bind=[B('orglass_charge', 'leg:clawR:C:2', 'leg:clawL:C:2', 0.9)],
             hits=[hit('claws', 50, 104, 'orglass_charge', 26, 'knockdown', cost=40)],
             sounds=[(4, 'shell_clack'), (48, 'galdros_charge')], ai=ai(7, 13.5, 25, 1.5, cd=520, clear=10)),
    ]


ORGLASS_IDLE = idle(
    unaware=dict(pitch=-0.05, clawR=(-0.2, 0.2), clawL=(-0.1, 0.1)), sway=0.0, nod=0.06, rate=1.2,
    alert=dict(yH=0.03, finger=0.4, clawR=(0.25, -0.15), clawL=(0.2, -0.1)),
    weak=dict(yH=-0.06, clawR=(-0.3, 0.2), clawL=(-0.2, 0.1), plates=-0.2),
    rage=dict(plates=0.5, finger=0.6, clawR=(0.3, -0.2), clawL=(0.3, -0.2)),
    run=dict(yH=-0.04, clawR=(0.2, 0.3), clawL=(0.2, 0.3)),
    sleep=dict(yH=-0.3, plates=-0.3, clawR=(-0.3, 0.4), clawL=(-0.3, 0.4), legs={'*': (0, 0.8, -0.1)}),
    flinch=dict(yH=-0.04, pitch=0.1, finger=0.6, clawR=(0.4, -0.3), clawL=(0.4, -0.3)),
    topple=dict(roll=1.4, yH=-0.2, clawR=(0.5, -0.4), clawL=(0.5, -0.4), legs={'*': (0.2, 0.5, 0.3)}),
    rise=dict(yH=0.05, legs={'*': (0, -0.2)}),
    dead=[(15, dict(yH=-0.2, clawR=(-0.2, 0.3), clawL=(-0.2, 0.3), legs={'*': (0, 0.6)})),
          (50, dict(yH=-0.35, plates=-0.2, finger=0.6, clawR=(-0.4, 0.5), clawL=(-0.4, 0.5), legs={'*': (0.1, 1.0, -0.2)})),
          (100, dict(yH=-0.38, plates=-0.3, finger=0.8, clawR=(-0.45, 0.55), clawL=(-0.45, 0.55), legs={'*': (0.1, 1.1, -0.25)}))],
    fidgets=[
        F('claw_clean', 2.0, 'calm', K('w', 0.3, None, clawL=(0.5, 0.6), clawR=(0.2, 0.3), finger=0.5), K('w', 0.6, None, clawL=(0.4, 0.7), clawR=(0.25, 0.3), finger=-0.1),
          K('w', 0.85, None, clawL=(0.5, 0.6), finger=0.4)),
        F('clack', 0.9, 'any', K('w', 0.25, None, finger=1.0), K('w', 0.45, None, finger=-0.2), K('w', 0.7, None, finger=1.0)),
        F('plates_flex', 1.6, 'any', K('w', 0.4, None, plates=0.8), K('w', 0.8, None, plates=0.1)),
        F('side_shift', 1.4, 'any', K('w', 0.5, None, x=0.04, roll=-0.03, legs={'*.S': (0, 0.3)})),
        F('raise_guard', 1.6, 'aware', K('w', 0.35, None, yH=0.04, finger=0.8, clawR=(0.6, -0.3), clawL=(0.5, -0.3)), K('w', 0.75, None, yH=0.04, finger=0.6, clawR=(0.55, -0.25))),
        F('dig', 2.0, 'calm', K('w', 0.3, None, pitch=-0.06, legs={'M1': (0.4, 0.5)}), K('w', 0.5, None, legs={'M1': (-0.3, 0.1)}),
          K('w', 0.7, None, legs={'M1': (0.4, 0.5)}), K('w', 0.9, None, legs={'M1': (-0.3, 0.1)})),
    ])


# =============================================================================================
# 08 鉤輪蟲 テンガロ（多脚甲殻・輪。麻痺）: 弓なりの体（arch）。体を閉じて輪になり転がる。前と後ろの半身を持ち上げて落とす
#   体: 根元（弓の頂上）z -0.04 y 2.81、頭 z 1.96 y 0.65（sp:13）、尾の端 z -1.70（sp:0〜1）。脚 A（6 対）。
#   ring + で輪へ閉じる、archFront + で前の半身を持ち上げ、archBack + で後ろの半身を持ち上げる。
# =============================================================================================


def tengaro_moves(s):
    head = lambda n: B(n, 'sp:11', 'sp:14', 0.75, ext=0.1)
    rear = lambda n: B(n, 'sp:3', 'sp:0', 0.75, ext=0.1)
    return [
        move('roar', 100, 100, 100, A(
            K('w', 0.6, None, yH=-0.03, archFront=-0.3),
            K('w', 1.0, None, yH=0.03, archFront=0.8, archBack=0.2),
            K('s', 0.4, 'o', yH=0.05, archFront=1.3, archBack=0.3, legs={'A': (0.2, 0.6)}),
            K('r', 0.5, None, yH=0.04, archFront=1.2, archBack=0.25, legs={'A': (0.15, 0.5)}),
            K('r', 0.85, None, archFront=0.2), shake=0.03), sounds=[(10, 'insect_buzz'), (40, 'hiss')]),
        move('threat', 110, 26, 86, A(
            K('w', 1.0, None, archFront=0.9, legs={'A': (0.2, 0.5)}),
            K('s', 0.25, None, archFront=1.0, yaw=0.15, roll=-0.05, legs={'A': (0.3, 0.6)}),
            K('s', 0.5, None, archFront=0.9, yaw=-0.15, roll=0.05, legs={'A': (0.1, 0.5)}),
            K('s', 0.75, None, archFront=1.0, yaw=0.15, roll=-0.05, legs={'A': (0.3, 0.6)}),
            K('s', 1.0, None, archFront=0.8, legs={'A': (0.2, 0.5)}),
            K('r', 0.5, None, archFront=0.2), shake=0.02, shakeIn='strike'),
             sounds=[(6, 'insect_buzz'), (40, 'hiss'), (70, 'hiss')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 100, 20, 56, A(
            K('w', 0.7, None, ring=0.6, yH=-0.05),
            K('w', 1.0, None, ring=1.0, yH=-0.1),
            K('s', 0.5, None, ring=1.0, yH=-0.1),
            K('s', 1.0, None, ring=1.0, yH=-0.1),
            K('r', 0.3, None, ring=0.6, yH=-0.05),
            K('r', 0.7, None, ring=0.1), roll=1),
             curve=(-4.5, 18, 60), sounds=[(18, 'insect_buzz')], ai=ai(0, 3.2, 180, 0.8, cd=520)),
        *lr(lambda sd, n: move(f'roll_{n}', 130, 44, 92, A(
            K('w', 0.6, None, ring=0.6, yH=-0.05),
            K('w', 1.0, None, ring=1.0, yH=-0.1),
            K('s', 0.5, None, ring=1.0, yH=-0.1),
            K('s', 1.0, None, ring=1.0, yH=-0.1),
            K('r', 0.3, None, ring=0.6, yH=-0.05),
            K('r', 0.7, None, ring=0.1), roll=1),
            side=sd, curve=(11.0, 44, 92), dirDeg=25 * sd,
            tracks=[track(f'tengaro_roll_{n}', 1.5, 3.6, [(44, [0, 1.25, -1.8], [0, 0, 1]), (92, [0, 1.25, -1.8], [0, 0, 1])])],
            hits=[hit('ring', 44, 92, f'tengaro_roll_{n}', 26, 'knockdown', cost=40)],
            sounds=[(4, 'insect_buzz'), (44, 'galdros_charge')], ai=ai(6, 12.9, 40, 1.5, side=side_name(sd), cd=480, clear=10))),
        *lr(lambda sd, n: move(f'hook_sweep_{n}', 90, 36, 46, A(
            K('w', 1.0, None, yaw=-0.3, roll=0.1, twist=0.1, archFront=0.3),
            K('s', 0.5, 'o', yaw=0.4, roll=-0.15, twist=-0.1, archFront=0.1),
            K('s', 1.0, None, yaw=0.45, roll=-0.12, twist=-0.1),
            K('r', 0.4, None, yaw=0.2, roll=-0.05),
            K('r', 0.8, None, yaw=0.03)),
            side=sd, bind=[B(f'tengaro_hook_sweep_{n}', 'sp:9', 'sp:13', 0.8)],
            hits=[hit('hooks', 36, 46, f'tengaro_hook_sweep_{n}', 18, 'flinch', kind='cut', cost=25, status=('para', 35))],
            sounds=[(4, 'hiss'), (34, 'galdros_swing')], ai=ai(0, 3.2, 140, 2.5, minA=40, side=side_name(sd)))),
        move('arch_drop', 100, 44, 52, A(
            K('w', 1.0, None, yH=0.05, archFront=1.2, legs={'A': (0.2, 0.5)}),
            K('s', 0.5, 'i', yH=-0.06, archFront=-0.5),
            K('s', 1.0, None, yH=-0.06, archFront=-0.5),
            K('r', 0.4, None, archFront=-0.3),
            K('r', 0.8, None, archFront=-0.05)),
             curve=(1.5, 40, 52), turn=(30, 50), slamTrack='tengaro_arch_drop', bind=[head('tengaro_arch_drop')],
             hits=[hit('drop', 44, 52, 'tengaro_arch_drop', 26, 'knockdown', cost=40)],
             sounds=[(4, 'insect_buzz'), (42, 'galdros_swing')], vfx=[(50, 'ground_slam')], ai=ai(0, 4.6, 35, 2.5)),
        move('venom_strike', 100, 42, 48, A(
            K('w', 1.0, None, yH=0.04, archBack=1.2, archFront=-0.1),
            K('s', 0.5, 'i', archBack=-0.4),
            K('s', 1.0, None, archBack=-0.4),
            K('r', 0.4, None, archBack=-0.2),
            K('r', 0.8, None, archBack=-0.03)),
             bind=[rear('tengaro_venom_strike')],
             hits=[hit('tail', 42, 48, 'tengaro_venom_strike', 14, 'flinch', cost=20, status=('para', 45))],
             hazards=[hazard(44, 3, 2.2, 1.4, 36, 20, 8, 'flinch', [0, 1.5, -2.0], 'para', peak=3, status=('para', 55))],
             sounds=[(4, 'hiss'), (42, 'splash')], ai=ai(2, 12, 180, 2, cd=360)),
        move('head_bite', 80, 30, 38, A(
            K('w', 1.0, None, z=-0.03, archFront=0.5),
            K('s', 0.5, 'o', z=0.05, archFront=-0.3),
            K('s', 1.0, None, z=0.05, archFront=-0.3),
            K('r', 0.5, None, archFront=-0.1)),
             turn=(24, 70), bind=[head('tengaro_head_bite')],
             hits=[hit('jaws', 30, 38, 'tengaro_head_bite', 18, 'flinch', kind='cut', cost=25, status=('para', 20))],
             sounds=[(28, 'hiss')], ai=ai(0, 3.6, 35, 2.5)),
        move('rear_drop', 100, 44, 52, A(
            K('w', 1.0, None, yH=0.04, archBack=1.3),
            K('s', 0.5, 'i', yH=-0.05, archBack=-0.5),
            K('s', 1.0, None, yH=-0.05, archBack=-0.5),
            K('r', 0.4, None, archBack=-0.3),
            K('r', 0.8, None, archBack=-0.05)),
             bind=[rear('tengaro_rear_drop')],
             hits=[hit('drop', 44, 52, 'tengaro_rear_drop', 24, 'knockdown', cost=35)],
             sounds=[(4, 'insect_buzz'), (42, 'galdros_swing')], vfx=[(50, 'dust_ring')], ai=ai(0, 4.3, 180, 2.2, minA=130)),
        move('double_drop', 150, 44, 92, A(
            K('w', 1.0, None, yH=0.05, archFront=1.2),
            K('s', 0.15, 'i', yH=-0.06, archFront=-0.5),
            K('s', 0.5, None, yH=0.04, archFront=-0.2, archBack=1.2),
            K('s', 0.9, 'i', yH=-0.05, archBack=-0.5),
            K('s', 1.0, None, yH=-0.05, archBack=-0.5),
            K('r', 0.4, None, archBack=-0.25),
            K('r', 0.8, None, archBack=-0.03)), turn=(30, 50),
             bind=[head('tengaro_double_drop_a'), rear('tengaro_double_drop_b')],
             hits=[hit('front', 44, 52, 'tengaro_double_drop_a', 20, 'knockdown', cost=30), hit('rear', 84, 92, 'tengaro_double_drop_b', 20, 'knockdown', cost=30)],
             sounds=[(4, 'insect_buzz'), (42, 'galdros_swing'), (82, 'galdros_swing')], vfx=[(50, 'dust_ring'), (90, 'dust_ring')], ai=ai(0, 4.1, 70, 1.6, cd=360)),
        move('roll_straight', 140, 50, 100, A(
            K('w', 0.3, None, yH=0.04, archFront=0.5),
            K('w', 0.7, None, ring=0.7, yH=-0.06),
            K('w', 1.0, None, ring=1.05, yH=-0.12),
            K('s', 0.5, None, ring=1.05, yH=-0.12),
            K('s', 1.0, None, ring=1.05, yH=-0.12),
            K('r', 0.25, None, ring=0.7, yH=-0.04, archFront=0.3),
            K('r', 0.6, None, ring=0.2, archFront=0.1), roll=1),
             curve=(12.0, 50, 100), turn=(44, 50),
             tracks=[track('tengaro_roll_straight', 1.5, 3.6, [(50, [0, 1.25, -1.8], [0, 0, 1]), (100, [0, 1.25, -1.8], [0, 0, 1])])],
             hits=[hit('ring', 50, 100, 'tengaro_roll_straight', 26, 'knockdown', cost=40)],
             sounds=[(4, 'insect_buzz'), (50, 'galdros_charge')], ai=ai(7, 13.9, 25, 1.4, cd=520, clear=12)),
        move('spin_hooks', 110, 44, 62, A(
            K('w', 1.0, None, yaw=-0.3, archFront=0.2, archBack=0.2),
            K('s', 0.5, None, archFront=0.1, archBack=0.1, roll=0.05),
            K('s', 1.0, None, archFront=0.1),
            K('r', 0.4, None, archFront=0.05), spin=1),
             bind=[head('tengaro_spin_hooks_a'), rear('tengaro_spin_hooks_b')],
             hits=[hit('front', 44, 62, 'tengaro_spin_hooks_a', 16, 'flinch', kind='cut', cost=25, status=('para', 25)),
                   hit('rear', 44, 62, 'tengaro_spin_hooks_b', 16, 'flinch', kind='cut', cost=25, status=('para', 25))],
             sounds=[(4, 'hiss'), (42, 'galdros_swing'), (52, 'galdros_swing')], ai=ai(0, 3.4, 180, 1.4, cd=420)),
        move('venom_spray', 110, 48, 60, A(
            K('w', 0.6, None, archFront=0.7, z=-0.03),
            K('w', 1.0, None, archFront=0.9, z=-0.04),
            K('s', 0.3, 'o', archFront=0.4, z=0.03),
            K('s', 1.0, None, archFront=0.4, z=0.03),
            K('r', 0.5, None, archFront=0.1), shake=0.02, shakeIn='strike'), turn=(40, 60),
             tracks=[track('tengaro_venom_spray', 1.0, 4.2, [(48, [0, 1.2, 2.0], [0, -0.2, 1]), (60, [0, 1.0, 2.0], [0, -0.25, 1])])],
             hits=[hit('venom', 48, 60, 'tengaro_venom_spray', 6, 'flinch', cost=15, status=('para', 60))],
             sounds=[(4, 'hiss'), (46, 'splash')], vfx=[(48, 'venom_spray')], ai=ai(2, 7, 30, 1.8, cd=360)),
        move('spring_drop', 130, 58, 66, A(
            K('w', 0.4, None, yH=-0.12, ring=0.3, legs={'A': (0, 0.6)}),
            K('w', 0.55, 'o', yH=0.05, ring=-0.2, archFront=0.4),
            K('w', 0.85, None, ring=-0.1, archFront=0.2),
            K('s', 0.4, 'i', yH=-0.08, archFront=-0.3, archBack=-0.3),
            K('s', 1.0, None, yH=-0.08, archFront=-0.3, archBack=-0.3),
            K('r', 0.4, None, yH=-0.04),
            K('r', 0.8, None, yH=-0.01), hop=0.5),
             curve=(6.0, 34, 60), turn=(30, 60), bind=[B('tengaro_spring_drop', 'sp:3', 'sp:11', 1.1)],
             hits=[hit('land', 58, 66, 'tengaro_spring_drop', 26, 'knockdown', cost=40)],
             sounds=[(4, 'insect_buzz'), (34, 'gust'), (58, 'galdros_swing')], vfx=[(62, 'dust_ring')], ai=ai(5, 8.7, 30, 1.5, cd=400, clear=6)),
        move('hook_rake', 96, 38, 48, A(
            K('w', 1.0, None, archFront=0.8, z=0.04, legs={'A': (0.3, 0.4)}),
            K('s', 0.5, 'o', archFront=-0.2, z=-0.05),
            K('s', 1.0, None, archFront=-0.25, z=-0.06),
            K('r', 0.5, None, archFront=-0.1)),
             turn=(30, 60), bind=[head('tengaro_hook_rake')],
             hits=[hit('hooks', 38, 48, 'tengaro_hook_rake', 20, 'knockdown', kind='cut', cost=30, status=('para', 25))],
             sounds=[(4, 'hiss'), (36, 'galdros_scrape')], ai=ai(0, 4, 40, 2)),
        move('para_rain', 140, 56, 62, A(
            K('w', 0.5, None, archBack=0.9),
            K('w', 1.0, None, archBack=1.2, archFront=-0.1),
            K('s', 0.4, 'o', archBack=0.5),
            K('s', 1.0, None, archBack=0.4),
            K('r', 0.5, None, archBack=0.1), shake=0.02, shakeIn='windup'),
             hazards=[hazard(58, 5, 4.2, 1.3, 44, 18, 6, 'flinch', [0, 1.6, -2.0], 'para', peak=5, status=('para', 45))],
             sounds=[(4, 'hiss'), (56, 'splash')], ai=ai(6, 18, 180, 1.2, cd=600)),
    ]


TENGARO_IDLE = idle(
    unaware=dict(archFront=-0.2, yH=-0.02), sway=0.0, nod=0.0, rate=0.5,
    alert=dict(archFront=0.25),
    weak=dict(yH=-0.05, archFront=-0.25, archBack=-0.2),
    rage=dict(archFront=0.35, archBack=0.15),
    run=dict(archFront=0.1),
    sleep=dict(roll=1.45, ring=0.55, yH=-0.06, archFront=-0.2, archBack=-0.2, legs={'A': (0.1, 0.4, 0.2)}),
    flinch=dict(archFront=0.6, yH=0.02),
    topple=dict(roll=1.35, yH=-0.15, ring=0.2, legs={'A': (0.2, 0.5, 0.3)}),
    rise=dict(archFront=0.4),
    dead=[(20, dict(yH=-0.1, archFront=-0.4, archBack=-0.3)),
          (60, dict(roll=1.3, yH=-0.22, archFront=-0.5, archBack=-0.5, ring=-0.15, legs={'A': (0.1, 0.6, 0.2)})),
          (110, dict(roll=1.35, yH=-0.25, archFront=-0.55, archBack=-0.55, ring=-0.2, legs={'A': (0.15, 0.7, 0.2)}))],
    fidgets=[
        F('front_probe', 2.0, 'any', K('w', 0.35, None, archFront=0.6, yaw=0.1), K('w', 0.75, None, archFront=0.5, yaw=-0.1)),
        F('rear_lift', 1.6, 'any', K('w', 0.4, None, archBack=0.6), K('w', 0.75, None, archBack=0.4)),
        F('half_curl', 2.4, 'calm', K('w', 0.4, None, ring=0.35, yH=-0.03), K('w', 0.75, None, ring=0.3, yH=-0.03)),
        F('leg_ripple', 1.4, 'any', K('w', 0.3, None, legs={'A': (0.3, 0.4)}), K('w', 0.6, None, legs={'A': (-0.3, 0.3)})),
        F('rattle', 0.9, 'aware', K('w', 0.5, None, archFront=0.4), shake=0.04),
    ])


# =============================================================================================
# 09 絹霧蟲 ヴェリト（多脚の虫。毒）: 羽袋（bags）をふくらませ、尾の紡糸管から毒糸、腹から毒の滴。前脚は糸櫛
#   体: 根元 z 0.16 / 高さ 1.12、頭 z 1.26（sp:6）、口先 z 1.46（sp:7）、尾の端 z -1.98（sp:0）。脚 M1（前・糸櫛）〜M4（後ろ）は水平に振る。
# =============================================================================================


def verito_moves(s):
    fore = lambda n: B(n, 'leg:M1:L:end', 'leg:M1:R:end', 0.55)
    mouth = lambda n: B(n, 'sp:5', 'sp:7', 0.5, ext=0.2)
    return [
        move('roar', 90, 90, 90, A(
            K('w', 0.6, None, yH=-0.05, bags=-0.3, legs={'M1': (0.2, 0.3)}),
            K('w', 1.0, None, pitch=0.15, yH=0.05, bags=0.8, legs={'M1': (0.6, 0.9)}),
            K('s', 0.4, 'o', pitch=0.25, yH=0.08, bags=1.2, legs={'M1': (0.8, 1.1), 'M2': (0.3, 0.4)}),
            K('r', 0.5, None, pitch=0.22, yH=0.07, bags=1.1, legs={'M1': (0.75, 1.0), 'M2': (0.25, 0.3)}),
            K('r', 0.85, None, pitch=0.03, bags=0.2), shake=0.03), sounds=[(8, 'insect_buzz')]),
        move('threat', 110, 26, 86, A(
            K('w', 1.0, None, pitch=0.18, yH=0.05, bags=1.0, legs={'M1': (0.6, 1.0)}),
            K('s', 0.25, None, pitch=0.2, yH=0.06, bags=1.3, legs={'M1': (0.7, 1.1)}),
            K('s', 0.5, None, pitch=0.18, yH=0.05, bags=0.8, legs={'M1': (0.5, 0.9)}),
            K('s', 0.75, None, pitch=0.2, yH=0.06, bags=1.3, legs={'M1': (0.7, 1.1)}),
            K('s', 1.0, None, pitch=0.15, bags=0.9, legs={'M1': (0.5, 0.8)}),
            K('r', 0.5, None, bags=0.2), shake=0.02, shakeIn='strike'),
             sounds=[(6, 'insect_buzz'), (40, 'hiss'), (70, 'hiss')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 80, 18, 36, A(
            K('w', 1.0, None, yH=-0.12, bags=-0.5, legs={'*': (0, 0.5)}),
            K('s', 0.4, 'o', yH=0.02, pitch=0.12, bags=0.6, legs={'M1': (0.5, 0.7)}),
            K('s', 1.0, None, pitch=0.08, bags=0.4, legs={'*': (0, 0.6)}),
            K('r', 0.3, 'i', yH=-0.08, legs={'*': (0, 0.3)}),
            K('r', 0.7, None, yH=-0.01), hop=0.3),
             curve=(-4.5, 16, 40), sounds=[(16, 'insect_buzz')], vfx=[(20, 'poison_threads')], ai=ai(0, 3.0, 180, 0.8, cd=520)),
        move('thread_spray', 110, 46, 62, A(
            K('w', 0.6, None, pitch=-0.12, tailPitch=0.4),
            K('w', 1.0, None, pitch=-0.15, yaw=-0.2, tailPitch=0.6, tailYaw=-0.3),
            K('s', 0.5, None, pitch=-0.12, yaw=0.0, tailPitch=0.5, tailYaw=0.0),
            K('s', 1.0, None, pitch=-0.12, yaw=0.25, tailPitch=0.5, tailYaw=0.35),
            K('r', 0.4, None, pitch=-0.06, yaw=0.12, tailYaw=0.15),
            K('r', 0.8, None, yaw=0.02)),
             tracks=[track('verito_thread_spray', 0.7, 3.4, [(46, [0, 0.5, -2.0], [-1, 0, -0.45]), (54, [0, 0.5, -2.0], [0, 0, -1]), (62, [0, 0.5, -2.0], [1, 0, -0.45])])],
             hits=[hit('threads', 46, 62, 'verito_thread_spray', 8, 'flinch', cost=15, status=('poison', 70))],
             sounds=[(4, 'hiss'), (46, 'gust')], vfx=[(46, 'poison_threads')], ai=ai(0, 6, 180, 2.5, minA=100, cd=300)),
        move('hop', 100, 46, 54, A(
            K('w', 0.5, None, yH=-0.15, bags=-0.6, legs={'*': (0, 0.6)}),
            K('w', 0.7, 'o', yH=0.05, pitch=0.12, bags=0.8, legs={'M1': (0.6, 0.9), 'M4': (-0.4, 0.5)}),
            K('w', 1.0, None, pitch=0.0, bags=0.6, legs={'*': (0, 0.7)}),
            K('s', 0.4, 'i', yH=-0.12, pitch=-0.05, bags=0.2, legs={'*': (0, 0.3, 0.2)}),
            K('s', 1.0, None, yH=-0.12, pitch=-0.05, bags=0.2, legs={'*': (0, 0.3, 0.2)}),
            K('r', 0.4, None, yH=-0.05),
            K('r', 0.8, None, yH=-0.01), hop=0.4),
             curve=(5.0, 34, 52), slamTrack='verito_hop', bind=[B('verito_hop', 'sp:1', 'sp:7', 1.0)],
             hits=[hit('land', 46, 54, 'verito_hop', 22, 'knockdown', cost=35)],
             sounds=[(4, 'insect_buzz'), (34, 'gust')], vfx=[(52, 'ground_slam')], ai=ai(4, 7.4, 30, 2, cd=300, clear=6)),
        move('foreleg_sweep', 80, 32, 42, A(
            K('w', 1.0, None, pitch=0.1, legs={'M1': (0.4, 0.9, 0.3)}),
            K('s', 0.5, 'o', pitch=-0.05, legs={'M1': (0.6, 0.3, -0.3)}),
            K('s', 1.0, None, pitch=-0.05, legs={'M1': (0.7, 0.2, -0.4)}),
            K('r', 0.4, None, legs={'M1': (0.3, 0.2)}),
            K('r', 0.8, None, legs={'M1': (0.05, 0.05)})), turn=(24, 80),
             bind=[fore('verito_foreleg_sweep')],
             hits=[hit('legs', 32, 42, 'verito_foreleg_sweep', 16, 'flinch', kind='cut', cost=25, status=('poison', 35))],
             sounds=[(30, 'galdros_swing')], ai=ai(0, 3.1, 50, 3)),
        move('drip', 100, 40, 44, A(
            K('w', 0.6, None, pitch=-0.2, yH=0.05, bags=0.6),
            K('w', 1.0, None, pitch=-0.25, yH=0.06, bags=0.9, tailPitch=0.4),
            K('s', 0.5, 'o', pitch=0.05, yH=0.0, bags=0.2, tailPitch=0.0),
            K('s', 1.0, None, pitch=0.05, bags=0.2),
            K('r', 0.5, None, bags=0.0)),
             hazards=[hazard(42, 4, 2.5, 1.2, 30, 24, 6, 'flinch', [0, 1.5, -1.6], 'poison', peak=2.5, status=('poison', 60))],
             sounds=[(4, 'hiss'), (40, 'splash')], ai=ai(0, 7, 180, 2, cd=300)),
        move('foreleg_stab', 90, 36, 42, A(
            K('w', 0.6, None, pitch=0.15, yH=0.04, legs={'M1': (0.4, 1.0)}),
            K('w', 1.0, None, pitch=0.2, yH=0.05, legs={'M1': (0.5, 1.1)}),
            K('s', 0.5, 'i', pitch=-0.1, yH=-0.04, legs={'M1': (0.6, 0.0)}),
            K('s', 1.0, None, pitch=-0.1, yH=-0.04, legs={'M1': (0.6, 0.0)}),
            K('r', 0.4, None, pitch=-0.05, legs={'M1': (0.4, 0.1)}),
            K('r', 0.8, None, legs={'M1': (0.05, 0.05)})), turn=(26, 70), slamTrack='verito_foreleg_stab',
             bind=[fore('verito_foreleg_stab')],
             hits=[hit('legs', 36, 42, 'verito_foreleg_stab', 20, 'knockdown', kind='cut', cost=30, status=('poison', 30))],
             sounds=[(4, 'hiss'), (34, 'galdros_swing')], ai=ai(0, 3.1, 40, 2.5)),
        move('bite', 80, 30, 36, A(
            K('w', 1.0, None, z=-0.05, pitch=0.12, headPitch=0.3, legs={'M1': (0.3, 0.5)}),
            K('s', 0.5, 'o', z=0.1, pitch=-0.1, headPitch=-0.25, legs={'M1': (0.5, 0.2)}),
            K('s', 1.0, None, z=0.1, pitch=-0.1, headPitch=-0.25, legs={'M1': (0.5, 0.2)}),
            K('r', 0.5, None, z=0.03, legs={'M1': (0.2, 0.1)})),
             curve=(0.6, 26, 36), turn=(24, 80), bind=[mouth('verito_bite')],
             hits=[hit('jaws', 30, 36, 'verito_bite', 16, 'flinch', kind='cut', cost=20, status=('poison', 25))],
             sounds=[(28, 'hiss')], ai=ai(0, 3, 30, 2.5)),
        *lr(lambda sd, n: move(f'thread_whip_{n}', 96, 38, 50, A(
            K('w', 1.0, None, yaw=-0.2, tailYaw=-0.8, tailPitch=0.3),
            K('s', 0.5, 'o', yaw=0.35, tailYaw=1.1, tailPitch=0.1),
            K('s', 1.0, None, yaw=0.4, tailYaw=1.25, tailPitch=0.1),
            K('r', 0.4, None, yaw=0.2, tailYaw=0.5),
            K('r', 0.8, None, tailYaw=0.05)),
            side=sd, bind=[B(f'verito_thread_whip_{n}', 'sp:3', 'sp:0', 0.4, ext=0.8)],
            hits=[hit('thread', 38, 50, f'verito_thread_whip_{n}', 10, 'flinch', cost=15, status=('poison', 45))],
            sounds=[(4, 'hiss'), (36, 'gust')], ai=ai(0, 3.2, 180, 2, minA=70, side=side_name(sd)))),
        move('web_volley', 130, 56, 62, A(
            K('w', 0.6, None, pitch=0.15, bags=0.8, legs={'M1': (0.3, 0.6)}),
            K('w', 1.0, None, pitch=0.2, yH=0.04, bags=1.1, legs={'M1': (0.4, 0.7)}),
            K('s', 0.4, 'o', pitch=-0.05, bags=0.2),
            K('s', 1.0, None, pitch=-0.05, bags=0.2),
            K('r', 0.5, None, bags=0.0)), turn=(46, 60),
             hazards=[hazard(58, 5, 0.6, 1.2, 34, 26, 6, 'flinch', [0, 1.0, 1.4], 'poison', peak=2, pattern='line', status=('poison', 50))],
             sounds=[(4, 'hiss'), (56, 'gust')], vfx=[(58, 'web_spray')], ai=ai(5, 16, 40, 1.6, cd=420)),
        move('body_slam', 110, 46, 52, A(
            K('w', 0.6, None, pitch=0.35, yH=0.08, bags=0.6, legs={'M1': (0.5, 1.0), 'M2': (0.3, 0.6)}),
            K('w', 1.0, None, pitch=0.45, yH=0.1, bags=0.9, legs={'M1': (0.6, 1.1), 'M2': (0.4, 0.7)}),
            K('s', 0.5, 'i', pitch=-0.12, yH=-0.08, bags=0.2, legs={'M1': (0.4, 0.0, 0.2), 'M2': (0.2, 0.0)}),
            K('s', 1.0, None, pitch=-0.12, yH=-0.08, bags=0.2, legs={'M1': (0.4, 0.0, 0.2)}),
            K('r', 0.4, None, pitch=-0.06, yH=-0.04),
            K('r', 0.8, None, yH=-0.01)), turn=(34, 60), slamTrack='verito_body_slam',
             bind=[B('verito_body_slam', 'sp:4', 'sp:7', 0.85)],
             hits=[hit('body', 46, 52, 'verito_body_slam', 24, 'knockdown', cost=35)],
             sounds=[(4, 'insect_buzz'), (44, 'galdros_swing')], vfx=[(50, 'ground_slam')], ai=ai(0, 2.6, 40, 2, cd=240)),
        move('spin_threads', 120, 46, 66, A(
            K('w', 1.0, None, yaw=-0.3, tailPitch=0.4, bags=0.6),
            K('s', 0.5, None, tailPitch=0.3, bags=0.8),
            K('s', 1.0, None, tailPitch=0.2, bags=0.5),
            K('r', 0.4, None, bags=0.1), spin=1),
             tracks=[track('verito_spin_threads', 2.8, 1.4, [(46, [0, 0.4, -0.7], [0, 0, 1])])],
             hits=[hit('threads', 48, 66, 'verito_spin_threads', 8, 'flinch', cost=15, status=('poison', 50))],
             sounds=[(4, 'hiss'), (44, 'gust'), (56, 'gust')], vfx=[(48, 'poison_cloud')], ai=ai(0, 3.6, 180, 1.3, cd=420)),
        *lr(lambda sd, n: move(f'leg_rake_{n}', 84, 30, 40, A(
            K('w', 1.0, None, roll=0.08, legs={'M2.S': (0.5, 0.9), 'M3.S': (0.3, 0.7)}),
            K('s', 0.5, 'o', roll=-0.08, x=0.03, legs={'M2.S': (-0.4, 0.2, 0.3), 'M3.S': (-0.4, 0.2, 0.2)}),
            K('s', 1.0, None, roll=-0.06, x=0.03, legs={'M2.S': (-0.5, 0.1, 0.3), 'M3.S': (-0.5, 0.1, 0.2)}),
            K('r', 0.4, None, legs={'M2.S': (-0.2, 0.2), 'M3.S': (-0.2, 0.2)}),
            K('r', 0.8, None, legs={'M2.S': (0.0, 0.05)})),
            side=sd, bind=[B(f'verito_leg_rake_{n}', 'leg:M2:S:1', 'leg:M2:S:end', 0.5, ext=0.15)],
            hits=[hit('legs', 30, 40, f'verito_leg_rake_{n}', 14, 'flinch', kind='cut', cost=20, status=('poison', 25))],
            sounds=[(28, 'galdros_swing')], ai=ai(0, 2.8, 130, 2, minA=40, side=side_name(sd)))),
        move('mist_cloud', 140, 56, 96, A(
            K('w', 0.35, None, yH=-0.08, pitch=-0.05, bags=0.7, legs={'*': (0, 0.45, -0.1)}),
            K('w', 1.0, 'i', yH=-0.12, pitch=-0.14, bags=1.5, legs={'*': (0, 0.7, -0.15)}),
            K('s', 0.15, 'o', yH=0.08, pitch=0.08, bags=-0.4, legs={'*': (0, 0.0, 0.35)}),
            K('s', 1.0, None, yH=0.03, pitch=0.03, bags=-0.25, legs={'*': (0, 0.1, 0.25)}),
            K('r', 0.5, None, bags=0.0, legs={'*': (0, 0.05, 0.1)}), shake=0.03, shakeIn='windup'),
             tracks=[track('verito_mist_cloud', 3.0, 1.6, [(56, [0, 0.8, -0.8], [0, 0, 1])])],
             hits=[hit('mist', 58, 96, 'verito_mist_cloud', 4, 'flinch', cost=10, status=('poison', 70))],
             sounds=[(4, 'hiss'), (56, 'gust')], vfx=[(58, 'poison_cloud'), (76, 'poison_cloud')], ai=ai(0, 4, 180, 1.1, cd=640)),
        move('pounce', 100, 44, 52, A(
            K('w', 0.5, None, yH=-0.14, bags=-0.4, legs={'*': (0, 0.55)}),
            K('w', 0.75, 'o', yH=0.04, pitch=0.12, bags=0.6, legs={'M1': (0.6, 0.8)}),
            K('s', 0.4, 'i', yH=-0.08, pitch=-0.12, bags=0.2, legs={'M1': (0.5, 0.2)}),
            K('s', 1.0, None, yH=-0.08, pitch=-0.12, legs={'M1': (0.5, 0.2)}),
            K('r', 0.4, None, yH=-0.04),
            K('r', 0.8, None, yH=-0.01), hop=0.25),
             curve=(3.5, 26, 46), turn=(24, 80), bind=[mouth('verito_pounce')],
             hits=[hit('jaws', 44, 52, 'verito_pounce', 20, 'knockdown', kind='cut', cost=30, status=('poison', 30))],
             sounds=[(4, 'insect_buzz'), (26, 'gust'), (42, 'hiss')], ai=ai(3, 5.7, 30, 1.6, cd=300, clear=4)),
    ]


VERITO_IDLE = idle(
    unaware=dict(pitch=-0.05, legs={'M1': (0.3, 0.3)}), sway=0.0, nod=0.05, rate=0.8,
    alert=dict(pitch=0.06, bags=0.3, legs={'M1': (0.2, 0.3)}),
    weak=dict(yH=-0.06, bags=-0.4, tailPitch=-0.2),
    rage=dict(bags=0.6, pitch=0.05),
    run=dict(yH=-0.03, bags=-0.3),
    sleep=dict(yH=-0.25, bags=-0.6, pitch=-0.03, legs={'*': (0, 0.7, -0.1)}),
    flinch=dict(pitch=0.15, yH=0.02, bags=0.6, legs={'M1': (0.4, 0.6)}),
    topple=dict(roll=2.6, yH=0.1, bags=-0.3, legs={'*': (0.2, 0.8, 0.3)}),
    rise=dict(roll=0.0, pitch=0.1, legs={'M1': (0.3, 0.6)}),
    dead=[(15, dict(yH=-0.1, pitch=-0.05, legs={'*': (0, 0.5)})),
          (50, dict(roll=2.4, yH=0.05, bags=-0.4, legs={'*': (0.1, 1.0, -0.1)})),
          (110, dict(roll=2.6, yH=0.05, bags=-0.5, legs={'*': (0.15, 1.2, -0.2)}))],
    fidgets=[
        F('comb_threads', 2.2, 'calm', K('w', 0.3, None, pitch=0.08, legs={'M1': (0.6, 0.8, -0.3)}), K('w', 0.5, None, legs={'M1': (0.4, 0.6, 0.2)}),
          K('w', 0.7, None, pitch=0.08, legs={'M1': (0.6, 0.8, -0.3)}), K('w', 0.9, None, legs={'M1': (0.4, 0.6, 0.2)})),
        F('bag_puff', 1.4, 'any', K('w', 0.4, None, bags=0.9), K('w', 0.8, None, bags=-0.1)),
        F('antenna_twitch', 0.8, 'any', K('w', 0.3, None, headYaw=0.2, pitch=0.04), K('w', 0.6, None, headYaw=-0.2)),
        F('spinner_flick', 1.0, 'any', K('w', 0.3, None, tailPitch=0.5, tailYaw=0.3), K('w', 0.7, None, tailPitch=0.2, tailYaw=-0.3)),
        F('rear_up', 1.6, 'aware', K('w', 0.4, None, pitch=0.2, yH=0.05, legs={'M1': (0.5, 0.9)}), K('w', 0.75, None, pitch=0.18, legs={'M1': (0.5, 0.8)})),
    ])


# =============================================================================================
# 10 環骨蛇 ラズメル（長胴獣）: 骨環の並ぶ長い体と 2 対の短い脚。大きく体を回す前に、必ず前半身を反対へ曲げる
#   体: 根元 z 0 / 高さ 1.22、頭 z 3.72 y 1.55（sp:10）、口先 z 4.01（sp:11）、首 sp:8〜9、前脚 z 1.72、後脚 z -1.62、尾の先 z -4.16（sp:0）。
# =============================================================================================


def razmer_moves(s):
    head = lambda n: B(n, 'sp:9', 'sp:11', 0.5, ext=0.2)
    front = lambda n: B(n, 'sp:6', 'sp:10', 0.85)
    tail = lambda n: B(n, 'sp:3', 'sp:0', 0.55, ext=0.2)
    return [
        move('roar', 100, 100, 100, A(
            K('w', 0.6, None, yH=-0.05, neckPitch=-0.2, spinePitch=-0.1),
            K('w', 1.0, None, spinePitch=0.3, neckPitch=0.4, headPitch=0.25, tailWave=0.15),
            K('s', 0.4, 'o', spinePitch=0.45, neckPitch=0.55, headPitch=0.4, yH=0.05, tailWave=0.3, legs={'F': (0.2, 0.6)}),
            K('r', 0.5, None, spinePitch=0.42, neckPitch=0.5, headPitch=0.35, yH=0.04, tailWave=0.3, legs={'F': (0.2, 0.5)}),
            K('r', 0.85, None, spinePitch=0.05, neckPitch=0.1), shake=0.03), sounds=[(10, 'hiss'), (30, 'galdros_rumble')]),
        move('threat', 120, 30, 90, A(
            K('w', 1.0, None, spinePitch=0.3, neckPitch=0.45, headPitch=0.2, legs={'F': (0.2, 0.5)}),
            K('s', 0.25, None, spinePitch=0.32, neckPitch=0.45, neckYaw=0.3, headYaw=0.15, tailWave=0.4, legs={'F': (0.2, 0.5)}),
            K('s', 0.5, None, spinePitch=0.3, neckPitch=0.45, neckYaw=-0.3, headYaw=-0.15, tailWave=0.4, legs={'F': (0.2, 0.5)}),
            K('s', 0.75, None, spinePitch=0.32, neckPitch=0.45, neckYaw=0.3, headYaw=0.15, tailWave=0.4, legs={'F': (0.2, 0.5)}),
            K('s', 1.0, None, spinePitch=0.25, neckPitch=0.35, tailWave=0.2),
            K('r', 0.5, None, spinePitch=0.05, neckPitch=0.05), shake=0.025, shakeIn='strike'),
             sounds=[(6, 'hiss'), (40, 'galdros_rumble'), (70, 'hiss')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 90, 20, 50, A(
            K('w', 1.0, None, spineYaw=0.3, neckYaw=-0.3, neckPitch=0.25, z=0.02),
            K('s', 0.5, None, spineYaw=-0.3, neckYaw=0.3, neckPitch=0.2),
            K('s', 1.0, None, spineYaw=0.2, neckYaw=-0.2, neckPitch=0.15),
            K('r', 0.5, None, spineYaw=0.0), und=0.6),
             curve=(-4.0, 18, 54), sounds=[(18, 'hiss')], ai=ai(0, 3.4, 180, 0.8, cd=520)),
        *lr(lambda sd, n: move(f'body_sweep_{n}', 100, 40, 54, A(
            K('w', 0.7, None, spineYaw=-0.55, neckYaw=-0.6, headYaw=-0.25, yaw=-0.1, tailYaw=0.3),
            K('w', 1.0, None, spineYaw=-0.6, neckYaw=-0.65, headYaw=-0.3, yaw=-0.12, tailYaw=0.35),
            K('s', 0.5, 'o', spineYaw=0.6, neckYaw=0.75, headYaw=0.3, yaw=0.3, tailYaw=-0.4, roll=-0.06),
            K('s', 1.0, None, spineYaw=0.7, neckYaw=0.85, headYaw=0.35, yaw=0.35, tailYaw=-0.45),
            K('r', 0.4, None, spineYaw=0.45, neckYaw=0.5, yaw=0.2, tailYaw=-0.25),
            K('r', 0.8, None, spineYaw=0.05)),
            side=sd, bind=[front(f'razmer_body_sweep_{n}')],
            hits=[hit('body', 40, 54, f'razmer_body_sweep_{n}', 26, 'knockdown', cost=40)],
            sounds=[(4, 'hiss'), (38, 'galdros_swing')], ai=ai(0, 4.5, 110, 2.5, side=side_name(sd)))),
        move('crawl_charge', 120, 40, 84, A(
            K('w', 0.7, None, yH=-0.12, neckPitch=-0.1, legs={'*': (-0.4, 0.4)}),
            K('w', 1.0, None, yH=-0.14, neckPitch=-0.12, headPitch=0.1, legs={'*': (-0.5, 0.45)}),
            K('s', 0.1, None, yH=-0.1, neckPitch=-0.1, legs={'*': (-0.5, 0.3)}),
            K('s', 0.9, None, yH=-0.1, neckPitch=-0.1, legs={'*': (-0.5, 0.3)}),
            K('r', 0.3, None, yH=-0.05, neckPitch=0.15, legs={'F': (0.3, 0.2)}),
            K('r', 0.7, None, yH=-0.01), und=1),
             curve=(13.0, 40, 84), bind=[head('razmer_crawl_charge')],
             hits=[hit('head', 40, 84, 'razmer_crawl_charge', 28, 'knockdown', cost=45)],
             sounds=[(4, 'hiss'), (40, 'galdros_charge')], ai=ai(6, 16.7, 25, 2, cd=480, clear=14)),
        move('ring_slam', 100, 46, 54, A(
            K('w', 0.6, None, spinePitch=0.4, neckPitch=0.25, legs={'F': (0.3, 0.8)}),
            K('w', 1.0, None, spinePitch=0.5, neckPitch=0.3, headPitch=0.1, legs={'F': (0.3, 0.9)}),
            K('s', 0.5, 'i', spinePitch=-0.2, neckPitch=-0.3, yH=-0.05, legs={'F': (0.2, 0.0)}),
            K('s', 1.0, None, spinePitch=-0.2, neckPitch=-0.3, yH=-0.05, legs={'F': (0.2, 0.0)}),
            K('r', 0.4, None, spinePitch=-0.12, neckPitch=-0.2),
            K('r', 0.8, None, spinePitch=-0.02)), turn=(30, 50), slamTrack='razmer_ring_slam',
             bind=[B('razmer_ring_slam', 'sp:6', 'sp:8', 0.9)],
             hits=[hit('ring', 46, 54, 'razmer_ring_slam', 30, 'knockdown', cost=45)],
             sounds=[(4, 'galdros_warn'), (44, 'galdros_swing')], vfx=[(52, 'ground_slam')], ai=ai(0, 3.7, 35, 2.5)),
        *lr(lambda sd, n: move(f'tail_wrap_{n}', 100, 40, 54, A(
            K('w', 1.0, None, yaw=-0.15, spineYaw=0.15, neckYaw=0.4, tailYaw=-0.6, tailCurl=0.1),
            K('s', 0.5, 'o', yaw=0.3, spineYaw=-0.1, neckYaw=0.3, tailYaw=1.3, tailCurl=0.5),
            K('s', 1.0, None, yaw=0.35, neckYaw=0.25, tailYaw=1.5, tailCurl=0.6),
            K('r', 0.4, None, yaw=0.2, tailYaw=0.7, tailCurl=0.3),
            K('r', 0.8, None, tailYaw=0.08)),
            side=sd, bind=[tail(f'razmer_tail_wrap_{n}')],
            hits=[hit('tail', 40, 54, f'razmer_tail_wrap_{n}', 24, 'knockdown', cost=35)],
            sounds=[(4, 'hiss'), (38, 'galdros_swing')], ai=ai(0, 4.7, 180, 2.5, minA=70, side=side_name(sd)))),
        move('bite', 80, 32, 38, A(
            K('w', 1.0, None, z=-0.05, neckPitch=0.45, headPitch=0.25, spinePitch=0.1),
            K('s', 0.5, 'o', z=0.12, neckPitch=-0.25, headPitch=-0.15, spinePitch=-0.05),
            K('s', 1.0, None, z=0.12, neckPitch=-0.25, headPitch=-0.15),
            K('r', 0.4, None, z=0.06, neckPitch=-0.1),
            K('r', 0.8, None, z=0.0)),
             curve=(1.2, 30, 38), turn=(26, 80), bind=[head('razmer_bite')],
             hits=[hit('jaws', 32, 38, 'razmer_bite', 22, 'knockdown', kind='cut', cost=30)],
             sounds=[(4, 'hiss'), (30, 'galdros_swing')], ai=ai(0, 6, 30, 2.5)),
        move('double_bite', 120, 32, 74, A(
            K('w', 1.0, None, z=-0.05, neckPitch=0.45, headPitch=0.25),
            K('s', 0.12, 'o', z=0.12, neckPitch=-0.25, headPitch=-0.15),
            K('s', 0.45, None, z=0.0, neckPitch=0.4, headPitch=0.25, neckYaw=0.15),
            K('s', 0.85, 'o', z=0.14, neckPitch=-0.3, headPitch=-0.2),
            K('s', 1.0, None, z=0.14, neckPitch=-0.3, headPitch=-0.2),
            K('r', 0.4, None, z=0.06, neckPitch=-0.1),
            K('r', 0.8, None, z=0.0)),
             curve=(2.0, 30, 72), turn=(30, 80), bind=[head('razmer_double_bite')],
             hits=[hit('bite1', 32, 38, 'razmer_double_bite', 16, 'flinch', kind='cut', cost=20), hit('bite2', 66, 72, 'razmer_double_bite', 22, 'knockdown', kind='cut', cost=30)],
             sounds=[(4, 'hiss'), (30, 'galdros_swing'), (64, 'galdros_swing')], ai=ai(0, 6.5, 30, 1.8, cd=300)),
        move('tail_slam', 110, 48, 56, A(
            K('w', 0.6, None, tailPitch=0.8, tailCurl=0.3, neckYaw=0.3),
            K('w', 1.0, None, tailPitch=1.1, tailCurl=0.4, neckYaw=0.35),
            K('s', 0.5, 'i', tailPitch=-0.5, tailCurl=-0.1),
            K('s', 1.0, None, tailPitch=-0.5, tailCurl=-0.1),
            K('r', 0.4, None, tailPitch=-0.3),
            K('r', 0.8, None, tailPitch=-0.05)),
             slamTrack='razmer_tail_slam', bind=[tail('razmer_tail_slam')],
             hits=[hit('tail', 48, 56, 'razmer_tail_slam', 28, 'knockdown', cost=40)],
             sounds=[(4, 'hiss'), (46, 'galdros_swing')], vfx=[(54, 'ground_slam')], ai=ai(0, 5.1, 180, 2.2, minA=135)),
        move('coil_spin', 130, 50, 72, A(
            K('w', 1.0, None, spineYaw=-0.5, neckYaw=-0.5, tailYaw=0.6, yaw=-0.3),
            K('s', 0.5, None, spineYaw=0.4, neckYaw=0.4, tailYaw=-0.4),
            K('s', 1.0, None, spineYaw=0.3, neckYaw=0.3, tailYaw=-0.3),
            K('r', 0.4, None, spineYaw=0.15), spin=1),
             bind=[front('razmer_coil_spin_a'), tail('razmer_coil_spin_b')],
             hits=[hit('front', 50, 72, 'razmer_coil_spin_a', 20, 'knockdown', cost=30), hit('tail', 50, 72, 'razmer_coil_spin_b', 20, 'knockdown', cost=30)],
             sounds=[(4, 'hiss'), (48, 'galdros_swing'), (60, 'galdros_swing')], ai=ai(0, 5, 180, 1.4, cd=480)),
        move('quake', 140, 60, 70, A(
            K('w', 0.5, None, yH=-0.08, spinePitch=-0.1, neckPitch=-0.2),
            K('w', 1.0, None, yH=-0.12, spinePitch=-0.15, neckPitch=-0.3, tailWave=0.3),
            K('s', 0.3, 'o', yH=-0.15, spinePitch=-0.15, neckPitch=-0.35, tailWave=0.5),
            K('s', 1.0, None, yH=-0.12, neckPitch=-0.3, tailWave=0.3),
            K('r', 0.5, None, yH=-0.03), shake=0.04, shakeIn='all'),
             tracks=[track('razmer_quake', 3.4, 4.0, [(60, [0, 0.3, -2.0], [0, 0, 1])])],
             hits=[hit('quake', 60, 70, 'razmer_quake', 14, 'flinch', cost=25)],
             sounds=[(4, 'galdros_rumble'), (58, 'rock_impact')], vfx=[(60, 'quake_ring')], ai=ai(0, 5, 180, 1.2, cd=600)),
        move('head_slam', 110, 48, 54, A(
            K('w', 0.6, None, spinePitch=0.35, neckPitch=0.6, headPitch=0.3),
            K('w', 1.0, None, spinePitch=0.4, neckPitch=0.7, headPitch=0.35, yH=0.04),
            K('s', 0.5, 'i', spinePitch=-0.1, neckPitch=-0.55, headPitch=-0.35, yH=-0.04),
            K('s', 1.0, None, spinePitch=-0.1, neckPitch=-0.55, headPitch=-0.35, yH=-0.04),
            K('r', 0.4, None, neckPitch=-0.4, headPitch=-0.25),
            K('r', 0.8, None, neckPitch=-0.05)), turn=(36, 50), slamTrack='razmer_head_slam',
             bind=[head('razmer_head_slam')],
             hits=[hit('head', 48, 54, 'razmer_head_slam', 28, 'knockdown', cost=40)],
             sounds=[(4, 'hiss'), (46, 'galdros_swing')], vfx=[(52, 'ground_slam')], ai=ai(2, 4.8, 30, 2)),
        *lr(lambda sd, n: move(f'side_roll_{n}', 120, 48, 64, A(
            K('w', 0.6, None, roll=0.2, yH=-0.04, neckYaw=-0.3, legs={'*.S': (0, 0.4)}),
            K('w', 1.0, None, roll=0.25, yH=-0.05, neckYaw=-0.3),
            K('s', 0.5, 'i', roll=-1.0, yH=-0.15, x=0.15, neckYaw=0.2, legs={'*.O': (0, 0.6, 0.4)}),
            K('s', 1.0, None, roll=-1.05, yH=-0.16, x=0.18, legs={'*.O': (0, 0.6, 0.4)}),
            K('r', 0.4, None, roll=-0.6, yH=-0.1, x=0.1),
            K('r', 0.8, None, roll=-0.1)),
            side=sd, curve=(1.6, 46, 64), dirDeg=90 * sd,
            bind=[B(f'razmer_side_roll_{n}', 'leg:F:S:0', 'leg:H:S:0', 1.0)],
            hits=[hit('body', 50, 64, f'razmer_side_roll_{n}', 24, 'knockdown', cost=35)],
            sounds=[(4, 'hiss'), (48, 'galdros_rumble')], vfx=[(58, 'dust_ring')], ai=ai(0, 3.6, 130, 1.6, minA=40, side=side_name(sd), cd=300))),
        move('lunge_sweep', 130, 36, 78, A(
            K('w', 1.0, None, z=-0.05, neckPitch=0.4, headPitch=0.2, spineYaw=-0.2),
            K('s', 0.12, 'o', z=0.12, neckPitch=-0.25, headPitch=-0.15),
            K('s', 0.4, None, z=0.1, spineYaw=-0.5, neckYaw=-0.6, neckPitch=-0.25),
            K('s', 0.85, 'o', z=0.05, spineYaw=0.6, neckYaw=0.75, yaw=0.3, neckPitch=-0.3),
            K('s', 1.0, None, spineYaw=0.65, neckYaw=0.8, yaw=0.32, neckPitch=-0.3),
            K('r', 0.4, None, spineYaw=0.4, neckYaw=0.45, yaw=0.2),
            K('r', 0.8, None, spineYaw=0.05)),
             curve=(1.4, 34, 44), turn=(30, 70), bind=[head('razmer_lunge_sweep_a'), front('razmer_lunge_sweep_b')],
             hits=[hit('bite', 36, 42, 'razmer_lunge_sweep_a', 18, 'flinch', kind='cut', cost=25), hit('sweep', 62, 78, 'razmer_lunge_sweep_b', 24, 'knockdown', cost=35)],
             sounds=[(4, 'hiss'), (34, 'galdros_swing'), (60, 'galdros_swing')], ai=ai(0, 6, 40, 1.6, cd=360)),
    ]


RAZMER_IDLE = idle(
    unaware=dict(neckPitch=-0.3, headPitch=-0.2, yH=-0.03), sway=0.35, nod=0.08, rate=0.5,
    alert=dict(neckPitch=0.2, spinePitch=0.08),
    weak=dict(yH=-0.06, neckPitch=-0.25, headPitch=-0.15, tailPitch=-0.1),
    rage=dict(neckPitch=0.25, spinePitch=0.12, tailWave=0.1),
    run=dict(yH=-0.04, neckPitch=-0.05),
    sleep=dict(yH=-0.12, spineYaw=0.6, neckYaw=0.8, neckPitch=-0.25, headPitch=-0.15, tailYaw=0.7, legs={'*': (0, 0.9, 0.2)}),
    flinch=dict(neckPitch=0.35, headPitch=0.2, spinePitch=0.12),
    topple=dict(roll=1.5, yH=-0.15, neckPitch=-0.1, legs={'*': (0.2, 0.5, 0.4)}),
    rise=dict(roll=0.0, neckPitch=0.2, spinePitch=0.1),
    dead=[(15, dict(yH=-0.08, neckPitch=-0.3, spinePitch=-0.1)),
          (50, dict(roll=1.4, yH=-0.15, neckPitch=-0.4, headPitch=-0.2, spinePitch=0.3, tailPitch=-0.4, legs={'*': (0.2, 0.5, 0.4)})),
          (110, dict(roll=1.5, yH=-0.17, neckPitch=-0.45, headPitch=-0.25, spinePitch=0.35, tailPitch=-0.45, legs={'*': (0.25, 0.5, 0.45)}))],
    fidgets=[
        F('tongue_test', 1.2, 'any', K('w', 0.3, None, neckPitch=0.15, z=0.02), K('w', 0.5, None, neckPitch=0.05), K('w', 0.7, None, neckPitch=0.15, z=0.02)),
        F('ring_rattle', 1.0, 'aware', K('w', 0.5, None, tailWave=0.5), shake=0.03),
        F('ring_press', 2.4, 'calm', K('w', 0.4, None, yH=-0.06, spineYaw=0.3, neckYaw=0.2), K('w', 0.8, None, yH=-0.05, spineYaw=0.3, neckYaw=0.25)),
        F('look_back', 2.0, 'any', K('w', 0.35, None, neckYaw=0.9, headYaw=0.4, spineYaw=0.2), K('w', 0.75, None, neckYaw=0.95, headYaw=0.4, spineYaw=0.2)),
        F('tail_curl', 1.8, 'any', K('w', 0.4, None, tailYaw=0.6, tailCurl=0.4), K('w', 0.8, None, tailYaw=0.3, tailCurl=0.2)),
    ])


# =============================================================================================
# 11 氷帆蛇 キリサーヴ（長胴獣。氷）: 脚の無い長い体と、背の 8 枚の氷帆（sail0〜7。sail を seq で前から順に立てる）。腹で滑る
#   体: 根元 z -0.28 / 高さ 0.52（低い）、頭 z 3.90 y 1.38（sp:10）、口先 z 4.37（sp:11）、首 sp:8〜9、尾の先 z -5.06（sp:0）。
# =============================================================================================


def kirisave_moves(s):
    head = lambda n: B(n, 'sp:9', 'sp:11', 0.45, ext=0.2)
    rear = lambda n: B(n, 'sp:4', 'sp:1', 0.6)
    tail = lambda n: B(n, 'sp:2', 'sp:0', 0.5, ext=0.25)
    return [
        move('roar', 100, 100, 100, A(
            K('w', 0.6, None, neckPitch=-0.15, sail=0.4),
            K('w', 1.0, None, spinePitch=0.25, neckPitch=0.4, headPitch=0.25, sail=1.0, fin=0.5),
            K('s', 0.4, 'o', spinePitch=0.35, neckPitch=0.55, headPitch=0.4, sail=1.3, tailWave=0.2, fin=0.85),
            K('r', 0.5, None, spinePitch=0.32, neckPitch=0.5, headPitch=0.35, sail=1.2, tailWave=0.2, fin=0.75),
            K('r', 0.85, None, spinePitch=0.05, neckPitch=0.05, sail=0.2, fin=0.1), seq=True, shake=0.025),
             sounds=[(10, 'hiss'), (40, 'ice_crack')]),
        move('threat', 120, 36, 90, A(
            K('w', 1.0, None, spinePitch=0.15, neckPitch=0.3, sail=1.2, fin=0.6),
            K('s', 0.3, None, spinePitch=0.15, neckPitch=0.3, neckYaw=0.25, sail=1.3, tailWave=0.2, fin=0.7),
            K('s', 0.6, None, spinePitch=0.15, neckPitch=0.3, neckYaw=-0.25, sail=1.2, tailWave=0.2, fin=0.7),
            K('s', 1.0, None, spinePitch=0.1, neckPitch=0.2, sail=1.0, fin=0.5),
            K('r', 0.5, None, sail=0.2), seq=True),
             sounds=[(6, 'hiss'), (30, 'ice_crack'), (60, 'ice_crack')], ai=ai(5, 15, 60, 0.7, cd=700)),
        move('retreat', 90, 20, 52, A(
            K('w', 1.0, None, neckPitch=0.2, spineYaw=0.2, sail=0.3),
            K('s', 0.5, None, neckPitch=0.15, spineYaw=-0.2, sail=0.3),
            K('s', 1.0, None, neckPitch=0.1, spineYaw=0.1),
            K('r', 0.5, None, spineYaw=0.0), und=0.6, paddle=0.7),
             curve=(-4.5, 18, 56), sounds=[(18, 'hiss')], ai=ai(0, 3.4, 180, 0.8, cd=520)),
        move('ice_row', 120, 58, 62, A(
            K('w', 0.5, None, neckPitch=0.2, sail=0.8),
            K('w', 1.0, None, neckPitch=0.25, headPitch=0.1, sail=1.3),
            K('s', 0.5, 'o', neckPitch=-0.15, headPitch=-0.1, sail=1.0),
            K('s', 1.0, None, neckPitch=-0.15, headPitch=-0.1, sail=0.9),
            K('r', 0.4, None, sail=0.6),
            K('r', 0.8, None, sail=0.1), seq=True), turn=(40, 60),
             hazards=[hazard(58, 6, 0.5, 1.1, 32, 8, 18, 'flinch', [0, 1.6, 2.0], 'ice', peak=2.5, pattern='line')],
             sounds=[(6, 'ice_crack'), (56, 'ice_crack')], ai=ai(5, 18, 45, 2.5, cd=360)),
        move('slide', 110, 40, 70, A(
            K('w', 0.7, None, yH=-0.2, neckPitch=-0.2, sail=-0.3, fin=-0.5),
            K('w', 1.0, None, yH=-0.25, neckPitch=-0.25, headPitch=0.1, sail=-0.4, fin=-0.9),
            K('s', 0.1, 'o', yH=-0.3, neckPitch=-0.15, sail=-0.4, fin=-1.0),
            K('s', 0.9, None, yH=-0.3, neckPitch=-0.15, sail=-0.4, fin=-1.0),
            K('r', 0.3, None, yH=-0.15, neckPitch=0.1, sail=0.0, fin=-0.3),
            K('r', 0.7, None, yH=-0.02), wiggle=0.08),
             curve=(9.0, 40, 70), bind=[B('kirisave_slide', 'sp:8', 'sp:11', 0.6, ext=0.2)],
             hits=[hit('head', 40, 70, 'kirisave_slide', 24, 'knockdown', cost=35)],
             sounds=[(4, 'hiss'), (40, 'galdros_charge')], ai=ai(2.5, 13.7, 25, 2.5, cd=300, clear=10)),
        *lr(lambda sd, n: move(f'body_sweep_{n}', 90, 36, 48, A(
            K('w', 1.0, None, spineYaw=0.4, tailYaw=-0.5, roll=0.1, sail=0.6),
            K('s', 0.5, 'o', spineYaw=-0.35, tailYaw=0.9, roll=-0.15, sail=0.6),
            K('s', 1.0, None, spineYaw=-0.4, tailYaw=1.0, roll=-0.15, sail=0.5),
            K('r', 0.4, None, spineYaw=-0.2, tailYaw=0.5, sail=0.3),
            K('r', 0.8, None, tailYaw=0.05)),
            side=sd, bind=[rear(f'kirisave_body_sweep_{n}')],
            hits=[hit('body', 36, 48, f'kirisave_body_sweep_{n}', 20, 'flinch', cost=30)],
            sounds=[(4, 'ice_crack'), (34, 'galdros_swing')], ai=ai(0, 5, 140, 2.5, minA=40, side=side_name(sd)))),
        move('tail_slam', 110, 50, 58, A(
            K('w', 0.5, None, tailPitch=0.6, tailCurl=0.6, neckYaw=0.3),
            K('w', 1.0, None, tailPitch=1.0, tailCurl=0.9, neckYaw=0.35),
            K('s', 0.5, 'i', tailPitch=-0.4, tailCurl=-0.2),
            K('s', 1.0, None, tailPitch=-0.4, tailCurl=-0.2),
            K('r', 0.4, None, tailPitch=-0.25),
            K('r', 0.8, None, tailPitch=-0.03)),
             slamTrack='kirisave_tail_slam', bind=[tail('kirisave_tail_slam')],
             hits=[hit('tail', 50, 58, 'kirisave_tail_slam', 28, 'knockdown', cost=40)],
             sounds=[(4, 'hiss'), (48, 'galdros_swing')], vfx=[(56, 'ground_slam')], ai=ai(0, 5.7, 180, 2.5, minA=120)),
        move('bite', 80, 32, 38, A(
            K('w', 1.0, None, z=-0.1, neckPitch=0.4, headPitch=0.2),
            K('s', 0.5, 'o', z=0.2, neckPitch=-0.2, headPitch=-0.15),
            K('s', 1.0, None, z=0.2, neckPitch=-0.2, headPitch=-0.15),
            K('r', 0.4, None, z=0.1, neckPitch=-0.1),
            K('r', 0.8, None, z=0.0)),
             curve=(1.2, 30, 38), turn=(26, 80), bind=[head('kirisave_bite')],
             hits=[hit('jaws', 32, 38, 'kirisave_bite', 20, 'knockdown', kind='cut', cost=30)],
             sounds=[(4, 'hiss'), (30, 'galdros_swing')], ai=ai(0, 6, 30, 2.5)),
        move('frost_breath', 130, 56, 76, A(
            K('w', 0.6, None, neckPitch=0.3, headPitch=0.2, sail=0.6),
            K('w', 1.0, None, neckPitch=0.35, headPitch=0.25, z=-0.06, sail=0.9),
            K('s', 0.2, 'o', neckPitch=-0.1, headPitch=-0.1, z=0.02, sail=1.0),
            K('s', 1.0, None, neckPitch=-0.12, headPitch=-0.12, neckYaw=0.15, sail=0.9),
            K('r', 0.4, None, neckPitch=-0.05, sail=0.4),
            K('r', 0.8, None, sail=0.1), seq=True), turn=(50, 50),
             tracks=[track('kirisave_frost_breath', 1.3, 5.4, [(56, [0, 1.2, 4.0], [0, -0.15, 1]), (76, [0, 1.1, 4.0], [0, -0.18, 1])])],
             hits=[hit('frost', 56, 76, 'kirisave_frost_breath', 18, 'knockdown', cost=30)],
             sounds=[(4, 'hiss'), (54, 'ice_crack'), (64, 'gust')], vfx=[(56, 'frost_breath'), (66, 'frost_breath')], ai=ai(3, 10.5, 30, 1.8, cd=420)),
        *lr(lambda sd, n: move(f'sail_slash_{n}', 100, 40, 52, A(
            K('w', 1.0, None, roll=0.2, twist=0.15, spineYaw=-0.2, sail=1.2),
            K('s', 0.5, 'o', roll=-0.5, twist=-0.3, spineYaw=0.3, x=0.08, sail=1.3),
            K('s', 1.0, None, roll=-0.55, twist=-0.3, spineYaw=0.35, x=0.1, sail=1.2),
            K('r', 0.4, None, roll=-0.3, twist=-0.15, sail=0.6),
            K('r', 0.8, None, roll=-0.03, sail=0.1)),
            side=sd, bind=[B(f'kirisave_sail_slash_{n}', 'own:sail1:C', 'own:sail6:C', 1.0)],
            hits=[hit('sails', 40, 52, f'kirisave_sail_slash_{n}', 22, 'knockdown', kind='cut', cost=35)],
            sounds=[(4, 'ice_crack'), (38, 'galdros_swing')], ai=ai(0, 4.2, 120, 2, minA=30, side=side_name(sd)))),
        move('ice_ring', 140, 62, 76, A(
            K('w', 0.5, None, yH=-0.1, sail=1.0),
            K('w', 1.0, None, yH=-0.12, sail=1.4),
            K('s', 0.2, 'o', yH=0.05, sail=-0.2),
            K('s', 1.0, None, sail=-0.1),
            K('r', 0.5, None, sail=0.0), seq=True, shake=0.03, shakeIn='windup'),
             tracks=[track('kirisave_ice_ring', 3.0, 5.0, [(62, [0, 0.6, -2.4], [0, 0, 1])])],
             hits=[hit('ice', 62, 76, 'kirisave_ice_ring', 16, 'knockdown', cost=30)],
             sounds=[(4, 'ice_crack'), (60, 'ice_crack')], vfx=[(62, 'ice_ring')], ai=ai(0, 4.5, 180, 1.2, cd=600)),
        move('coil_slam', 120, 52, 58, A(
            K('w', 0.6, None, spinePitch=0.5, neckPitch=0.4, sail=0.6),
            K('w', 1.0, None, spinePitch=0.65, neckPitch=0.5, headPitch=0.2, yH=0.1, sail=0.8),
            K('s', 0.5, 'i', spinePitch=-0.15, neckPitch=-0.4, headPitch=-0.2, yH=-0.05, sail=0.4),
            K('s', 1.0, None, spinePitch=-0.15, neckPitch=-0.4, headPitch=-0.2, yH=-0.05, sail=0.4),
            K('r', 0.4, None, spinePitch=-0.1, neckPitch=-0.3),
            K('r', 0.8, None, neckPitch=-0.03, sail=0.1)), turn=(40, 50), slamTrack='kirisave_coil_slam',
             bind=[B('kirisave_coil_slam', 'sp:7', 'sp:11', 0.8, ext=0.1)],
             hits=[hit('body', 52, 58, 'kirisave_coil_slam', 28, 'knockdown', cost=40)],
             sounds=[(4, 'hiss'), (50, 'galdros_swing')], vfx=[(56, 'ground_slam')], ai=ai(0, 5.4, 35, 2.2)),
        *lr(lambda sd, n: move(f'tail_whip_{n}', 90, 34, 46, A(
            K('w', 1.0, None, yaw=-0.12, tailYaw=-0.7, neckYaw=0.3),
            K('s', 0.5, 'o', yaw=0.25, tailYaw=1.2, tailCurl=0.3),
            K('s', 1.0, None, yaw=0.3, tailYaw=1.4, tailCurl=0.35),
            K('r', 0.4, None, yaw=0.15, tailYaw=0.6),
            K('r', 0.8, None, tailYaw=0.05)),
            side=sd, bind=[tail(f'kirisave_tail_whip_{n}')],
            hits=[hit('tail', 34, 46, f'kirisave_tail_whip_{n}', 18, 'flinch', cost=25)],
            sounds=[(32, 'galdros_swing')], ai=ai(0, 5.8, 180, 2, minA=100, side=side_name(sd)))),
        move('ice_burst', 140, 60, 66, A(
            K('w', 0.5, None, neckPitch=0.3, sail=0.9, fin=0.3),
            K('w', 1.0, None, neckPitch=0.35, headPitch=0.2, sail=1.3, fin=0.7),
            K('s', 0.4, 'o', neckPitch=-0.2, sail=0.4, fin=0.9),
            K('s', 1.0, None, neckPitch=-0.2, sail=0.3),
            K('r', 0.5, None, sail=0.0), seq=True),
             hazards=[hazard(62, 5, 3.6, 1.3, 48, 8, 16, 'flinch', [0, 1.5, 0.0], 'ice', peak=5)],
             sounds=[(4, 'ice_crack'), (60, 'ice_crack')], ai=ai(6, 18, 90, 1.4, cd=480)),
        move('slide_long', 140, 46, 100, A(
            K('w', 0.7, None, yH=-0.2, neckPitch=-0.2, sail=-0.3, fin=-0.5),
            K('w', 1.0, None, yH=-0.25, neckPitch=-0.25, headPitch=0.1, sail=-0.4, fin=-0.9),
            K('s', 0.1, 'o', yH=-0.3, neckPitch=-0.15, sail=-0.4, fin=-1.0),
            K('s', 0.92, None, yH=-0.3, neckPitch=-0.15, sail=-0.4, fin=-1.0),
            K('r', 0.3, None, yH=-0.15, neckPitch=0.1, sail=0.0, fin=-0.3),
            K('r', 0.7, None, yH=-0.02), wiggle=0.1),
             curve=(15.0, 46, 100), turn=(40, 50), bind=[B('kirisave_slide_long', 'sp:7', 'sp:11', 0.65, ext=0.2)],
             hits=[hit('body', 46, 100, 'kirisave_slide_long', 26, 'knockdown', cost=40)],
             sounds=[(4, 'hiss'), (46, 'galdros_charge')], ai=ai(8, 19.5, 25, 1.5, cd=520, clear=14)),
    ]


KIRISAVE_IDLE = idle(
    unaware=dict(neckPitch=-0.35, headPitch=-0.2), sway=0.4, nod=0.1, rate=0.45,
    alert=dict(neckPitch=0.2, sail=0.35, fin=0.25),
    weak=dict(neckPitch=-0.25, headPitch=-0.15, sail=-0.3, fin=-0.2),
    rage=dict(neckPitch=0.2, sail=0.6, fin=0.45),
    run=dict(neckPitch=-0.1, sail=-0.3, fin=-0.4),
    sleep=dict(spineYaw=0.6, neckYaw=0.7, neckPitch=-0.3, tailYaw=0.6, sail=-0.6, fin=-0.7),
    flinch=dict(neckPitch=0.35, headPitch=0.2, spinePitch=0.1, sail=0.6, fin=0.6),
    topple=dict(roll=1.6, neckPitch=-0.1, sail=0.3, fin=0.6),
    rise=dict(roll=0.0, neckPitch=0.2),
    dead=[(15, dict(neckPitch=-0.3, spinePitch=-0.1, sail=0.3)),
          (50, dict(roll=1.4, neckPitch=-0.4, headPitch=-0.2, spinePitch=0.3, tailPitch=-0.4, sail=-0.3)),
          (110, dict(roll=1.5, neckPitch=-0.45, headPitch=-0.25, spinePitch=0.35, tailPitch=-0.45, sail=-0.5, fin=0.4))],
    fidgets=[
        F('sail_ripple', 1.8, 'any', K('w', 0.4, None, sail=0.8), K('w', 0.8, None, sail=0.1)),
        F('lick_rock', 2.2, 'calm', K('w', 0.3, 'i', neckPitch=-0.55, headPitch=-0.3), K('w', 0.5, None, neckPitch=-0.45),
          K('w', 0.7, 'i', neckPitch=-0.55, headPitch=-0.3)),
        F('look_back', 2.0, 'any', K('w', 0.35, None, neckYaw=0.8, spineYaw=0.3), K('w', 0.75, None, neckYaw=0.85, spineYaw=0.3)),
        F('tail_flick', 1.0, 'any', K('w', 0.3, None, tailYaw=0.5, tailCurl=0.3), K('w', 0.7, None, tailYaw=-0.3)),
        F('frost_shiver', 0.9, 'aware', K('w', 0.5, None, sail=0.5), shake=0.03),
    ])


# =============================================================================================
# 12 霧灯獣 ヴェルガイト（四足軽獣。霧）: 頭の環冠（crown）と背の灯節（glow）。遅れて弾ける霧の球。長い尾は上へ巻いている
#   体: 根元 z 0 / 高さ 2.00、頭 z 1.78 y 2.77（sp:12）、口先 z 2.05（sp:13）、前脚 z 1.08、後脚 z -1.08、尾は sp:1〜6（巻いた先は sp:2〜3 の z -3.2 付近）。
#   印: tip:crown:C = 環冠の中心（頭の上）。
# =============================================================================================


def velgait_moves(s):
    crown = lambda n: B(n, 'sp:13', 'tip:crown:C', 0.65)
    head = lambda n: B(n, 'sp:11', 'sp:13', 0.5, ext=0.2)
    tail = lambda n: B(n, 'sp:5', 'sp:2', 0.45, ext=0.2)
    crown_pos = s.m(1258, 125)
    return [
        move('roar', 90, 90, 90, A(
            K('w', 0.6, None, yH=-0.04, neckPitch=-0.25, headPitch=-0.15, crown=-0.3, glow=0.4),
            K('w', 1.0, None, pitch=0.1, neckPitch=0.3, headPitch=0.25, crown=0.6, glow=1.0, tailPitch=0.2),
            K('s', 0.4, 'o', pitch=0.15, yH=0.04, neckPitch=0.45, headPitch=0.4, crown=1.0, glow=1.8, tailPitch=0.4, legs={'F': (-0.1, 0.25)}),
            K('r', 0.55, None, pitch=0.13, neckPitch=0.42, headPitch=0.36, crown=0.9, glow=1.6, tailPitch=0.35),
            K('r', 0.85, None, neckPitch=0.08, crown=0.2, glow=0.4), shake=0.03), sounds=[(8, 'beast_cry'), (30, 'mist_pop')]),
        move('threat', 110, 28, 82, A(
            K('w', 1.0, None, neckPitch=-0.1, headPitch=-0.3, crown=0.8, glow=1.0),
            K('s', 0.3, None, neckPitch=-0.12, headPitch=-0.35, headRoll=0.15, crown=1.0, glow=2.0),
            K('s', 0.6, None, neckPitch=-0.12, headPitch=-0.35, headRoll=-0.15, crown=1.0, glow=1.0),
            K('s', 1.0, None, neckPitch=-0.1, headPitch=-0.3, crown=0.9, glow=2.0, legs={'F.S': (0.2, 0.5)}),
            K('r', 0.35, 'i', crown=0.5, glow=0.8, legs={'F.S': (0.1, 0.0)}),
            K('r', 0.8, None, glow=0.2)),
             sounds=[(6, 'beast_cry'), (40, 'mist_pop'), (82, 'galdros_step')], ai=ai(5, 14, 60, 0.7, cd=700)),
        move('retreat', 80, 18, 38, A(
            K('w', 1.0, None, yH=-0.14, pitch=-0.05, legs={'*': (0, 0.55)}),
            K('s', 0.4, 'o', pitch=0.2, neckPitch=0.2, crown=0.3, legs={'F': (0.6, 0.8), 'H': (-0.4, 0.3)}),
            K('s', 1.0, None, pitch=0.1, legs={'*': (0, 0.8)}),
            K('r', 0.25, 'i', yH=-0.1, pitch=-0.04, legs={'*': (0, 0.4)}),
            K('r', 0.7, None, yH=-0.02), hop=0.25),
             curve=(-4.5, 16, 42), sounds=[(16, 'gust')], ai=ai(0, 3.0, 180, 0.8, cd=520)),
        move('mist_ball', 110, 50, 54, A(
            K('w', 0.4, None, pitch=0.06, neckPitch=0.15, headPitch=-0.05, crown=0.5, glow=0.8, legs={'H': (0, 0.25)}),
            K('w', 1.0, 'i', pitch=0.16, yH=0.03, neckPitch=0.4, headPitch=0.1, headRoll=0.12, crown=1.0, glow=2.0, legs={'F': (0.25, 0.3), 'H': (-0.1, 0.35)}),
            K('s', 0.5, 'o', pitch=-0.05, yH=-0.03, neckPitch=-0.15, headPitch=-0.35, crown=-0.3, glow=1.2, legs={'F': (0.35, 0.0)}),
            K('s', 1.0, None, pitch=-0.04, yH=-0.02, neckPitch=-0.12, headPitch=-0.35, crown=-0.3, glow=1.0, legs={'F': (0.3, 0.0)}),
            K('r', 0.4, None, crown=0.0, glow=0.6),
            K('r', 0.8, None, glow=0.2)), turn=(36, 70),
             hazards=[hazard(52, 2, 3.0, 2.4, 70, 10, 20, 'knockdown', crown_pos, 'mist', peak=2.5)],
             sounds=[(6, 'mist_pop'), (50, 'mist_pop')], ai=ai(5, 16, 45, 2.5, cd=300)),
        *lr(lambda sd, n: move(f'side_thrust_{n}', 85, 32, 42, A(
            K('w', 0.6, None, roll=-0.12, x=-0.03, yH=-0.08, neckYaw=0.2, legs={'F.S': (0, 0.5)}),
            K('w', 1.0, None, roll=-0.15, yH=-0.12, neckYaw=0.25, headYaw=0.15, crown=0.5, legs={'*': (0, 0.45)}),
            K('s', 0.4, 'o', roll=0.1, yaw=0.2, pitch=-0.15, yH=-0.06, neckYaw=0.5, headYaw=0.25, neckPitch=-1.05, headPitch=-0.45, crown=0.8, legs={'F': (0.2, 0.6)}),
            K('s', 1.0, None, roll=0.08, yaw=0.22, pitch=-0.15, yH=-0.06, neckYaw=0.55, headYaw=0.25, neckPitch=-1.05, headPitch=-0.45, crown=0.7),
            K('r', 0.3, 'i', yH=-0.08, neckYaw=0.3, legs={'*': (0, 0.35)}),
            K('r', 0.7, None, neckYaw=0.05), hop=0.22),
            side=sd, curve=(2.4, 28, 44), dirDeg=60 * sd, bind=[B(f'velgait_side_thrust_{n}', 'sp:13', 'tip:crown:C', 0.65)],
            hits=[hit('head', 32, 42, f'velgait_side_thrust_{n}', 20, 'flinch', kind='cut', cost=25)],
            sounds=[(4, 'galdros_warn'), (30, 'galdros_swing')], ai=ai(2, 4.9, 120, 2.5, minA=30, side=side_name(sd)))),
        move('stomp', 95, 42, 50, A(
            K('w', 0.5, None, pitch=0.35, yH=0.06, neckPitch=0.3, crown=0.4, legs={'F': (0.5, 0.9)}),
            K('w', 1.0, None, pitch=0.5, yH=0.1, neckPitch=0.4, crown=0.6, glow=0.8, legs={'F': (0.7, 1.0)}),
            K('s', 0.5, 'i', pitch=-0.06, yH=-0.08, neckPitch=-0.2, crown=0.3, legs={'F': (0.35, 0.0)}),
            K('s', 1.0, None, pitch=-0.08, yH=-0.1, neckPitch=-0.2, legs={'F': (0.35, 0.0)}),
            K('r', 0.35, None, pitch=-0.05, yH=-0.06, legs={'F': (0.3, 0.0)}),
            K('r', 0.75, None, yH=-0.01)), turn=(30, 70), slamTrack='velgait_stomp',
             bind=[B('velgait_stomp', 'leg:F:L:end', 'leg:F:R:end', 0.6)],
             hits=[hit('fore', 42, 50, 'velgait_stomp', 26, 'knockdown', cost=40)],
             sounds=[(4, 'beast_cry'), (40, 'galdros_swing')], vfx=[(48, 'ground_slam')], ai=ai(0, 3.7, 35, 3)),
        *lr(lambda sd, n: move(f'tail_sweep_{n}', 95, 38, 52, A(
            K('w', 1.0, None, yaw=-0.15, spineYaw=-0.1, neckYaw=0.35, tailYaw=-0.8, glow=0.6),
            K('s', 0.5, 'o', yaw=0.35, spineYaw=0.15, neckYaw=0.2, tailYaw=1.2, glow=0.8),
            K('s', 1.0, None, yaw=0.42, spineYaw=0.15, tailYaw=1.35),
            K('r', 0.4, None, yaw=0.2, tailYaw=0.6),
            K('r', 0.8, None, tailYaw=0.06)),
            side=sd, bind=[tail(f'velgait_tail_sweep_{n}')],
            hits=[hit('tail', 38, 52, f'velgait_tail_sweep_{n}', 20, 'knockdown', cost=30)],
            sounds=[(4, 'galdros_warn'), (36, 'galdros_swing')], ai=ai(0, 4, 180, 2.5, minA=60, side=side_name(sd)))),
        move('crown_ram', 120, 40, 78, A(
            K('w', 0.6, None, yH=-0.06, neckPitch=-0.35, headPitch=-0.3, crown=0.6, glow=1.0, legs={'F.S': (0.3, 0.6)}),
            K('w', 1.0, None, yH=-0.1, pitch=-0.12, neckPitch=-0.95, headPitch=-0.5, crown=0.8, glow=1.5),
            K('s', 0.1, 'o', yH=-0.06, pitch=-0.12, neckPitch=-0.95, headPitch=-0.5, crown=0.8, glow=1.5),
            K('s', 0.9, None, yH=-0.06, pitch=-0.12, neckPitch=-0.95, headPitch=-0.5, crown=0.8, glow=1.5),
            K('r', 0.3, None, pitch=0.15, neckPitch=0.1, crown=0.3, legs={'F': (0.5, 0.1)}),
            K('r', 0.7, None, pitch=0.02, glow=0.3)),
             curve=(8.0, 40, 78), turn=(34, 60), bind=[crown('velgait_crown_ram')],
             hits=[hit('crown', 40, 78, 'velgait_crown_ram', 24, 'knockdown', cost=35)],
             sounds=[(4, 'beast_cry'), (38, 'galdros_charge')], ai=ai(5, 10.2, 25, 1.8, cd=360, clear=8)),
        *lr(lambda sd, n: move(f'crown_swing_{n}', 96, 36, 48, A(
            K('w', 0.7, None, yaw=-0.2, spineYaw=-0.15, neckYaw=-0.55, headYaw=-0.25, neckPitch=-0.15, crown=0.6),
            K('w', 1.0, None, yaw=-0.22, spineYaw=-0.18, neckYaw=-0.6, headYaw=-0.3, neckPitch=-0.2, crown=0.7),
            K('s', 0.5, 'o', yaw=0.3, spineYaw=0.25, pitch=-0.15, yH=-0.05, neckYaw=0.75, headYaw=0.3, neckPitch=-1.05, headPitch=-0.45, roll=-0.08, crown=0.9, glow=1.0),
            K('s', 1.0, None, yaw=0.38, spineYaw=0.3, pitch=-0.15, yH=-0.05, neckYaw=0.85, headYaw=0.35, neckPitch=-1.05, headPitch=-0.45, crown=0.8),
            K('r', 0.4, None, yaw=0.2, neckYaw=0.5, neckPitch=-0.2, crown=0.4),
            K('r', 0.85, None, neckYaw=0.05)),
            side=sd, bind=[crown(f'velgait_crown_swing_{n}')],
            hits=[hit('crown', 36, 48, f'velgait_crown_swing_{n}', 20, 'knockdown', cost=30)],
            sounds=[(4, 'galdros_warn'), (34, 'galdros_swing')], ai=ai(0, 2.7, 110, 2.2, minA=25, side=side_name(sd)))),
        move('rear_kick', 96, 36, 44, A(
            K('w', 0.6, None, pitch=-0.12, yH=-0.05, neckPitch=-0.2, legs={'H': (0.25, 0.6)}),
            K('w', 1.0, None, pitch=-0.18, yH=-0.06, neckPitch=-0.25, headPitch=-0.15, legs={'H': (0.3, 0.7)}),
            K('s', 0.4, 'o', pitch=-0.32, yH=0.04, neckPitch=-0.3, legs={'H': (-1.1, 0.15), 'F': (-0.1, 0.0)}),
            K('s', 1.0, None, pitch=-0.3, yH=0.03, neckPitch=-0.28, legs={'H': (-1.15, 0.1), 'F': (-0.1, 0.0)}),
            K('r', 0.3, None, pitch=-0.05, legs={'H': (-0.2, 0.4)}),
            K('r', 0.7, None, pitch=0.0)),
             bind=[B('velgait_rear_kick', 'leg:H:L:end', 'leg:H:R:end', 0.5)],
             hits=[hit('hind', 36, 44, 'velgait_rear_kick', 22, 'knockdown', cost=30)],
             sounds=[(4, 'galdros_warn'), (34, 'galdros_swing')], ai=ai(0, 3.4, 180, 2.4, minA=120)),
        move('mist_burst', 130, 54, 60, A(
            K('w', 0.5, None, yH=-0.06, crown=0.6, glow=1.4, legs={'*': (0, 0.3)}),
            K('w', 1.0, None, yH=-0.08, crown=0.9, glow=2.2, legs={'*': (0, 0.35)}),
            K('s', 0.4, 'o', yH=0.03, neckPitch=0.3, crown=-0.2, glow=1.0),
            K('s', 1.0, None, neckPitch=0.25, crown=-0.1, glow=0.8),
            K('r', 0.5, None, glow=0.3), shake=0.03, shakeIn='windup'),
             tracks=[track('velgait_mist_burst', 3.2, 2.0, [(54, [0, 1.0, -1.0], [0, 0, 1])])],
             hits=[hit('mist', 68, 78, 'velgait_mist_burst', 18, 'knockdown', cost=30)],
             sounds=[(4, 'mist_pop'), (54, 'mist_pop'), (68, 'mist_pop')], vfx=[(54, 'mist_gather'), (68, 'mist_burst')], ai=ai(0, 4.4, 180, 1.2, cd=600)),
        move('mist_volley', 130, 56, 60, A(
            K('w', 0.4, None, pitch=0.08, neckPitch=0.2, headPitch=-0.05, crown=0.6, glow=1.0, legs={'H': (0, 0.3)}),
            K('w', 1.0, 'i', pitch=0.2, yH=0.04, neckPitch=0.45, headPitch=0.12, headRoll=-0.12, crown=1.1, glow=2.2, legs={'F': (0.3, 0.35), 'H': (-0.12, 0.4)}),
            K('s', 0.5, 'o', pitch=-0.05, yH=-0.03, neckPitch=-0.15, headPitch=-0.35, headRoll=0.12, crown=-0.3, glow=1.2, legs={'F': (0.35, 0.0)}),
            K('s', 1.0, None, pitch=-0.04, yH=-0.02, neckPitch=-0.12, headPitch=-0.35, crown=-0.3, glow=1.0, legs={'F': (0.3, 0.0)}),
            K('r', 0.4, None, crown=0.0, glow=0.5),
            K('r', 0.8, None, glow=0.2)), turn=(40, 70),
             hazards=[hazard(58, 3, 4.2, 2.0, 72, 10, 18, 'knockdown', crown_pos, 'mist', peak=3)],
             sounds=[(6, 'mist_pop'), (54, 'mist_pop'), (58, 'mist_pop')], ai=ai(7, 18, 50, 1.5, cd=480)),
        move('pounce', 110, 46, 54, A(
            K('w', 0.5, None, yH=-0.16, pitch=-0.08, crown=0.3, legs={'*': (0, 0.6)}),
            K('w', 0.72, 'o', yH=0.05, pitch=0.3, neckPitch=0.2, crown=0.6, legs={'F': (0.7, 0.9), 'H': (-0.5, 0.3)}),
            K('w', 1.0, None, pitch=0.15, crown=0.7, legs={'F': (0.8, 0.7), 'H': (-0.2, 0.6)}),
            K('s', 0.4, 'i', pitch=-0.12, yH=-0.1, neckPitch=-0.3, crown=0.5, legs={'F': (0.3, 0.0), 'H': (0, 0.4)}),
            K('s', 1.0, None, pitch=-0.12, yH=-0.1, neckPitch=-0.3, legs={'F': (0.3, 0.0), 'H': (0, 0.4)}),
            K('r', 0.4, None, yH=-0.05, neckPitch=-0.1),
            K('r', 0.8, None, yH=-0.01), hop=0.4),
             curve=(5.0, 30, 50), turn=(28, 80), slamTrack='velgait_pounce', bind=[B('velgait_pounce', 'leg:F:L:end', 'leg:F:R:end', 0.65)],
             hits=[hit('fore', 46, 54, 'velgait_pounce', 22, 'knockdown', cost=35)],
             sounds=[(4, 'beast_cry'), (30, 'gust'), (44, 'galdros_swing')], vfx=[(50, 'ground_slam')], ai=ai(4, 8.1, 30, 1.6, cd=320, clear=5)),
        move('stomp_double', 130, 40, 82, A(
            K('w', 1.0, None, pitch=0.12, legs={'F.S': (0.5, 1.0)}),
            K('s', 0.1, 'i', pitch=-0.05, yH=-0.04, legs={'F.S': (0.3, 0.0)}),
            K('s', 0.45, None, pitch=0.15, roll=0.04, legs={'F.S': (0.2, 0.1), 'F.O': (0.55, 1.0)}),
            K('s', 0.9, 'i', pitch=-0.06, yH=-0.06, legs={'F.O': (0.35, 0.0)}),
            K('s', 1.0, None, pitch=-0.06, yH=-0.06, legs={'F.O': (0.35, 0.0)}),
            K('r', 0.4, None, legs={'F.O': (0.2, 0.0)}),
            K('r', 0.8, None, yH=-0.01)), turn=(34, 70), side=1,
             bind=[B('velgait_stomp_double_a', 'leg:F:S:2', 'leg:F:S:end', 0.55, ext=0.1), B('velgait_stomp_double_b', 'leg:F:O:2', 'leg:F:O:end', 0.55, ext=0.1)],
             hits=[hit('fore1', 40, 46, 'velgait_stomp_double_a', 16, 'flinch', cost=25), hit('fore2', 74, 82, 'velgait_stomp_double_b', 22, 'knockdown', cost=35)],
             sounds=[(4, 'beast_cry'), (38, 'galdros_step'), (72, 'galdros_step')], vfx=[(44, 'dust_ring'), (78, 'dust_ring')], ai=ai(0, 3.5, 50, 1.8, cd=280)),
        move('charge', 150, 44, 104, A(
            K('w', 0.3, None, neckPitch=-0.25, headPitch=-0.2, crown=0.5, legs={'F.S': (0.3, 0.7)}),
            K('w', 0.55, 'i', neckPitch=-0.3, headPitch=-0.25, crown=0.6, legs={'F.S': (0.1, 0.0)}),
            K('w', 1.0, None, yH=-0.12, pitch=-0.12, neckPitch=-0.45, headPitch=-0.3, crown=0.8, glow=1.5, legs={'H': (0.2, 0.5)}),
            K('s', 0.12, 'o', yH=-0.04, pitch=-0.1, neckPitch=-0.45, headPitch=-0.3, crown=0.8, glow=1.5),
            K('s', 0.92, None, yH=-0.04, pitch=-0.1, neckPitch=-0.45, headPitch=-0.3, crown=0.8, glow=1.5),
            K('r', 0.3, None, yH=-0.06, pitch=0.18, neckPitch=0.1, crown=0.3, legs={'F': (0.6, 0.1), 'H': (0.3, 0.2)}),
            K('r', 0.7, None, pitch=0.03, glow=0.3)),
             curve=(14.0, 44, 104), turn=(40, 60), bind=[crown('velgait_charge')],
             hits=[hit('crown', 44, 104, 'velgait_charge', 26, 'knockdown', cost=40)],
             sounds=[(4, 'beast_cry'), (40, 'galdros_charge')], ai=ai(7, 15.9, 25, 1.5, cd=520, clear=10)),
    ]


VELGAIT_IDLE = idle(
    unaware=dict(neckPitch=-0.85, headPitch=-0.35, pitch=-0.03, crown=-0.2, glow=-0.05), sway=0.25, nod=0.08, rate=0.5,
    alert=dict(neckPitch=0.1, crown=0.3, glow=0.3, tailPitch=0.1),
    weak=dict(neckPitch=-0.25, headPitch=-0.15, crown=-0.3, glow=-0.1, tailPitch=-0.3, yH=-0.04),
    rage=dict(crown=0.6, glow=0.8, tailPitch=0.2),
    run=dict(neckPitch=-0.25, headPitch=-0.2, crown=-0.2, pitch=-0.03),
    sleep=dict(yH=-0.42, neckPitch=-0.6, neckYaw=0.9, headPitch=-0.2, crown=-0.4, glow=-0.15, tailYaw=0.6, legs={'*': (0, 1.1, 0.15)}),
    flinch=dict(neckPitch=0.35, headPitch=0.3, pitch=0.12, yH=-0.03, crown=0.5, glow=0.8),
    topple=dict(roll=1.2, yH=-0.45, neckPitch=-0.25, headPitch=-0.1, crown=-0.2, tailPitch=-0.2, legs={'*': (0.1, 0.3, 0.35)}),
    rise=dict(pitch=0.15, neckPitch=0.25, legs={'F': (0.3, 0.5)}),
    dead=[(15, dict(yH=-0.2, pitch=-0.15, neckPitch=-0.2, glow=0.3, legs={'F': (0.1, 0.9)})),
          (45, dict(roll=1.25, yH=-0.45, neckPitch=-0.5, headPitch=-0.25, crown=-0.4, glow=0.0, tailPitch=-0.25, legs={'*': (0.1, 0.35, 0.4)})),
          (100, dict(roll=1.3, yH=-0.47, neckPitch=-0.6, headPitch=-0.3, crown=-0.5, glow=-0.15, tailPitch=-0.3, legs={'*': (0.15, 0.3, 0.45)}))],
    fidgets=[
        F('lamp_breathe', 2.4, 'any', K('w', 0.4, None, glow=1.0), K('w', 0.8, None, glow=0.1)),
        F('crown_tilt', 2.0, 'calm', K('w', 0.35, None, headRoll=0.25, crown=0.4, neckPitch=0.2), K('w', 0.75, None, headRoll=0.25, crown=0.4, neckPitch=0.2)),
        F('stamp', 1.2, 'aware', K('w', 0.3, None, legs={'F.S': (0.2, 0.7)}), K('w', 0.5, 'i', legs={'F.S': (0.1, 0.0)})),
        F('tail_coil', 1.8, 'any', K('w', 0.4, None, tailYaw=0.5, tailCurl=0.4), K('w', 0.8, None, tailYaw=-0.3)),
        F('head_shake', 0.9, 'any', K('w', 0.5, None, crown=0.3, headRoll=0.12), shake=0.05),
        F('sniff_air', 2.0, 'calm', K('w', 0.4, None, neckPitch=0.5, headPitch=0.35), K('w', 0.8, None, neckPitch=0.5, headPitch=0.4)),
    ])


# =============================================================================================
# 幼体 8 種（登録簿の 14〜21）: 親の体を小さくした体で、親とは違う、子どもらしい短い動き（跳ねる・転ぶように突っ込む・すぐ逃げる）
#   どれも 7〜8 の技（登録簿の 3 つ + 威嚇 + 子に固有の技）。群れで暮らし、追い詰められた時と攻撃された時だけ技を出す。
# =============================================================================================


def kordopil_moves(J):
    """14 コルドピル（ガルドロスの幼体）: 高さ 0.60、頭 z 0.90（sp:10）、鼻先 z 1.14（sp:12）、尾の先 z -1.04。重い体で、転がるように突っ込む"""
    head = lambda n: B(n, 'sp:9', 'sp:12', 0.3, ext=0.1)
    return [
        move('push_slam', 70, 30, 36, A(
            K('w', 0.5, None, pitch=0.3, yH=0.08, neckPitch=0.2, legs={'F': (0.5, 0.9)}),
            K('w', 1.0, None, pitch=0.42, yH=0.12, neckPitch=0.3, legs={'F': (0.65, 1.0)}),
            K('s', 0.5, 'i', pitch=-0.08, yH=-0.06, neckPitch=-0.15, legs={'F': (0.3, 0.0)}),
            K('s', 1.0, None, pitch=-0.08, yH=-0.06, neckPitch=-0.15, legs={'F': (0.3, 0.0)}),
            K('r', 0.4, None, pitch=-0.04, legs={'F': (0.2, 0.0)}),
            K('r', 0.8, None, yH=-0.01)), turn=(20, 120), slamTrack='kordopil_push_slam',
             bind=[B('kordopil_push_slam', 'leg:F:L:end', 'leg:F:R:end', 0.4)],
             hits=[hit('paw', 30, 36, 'kordopil_push_slam', 10, 'flinch', cost=15)],
             sounds=[(4, 'galdros_warn'), (28, 'galdros_swing')], vfx=[(34, 'dust_ring')], ai=ai(0, 1.8, 45, 3)),
        move('dash', 80, 24, 42, A(
            K('w', 0.6, None, yH=-0.1, pitch=-0.1, neckPitch=-0.3, headPitch=-0.25, legs={'H': (0.25, 0.5)}),
            K('w', 1.0, None, yH=-0.14, pitch=-0.12, neckPitch=-0.35, headPitch=-0.3, tailPitch=0.3, legs={'H': (0.3, 0.55)}),
            K('s', 0.15, 'o', yH=-0.05, pitch=-0.1, neckPitch=-0.35, headPitch=-0.3, tailPitch=0.3),
            K('s', 0.9, None, yH=-0.05, pitch=-0.1, neckPitch=-0.35, headPitch=-0.3, tailPitch=0.3),
            K('r', 0.3, None, pitch=0.15, yH=-0.04, neckPitch=0.1, legs={'F': (0.5, 0.1)}),
            K('r', 0.7, None, pitch=0.02)),
             curve=(3.0, 22, 42), turn=(18, 140), bind=[head('kordopil_dash')],
             hits=[hit('head', 24, 42, 'kordopil_dash', 12, 'knockdown', cost=20)],
             sounds=[(4, 'galdros_warn'), (24, 'galdros_charge')], ai=ai(2, 4.2, 30, 2.5, cd=200, clear=3)),
        move('dirt_kick', 80, 32, 42, A(
            K('w', 0.6, None, yH=-0.08, pitch=0.08, tailYaw=0.4, legs={'H': (0.35, 0.6)}),
            K('w', 1.0, None, yH=-0.12, pitch=0.1, neckYaw=0.3, tailYaw=-0.3, legs={'H': (0.45, 0.7)}),
            K('s', 0.4, 'o', yH=-0.06, pitch=-0.12, tailYaw=0.5, legs={'H': (-0.7, 0.2)}),
            K('s', 1.0, None, yH=-0.06, pitch=-0.12, tailYaw=-0.4, legs={'H': (-0.6, 0.3)}),
            K('r', 0.5, None, pitch=-0.03, legs={'H': (-0.1, 0.1)})), turn=(20, 100),
             tracks=[track('kordopil_dirt_kick', 0.6, 1.4, [(32, [0, 0.35, -0.8], [0, 0, -1]), (42, [0, 0.35, -0.8], [0, 0.1, -1])])],
             hits=[hit('dirt', 32, 42, 'kordopil_dirt_kick', 6, 'flinch', cost=10)],
             sounds=[(30, 'galdros_scrape')], vfx=[(34, 'mud_rear')], ai=ai(0, 2.6, 180, 2.5, minA=100, cd=180)),
        move('threat', 90, 22, 66, A(
            K('w', 1.0, None, yH=-0.06, neckPitch=-0.25, headPitch=-0.2, tailPitch=0.4, legs={'F.S': (0.25, 0.6)}),
            K('s', 0.25, 'i', yH=-0.07, neckPitch=-0.28, headPitch=-0.22, tailPitch=0.4, legs={'F.S': (0.1, 0.0)}),
            K('s', 0.5, None, yH=-0.06, neckPitch=-0.25, headPitch=-0.2, tailPitch=0.45, legs={'F.O': (0.25, 0.6)}),
            K('s', 0.75, 'i', yH=-0.07, neckPitch=-0.28, headPitch=-0.22, tailPitch=0.45, legs={'F.O': (0.1, 0.0)}),
            K('s', 1.0, None, yH=-0.05, neckPitch=0.2, headPitch=0.15, tailPitch=0.3),
            K('r', 0.5, None, neckPitch=0.05)),
             sounds=[(6, 'galdros_warn'), (30, 'galdros_step'), (50, 'galdros_step')], ai=ai(2.5, 8, 60, 0.7, cd=600)),
        move('headbutt', 70, 26, 32, A(
            K('w', 1.0, None, yH=-0.06, z=-0.06, neckPitch=0.2, headPitch=0.2),
            K('s', 0.5, 'o', yH=-0.04, z=0.1, pitch=-0.1, neckPitch=-0.3, headPitch=-0.2),
            K('s', 1.0, None, yH=-0.04, z=0.1, pitch=-0.1, neckPitch=-0.3, headPitch=-0.2),
            K('r', 0.5, None, z=0.03)),
             curve=(0.6, 24, 32), turn=(20, 120), bind=[head('kordopil_headbutt')],
             hits=[hit('crown', 26, 32, 'kordopil_headbutt', 9, 'flinch', cost=14)],
             sounds=[(24, 'galdros_swing')], ai=ai(0, 2.0, 35, 2.5)),
        *lr(lambda sd, n: move(f'tail_swipe_{n}', 70, 26, 36, A(
            K('w', 1.0, None, yaw=-0.15, tailYaw=-0.7, neckYaw=0.4),
            K('s', 0.5, 'o', yaw=0.35, tailYaw=1.1),
            K('s', 1.0, None, yaw=0.4, tailYaw=1.25),
            K('r', 0.5, None, yaw=0.15, tailYaw=0.4)),
            side=sd, bind=[B(f'kordopil_tail_swipe_{n}', 'sp:3', 'sp:0', 0.3, ext=0.1)],
            hits=[hit('tail', 26, 36, f'kordopil_tail_swipe_{n}', 7, 'flinch', cost=12)],
            sounds=[(24, 'galdros_swing')], ai=ai(0, 1.7, 180, 2, minA=70, side=side_name(sd)))),
    ]


KORDOPIL_IDLE = idle(
    unaware=dict(neckPitch=-0.4, headPitch=-0.3), sway=0.2, nod=0.1, rate=0.6, alert=dict(neckPitch=0.15), weak=dict(neckPitch=-0.2, yH=-0.04),
    rage=dict(neckPitch=0.1, tailPitch=0.2), run=dict(neckPitch=-0.2, headPitch=-0.1, tailPitch=0.2),
    sleep=dict(yH=-0.45, neckPitch=-0.3, neckYaw=0.5, headPitch=-0.2, tailYaw=0.7, legs={'*': (0, 1.1, 0.2)}),
    flinch=dict(pitch=0.12, neckPitch=0.3, headPitch=0.25), topple=dict(roll=1.4, yH=-0.42, neckPitch=-0.1, legs={'*': (0.2, 0.3, 0.3)}),
    rise=dict(pitch=0.12, legs={'F': (0.3, 0.5)}),
    dead=[(12, dict(yH=-0.25, legs={'F': (0.1, 0.9)})), (40, dict(roll=1.35, yH=-0.45, neckPitch=-0.4, legs={'*': (0.15, 0.35, 0.4)}))],
    graze=dict(neckPitch=-0.9, headPitch=-0.25, pitch=-0.06, yH=-0.02, legs={'F': (0.15, 0.05)}),
    fidgets=[
        F('dig', 1.6, 'any', K('w', 0.3, None, pitch=0.05, legs={'F.S': (0.4, 0.6)}), K('w', 0.5, None, legs={'F.S': (-0.2, 0.1)}),
          K('w', 0.7, None, legs={'F.S': (0.4, 0.6)}), K('w', 0.9, None, legs={'F.S': (-0.2, 0.1)})),
        F('shake', 0.8, 'any', K('w', 0.5, None, headRoll=0.15), shake=0.06),
        F('sniff', 1.4, 'any', K('w', 0.4, None, neckPitch=0.3, headPitch=0.3, neckYaw=0.3), K('w', 0.8, None, neckPitch=0.25, neckYaw=-0.3)),
        F('flop', 2.0, 'any', K('w', 0.35, 'i', yH=-0.25, roll=0.25, legs={'*.S': (0, 0.8)}), K('w', 0.7, None, yH=-0.22, roll=0.2, legs={'*.S': (0, 0.8)})),
    ])


def palseit_moves(J):
    """15 パルセイト（セルヴァルクの幼体）: 高さ 0.72、頭 z 0.71 y 1.09（sp:11）、鼻先 z 0.79（sp:12）。細い脚でよく跳ねる"""
    return [
        *lr(lambda sd, n: move(f'side_kick_{n}', 64, 24, 32, A(
            K('w', 0.6, None, roll=0.12, headYaw=0.3, legs={'H.S': (0.1, 0.9)}),
            K('w', 1.0, None, yH=-0.15, roll=0.15, headYaw=0.35, crest=0.4, legs={'*': (0, 0.5), 'H.S': (0.15, 1.0)}),
            K('s', 0.4, 'o', yH=0.03, roll=-0.25, yaw=0.12, crest=0.7, legs={'H.S': (-0.35, 0.05, 1.15), 'F': (0, 0.6)}),
            K('s', 1.0, None, roll=-0.2, yaw=0.1, crest=0.6, legs={'H.S': (-0.4, 0.0, 1.2), 'F': (0, 0.5)}),
            K('r', 0.35, 'i', yH=-0.12, legs={'*': (0, 0.4)}),
            K('r', 0.75, None, yH=-0.02), hop=0.35),
            side=sd, curve=(1.2, 18, 34), dirDeg=90 * sd, bind=[B(f'palseit_side_kick_{n}', 'leg:H:S:1', 'leg:H:S:end', 0.3, ext=0.1)],
            hits=[hit('kick', 24, 32, f'palseit_side_kick_{n}', 8, 'flinch', cost=12)],
            sounds=[(22, 'galdros_swing')], ai=ai(0, 2.2, 140, 2.5, minA=35, side=side_name(sd)))),
        move('puff', 80, 36, 44, A(
            K('w', 0.5, None, neckPitch=0.3, headPitch=0.2, crest=0.6),
            K('w', 1.0, None, neckPitch=0.4, headPitch=0.3, pitch=0.12, crest=1.2, legs={'F': (-0.1, 0.15)}),
            K('s', 0.3, 'o', neckPitch=-0.3, headPitch=-0.25, pitch=-0.12, crest=0.5, legs={'F': (0.15, 0)}),
            K('s', 1.0, None, neckPitch=-0.3, headPitch=-0.25, pitch=-0.12, crest=0.6),
            K('r', 0.5, None, crest=0.2)), turn=(26, 120),
             tracks=[track('palseit_puff', 0.7, 2.0, [(36, [0, 0.5, 0.5], [0, -0.2, 1]), (44, [0, 0.45, 0.5], [0, -0.25, 1])])],
             hits=[hit('wind', 36, 44, 'palseit_puff', 5, 'flinch', cost=10)],
             sounds=[(4, 'beast_cry'), (34, 'gust')], vfx=[(36, 'gust')], ai=ai(1, 3.4, 35, 2, cd=240)),
        move('hop_back', 70, 20, 28, A(
            K('w', 1.0, None, yH=-0.18, pitch=-0.08, legs={'H': (0.35, 0.6), 'F': (0, 0.4)}),
            K('s', 0.4, 'o', yH=0.06, pitch=0.45, neckPitch=0.3, crest=0.7, legs={'F': (0.9, 0.8), 'H': (-0.5, 0.2)}),
            K('s', 1.0, None, pitch=0.35, crest=0.6, legs={'F': (0.6, 0.9)}),
            K('r', 0.35, 'i', yH=-0.12, pitch=0.05, legs={'*': (0, 0.4)}),
            K('r', 0.75, None, yH=-0.02), hop=0.4),
             curve=(-2.6, 18, 40), bind=[B('palseit_hop_back', 'leg:F:L:end', 'leg:F:R:end', 0.35)],
             hits=[hit('fore', 20, 28, 'palseit_hop_back', 6, 'flinch', cost=10)],
             sounds=[(18, 'gust')], ai=ai(0, 1.5, 70, 2, cd=300)),
        move('threat', 80, 20, 60, A(
            K('w', 1.0, None, neckPitch=-0.2, headPitch=-0.25, crest=1.1, legs={'F.S': (0.25, 0.7)}),
            K('s', 0.3, 'i', neckPitch=-0.22, headPitch=-0.25, crest=1.2, legs={'F.S': (0.1, 0.0)}),
            K('s', 0.6, None, neckPitch=-0.2, headPitch=-0.25, crest=1.1, legs={'F.S': (0.25, 0.7)}),
            K('s', 0.9, 'i', neckPitch=-0.22, headPitch=-0.25, crest=1.2, legs={'F.S': (0.1, 0.0)}),
            K('r', 0.5, None, crest=0.3)),
             sounds=[(6, 'beast_cry'), (32, 'galdros_step')], ai=ai(2.5, 8, 60, 0.7, cd=600)),
        move('headbutt', 64, 24, 30, A(
            K('w', 1.0, None, yH=-0.1, pitch=-0.1, neckPitch=-0.2, crest=-0.4, legs={'F': (0.2, 0.5)}),
            K('s', 0.5, 'o', yH=-0.04, pitch=-0.22, z=0.1, neckPitch=-0.45, headPitch=-0.2, crest=0.3, legs={'F': (0.5, 0.2), 'H': (-0.5, 0.1)}),
            K('s', 1.0, None, yH=-0.04, pitch=-0.22, z=0.1, neckPitch=-0.45, headPitch=-0.2, crest=0.3),
            K('r', 0.5, None, z=0.04, pitch=-0.08)),
             curve=(1.0, 20, 30), turn=(18, 120), bind=[B('palseit_headbutt', 'sp:9', 'sp:12', 0.3, ext=0.1)],
             hits=[hit('head', 24, 30, 'palseit_headbutt', 8, 'flinch', cost=12)],
             sounds=[(22, 'galdros_swing')], ai=ai(0, 2.4, 30, 2.5)),
        move('rear_kick', 70, 26, 32, A(
            K('w', 1.0, None, pitch=-0.15, yH=-0.05, neckPitch=-0.2, legs={'H': (0.3, 0.7)}),
            K('s', 0.4, 'o', pitch=-0.35, yH=0.05, neckPitch=-0.3, tailPitch=0.6, legs={'H': (-1.1, 0.15)}),
            K('s', 1.0, None, pitch=-0.3, yH=0.04, tailPitch=0.5, legs={'H': (-1.1, 0.1)}),
            K('r', 0.4, None, pitch=-0.05, legs={'H': (-0.2, 0.4)})),
             bind=[B('palseit_rear_kick', 'leg:H:L:end', 'leg:H:R:end', 0.35)],
             hits=[hit('hind', 26, 32, 'palseit_rear_kick', 8, 'flinch', cost=12)],
             sounds=[(24, 'galdros_swing')], ai=ai(0, 1.6, 180, 2.4, minA=120)),
    ]


PALSEIT_IDLE = idle(
    unaware=dict(neckPitch=-0.9, headPitch=-0.3, crest=-0.3), sway=0.25, nod=0.08, rate=0.7, alert=dict(neckPitch=0.15, crest=0.4),
    weak=dict(neckPitch=-0.2, crest=-0.3), rage=dict(crest=0.6), run=dict(neckPitch=-0.25, crest=-0.5),
    sleep=dict(yH=-0.45, neckPitch=-0.55, neckYaw=0.9, headPitch=-0.2, crest=-0.6, tailYaw=0.6, legs={'*': (0, 1.15, 0.15)}),
    flinch=dict(neckPitch=0.35, headPitch=0.3, pitch=0.12, crest=0.6), topple=dict(roll=1.25, yH=-0.45, crest=-0.2, legs={'*': (0.1, 0.3, 0.35)}),
    rise=dict(pitch=0.15, legs={'F': (0.3, 0.5)}),
    dead=[(12, dict(yH=-0.2, legs={'F': (0.1, 0.9)})), (40, dict(roll=1.3, yH=-0.47, neckPitch=-0.55, crest=-0.6, legs={'*': (0.15, 0.3, 0.45)}))],
    graze=dict(neckPitch=-1.0, headPitch=-0.3, pitch=-0.05, crest=-0.2, legs={'F': (0.15, 0.0)}),
    fidgets=[
        F('pronk', 0.9, 'any', K('w', 0.3, 'i', yH=-0.12, legs={'*': (0, 0.5)}), K('w', 0.55, 'o', yH=0.2, pitch=0.1, crest=0.5, legs={'*': (0, 0.6)}),
          K('w', 0.8, 'i', yH=-0.08, legs={'*': (0, 0.3)})),
        F('crest_flick', 0.8, 'any', K('w', 0.25, None, crest=0.6), K('w', 0.5, None, crest=-0.1), K('w', 0.75, None, crest=0.5)),
        F('look_back', 1.6, 'any', K('w', 0.35, None, neckYaw=0.9, headYaw=0.4, neckPitch=0.25), K('w', 0.75, None, neckYaw=0.9, headYaw=0.4)),
        F('scratch', 1.6, 'any', K('w', 0.3, None, neckYaw=0.6, neckPitch=-0.3, legs={'H.S': (0.4, 0.9)}), K('w', 0.5, None, legs={'H.S': (0.6, 0.8)}),
          K('w', 0.7, None, neckYaw=0.6, legs={'H.S': (0.4, 0.9)})),
    ])


def numaporon_moves(J):
    """16 ヌマポロン（ヌメラドンの幼体）: 高さ 0.62、頭 z 0.82（sp:7）、口先 z 1.12（sp:9）、尾の先 z -0.92。小さな泥皿（dish）"""
    return [
        move('mud_spit', 80, 38, 42, A(
            K('w', 0.4, None, neckPitch=-0.25, headPitch=-0.2, dish=-0.5),
            K('w', 1.0, None, neckPitch=0.35, headPitch=0.35, pitch=0.06, dish=1.0),
            K('s', 0.5, 'o', neckPitch=-0.2, headPitch=-0.25, pitch=-0.05, dish=-0.5),
            K('s', 1.0, None, neckPitch=-0.2, headPitch=-0.25, dish=-0.4),
            K('r', 0.5, None, dish=0.0)), turn=(34, 100),
             hazards=[hazard(40, 1, 0.6, 1.0, 34, 8, 8, 'flinch', [0, 0.6, 1.0], 'mud', peak=2.2)],
             sounds=[(4, 'galdros_warn'), (38, 'splash')], ai=ai(3, 10, 40, 2.5, cd=240)),
        move('belly_slide', 90, 30, 50, A(
            K('w', 0.6, None, yH=0.08, pitch=0.12, legs={'F': (-0.1, 0.0), 'H': (0.1, 0.0)}),
            K('w', 1.0, None, yH=0.1, pitch=0.15, neckPitch=0.2, dish=0.4),
            K('s', 0.2, 'i', yH=-0.32, pitch=-0.05, dish=0.2, legs={'F': (0.7, 0.5), 'H': (-0.7, 0.5)}),
            K('s', 1.0, None, yH=-0.32, pitch=-0.05, dish=0.2, legs={'F': (0.7, 0.5), 'H': (-0.7, 0.5)}),
            K('r', 0.4, None, yH=-0.25, legs={'F': (0.5, 0.5), 'H': (-0.5, 0.5)}),
            K('r', 0.8, None, yH=-0.03), wiggle=0.12),
             curve=(3.6, 30, 50), bind=[B('numaporon_belly_slide', 'sp:2', 'sp:7', 0.45)],
             hits=[hit('belly', 30, 50, 'numaporon_belly_slide', 10, 'knockdown', cost=18)],
             sounds=[(4, 'galdros_warn'), (30, 'galdros_charge')], vfx=[(32, 'mud_splash')], ai=ai(2, 4.9, 25, 2, cd=300, clear=4)),
        *lr(lambda sd, n: move(f'mud_push_{n}', 70, 28, 36, A(
            K('w', 1.0, None, roll=-0.14, twist=-0.08, yaw=-0.1, yH=-0.08, x=-0.03, legs={'F.S': (0, 0.5)}),
            K('s', 0.4, 'o', roll=0.08, twist=0.1, yaw=0.18, x=0.08, legs={'F.S': (0, 0.1, 0.3)}),
            K('s', 1.0, None, roll=0.06, yaw=0.15, x=0.07),
            K('r', 0.5, None, x=0.02)),
            side=sd, curve=(0.9, 26, 38), dirDeg=90 * sd, bind=[B(f'numaporon_mud_push_{n}', 'leg:F:S:0', 'leg:H:S:0', 0.4)],
            hits=[hit('shoulder', 28, 36, f'numaporon_mud_push_{n}', 8, 'flinch', cost=14)],
            sounds=[(26, 'splash')], vfx=[(30, 'mud_splash')], ai=ai(0, 1.9, 135, 2.5, minA=40, side=side_name(sd)))),
        move('threat', 90, 24, 66, A(
            K('w', 1.0, None, neckPitch=0.2, dish=0.8),
            K('s', 0.25, None, neckPitch=0.2, headRoll=0.15, dish=1.0),
            K('s', 0.5, None, neckPitch=0.2, headRoll=-0.15, dish=0.6),
            K('s', 0.75, None, neckPitch=0.2, headRoll=0.15, dish=1.0),
            K('s', 1.0, None, neckPitch=0.1, dish=0.5),
            K('r', 0.5, None, dish=0.1)),
             sounds=[(6, 'galdros_warn'), (30, 'splash')], ai=ai(2.5, 8, 60, 0.7, cd=600)),
        move('bite', 70, 28, 34, A(
            K('w', 1.0, None, z=-0.05, neckPitch=0.25, headPitch=0.25),
            K('s', 0.5, 'o', z=0.1, pitch=-0.06, neckPitch=-0.25, headPitch=-0.2),
            K('s', 1.0, None, z=0.1, pitch=-0.06, neckPitch=-0.25, headPitch=-0.2),
            K('r', 0.5, None, z=0.03)),
             curve=(0.5, 24, 34), turn=(24, 120), bind=[B('numaporon_bite', 'sp:6', 'sp:9', 0.3, ext=0.1)],
             hits=[hit('mouth', 28, 34, 'numaporon_bite', 8, 'flinch', cost=12)],
             sounds=[(26, 'galdros_swing')], ai=ai(0, 2.0, 30, 2.5)),
        move('tail_slap', 76, 32, 38, A(
            K('w', 1.0, None, pitch=-0.1, neckYaw=0.3, tailPitch=1.0, tailCurl=0.4),
            K('s', 0.5, 'i', pitch=0.06, tailPitch=-0.6),
            K('s', 1.0, None, pitch=0.06, tailPitch=-0.6),
            K('r', 0.5, None, tailPitch=-0.2)),
             bind=[B('numaporon_tail_slap', 'sp:2', 'sp:0', 0.3, ext=0.1)],
             hits=[hit('tail', 32, 38, 'numaporon_tail_slap', 8, 'flinch', cost=12)],
             sounds=[(30, 'galdros_swing'), (36, 'splash')], vfx=[(36, 'mud_rear')], ai=ai(0, 1.6, 180, 2.4, minA=120)),
    ]


NUMAPORON_IDLE = idle(
    unaware=dict(neckPitch=-0.35, dish=-0.2), sway=0.2, nod=0.1, rate=0.5, alert=dict(neckPitch=0.1, dish=0.3), weak=dict(neckPitch=-0.2, dish=-0.3),
    rage=dict(dish=0.5), run=dict(neckPitch=-0.1, dish=-0.3),
    sleep=dict(yH=-0.42, neckPitch=-0.35, headRoll=0.45, dish=-0.6, legs={'*': (0, 1.1, 0.25)}),
    flinch=dict(pitch=0.1, neckPitch=0.25, dish=0.4), topple=dict(roll=1.2, yH=-0.35, dish=0.3, legs={'*': (0.1, 0.25, 0.4)}),
    rise=dict(pitch=0.1, legs={'F': (0.3, 0.5)}),
    dead=[(12, dict(yH=-0.25, legs={'F': (0.1, 0.9)})), (45, dict(roll=1.25, yH=-0.4, neckPitch=-0.35, dish=0.5, legs={'*': (0.1, 0.3, 0.45)}))],
    graze=dict(neckPitch=-0.55, headPitch=-0.35, dish=-0.5, pitch=-0.04),
    fidgets=[
        F('dish_tip', 1.6, 'any', K('w', 0.35, None, dish=0.9, headRoll=0.3), K('w', 0.75, None, dish=0.9, headRoll=0.3)),
        F('splash_step', 1.2, 'any', K('w', 0.3, None, legs={'F.S': (0.3, 0.7)}), K('w', 0.5, 'i', legs={'F.S': (0.1, 0.0)})),
        F('wallow', 2.0, 'any', K('w', 0.4, None, roll=0.15, yH=-0.08), K('w', 0.8, None, roll=-0.1, yH=-0.06)),
        F('snort', 0.8, 'any', K('w', 0.3, None, headPitch=-0.15), K('w', 0.55, None, headPitch=0.12)),
    ])


def chilumicana_moves(J):
    """17 チルミカナ（ルミスカの幼体）: 高さ 0.85、頭 z 0.52 y 1.24（sp:9）、嘴 z 0.62（sp:11）、尾の先 z -1.08。尾の 2 節が灯る"""
    return [
        move('tail_jab', 80, 36, 42, A(
            K('w', 0.5, None, tailPitch=0.4, glow=0.8),
            K('w', 1.0, None, tailPitch=0.6, tailCurl=0.5, glow=1.6, neckYaw=0.3),
            K('s', 0.5, 'o', z=-0.05, tailPitch=-0.2, tailCurl=-0.3, glow=2.0),
            K('s', 1.0, None, z=-0.05, tailPitch=-0.2, tailCurl=-0.3, glow=1.6),
            K('r', 0.5, None, glow=0.4)),
             bind=[B('chilumicana_tail_jab', 'sp:3', 'sp:0', 0.3, ext=0.2)],
             hits=[hit('tail', 36, 42, 'chilumicana_tail_jab', 7, 'flinch', cost=12)],
             sounds=[(6, 'zap'), (34, 'zap')], ai=ai(0, 1.9, 180, 2.5, minA=100, cd=180)),
        move('kick', 64, 24, 30, A(
            K('w', 1.0, None, pitch=0.1, roll=0.04, wing=0.3, legs={'B.S': (-0.6, 1.1)}),
            K('s', 0.4, 'o', pitch=-0.1, z=0.05, wing=0.5, legs={'B.S': (1.1, 0.1)}),
            K('s', 1.0, None, pitch=-0.1, z=0.05, legs={'B.S': (1.0, 0.2)}),
            K('r', 0.5, None, legs={'B.S': (0.3, 0.3)})),
             side=1, curve=(0.5, 20, 30), turn=(16, 140), bind=[B('chilumicana_kick', 'leg:B:S:2', 'leg:B:S:end', 0.3, ext=0.1)],
             hits=[hit('kick', 24, 30, 'chilumicana_kick', 8, 'flinch', cost=12)],
             sounds=[(22, 'galdros_swing')], ai=ai(0, 1.8, 40, 3)),
        move('glide_back', 80, 26, 34, A(
            K('w', 1.0, None, yH=-0.16, wing=0.4, legs={'B': (0.1, 0.6)}),
            K('s', 0.3, 'o', yH=0.02, pitch=0.2, wing=1.3, tailPitch=0.3, legs={'B': (0.4, 0.8)}),
            K('s', 1.0, None, pitch=0.12, wing=1.0, legs={'B': (0.3, 0.7)}),
            K('r', 0.35, 'i', yH=-0.1, wing=0.3, legs={'B': (0.0, 0.4)}),
            K('r', 0.75, None, yH=-0.02), hop=0.25),
             curve=(-3.0, 22, 48), bind=[B('chilumicana_glide_back', 'tip:wing:L', 'tip:wing:R', 0.3)],
             hits=[hit('wing', 26, 34, 'chilumicana_glide_back', 5, 'flinch', cost=8)],
             sounds=[(22, 'gust')], ai=ai(0, 1.6, 70, 2, cd=300)),
        move('threat', 80, 20, 60, A(
            K('w', 1.0, None, neckPitch=0.2, wing=0.7, tailPitch=0.7, glow=1.0),
            K('s', 0.25, None, neckPitch=0.2, wing=0.8, tailPitch=0.75, glow=2.0),
            K('s', 0.5, None, neckPitch=0.2, wing=0.7, tailPitch=0.7, glow=0.3),
            K('s', 0.75, None, neckPitch=0.2, wing=0.8, tailPitch=0.75, glow=2.0),
            K('r', 0.5, None, glow=0.3)),
             sounds=[(6, 'bird_screech'), (30, 'zap')], ai=ai(2.5, 8, 60, 0.7, cd=600)),
        move('peck', 60, 22, 28, A(
            K('w', 1.0, None, z=-0.05, neckPitch=0.3, headPitch=0.3),
            K('s', 0.5, 'o', z=0.08, pitch=-0.2, neckPitch=-0.55, headPitch=-0.35),
            K('s', 1.0, None, z=0.08, pitch=-0.2, neckPitch=-0.55, headPitch=-0.35),
            K('r', 0.5, None, z=0.03, neckPitch=-0.2)),
             turn=(18, 140), bind=[B('chilumicana_peck', 'sp:9', 'sp:11', 0.25, ext=0.1)],
             hits=[hit('beak', 22, 28, 'chilumicana_peck', 6, 'flinch', kind='cut', cost=10)],
             sounds=[(20, 'galdros_swing')], ai=ai(0, 1.3, 30, 2.5)),
        *lr(lambda sd, n: move(f'wing_slap_{n}', 64, 24, 32, A(
            K('w', 1.0, None, yaw=-0.15, wingS=1.2),
            K('s', 0.5, 'o', yaw=0.35, wingS=0.3),
            K('s', 1.0, None, yaw=0.4, wingS=0.2),
            K('r', 0.5, None, yaw=0.15)),
            side=sd, bind=[B(f'chilumicana_wing_slap_{n}', 'own:wing:S', 'tip:wing:S', 0.3, ext=0.1)],
            hits=[hit('wing', 24, 32, f'chilumicana_wing_slap_{n}', 6, 'flinch', cost=10)],
            sounds=[(22, 'gust')], ai=ai(0, 1, 120, 2, minA=30, side=side_name(sd)))),
    ]


CHILUMICANA_IDLE = idle(
    unaware=dict(pitch=-0.12, neckPitch=-0.6, headPitch=-0.3), sway=0.3, nod=0.2, rate=0.9, alert=dict(neckPitch=0.15, tailPitch=0.2, glow=0.3),
    weak=dict(neckPitch=-0.2, tailPitch=-0.2), rage=dict(tailPitch=0.3, glow=0.5), run=dict(pitch=-0.18, neckPitch=-0.3, wing=0.3, tailPitch=0.2),
    sleep=dict(yH=-0.4, neckYaw=1.2, neckPitch=-0.25, headPitch=-0.3, tailYaw=-0.9, glow=-0.15, legs={'B': (0, 1.2)}),
    flinch=dict(pitch=0.1, neckPitch=0.3, wing=0.5, glow=0.6), topple=dict(roll=1.3, yH=-0.5, wing=0.45, legs={'B': (0.3, 0.3, 0.2)}),
    rise=dict(wing=1.0, pitch=0.1),
    dead=[(12, dict(yH=-0.2, neckPitch=-0.3, wing=0.5, legs={'B': (0.1, 0.8)})), (40, dict(roll=1.35, yH=-0.52, neckPitch=-0.5, wing=0.3, glow=-0.1, legs={'B': (0.2, 0.4, 0.2)}))],
    graze=dict(pitch=-0.25, neckPitch=-0.7, headPitch=-0.35),
    fidgets=[
        F('blink_nodes', 1.0, 'any', K('w', 0.25, None, glow=1.4), K('w', 0.5, None, glow=0.0), K('w', 0.75, None, glow=1.2)),
        F('wing_flap', 0.9, 'any', K('w', 0.3, None, wing=0.9), K('w', 0.55, None, wing=0.1), K('w', 0.8, None, wing=0.8)),
        F('hop', 0.8, 'any', K('w', 0.3, 'i', yH=-0.12, legs={'B': (0, 0.5)}), K('w', 0.55, 'o', yH=0.15, wing=0.6, legs={'B': (0, 0.6)}), K('w', 0.8, 'i', yH=-0.05)),
        F('preen', 1.8, 'any', K('w', 0.35, None, neckYaw=0.9, neckPitch=-0.2, headPitch=-0.35, wingS=0.3), K('w', 0.75, None, neckYaw=0.95, headPitch=-0.4, wingS=0.3)),
    ])


def kohalgis_moves(J):
    """18 コハルギス（オルグラスの幼体）: 高さ 0.76、左右とも小さな鋏（clawR・clawL。左だけ指 finger_L）、乳白色の薄い背板"""
    claws = lambda n: B(n, 'leg:clawR:C:2', 'leg:clawL:C:2', 0.32)
    return [
        move('pinch', 70, 28, 36, A(
            K('w', 1.0, None, finger=1.2, clawR=(0.6, -0.7), clawL=(0.6, -0.7)),
            K('s', 0.5, 'o', finger=-0.2, z=0.04, clawR=(0.0, 0.5), clawL=(0.0, 0.5)),
            K('s', 1.0, None, finger=-0.2, z=0.04, clawR=(0.0, 0.6), clawL=(0.0, 0.6)),
            K('r', 0.5, None, clawR=(0.0, 0.2), clawL=(0.0, 0.2))), turn=(22, 120),
             bind=[claws('kohalgis_pinch')],
             hits=[hit('claws', 28, 36, 'kohalgis_pinch', 8, 'flinch', kind='cut', cost=12)],
             sounds=[(4, 'shell_clack'), (26, 'galdros_swing'), (34, 'shell_clack')], ai=ai(0, 1.6, 50, 3)),
        *lr(lambda sd, n: move(f'side_hop_{n}', 64, 22, 38, A(
            K('w', 1.0, None, yH=-0.15, roll=0.06, clawR=(0.1, 0.3), clawL=(0.1, 0.3), legs={'*': (0, 0.55)}),
            K('s', 0.2, 'o', yH=0.04, roll=-0.08, legs={'*': (0, 0.7)}),
            K('s', 0.8, None, yH=0.02, roll=-0.06, legs={'*': (0, 0.6)}),
            K('r', 0.3, 'i', yH=-0.1, legs={'*': (0, 0.3)}),
            K('r', 0.7, None, yH=-0.01), hop=0.3),
            side=sd, curve=(2.2, 22, 38), dirDeg=90 * sd, bind=[B(f'kohalgis_side_hop_{n}', 'leg:M1:S:0', 'leg:M3:S:0', 0.45)],
            hits=[hit('body', 22, 38, f'kohalgis_side_hop_{n}', 7, 'flinch', cost=12)],
            sounds=[(4, 'shell_clack'), (22, 'galdros_charge')], ai=ai(1, 3.2, 135, 2.5, minA=45, side=side_name(sd), cd=200))),
        move('sand_scrape', 80, 32, 44, A(
            K('w', 0.6, None, yH=-0.1, pitch=-0.08, legs={'M1': (0.6, 0.6)}),
            K('w', 1.0, None, yH=-0.12, pitch=-0.1, plates=-0.3, legs={'M1': (0.7, 0.7)}),
            K('s', 0.5, 'o', yH=-0.1, pitch=-0.06, legs={'M1': (-0.5, 0.1)}),
            K('s', 1.0, None, yH=-0.1, pitch=-0.06, legs={'M1': (0.5, 0.6)}),
            K('r', 0.5, None, legs={'M1': (-0.2, 0.1)}), paddle=0.6),
             tracks=[track('kohalgis_sand_scrape', 0.55, 1.4, [(32, [0, 0.25, 0.7], [0, 0, 1]), (44, [0, 0.25, 0.7], [0, 0.1, 1])])],
             hits=[hit('sand', 32, 44, 'kohalgis_sand_scrape', 5, 'flinch', cost=8)],
             sounds=[(30, 'galdros_scrape')], vfx=[(34, 'mud_splash')], ai=ai(1, 2.9, 35, 2, cd=220)),
        move('threat', 80, 20, 60, A(
            K('w', 1.0, None, yH=0.05, finger=1.0, clawR=(0.8, -0.4), clawL=(0.8, -0.4)),
            K('s', 0.2, None, yH=0.05, finger=-0.2, clawR=(0.85, -0.4), clawL=(0.85, -0.4)),
            K('s', 0.45, None, yH=0.05, finger=1.0, clawR=(0.8, -0.4), clawL=(0.8, -0.4)),
            K('s', 0.7, None, yH=0.05, finger=-0.2, clawR=(0.85, -0.4), clawL=(0.85, -0.4)),
            K('s', 1.0, None, yH=0.04, finger=0.8, clawR=(0.7, -0.3), clawL=(0.7, -0.3)),
            K('r', 0.5, None, clawR=(0.2, 0.0), clawL=(0.2, 0.0))),
             sounds=[(6, 'shell_clack'), (26, 'shell_clack'), (40, 'shell_clack')], ai=ai(2.5, 8, 60, 0.7, cd=600)),
        move('jab', 56, 20, 26, A(
            K('w', 1.0, None, clawL=(0.4, -0.2)),
            K('s', 0.5, 'o', z=0.05, pitch=-0.06, clawL=(-0.5, 0.2)),
            K('s', 1.0, None, z=0.05, pitch=-0.06, clawL=(-0.5, 0.2)),
            K('r', 0.5, None, clawL=(0.0, 0.05))),
             turn=(16, 140), bind=[B('kohalgis_jab', 'leg:clawL:C:1', 'tip:finger_L:C', 0.25, ext=0.05)],
             hits=[hit('claw', 20, 26, 'kohalgis_jab', 6, 'flinch', kind='cut', cost=10)],
             sounds=[(18, 'shell_clack')], ai=ai(0, 1.8, 35, 2.5)),
        move('shell_bump', 70, 28, 34, A(
            K('w', 1.0, None, yH=0.1, plates=0.6, legs={'*': (0, -0.2)}),
            K('s', 0.5, 'i', yH=-0.15, plates=0.2, legs={'*': (0, 0.5, 0.2)}),
            K('s', 1.0, None, yH=-0.15, legs={'*': (0, 0.5, 0.2)}),
            K('r', 0.5, None, yH=-0.04)),
             tracks=[track('kohalgis_shell_bump', 0.9, 1.0, [(28, [0, 0.35, -0.5], [0, 0, 1])])],
             hits=[hit('shell', 28, 34, 'kohalgis_shell_bump', 6, 'flinch', cost=10)],
             sounds=[(26, 'shell_clack')], vfx=[(32, 'dust_ring')], ai=ai(0, 1.6, 180, 1.8, cd=240)),
    ]


KOHALGIS_IDLE = idle(
    unaware=dict(pitch=-0.05), sway=0.0, nod=0.05, rate=1.4, alert=dict(yH=0.03, finger=0.4, clawR=(0.3, -0.2), clawL=(0.3, -0.2)),
    weak=dict(yH=-0.05, clawR=(-0.2, 0.1), clawL=(-0.2, 0.1)), rage=dict(finger=0.6, clawR=(0.3, -0.2), clawL=(0.3, -0.2)),
    run=dict(yH=-0.04, clawR=(0.2, 0.3), clawL=(0.2, 0.3)),
    sleep=dict(yH=-0.3, clawR=(-0.3, 0.4), clawL=(-0.3, 0.4), legs={'*': (0, 0.8, -0.1)}),
    flinch=dict(yH=-0.04, pitch=0.1, finger=0.6, clawR=(0.4, -0.3), clawL=(0.4, -0.3)),
    topple=dict(roll=2.8, yH=0.1, clawR=(0.5, -0.4), clawL=(0.5, -0.4), legs={'*': (0.3, 0.7, 0.3)}),
    rise=dict(roll=0.0, legs={'*': (0, -0.2)}),
    dead=[(12, dict(yH=-0.2, legs={'*': (0, 0.6)})), (40, dict(yH=-0.35, finger=0.8, clawR=(-0.4, 0.5), clawL=(-0.4, 0.5), legs={'*': (0.1, 1.1, -0.25)}))],
    graze=dict(pitch=-0.08, finger=0.4, clawR=(-0.3, 0.4), clawL=(-0.3, 0.4)),
    fidgets=[
        F('pick', 1.4, 'any', K('w', 0.25, None, clawL=(-0.3, 0.5), finger=0.8), K('w', 0.5, None, clawL=(0.3, 0.3), finger=-0.1),
          K('w', 0.75, None, clawR=(-0.3, 0.5)), K('w', 0.9, None, clawR=(0.2, 0.2))),
        F('clack', 0.8, 'any', K('w', 0.3, None, finger=1.0), K('w', 0.6, None, finger=-0.2)),
        F('side_step', 1.2, 'any', K('w', 0.5, None, x=0.06, roll=-0.04, legs={'*.S': (0, 0.4)})),
        F('hunker', 1.8, 'any', K('w', 0.4, None, yH=-0.15, legs={'*': (0, 0.4)}), K('w', 0.8, None, yH=-0.12, legs={'*': (0, 0.35)})),
    ])


def mitogaron_moves(J):
    """19 ミトガロン（テンガロの幼体）: 弓の体（arch）の頂上 y 1.20、頭 z 1.19 y 0.28（sp:13）。体が柔らかく、輪には閉じきれない"""
    head = lambda n: B(n, 'sp:11', 'sp:14', 0.35, ext=0.05)
    return [
        move('curl_bump', 80, 34, 42, A(
            K('w', 1.0, None, yH=0.05, archFront=1.0, ring=0.3),
            K('s', 0.5, 'i', yH=-0.05, archFront=-0.4, ring=0.1),
            K('s', 1.0, None, yH=-0.05, archFront=-0.4),
            K('r', 0.5, None, archFront=-0.1)),
             curve=(1.0, 30, 42), turn=(26, 90), bind=[head('mitogaron_curl_bump')],
             hits=[hit('bump', 34, 42, 'mitogaron_curl_bump', 9, 'knockdown', cost=16)],
             sounds=[(4, 'insect_buzz'), (32, 'galdros_swing')], ai=ai(0, 2.4, 35, 3)),
        *lr(lambda sd, n: move(f'hook_scrape_{n}', 70, 28, 36, A(
            K('w', 1.0, None, yaw=-0.3, roll=0.12, twist=0.1, archFront=0.3),
            K('s', 0.5, 'o', yaw=0.4, roll=-0.15, twist=-0.1),
            K('s', 1.0, None, yaw=0.45, roll=-0.12),
            K('r', 0.5, None, yaw=0.15)),
            side=sd, bind=[B(f'mitogaron_hook_scrape_{n}', 'sp:9', 'sp:13', 0.35)],
            hits=[hit('hooks', 28, 36, f'mitogaron_hook_scrape_{n}', 7, 'flinch', kind='cut', cost=12)],
            sounds=[(4, 'hiss'), (26, 'galdros_swing')], ai=ai(0, 1.9, 140, 2.5, minA=40, side=side_name(sd)))),
        move('para_drip', 80, 34, 38, A(
            K('w', 1.0, None, archBack=1.1),
            K('s', 0.5, 'o', archBack=0.3),
            K('s', 1.0, None, archBack=0.3),
            K('r', 0.5, None, archBack=0.05)),
             hazards=[hazard(36, 2, 1.4, 0.9, 30, 16, 4, 'flinch', [0, 0.8, -1.0], 'para', peak=1.8, status=('para', 40))],
             sounds=[(4, 'hiss'), (34, 'splash')], ai=ai(1, 6, 180, 2, cd=300)),
        move('threat', 80, 20, 60, A(
            K('w', 1.0, None, archFront=0.9, legs={'A': (0.2, 0.5)}),
            K('s', 0.3, None, archFront=1.0, yaw=0.12, legs={'A': (0.3, 0.6)}),
            K('s', 0.6, None, archFront=0.9, yaw=-0.12, legs={'A': (0.1, 0.5)}),
            K('s', 1.0, None, archFront=0.8),
            K('r', 0.5, None, archFront=0.2), shake=0.02, shakeIn='strike'),
             sounds=[(6, 'insect_buzz'), (30, 'hiss')], ai=ai(2.5, 8, 60, 0.7, cd=600)),
        move('half_roll', 100, 34, 64, A(
            K('w', 1.0, None, ring=0.6, yH=-0.05),
            K('s', 0.5, None, ring=0.6, yH=-0.05),
            K('s', 1.0, None, ring=0.55, yH=-0.05),
            K('r', 0.4, None, ring=0.3),
            K('r', 0.8, None, ring=0.05), roll=1),
             curve=(4.0, 34, 64), turn=(30, 80), bind=[B('mitogaron_half_roll', 'sp:3', 'sp:11', 0.55)],
             hits=[hit('body', 34, 64, 'mitogaron_half_roll', 8, 'knockdown', cost=14)],
             sounds=[(4, 'insect_buzz'), (34, 'galdros_charge')], ai=ai(2, 5.5, 30, 1.8, cd=300, clear=5)),
        move('bite', 60, 22, 28, A(
            K('w', 1.0, None, archFront=0.5, z=-0.03),
            K('s', 0.5, 'o', archFront=-0.3, z=0.05),
            K('s', 1.0, None, archFront=-0.3, z=0.05),
            K('r', 0.5, None, archFront=-0.05)),
             turn=(18, 120), bind=[head('mitogaron_bite')],
             hits=[hit('jaws', 22, 28, 'mitogaron_bite', 6, 'flinch', kind='cut', cost=10, status=('para', 15))],
             sounds=[(20, 'hiss')], ai=ai(0, 2.0, 35, 2.5)),
    ]


MITOGARON_IDLE = idle(
    unaware=dict(archFront=-0.2), sway=0.0, nod=0.0, rate=0.5, alert=dict(archFront=0.25), weak=dict(archFront=-0.25, archBack=-0.2),
    rage=dict(archFront=0.3), run=dict(archFront=0.1), sleep=dict(roll=1.45, ring=0.45, yH=-0.06, archFront=-0.2, archBack=-0.2, legs={'A': (0.1, 0.4, 0.2)}),
    flinch=dict(archFront=0.6, yH=0.02), topple=dict(roll=1.35, yH=-0.15, ring=0.2, legs={'A': (0.2, 0.5, 0.3)}), rise=dict(archFront=0.4),
    dead=[(15, dict(yH=-0.1, archFront=-0.4, archBack=-0.3)), (50, dict(roll=1.3, yH=-0.22, archFront=-0.5, archBack=-0.5, legs={'A': (0.1, 0.6, 0.2)}))],
    graze=dict(archFront=-0.45, yH=-0.03),
    fidgets=[
        F('probe', 1.6, 'any', K('w', 0.35, None, archFront=0.5, yaw=0.12), K('w', 0.75, None, archFront=0.4, yaw=-0.12)),
        F('wriggle', 1.2, 'any', K('w', 0.5, None, roll=0.08, archBack=0.3), shake=0.03),
        F('curl_try', 2.0, 'any', K('w', 0.45, None, ring=0.4, yH=-0.04), K('w', 0.8, None, ring=0.35, yH=-0.04)),
    ])


def yurtepica_moves(J):
    """20 ユルテピカ（ヴェリトの幼体）: 高さ 0.47、頭 z 0.47（sp:6）、尾の端 z -0.68。平たい羽袋（bags）と短い糸"""
    return [
        move('thread_flick', 80, 34, 46, A(
            K('w', 0.6, None, pitch=-0.12, tailPitch=0.5),
            K('w', 1.0, None, pitch=-0.15, yaw=-0.2, tailPitch=0.7, tailYaw=-0.3),
            K('s', 0.5, None, pitch=-0.12, tailPitch=0.6),
            K('s', 1.0, None, pitch=-0.12, yaw=0.25, tailPitch=0.6, tailYaw=0.35),
            K('r', 0.5, None, yaw=0.08)),
             tracks=[track('yurtepica_thread_flick', 0.38, 1.4, [(34, [0, 0.3, -0.6], [-1, 0, -0.45]), (40, [0, 0.3, -0.6], [0, 0, -1]), (46, [0, 0.3, -0.6], [1, 0, -0.45])])],
             hits=[hit('threads', 34, 46, 'yurtepica_thread_flick', 4, 'flinch', cost=8, status=('poison', 40))],
             sounds=[(4, 'hiss'), (34, 'gust')], vfx=[(34, 'poison_threads')], ai=ai(0, 2.4, 180, 2.5, minA=100, cd=200)),
        move('hop_back', 64, 20, 28, A(
            K('w', 1.0, None, yH=-0.15, bags=-0.6, legs={'*': (0, 0.55)}),
            K('s', 0.4, 'o', yH=0.05, pitch=0.2, bags=0.6, legs={'M1': (0.6, 0.8)}),
            K('s', 1.0, None, pitch=0.1, bags=0.4, legs={'*': (0, 0.6)}),
            K('r', 0.35, 'i', yH=-0.1, legs={'*': (0, 0.3)}),
            K('r', 0.75, None, yH=-0.01), hop=0.4),
             curve=(-2.0, 16, 36), bind=[B('yurtepica_hop_back', 'leg:M1:L:end', 'leg:M1:R:end', 0.3)],
             hits=[hit('fore', 20, 28, 'yurtepica_hop_back', 4, 'flinch', cost=8)],
             sounds=[(18, 'insect_buzz')], ai=ai(0, 1.3, 70, 2, cd=300)),
        move('thread_push', 70, 28, 36, A(
            K('w', 1.0, None, pitch=0.12, legs={'M1': (0.4, 0.9, 0.3)}),
            K('s', 0.5, 'o', pitch=-0.05, z=0.05, legs={'M1': (0.6, 0.3, -0.3)}),
            K('s', 1.0, None, pitch=-0.05, z=0.05, legs={'M1': (0.7, 0.2, -0.4)}),
            K('r', 0.5, None, legs={'M1': (0.2, 0.1)})), turn=(20, 120),
             bind=[B('yurtepica_thread_push', 'leg:M1:L:end', 'leg:M1:R:end', 0.3)],
             hits=[hit('legs', 28, 36, 'yurtepica_thread_push', 6, 'flinch', cost=10, status=('poison', 20))],
             sounds=[(26, 'galdros_swing')], ai=ai(0, 1.5, 50, 3)),
        move('threat', 80, 20, 60, A(
            K('w', 1.0, None, pitch=0.2, yH=0.08, bags=1.0, legs={'M1': (0.6, 1.0)}),
            K('s', 0.3, None, pitch=0.22, yH=0.1, bags=1.3, legs={'M1': (0.7, 1.1)}),
            K('s', 0.6, None, pitch=0.2, yH=0.08, bags=0.8, legs={'M1': (0.5, 0.9)}),
            K('s', 1.0, None, pitch=0.15, bags=1.0),
            K('r', 0.5, None, bags=0.2), shake=0.02, shakeIn='strike'),
             sounds=[(6, 'insect_buzz'), (30, 'hiss')], ai=ai(2, 7, 60, 0.7, cd=600)),
        move('bite', 56, 20, 26, A(
            K('w', 1.0, None, z=-0.05, pitch=0.12, headPitch=0.3, legs={'M1': (0.3, 0.5)}),
            K('s', 0.5, 'o', z=0.1, pitch=-0.1, headPitch=-0.25, legs={'M1': (0.5, 0.2)}),
            K('s', 1.0, None, z=0.1, pitch=-0.1, headPitch=-0.25),
            K('r', 0.5, None, z=0.03)),
             turn=(16, 140), bind=[B('yurtepica_bite', 'sp:5', 'sp:7', 0.22, ext=0.08)],
             hits=[hit('jaws', 20, 26, 'yurtepica_bite', 5, 'flinch', kind='cut', cost=8, status=('poison', 15))],
             sounds=[(18, 'hiss')], ai=ai(0, 1.2, 30, 2.5)),
        move('drip', 70, 28, 32, A(
            K('w', 1.0, None, pitch=-0.25, yH=0.06, bags=0.9, tailPitch=0.4),
            K('s', 0.5, 'o', pitch=0.05, bags=0.2),
            K('s', 1.0, None, pitch=0.05, bags=0.2),
            K('r', 0.5, None, bags=0.0)),
             hazards=[hazard(30, 2, 1.2, 0.8, 26, 18, 3, 'flinch', [0, 0.6, -0.5], 'poison', peak=1.4, status=('poison', 35))],
             sounds=[(4, 'hiss'), (28, 'splash')], ai=ai(0, 3.5, 180, 1.6, cd=300)),
        move('pounce', 76, 30, 36, A(
            K('w', 0.5, None, yH=-0.14, bags=-0.4, legs={'*': (0, 0.55)}),
            K('w', 0.8, 'o', yH=0.06, pitch=0.12, bags=0.6, legs={'M1': (0.6, 0.8)}),
            K('s', 0.4, 'i', yH=-0.08, pitch=-0.12, legs={'M1': (0.5, 0.2)}),
            K('s', 1.0, None, yH=-0.08, pitch=-0.12),
            K('r', 0.5, None, yH=-0.02), hop=0.3),
             curve=(1.8, 18, 32), turn=(16, 120), bind=[B('yurtepica_pounce', 'sp:4', 'sp:7', 0.25)],
             hits=[hit('jaws', 30, 36, 'yurtepica_pounce', 5, 'flinch', cost=8, status=('poison', 20))],
             sounds=[(18, 'gust'), (28, 'hiss')], ai=ai(1.2, 2.8, 30, 1.6, cd=260, clear=2)),
    ]


YURTEPICA_IDLE = idle(
    unaware=dict(pitch=-0.05), sway=0.0, nod=0.05, rate=0.9, alert=dict(pitch=0.06, bags=0.3), weak=dict(yH=-0.06, bags=-0.4),
    rage=dict(bags=0.5), run=dict(yH=-0.03, bags=-0.3), sleep=dict(yH=-0.25, bags=-0.6, legs={'*': (0, 0.7, -0.1)}),
    flinch=dict(pitch=0.15, bags=0.6, legs={'M1': (0.4, 0.6)}), topple=dict(roll=2.7, yH=0.1, legs={'*': (0.2, 0.8, 0.3)}),
    rise=dict(roll=0.0, pitch=0.1),
    dead=[(12, dict(yH=-0.1, legs={'*': (0, 0.5)})), (40, dict(roll=2.6, yH=0.05, bags=-0.4, legs={'*': (0.15, 1.2, -0.2)}))],
    graze=dict(pitch=-0.1, legs={'M1': (0.4, 0.4, -0.2)}),
    fidgets=[
        F('comb', 1.6, 'any', K('w', 0.3, None, legs={'M1': (0.6, 0.8, -0.3)}), K('w', 0.55, None, legs={'M1': (0.4, 0.6, 0.2)}),
          K('w', 0.8, None, legs={'M1': (0.6, 0.8, -0.3)})),
        F('puff', 1.0, 'any', K('w', 0.4, None, bags=0.9), K('w', 0.8, None, bags=-0.1)),
        F('spinner_wag', 1.0, 'any', K('w', 0.3, None, tailYaw=0.4, tailPitch=0.3), K('w', 0.7, None, tailYaw=-0.4)),
    ])


def hinasalv_moves(J):
    """21 ヒナサルヴ（キリサーヴの幼体）: 低い長い体（高さ 0.20）、頭 z 1.59 y 0.52（sp:10）、口先 z 1.76（sp:11）、短い 2 対の脚。背の小板（sail0〜7）"""
    return [
        move('ice_scatter', 90, 44, 48, A(
            K('w', 0.3, None, sail=0.6),
            K('w', 0.55, None, sail=0.2),
            K('w', 0.8, None, sail=0.8),
            K('w', 1.0, None, sail=1.1, neckPitch=0.2),
            K('s', 0.5, 'o', sail=0.3, neckPitch=-0.1),
            K('s', 1.0, None, sail=0.3),
            K('r', 0.5, None, sail=0.0), seq=True, shake=0.04, shakeIn='windup'), turn=(36, 90),
             hazards=[hazard(46, 3, 1.6, 0.9, 30, 8, 6, 'flinch', [0, 0.7, 0.3], 'ice', peak=1.6)],
             sounds=[(6, 'ice_crack'), (44, 'ice_crack')], ai=ai(1, 7, 60, 2.5, cd=260)),
        move('slide', 90, 30, 52, A(
            K('w', 1.0, None, yH=-0.3, neckPitch=-0.25, headPitch=0.1, sail=-0.4, fin=-0.8, legs={'*': (-0.5, 0.5)}),
            K('s', 0.1, 'o', yH=-0.35, neckPitch=-0.15, sail=-0.4, fin=-1.0, legs={'*': (-0.6, 0.6)}),
            K('s', 0.9, None, yH=-0.35, neckPitch=-0.15, sail=-0.4, fin=-1.0, legs={'*': (-0.6, 0.6)}),
            K('r', 0.4, None, yH=-0.1, neckPitch=0.1),
            K('r', 0.8, None, yH=-0.02), wiggle=0.1),
             curve=(4.0, 30, 52), bind=[B('hinasalv_slide', 'sp:8', 'sp:11', 0.3, ext=0.1)],
             hits=[hit('head', 30, 52, 'hinasalv_slide', 10, 'knockdown', cost=18)],
             sounds=[(4, 'hiss'), (30, 'galdros_charge')], ai=ai(2, 6, 25, 2, cd=260, clear=5)),
        *lr(lambda sd, n: move(f'tail_flick_{n}', 70, 28, 38, A(
            K('w', 1.0, None, spineYaw=0.3, tailYaw=-0.6, sail=0.4),
            K('s', 0.5, 'o', spineYaw=-0.3, tailYaw=1.1, roll=-0.1),
            K('s', 1.0, None, spineYaw=-0.35, tailYaw=1.25),
            K('r', 0.5, None, tailYaw=0.4)),
            side=sd, bind=[B(f'hinasalv_tail_flick_{n}', 'sp:3', 'sp:0', 0.3, ext=0.1)],
            hits=[hit('tail', 28, 38, f'hinasalv_tail_flick_{n}', 7, 'flinch', cost=12)],
            sounds=[(4, 'ice_crack'), (26, 'galdros_swing')], ai=ai(0, 2, 140, 2.5, minA=40, side=side_name(sd)))),
        move('threat', 90, 26, 70, A(
            K('w', 1.0, None, neckPitch=0.35, spinePitch=0.15, sail=1.2),
            K('s', 0.4, None, neckPitch=0.35, neckYaw=0.2, sail=1.3),
            K('s', 0.8, None, neckPitch=0.35, neckYaw=-0.2, sail=1.2),
            K('r', 0.5, None, sail=0.2), seq=True),
             sounds=[(6, 'hiss'), (30, 'ice_crack')], ai=ai(2.5, 8, 60, 0.7, cd=600)),
        move('bite', 64, 24, 30, A(
            K('w', 1.0, None, z=-0.1, neckPitch=0.4, headPitch=0.2),
            K('s', 0.5, 'o', z=0.2, neckPitch=-0.2),
            K('s', 1.0, None, z=0.2, neckPitch=-0.2),
            K('r', 0.5, None, z=0.05)),
             curve=(0.6, 22, 30), turn=(20, 120), bind=[B('hinasalv_bite', 'sp:9', 'sp:11', 0.25, ext=0.1)],
             hits=[hit('jaws', 24, 30, 'hinasalv_bite', 7, 'flinch', kind='cut', cost=12)],
             sounds=[(22, 'hiss')], ai=ai(0, 2.4, 30, 2.5)),
        move('frost_puff', 90, 40, 52, A(
            K('w', 1.0, None, neckPitch=0.3, headPitch=0.2, z=-0.08, sail=0.8),
            K('s', 0.3, 'o', neckPitch=-0.1, headPitch=-0.1, z=0.03, sail=0.9),
            K('s', 1.0, None, neckPitch=-0.12, headPitch=-0.1, sail=0.8),
            K('r', 0.5, None, sail=0.2), seq=True), turn=(34, 100),
             tracks=[track('hinasalv_frost_puff', 0.55, 1.8, [(40, [0, 0.5, 1.7], [0, -0.1, 1])])],
             hits=[hit('frost', 40, 52, 'hinasalv_frost_puff', 6, 'flinch', cost=10)],
             sounds=[(6, 'hiss'), (38, 'ice_crack')], vfx=[(40, 'frost_breath')], ai=ai(1, 3.6, 30, 1.8, cd=280)),
    ]


HINASALV_IDLE = idle(
    unaware=dict(neckPitch=-0.3), sway=0.35, nod=0.1, rate=0.6, alert=dict(neckPitch=0.2, sail=0.4, fin=0.25), weak=dict(neckPitch=-0.2, sail=-0.3),
    rage=dict(sail=0.6, fin=0.4), run=dict(neckPitch=-0.1, sail=-0.3, fin=-0.4), sleep=dict(spineYaw=0.6, neckYaw=0.7, neckPitch=-0.3, tailYaw=0.6, sail=-0.6, fin=-0.7),
    flinch=dict(neckPitch=0.35, sail=0.6), topple=dict(roll=1.6, sail=0.3, legs={'*': (0.2, 0.5, 0.3)}), rise=dict(roll=0.0, neckPitch=0.2),
    dead=[(12, dict(neckPitch=-0.3, sail=0.3)), (45, dict(roll=1.5, neckPitch=-0.45, spinePitch=0.35, tailPitch=-0.45, sail=-0.5))],
    graze=dict(neckPitch=-0.5, headPitch=-0.25),
    fidgets=[
        F('plate_shiver', 0.9, 'any', K('w', 0.5, None, sail=0.6), shake=0.03),
        F('nuzzle', 1.6, 'any', K('w', 0.4, None, neckYaw=0.7, neckPitch=-0.2), K('w', 0.8, None, neckYaw=0.6, neckPitch=-0.25)),
        F('tail_curl', 1.4, 'any', K('w', 0.4, None, tailYaw=0.6, tailCurl=0.4), K('w', 0.8, None, tailYaw=-0.3)),
    ])
