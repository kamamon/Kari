# 大型 13 種のうち、設定図の無い 12 種の側面図（Claude の下描き）。言葉の元は設計書 v1.0 p.16 と docs/elements.md。
import math
from draw import taper, ell, poly, line, leg, eye, glow, frame, _spline

def along(pts, t):
    """線の上の位置（0〜1）と、向き（度）"""
    ln = _spline(pts)
    i = min(len(ln) - 2, max(0, int(t * (len(ln) - 1))))
    (x0, y0), (x1, y1) = ln[i], ln[i + 1]
    return x0, y0, math.degrees(math.atan2(y1 - y0, x1 - x0))

def servalk():
    B, D, L, A = '#9aa48f', '#727b6a', '#c9cfbd', '#d7e6cf'
    s = line([(40, 96), (78, 90), (104, 100)], '#9fb7b0', 2, .7) + line([(30, 118), (70, 112), (96, 122)], '#9fb7b0', 2, .5)
    s += leg(152, 138, 140, 9, D, knee=-6, w1=4.5) + leg(252, 138, 264, 8, D, knee=4, w1=4.5)
    s += taper([(120, 126), (100, 118), (86, 126)], 7, 3, B)
    s += ell(190, 126, 72, 25, B) + ell(246, 124, 28, 25, B) + ell(190, 138, 58, 11, L, op=.5)
    s += leg(138, 136, 124, 11, B, knee=-13, w1=4.5) + leg(246, 138, 260, 9, B, knee=6, w1=5)
    s += taper([(258, 116), (280, 96), (296, 82)], 20, 13, B)
    # 帆のような角膜（分割角膜）: 骨の筋のあいだに膜
    s += poly([(298, 72), (246, 34), (262, 16), (290, 8)], A, .85, '#7f9a86') + poly([(304, 72), (300, 6), (328, 10), (348, 30)], '#eaf2dc', .85, '#7f9a86')
    for p in [(246, 34), (262, 16), (290, 8), (300, 6), (328, 10), (348, 30)]:
        s += line([(301, 72), p], '#5d6b58', 2)
    s += ell(308, 80, 20, 11, B, rot=12) + ell(325, 86, 9, 6, B, rot=20) + eye(314, 78)
    return frame(s)

def numeradon():
    B, D, L, M = '#7c7a55', '#5b5a3f', '#b9b48c', '#5a4330'
    s = leg(142, 160, 138, 16, D, w1=11) + leg(250, 160, 254, 16, D, w1=11)
    s += taper([(98, 150), (72, 158), (52, 174)], 24, 6, B)
    s += ell(190, 148, 100, 36, B) + ell(190, 166, 86, 15, L, op=.8)
    s += leg(120, 166, 116, 21, B, w1=13) + leg(262, 166, 268, 21, B, w1=13)
    s += ell(300, 150, 36, 26, B) + ell(318, 163, 24, 11, L)
    # 頭の泥受け皿と、こぼれる泥
    s += poly([(262, 130), (342, 130), (332, 112), (272, 112)], '#8d8866', 1, '#55533a')
    s += ell(302, 111, 31, 9, M) + taper([(280, 116), (278, 130), (279, 142)], 5, 2, M) + taper([(324, 116), (327, 130)], 4, 2, M)
    s += eye(324, 146) + ell(362, 193, 11, 8, M) + ell(380, 196, 6, 4, M)
    return frame(s)

def bornakel():
    B, D, S, S2 = '#8a7a66', '#64584a', '#d9b39a', '#a8765f'
    s = leg(146, 150, 142, 18, D, w1=12) + leg(248, 150, 252, 18, D, w1=12)
    s += taper([(102, 130), (82, 134), (66, 148)], 14, 5, B)
    s += ell(186, 128, 92, 42, B)
    # 三つの共鳴嚢: のどに 1 つ、背に 2 つ
    for cx, cy, rx, ry in [(150, 90, 21, 18), (203, 82, 25, 21), (288, 150, 23, 25)]:
        s += ell(cx, cy, rx, ry, S, stroke=S2, sw=2) + ell(cx - rx * .3, cy - ry * .35, rx * .3, ry * .22, '#fff', op=.45)
    s += leg(126, 158, 120, 22, B, w1=14) + leg(258, 158, 264, 22, B, w1=14)
    s += poly([(280, 96), (330, 98), (348, 128), (338, 144), (292, 138)], B) + ell(318, 118, 24, 20, B) + eye(328, 112)
    for k, x in enumerate((356, 368, 380)):
        s += line([(x, 94 - k * 4), (x + 9, 118), (x, 142 + k * 4)], '#b9a98c', 2, .8 - k * .2)
    return frame(s)

