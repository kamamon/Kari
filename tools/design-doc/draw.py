# 制作計画・実装指示書 第 2 版の、大型モンスターの側面図（SVG）を描く部品。
# 設計書 v1.0 の「大型 12 種の制作原案」（p.16）の言葉から、Claude がコードで起こした下描き。
# ChatGPT の設定図ではない（採用済みの設定図があるのはガルドロスだけ）。右向き、地面は y = 200、画面は 400 × 240。
import math

def _spline(pts, n=14):
    """点の列を通る、なめらかな線（Catmull-Rom）"""
    if len(pts) < 3:
        return [(pts[0][0] + (pts[-1][0] - pts[0][0]) * i / n, pts[0][1] + (pts[-1][1] - pts[0][1]) * i / n) for i in range(n + 1)]
    p = [pts[0]] + list(pts) + [pts[-1]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = p[i - 1], p[i], p[i + 1], p[i + 2]
        for k in range(n):
            t = k / n
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in (0, 1)))
    out.append(tuple(pts[-1]))
    return out

def _pts(ps):
    return ' '.join(f'{x:.1f},{y:.1f}' for x, y in ps)

def taper(pts, w0, w1, fill, mid=None, op=1.0):
    """太さが変わる帯（脚・尾・首・長い胴）。w0 → w1（mid があれば、真ん中でその太さ）。両端は丸める"""
    line = _spline(pts)
    n = len(line) - 1
    left, right = [], []
    for i, (x, y) in enumerate(line):
        a, b = line[max(0, i - 1)], line[min(n, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        d = math.hypot(dx, dy) or 1
        t = i / n
        w = (w0 + (w1 - w0) * t) if mid is None else (w0 + (mid - w0) * (t * 2) if t < 0.5 else mid + (w1 - mid) * (t * 2 - 1))
        left.append((x - dy / d * w / 2, y + dx / d * w / 2))
        right.append((x + dy / d * w / 2, y - dx / d * w / 2))
    o = f' opacity="{op}"' if op < 1 else ''
    s = f'<polygon points="{_pts(left + right[::-1])}" fill="{fill}"{o}/>'
    s += f'<circle cx="{line[0][0]:.1f}" cy="{line[0][1]:.1f}" r="{w0 / 2:.1f}" fill="{fill}"{o}/>'
    s += f'<circle cx="{line[-1][0]:.1f}" cy="{line[-1][1]:.1f}" r="{w1 / 2:.1f}" fill="{fill}"{o}/>'
    return s

def ell(cx, cy, rx, ry, fill, rot=0, op=1.0, stroke=None, sw=1.5):
    t = f' transform="rotate({rot} {cx} {cy})"' if rot else ''
    o = f' opacity="{op}"' if op < 1 else ''
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ''
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}"{t}{o}{st}/>'

def poly(ps, fill, op=1.0, stroke=None, sw=1.5):
    o = f' opacity="{op}"' if op < 1 else ''
    st = f' stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"' if stroke else ''
    return f'<polygon points="{_pts(ps)}" fill="{fill}"{o}{st}/>'

def line(ps, stroke, sw=2, op=1.0):
    o = f' opacity="{op}"' if op < 1 else ''
    return f'<polyline points="{_pts(_spline(ps) if len(ps) > 2 else ps)}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linecap="round"{o}/>'

def leg(x, y, foot_x, w, fill, knee=0, ground=200, w1=None):
    """上（x, y）から地面（foot_x）までの脚。knee は、ひざを前後へ出す量"""
    w1 = w1 if w1 is not None else w * 0.55
    my = (y + ground) / 2
    return taper([(x, y), ((x + foot_x) / 2 + knee, my), (foot_x, ground - w1 / 2)], w, w1, fill) + ell(foot_x + w1 * 0.35, ground - w1 * 0.3, w1 * 0.8, w1 * 0.36, fill)

def eye(x, y, r=2.6, glow='#f6f1dc'):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{glow}"/><circle cx="{x + r * 0.25}" cy="{y}" r="{r * 0.5}" fill="#1c1c1c"/>'

def glow(x, y, r, color):
    return f'<circle cx="{x}" cy="{y}" r="{r * 2.1:.1f}" fill="{color}" opacity="0.22"/><circle cx="{x}" cy="{y}" r="{r:.1f}" fill="{color}"/><circle cx="{x - r * 0.25:.1f}" cy="{y - r * 0.3:.1f}" r="{r * 0.4:.1f}" fill="#ffffff" opacity="0.75"/>'

def frame(body, bg='#eef0ea'):
    """1 体ぶんの絵（背景・地面の影つき）"""
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" role="img">'
            f'<rect width="400" height="240" fill="{bg}"/><ellipse cx="200" cy="203" rx="150" ry="9" fill="#000" opacity="0.10"/>' + body + '</svg>')
