# 把 client.js 里的 SVG 场景按像素栅格化，用于检查构图（不依赖浏览器）
import re
import xml.etree.ElementTree as ET
from PIL import Image, ImageChops, ImageDraw

SRC = r"D:\Python\dsh-stand-reminder\assets\client.js"
SCALE = 6
BG = "#f6f7fb"

COLORS = {
    "hair": "#2b3142", "skin": "#f0b892", "shirt": "#4f7fe0", "pants": "#2f3648",
    "ink": "#1f2430", "chair": "#8b93a7", "wood": "#b07a45", "bezel": "#262b36",
    "screen": "#8fd8ff", "code": "#2f6f9e", "kb": "#cfd6e4", "cupbody": "#e8f5fd",
    "cupwater": "#4aa3e0", "cupshine": "#fbfeff", "cuprim": "#c7e4f4",
}

SCREEN_OFF = "#39415a"


def extract_svg(text):
    start = text.index("'    <svg class=\"scene\"")
    end = text.index("'    </svg>'") + len("'    </svg>'")
    block = text[start:end]
    parts = re.findall(r"'([^']*)'", block)
    return "".join(parts)


def points_of(node):
    return [tuple(float(v) for v in p.split(",")) for p in node.get("points").split()]


def arc_points(x1, y1, x2, y2, rx, ry, phi, large, sweep, steps=24):
    """按 SVG 规范 F.6.5 把端点参数化的椭圆弧采样成折线"""
    import math
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return [(x2, y2)]
    phi = math.radians(phi % 360)
    cos_p, sin_p = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p = cos_p * dx + sin_p * dy
    y1p = -sin_p * dx + cos_p * dy
    scale = (x1p ** 2) / (rx ** 2) + (y1p ** 2) / (ry ** 2)
    if scale > 1:
        rx, ry = rx * math.sqrt(scale), ry * math.sqrt(scale)
    num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    coef = math.sqrt(max(0.0, num / den)) if den else 0.0
    if large == sweep:
        coef = -coef
    cxp = coef * rx * y1p / ry
    cyp = -coef * ry * x1p / rx
    cx = cos_p * cxp - sin_p * cyp + (x1 + x2) / 2
    cy = sin_p * cxp + cos_p * cyp + (y1 + y2) / 2
    def angle(ux, uy, vx, vy):
        dot = ux * vx + uy * vy
        n = math.hypot(ux, uy) * math.hypot(vx, vy)
        a = math.acos(max(-1.0, min(1.0, dot / n))) if n else 0.0
        return -a if ux * vy - uy * vx < 0 else a
    ux, uy = (x1p - cxp) / rx, (y1p - cyp) / ry
    vx, vy = (-x1p - cxp) / rx, (-y1p - cyp) / ry
    theta1 = angle(1, 0, ux, uy)
    delta = angle(ux, uy, vx, vy)
    if not sweep and delta > 0:
        delta -= 2 * math.pi
    if sweep and delta < 0:
        delta += 2 * math.pi
    out = []
    for i in range(1, steps + 1):
        t = theta1 + delta * i / steps
        out.append((cx + rx * math.cos(t) * cos_p - ry * math.sin(t) * sin_p,
                    cy + rx * math.cos(t) * sin_p + ry * math.sin(t) * cos_p))
    return out


def path_points(d, scale=SCALE):
    """只支持绝对命令 M/L/H/V/A（够画电源符号）"""
    tokens = re.findall(r"[MLHVAmlhva]|-?\d*\.?\d+", d)
    pts, cur, i = [], (0.0, 0.0), 0
    while i < len(tokens):
        cmd = tokens[i]
        i += 1
        if cmd in "ML":
            cur = (float(tokens[i]), float(tokens[i + 1]))
            i += 2
            if cmd == "M":
                pts.append(cur)
        elif cmd == "H":
            cur = (float(tokens[i]), cur[1])
            i += 1
            pts.append(cur)
        elif cmd == "V":
            cur = (cur[0], float(tokens[i]))
            i += 1
            pts.append(cur)
        elif cmd == "v":
            cur = (cur[0], cur[1] + float(tokens[i]))
            i += 1
            pts.append(cur)
        elif cmd == "h":
            cur = (cur[0] + float(tokens[i]), cur[1])
            i += 1
            pts.append(cur)
        elif cmd == "A":
            rx, ry, phi = float(tokens[i]), float(tokens[i + 1]), float(tokens[i + 2])
            large, sweep = tokens[i + 3] == "1", tokens[i + 4] == "1"
            end = (float(tokens[i + 5]), float(tokens[i + 6]))
            i += 7
            pts.extend(arc_points(cur[0], cur[1], end[0], end[1], rx, ry, phi, large, sweep))
            cur = end
        else:
            raise ValueError("unsupported path command: " + cmd)
    return [(x * scale, y * scale) for x, y in pts]