def ashreia():
    B, D, W, A = '#8e8f8a', '#63645f', '#b9b8b0', '#75766f'
    s = ell(92, 182, 44, 10, '#8c8c86', op=.35) + ell(60, 166, 30, 8, '#8c8c86', op=.25) + ell(130, 190, 34, 7, '#8c8c86', op=.3)
    s += leg(198, 148, 208, 8, D, knee=10, w1=5)
    s += taper([(142, 118), (102, 130), (72, 152)], 16, 3, A, op=.95) + taper([(144, 124), (110, 148), (88, 172)], 12, 3, D)
    s += ell(182, 122, 48, 30, B, rot=-12)
    # 布のように垂れる短い翼
    s += poly([(150, 102), (216, 98), (224, 150), (208, 144), (198, 170), (186, 148), (172, 174), (162, 150), (146, 162)], W, .96, '#77786f')
    for x in (166, 184, 202):
        s += line([(x, 106), (x + 2, 146)], '#77786f', 1.5, .7)
    s += leg(182, 150, 188, 9, B, knee=12, w1=5)
    s += taper([(212, 108), (250, 86), (264, 52), (282, 36)], 18, 9, B)
    s += ell(292, 31, 14, 9, B, rot=10) + poly([(302, 26), (328, 35), (302, 37)], '#3a3a36') + eye(294, 29)
    return frame(s)

def lumiska():
    B, D, G = '#56635f', '#3c4643', '#d9f27a'
    s = leg(202, 140, 216, 10, D, knee=14, w1=6)
    tail = [(152, 120), (112, 104), (72, 96), (34, 104)]
    s += taper(tail, 14, 7, B)
    for t, r in ((.25, 6), (.5, 6.5), (.75, 7), (1, 8.5)):
        x, y, _ = along(tail, min(t, .999))
        s += glow(x, y, r, G)
    s += ell(192, 118, 46, 28, B, rot=-8) + poly([(170, 104), (216, 104), (198, 130), (168, 124)], D)
    s += leg(186, 140, 198, 13, B, knee=16, w1=7)
    s += taper([(226, 104), (252, 84), (264, 66)], 16, 10, B)
    s += ell(274, 60, 15, 10, B) + poly([(286, 56), (308, 62), (286, 66)], '#d9c05a') + glow(264, 47, 3.5, G) + eye(278, 58)
    s += line([(318, 62), (386, 62)], G, 2, .45)
    return frame(s, '#e9ece6')

def orglass():
    B, B2, P, PS = '#9c8f7c', '#7d7262', '#bfe3ea', '#7fb9c6'
    s = ''
    for x0, x1 in ((150, 104), (128, 82), (172, 126)):
        s += taper([(x0, 158), (x1 + 14, 148), (x1, 198)], 9, 4, B2)
    for x0, x1 in ((236, 276), (256, 298), (216, 254)):
        s += taper([(x0, 160), (x1 - 12, 150), (x1, 198)], 9, 4, B2)
    s += ell(190, 152, 84, 30, B)
    # 背の透明な板
    s += poly([(118, 142), (150, 92), (190, 84), (182, 138)], P, .62, PS) + poly([(186, 138), (198, 78), (242, 86), (250, 136)], P, .62, PS) + poly([(252, 138), (252, 96), (284, 110), (278, 142)], P, .62, PS)
    s += line([(150, 92), (166, 138)], '#fff', 1.5, .6) + line([(214, 82), (222, 136)], '#fff', 1.5, .6)
    # 大きな鋏と、小さな鋏
    s += taper([(262, 152), (300, 132), (322, 122)], 16, 14, B) + poly([(314, 104), (374, 94), (350, 118), (374, 134), (316, 136)], B2, 1, '#5c5347')
    s += taper([(124, 156), (98, 146), (84, 140)], 10, 8, B) + poly([(88, 130), (58, 128), (72, 140), (58, 150), (88, 150)], B2)
    s += line([(214, 134), (220, 116)], B2, 3) + glow(221, 113, 3, '#f1f6d0') + line([(196, 134), (196, 116)], B2, 3) + glow(196, 113, 3, '#f1f6d0')
    return frame(s)

