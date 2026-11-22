"""Draws the NEOPAPER web icons from the NEOPAPER launcher glyph (108-unit viewport). No dependencies.

    python3 tools/make_icons.py
"""
import struct, zlib, pathlib

BG = (0x0E, 0x0E, 0x11)
ORANGE = (0xFF, 0x6A, 0x13)
INK = (0x14, 0x14, 0x14)
CARD = [(36, 30), (66, 30), (72, 36), (72, 78), (42, 78), (36, 72)]
# Dark marks on the card: QR finder ring + dot, two text lines, a rule and barcode bars.
RECTS = [(54, 36, 13, 3), (54, 41, 9, 2), (41, 49, 26, 1.5), (45, 39, 2, 2)]
RECTS += [(x, 62, w, 11) for x, w in [(41, 2), (44.5, 1), (47, 3), (51.5, 1), (54, 2), (57.5, 1), (60, 3), (64.5, 1), (66, 1)]]
RING = ((41, 35, 10, 10), (43, 37, 6, 6))

def in_poly(x, y, pts):
    inside = False
    for i in range(len(pts)):
        (x1, y1), (x2, y2) = pts[i], pts[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside

def in_rect(x, y, r):
    return r[0] <= x < r[0] + r[2] and r[1] <= y < r[1] + r[3]

def sample(x, y):
    if not in_poly(x, y, CARD):
        return None
    if any(in_rect(x, y, r) for r in RECTS) or (in_rect(x, y, RING[0]) and not in_rect(x, y, RING[1])):
        return INK
    return ORANGE

def render(size, span, bg=BG, ss=4):
    """span: how many viewport units (centred on 54,54) the image covers."""
    o = 54 - span / 2
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = sample(o + (px + (sx + .5) / ss) * span / size, o + (py + (sy + .5) / ss) * span / size)
                    if c is None:
                        if bg is None: continue
                        c = bg
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = ss * ss
            a = acc[3] / n
            if a: row += bytes([round(acc[0] / n * 255 / a), round(acc[1] / n * 255 / a), round(acc[2] / n * 255 / a), round(a)])
            else: row += bytes(4)
        rows.append(bytes(row))
    return rows

def png(path, size, rows):
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(rows)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    pathlib.Path(path).write_bytes(data)

out = pathlib.Path(__file__).resolve().parent.parent / 'icons'
out.mkdir(exist_ok=True)
for name, size, span in [('icon-192.png', 192, 64), ('icon-512.png', 512, 64), ('apple-touch-icon.png', 180, 64), ('icon-maskable-512.png', 512, 80)]:
    png(out / name, size, render(size, span))
    print('wrote', name)

marks = ''.join(f'<rect x="{x}" y="{y}" width="{w}" height="{h}"/>' for x, y, w, h in RECTS)
(out / 'favicon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="28 28 52 52">'
    f'<path fill="#FF6A13" d="M{" L".join(f"{x},{y}" for x, y in CARD)} Z"/>'
    f'<g fill="#141414">{marks}<path fill-rule="evenodd" d="M41,35h10v10h-10z M43,37v6h6v-6z"/></g></svg>\n')
print('wrote favicon.svg')