def render(svg_text, mode):
    svg_text = svg_text.replace('viewBox="0 0 36 28"', 'viewBox="0 0 36 28" xmlns="http://www.w3.org/2000/svg"')
    root = ET.fromstring(svg_text)
    img = Image.new("RGB", (36 * SCALE, 28 * SCALE), BG)
    size = img.size

    pose = {"off": "pose-legsup", "boot": "pose-legsup", "away": "pose-none"}.get(mode, "pose-" + mode)
    pc_off = mode in ("boot", "off")

    # clipPath 定义：id -> 多边形点（单位坐标）
    clips = {}
    for node in root.iter():
        if node.tag.endswith("clipPath"):
            for child in node:
                if child.tag.endswith("polygon"):
                    clips[node.get("id")] = points_of(child)

    def mask_of(draw_fn, clip_pts):
        mask = Image.new("L", size, 0)
        draw_fn(ImageDraw.Draw(mask))
        if clip_pts:
            cmask = Image.new("L", size, 0)
            ImageDraw.Draw(cmask).polygon([(x * SCALE, y * SCALE) for x, y in clip_pts], fill=255)
            mask = ImageChops.multiply(mask, cmask)
        return mask

    def paint(fill, draw_fn, clip_pts):
        img.paste(Image.new("RGB", size, fill), (0, 0), mask_of(draw_fn, clip_pts))

    def walk(node, hidden, clip_pts):
        if node.tag.endswith("clipPath"):
            return
        cls = node.get("class", "")
        tokens = cls.split()
        if "pose-" in cls and pose not in tokens:
            hidden = True
        if "code" in tokens and pc_off:
            hidden = True
        if "power" in tokens and not pc_off:
            hidden = True
        ref = node.get("clip-path")
        if ref and ref.startswith("url(#"):
            clip_pts = clips.get(ref[5:-1])
        if not hidden:
            fill = node.get("fill")
            for token in (tokens if not fill else []):
                if token == "screen" and pc_off:
                    fill = SCREEN_OFF
                    break
                if token in COLORS:
                    fill = COLORS[token]
                    break
            if fill:
                tag = node.tag.split("}")[-1]
                if tag == "rect":
                    x = float(node.get("x")) * SCALE
                    y = float(node.get("y")) * SCALE
                    w = float(node.get("width")) * SCALE
                    h = float(node.get("height")) * SCALE
                    if node.get("id") == "cupWater":  # 水位按比例从底部画
                        level = 0.45
                        y += h * (1 - level)
                        h *= level
                    paint(fill, lambda d: d.rectangle([x, y, x + w - 1, y + h - 1], fill=255), clip_pts)
                elif tag == "polygon":
                    pts = [(a * SCALE, b * SCALE) for a, b in points_of(node)]
                    paint(fill, lambda d: d.polygon(pts, fill=255), clip_pts)
                elif tag == "circle":
                    cx = float(node.get("cx")) * SCALE
                    cy = float(node.get("cy")) * SCALE
                    r = float(node.get("r")) * SCALE
                    paint(fill, lambda d: d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=255), clip_pts)
            if node.tag.split("}")[-1] == "path" and node.get("stroke"):
                color = node.get("stroke")
                width = max(1, int(round(float(node.get("stroke-width", 1)) * SCALE)))
                pts = path_points(node.get("d"))
                if len(pts) > 1:
                    paint(color, lambda d: d.line(pts, fill=255, width=width, joint="curve"), clip_pts)
        for child in node:
            walk(child, hidden, clip_pts)

    walk(root, False, None)
    if mode == "boot":
        img = Image.blend(img, Image.new("RGB", size, BG), 0.25)
    return img


svg = extract_svg(open(SRC, encoding="utf-8").read())
for mode in ("sit", "sip", "stand", "walk", "away", "boot", "off"):
    out = rf"D:\Python\dsh-stand-reminder\test\scene-{mode}.png"
    render(svg, mode).resize((36 * 12, 28 * 12), Image.NEAREST).save(out)
    print("saved", out)