def tengalo():
    B, D, H = '#7a3f35', '#57302a', '#e0b05a'
    s = ''
    cx, cy, R = 196, 178, 96
    n = 9
    for i in range(n):
        a = math.radians(186 - i * (192 / (n - 1)))
        x, y = cx + R * math.cos(a), cy - R * math.sin(a)
        ix, iy = cx + (R - 34) * math.cos(a), cy - (R - 34) * math.sin(a)
        s += taper([(x, y), ((x + ix) / 2 + 4, (y + iy) / 2), (ix, iy)], 5, 2.5, D)
    for i in range(n):
        a = math.radians(186 - i * (192 / (n - 1)))
        x, y = cx + R * math.cos(a), cy - R * math.sin(a)
        rot = -math.degrees(a) + 90
        ox, oy = math.cos(a), -math.sin(a)
        tx, ty = -math.sin(a), -math.cos(a)
        # 外側の鉤
        s += poly([(x + ox * 14 - tx * 9, y + oy * 14 - ty * 9), (x + ox * 40 + tx * 14, y + oy * 40 + ty * 14), (x + ox * 14 + tx * 7, y + oy * 14 + ty * 7)], H, 1, '#9a7434')
        s += ell(round(x, 1), round(y, 1), 21, 17, B if i % 2 else '#874a3e', rot=round(rot, 1), stroke=D, sw=1.5)
    a = math.radians(186 - 192)
    hx, hy = cx + R * math.cos(a) + 6, cy - R * math.sin(a) + 2
    s += ell(round(hx, 1), round(hy, 1), 18, 14, D) + poly([(hx + 12, hy - 4), (hx + 34, hy + 2), (hx + 14, hy + 4)], H) + poly([(hx + 10, hy + 6), (hx + 30, hy + 14), (hx + 10, hy + 12)], H) + eye(round(hx + 4, 1), round(hy - 5, 1), 2.4)
    return frame(s)

def velito():
    B, D, S, SS = '#8d86a8', '#665f80', '#ece8f6', '#a9a2c8'
    s = ell(70, 118, 38, 10, '#cfc9e6', op=.45) + ell(326, 172, 42, 10, '#cfc9e6', op=.4) + ell(110, 186, 30, 7, '#cfc9e6', op=.35)
    s += line([(114, 150), (82, 162), (52, 150), (26, 166)], '#f4f2fb', 2.5)
    for x0, x1 in ((150, 132), (178, 166), (212, 204), (232, 242)):
        s += taper([(x0, 146), ((x0 + x1) / 2 - 6, 172), (x1, 198)], 4.5, 2, D)
    s += ell(162, 140, 50, 22, B, rot=-10) + ell(224, 128, 28, 20, B) + ell(260, 122, 14, 12, B)
    for x in (136, 156, 176):
        s += line([(x, 124), (x + 6, 156)], D, 1.5, .6)
    # 袋のような羽の器官
    s += ell(190, 90, 45, 26, S, op=.9, stroke=SS, sw=2) + ell(234, 82, 30, 20, S, op=.9, stroke=SS, sw=2) + ell(176, 82, 14, 7, '#fff', op=.6)
    s += line([(268, 114), (286, 96), (300, 98)], D, 2) + line([(266, 118), (290, 110), (304, 116)], D, 2) + glow(264, 121, 2.6, '#f3f0ff')
    return frame(s, '#ecebf0')

def razmel():
    B, D, R = '#7d7462', '#5a5346', '#ece6d6'
    body = [(28, 188), (82, 152), (140, 178), (200, 142), (260, 166), (312, 122), (350, 98)]
    s = ''
    for t in (.5, .78):
        x, y, _ = along(body, t)
        s += taper([(x - 6, y + 4), (x - 16, y + 24), (x - 10, 198)], 10, 6, D)
    s += taper(body, 8, 22, B, mid=30)
    # 骨の環
    for t in (.14, .26, .38, .5, .62, .74, .86):
        x, y, ang = along(body, t)
        w = 8 + (30 - 8) * (t * 2) if t < .5 else 30 + (22 - 30) * (t * 2 - 1)
        s += ell(round(x, 1), round(y, 1), 5.5, round(w / 2 + 5, 1), R, rot=round(ang, 1), stroke='#b9b19c', sw=1.2)
    for t in (.5, .78):
        x, y, _ = along(body, t)
        s += taper([(x + 4, y + 6), (x + 12, y + 26), (x + 20, 198)], 12, 7, B)
    s += ell(364, 90, 21, 13, B, rot=-22) + poly([(374, 78), (396, 76), (378, 90)], D) + eye(368, 84)
    return frame(s)

def kirisarv():
    B, D, I, IS = '#9fb6c2', '#748c99', '#d6f1fb', '#86c6de'
    body = [(24, 190), (90, 176), (150, 188), (220, 170), (290, 180), (340, 150), (366, 120)]
    s = ''
    for x in (40, 62, 84):
        s += poly([(x, 198), (x + 7, 180), (x + 13, 198)], I, .8, IS, 1)
    s += taper(body, 8, 20, B, mid=27)
    # 交互に並ぶ氷の薄板
    for k, t in enumerate((.16, .27, .38, .49, .6, .71, .82, .92)):
        x, y, ang = along(body, t)
        lean = 16 if k % 2 else -14
        h = 34 + 14 * math.sin(t * math.pi)
        s += poly([(x - 9, y - 8), (x + lean, y - 8 - h), (x + 9, y - 8)], I, .78, IS, 1.2)
    s += ell(376, 112, 18, 11, B, rot=-32) + eye(380, 106)
    for dx, dy in ((14, -12), (22, -2), (12, 6)):
        s += poly([(388 + dx - 4, 104 + dy), (388 + dx + 2, 98 + dy), (388 + dx + 4, 106 + dy)], I, .8, IS, 1) if 388 + dx + 4 < 400 else ''
    return frame(s, '#eaf0f2')

def velgait():
    B, D, G = '#3d4c5e', '#293340', '#9fe8e0'
    s = ell(346, 122, 13, 13, G, op=.3) + ell(372, 150, 9, 9, G, op=.25) + ell(330, 160, 7, 7, G, op=.3)
    s += leg(152, 138, 146, 9, D, knee=-6, w1=5) + leg(252, 138, 260, 9, D, knee=5, w1=5)
    tail = [(120, 124), (88, 110), (62, 118), (42, 104)]
    s += taper(tail, 9, 3, B) + glow(42, 104, 5, G)
    s += ell(192, 126, 74, 24, B)
    s += leg(138, 136, 128, 11, B, knee=-10, w1=5.5) + leg(248, 138, 258, 10, B, knee=6, w1=5.5)
    s += taper([(258, 116), (284, 96), (298, 78)], 18, 12, B)
    # 環の頭冠と、背の 6 つの灯節
    s += ell(302, 44, 22, 22, 'none', stroke=G, sw=5) + ell(302, 44, 22, 22, 'none', stroke='#fff', sw=1.2, op=.7)
    s += ell(310, 72, 18, 11, B, rot=8) + ell(326, 77, 8, 6, B, rot=14) + glow(316, 70, 2.6, G)
    for i in range(6):
        s += glow(132 + i * 24, 103 - 3 * math.sin(i / 5 * math.pi), 5, G)
    return frame(s, '#e6eaec')

def embarg():
    B, D, P, F, F2 = '#3a3431', '#262220', '#231f1d', '#ff8a2a', '#ffd27a'
    s = ''
    for x in (150, 196, 236):
        s += line([(x, 88), (x - 5, 66), (x + 4, 46), (x - 2, 28)], F, 2.2, .45)
    s += leg(148, 150, 144, 16, D, w1=11) + leg(246, 150, 250, 16, D, w1=11)
    s += taper([(106, 130), (78, 126), (54, 140)], 16, 6, B) + glow(52, 141, 4, F)
    s += ell(188, 130, 88, 38, B)
    # 胸から腹の「炉」と、殻のすき間の光
    s += ell(228, 148, 42, 20, F, op=.95) + ell(230, 148, 27, 12, F2)
    s += line([(120, 138), (152, 150), (184, 142)], F, 3) + line([(140, 120), (170, 126)], F, 2.5, .8)
    s += poly([(110, 114), (162, 90), (232, 88), (276, 110), (258, 126), (232, 118), (196, 128), (150, 122), (126, 130)], P, 1, '#141211')
    for x in (150, 196, 236):
        s += poly([(x - 9, 94), (x - 6, 80), (x + 6, 80), (x + 9, 94)], '#4a4340', 1, '#141211') + ell(x, 80, 6, 2.5, F)
    s += leg(126, 158, 120, 20, B, w1=13) + leg(260, 158, 266, 20, B, w1=13)
    s += ell(302, 120, 30, 22, B) + poly([(280, 100), (320, 96), (338, 110), (300, 112)], P) + line([(298, 133), (328, 131)], F, 3) + glow(316, 114, 3, F)
    return frame(s, '#ece8e4')

DRAW = {'servalk': servalk, 'numeradon': numeradon, 'bornakel': bornakel, 'ashreia': ashreia, 'lumiska': lumiska, 'orglass': orglass,
        'tengalo': tengalo, 'velito': velito, 'razmel': razmel, 'kirisarv': kirisarv, 'velgait': velgait, 'embarg': embarg}

if __name__ == '__main__':
    import sys
    out = sys.argv[1]
    cells = ''.join(f'<div style="width:400px"><div style="font:14px sans-serif">{k}</div>{f()}</div>' for k, f in DRAW.items())
    open(out, 'w', encoding='utf8').write(f'<!doctype html><meta charset="utf8"><body style="margin:8px;display:grid;grid-template-columns:repeat(4,400px);gap:6px;background:#fff">{cells}</body>')
