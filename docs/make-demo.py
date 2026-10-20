"""Renders docs/how-it-works.gif, the animated explainer in the README.

Needs Pillow and ffmpeg on PATH. Run from the repo root:  python docs/make-demo.py
"""
import math
import os
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont

W, H, S = 880, 460, 2          # output size, supersampling factor
FPS, DUR = 15, 13.0
FONTS = "C:/Windows/Fonts/" if os.name == "nt" else "/usr/share/fonts/truetype/dejavu/"

BG = (11, 18, 32)
PANEL = (22, 31, 50)
EDGE = (45, 58, 84)
TEXT = (230, 236, 245)
MUTED = (140, 152, 175)
GREEN = (30, 142, 62)
BLUE = (26, 115, 232)
ORANGE = (246, 130, 31)
PINK = (236, 72, 153)
WHITE = (255, 255, 255)


def font(size, bold=False):
    names = ["segoeuib.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"] if bold else ["segoeui.ttf", "arial.ttf", "DejaVuSans.ttf"]
    for n in names:
        try:
            return ImageFont.truetype(FONTS + n, size * S)
        except OSError:
            pass
    return ImageFont.load_default()


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def seg(t, a, b):
    """0→1 progress of t through [a, b]."""
    return ease((t - a) / (b - a))


def mix(c1, c2, k):
    return tuple(int(a + (b - a) * k) for a, b in zip(c1, c2))


class Canvas:
    def __init__(self):
        self.im = Image.new("RGB", (W * S, H * S), BG)
        self.d = ImageDraw.Draw(self.im)

    def rect(self, x0, y0, x1, y1, fill, r=10, outline=None, width=1):
        self.d.rounded_rectangle((x0 * S, y0 * S, x1 * S, y1 * S), r * S, fill=fill, outline=outline, width=width * S)

    def circle(self, x, y, r, fill, outline=None, width=1):
        self.d.ellipse(((x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S), fill=fill, outline=outline, width=width * S)

    def line(self, pts, fill, width=2):
        self.d.line([(x * S, y * S) for x, y in pts], fill=fill, width=width * S, joint="curve")

    def text(self, x, y, s, size=13, fill=TEXT, bold=False, anchor="la"):
        self.d.text((x * S, y * S), s, font=font(size, bold), fill=fill, anchor=anchor)

    def tick(self, x, y, fill, size=7):
        self.line([(x, y), (x + size * 0.4, y + size * 0.45), (x + size, y - size * 0.55)], fill, 2)

    def frame(self):
        return self.im.resize((W, H), Image.Resampling.LANCZOS)


def wrap(c, s, size, width):
    f, words, lines, cur = font(size), s.split(), [], ""
    for w in words:
        nxt = (cur + " " + w).strip()
        if c.d.textlength(nxt, font=f) / S > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = nxt
    return lines + [cur]


STEPS = [
    (0.0, "You hit Send. The extension adds a hidden 1×1 pixel, wraps your links and registers the email with your Worker."),
    (2.8, "The email goes out through Gmail as usual. Nothing changes for the recipient."),
    (4.9, "Bob opens it. His mail app loads the pixel from your Worker, which logs the open in your D1 database."),
    (7.0, "Every minute the extension asks your Worker for new opens and clicks…"),
    (8.8, "…so the Sent badge turns green and a desktop notification pops up. Link clicks work the same way."),
]

LEFT, MID, RIGHT = (24, 70, 330, 340), (360, 70, 520, 340), (550, 70, 856, 340)


def panel(c, box, title, active):
    x0, y0, x1, y1 = box
    c.rect(x0, y0, x1, y1, PANEL, 14, mix(EDGE, (90, 120, 170), active), 1 + int(active > 0.5))
    c.text(x0 + 14, y0 + 12, title, 12, MUTED, True)


def compose(c, t, alpha):
    if alpha <= 0:
        return
    x0, y0 = 40, 106
    fg = lambda col: mix(PANEL, col, alpha)
    c.rect(x0, y0, x0 + 274, y0 + 200, fg((250, 251, 253)), 10)
    c.rect(x0, y0, x0 + 274, y0 + 28, fg((64, 72, 92)), 10)
    c.text(x0 + 12, y0 + 7, "New message", 11, fg(WHITE), True)
    c.text(x0 + 12, y0 + 40, "To   bob@example.com", 11, fg((40, 44, 52)))
    c.line([(x0 + 10, y0 + 60), (x0 + 264, y0 + 60)], fg((225, 228, 234)), 1)
    c.text(x0 + 12, y0 + 68, "Q3 plan", 11, fg((40, 44, 52)), True)
    c.line([(x0 + 10, y0 + 88), (x0 + 264, y0 + 88)], fg((225, 228, 234)), 1)
    for i, w in enumerate((220, 180, 200)):
        c.rect(x0 + 12, y0 + 100 + i * 14, x0 + 12 + w, y0 + 106 + i * 14, fg((222, 226, 233)), 3)
    pressed = 1.0 if 2.0 <= t < 2.25 else 0.0
    c.rect(x0 + 12, y0 + 162, x0 + 82, y0 + 188, fg(mix(BLUE, (14, 70, 160), pressed)), 13)
    c.text(x0 + 47, y0 + 175, "Send", 12, fg(WHITE), True, "mm")
    # Track toggle
    c.text(x0 + 172, y0 + 175, "Track", 11, fg((40, 44, 52)), True, "lm")
    c.rect(x0 + 212, y0 + 166, x0 + 246, y0 + 184, fg(GREEN), 9)
    c.circle(x0 + 237, y0 + 175, 7, fg(WHITE))
    # pixel being added, just before send
    k = seg(t, 0.6, 1.2) * alpha
    if k > 0:
        c.rect(x0 + 232, y0 + 126, x0 + 240, y0 + 134, mix(PANEL, PINK, k), 2)
        c.text(x0 + 228, y0 + 130, "1×1 pixel", 10, mix(PANEL, PINK, k), True, "rm")
    # cursor
    cx = x0 + 47 + (1 - seg(t, 1.0, 1.9)) * 140
    cy = y0 + 178 + (1 - seg(t, 1.0, 1.9)) * -60
    if alpha > 0.5 and t < 2.6:
        c.d.polygon([(cx * S, cy * S), ((cx + 4) * S, (cy + 15) * S), ((cx + 7) * S, (cy + 9) * S), ((cx + 13) * S, (cy + 9) * S)],
                    fill=WHITE, outline=(20, 20, 20))


def sent_list(c, t, alpha):
    if alpha <= 0:
        return
    fg = lambda col: mix(PANEL, col, alpha)
    x0, y0 = 40, 106
    c.text(x0, y0, "Sent", 13, fg(TEXT), True)
    rows = [("To: bob", "Q3 plan", None), ("To: alice", "Invoice #42", 2), ("To: team", "Lunch Friday?", 0)]
    opened = seg(t, 8.8, 9.1)
    for i, (who, subj, n) in enumerate(rows):
        y = y0 + 26 + i * 36
        c.rect(x0, y, x0 + 274, y + 30, fg((32, 43, 66)), 6)
        c.text(x0 + 10, y + 15, who, 11, fg(MUTED), anchor="lm")
        bx = x0 + 78
        if i == 0:
            n = 1 if opened > 0 else 0
        if n:
            pop = 1 + 0.25 * math.sin(math.pi * opened) if i == 0 else 1
            w = 34 * pop
            c.rect(bx, y + 15 - 9 * pop, bx + w, y + 15 + 9 * pop, fg(GREEN), 4)
            c.tick(bx + 4, y + 15, fg(WHITE), 6)
            c.tick(bx + 10, y + 15, fg(WHITE), 6)
            c.text(bx + 25 * pop, y + 15, str(n), 10, fg(WHITE), True, "mm")
        else:
            c.rect(bx, y + 6, bx + 22, y + 24, fg((60, 72, 96)), 4)
            c.tick(bx + 7, y + 15, fg(TEXT), 7)
        c.text(bx + 44, y + 15, subj, 11, fg(TEXT), i == 0, "lm")


def toast(c, t):
    k = seg(t, 9.0, 9.5)
    if k <= 0:
        return
    y = 344 - 80 * k
    c.rect(40, y, 314, y + 62, mix(BG, (250, 251, 253), k), 10)
    c.circle(66, y + 31, 13, mix(BG, (220, 240, 226), k))
    c.d.ellipse(((58) * S, (y + 26) * S, (74) * S, (y + 36) * S), outline=mix(BG, GREEN, k), width=2 * S)
    c.circle(66, y + 31, 3, mix(BG, GREEN, k))
    c.text(88, y + 14, "bob@example.com opened your email", 11, mix(BG, (30, 33, 40), k), True)
    c.text(88, y + 34, "“Q3 plan” · via Gmail", 11, mix(BG, (90, 96, 108), k))


def worker(c, t):
    glow = seg(t, 6.2, 6.5) * (1 - seg(t, 7.2, 7.8)) + seg(t, 7.0, 7.3) * (1 - seg(t, 7.9, 8.4))
    cx, cy = 440, 140
    col = mix((200, 110, 30), ORANGE, glow)
    for dx, dy, r in ((-20, 6, 16), (0, -4, 22), (22, 6, 16)):
        c.circle(cx + dx, cy + dy, r, col)
    c.rect(cx - 36, cy + 4, cx + 38, cy + 22, col, 9)
    c.text(cx, cy + 40, "Worker", 12, TEXT, True, "mm")
    # D1 cylinder
    dx0, dy0 = 410, 200
    c.rect(dx0, dy0, dx0 + 60, dy0 + 46, (56, 70, 100), 6)
    c.d.ellipse((dx0 * S, (dy0 - 7) * S, (dx0 + 60) * S, (dy0 + 7) * S), fill=(80, 98, 136))
    c.text(dx0 + 30, dy0 + 26, "D1", 12, TEXT, True, "mm")
    k = seg(t, 6.4, 6.8)
    if k > 0:
        c.rect(372, 262, 508, 296, mix(PANEL, (36, 62, 48), k), 6, mix(PANEL, GREEN, k))
        c.text(440, 273, "open logged", 10, mix(PANEL, (150, 230, 170), k), True, "mm")
        c.text(440, 287, "Q3 plan · via Gmail", 9, mix(PANEL, MUTED, k), anchor="mm")


def recipient(c, t):
    x0, y0 = 566, 100
    c.rect(x0, y0, x0 + 274, y0 + 222, (250, 251, 253), 10)
    c.text(x0 + 12, y0 + 10, "Inbox · bob@example.com", 10, (110, 116, 128), True)
    arrived = seg(t, 4.1, 4.4)
    open_k = seg(t, 5.0, 5.4)
    if open_k < 1:
        y = y0 + 34
        a = arrived * (1 - open_k)
        c.rect(x0 + 8, y, x0 + 266, y + 34, mix((250, 251, 253), (232, 240, 254), a), 6)
        c.text(x0 + 18, y + 17, "You", 11, mix((250, 251, 253), (30, 33, 40), a), True, "lm")
        c.text(x0 + 60, y + 17, "Q3 plan — here's the draft…", 11, mix((250, 251, 253), (30, 33, 40), a), True, "lm")
        for i in range(3):
            yy = y + 44 + i * 30
            c.rect(x0 + 18, yy + 10, x0 + 70, yy + 16, (225, 229, 236), 3)
            c.rect(x0 + 80, yy + 10, x0 + 240, yy + 16, (232, 235, 241), 3)
    if open_k > 0:
        fg = lambda col: mix((250, 251, 253), col, open_k)
        c.text(x0 + 14, y0 + 36, "Q3 plan", 14, fg((30, 33, 40)), True)
        c.text(x0 + 14, y0 + 60, "From: you@gmail.com", 10, fg((110, 116, 128)))
        for i, w in enumerate((230, 200, 215, 150)):
            c.rect(x0 + 14, y0 + 84 + i * 16, x0 + 14 + w, y0 + 91 + i * 16, fg((222, 226, 233)), 3)
        c.text(x0 + 14, y0 + 158, "docs.example.com/q3", 10, fg(BLUE))
        pk = seg(t, 5.4, 5.7) * (1 - seg(t, 7.2, 7.6))
        if pk > 0:
            c.rect(x0 + 200, y0 + 182, x0 + 210, y0 + 192, mix(fg((250, 251, 253)), PINK, pk), 2)
            c.text(x0 + 194, y0 + 187, "pixel loads", 10, mix((250, 251, 253), PINK, pk), True, "rm")


def packet(c, t, a, b, p0, p1, label, col, lift=40, envelope=False):
    if not a <= t <= b:
        return
    k = seg(t, a, b)
    x = p0[0] + (p1[0] - p0[0]) * k
    y = p0[1] + (p1[1] - p0[1]) * k - math.sin(math.pi * k) * lift
    trail = [(p0[0] + (p1[0] - p0[0]) * j, p0[1] + (p1[1] - p0[1]) * j - math.sin(math.pi * j) * lift)
             for j in [k * i / 12 for i in range(13)]]
    c.line(trail, mix(BG, col, 0.55), 2)
    if envelope:
        c.rect(x - 15, y - 10, x + 15, y + 10, WHITE, 3, col, 2)
        c.line([(x - 13, y - 8), (x, y + 2), (x + 13, y - 8)], col, 2)
    else:
        c.circle(x, y, 9, mix(BG, col, 0.35))
        c.circle(x, y, 5, col)
    c.text(x, y - 22, label, 11, col, True, "mm")


def caption(c, t):
    idx = max(i for i, (start, _) in enumerate(STEPS) if t >= start)
    start, s = STEPS[idx]
    k = seg(t, start, start + 0.35)
    c.rect(24, 356, 856, 440, PANEL, 14, EDGE)
    c.circle(54, 398, 16, mix(PANEL, BLUE, k))
    c.text(54, 398, str(idx + 1), 15, WHITE, True, "mm")
    for i, line in enumerate(wrap(c, s, 14, 760)):
        c.text(82, 398 - 10 * (len(wrap(c, s, 14, 760)) - 1) + i * 20, line, 14, mix(PANEL, TEXT, k), anchor="lm")
    for i in range(len(STEPS)):
        c.circle(800 + i * 11, 372, 3, BLUE if i == idx else EDGE)


def render(t):
    c = Canvas()
    c.text(24, 24, "email-tracker", 18, TEXT, True)
    c.text(160, 27, "how a tracked email works", 13, MUTED)
    gmail_active = 1.0 if t < 2.6 or t > 8.0 else 0.0
    panel(c, LEFT, "YOUR GMAIL  ·  extension", gmail_active)
    panel(c, MID, "YOUR CLOUDFLARE", 1.0 if 5.6 < t < 8.4 else 0.0)
    panel(c, RIGHT, "RECIPIENT", 1.0 if 2.8 < t < 7.0 else 0.0)
    swap = seg(t, 2.4, 2.9)
    compose(c, t, 1 - swap)
    sent_list(c, t, swap)
    worker(c, t)
    recipient(c, t)
    packet(c, t, 0.9, 1.9, (300, 160), (440, 140), "register", ORANGE, 30)
    packet(c, t, 2.8, 4.1, (150, 280), (700, 150), "email", WHITE, 70, envelope=True)
    packet(c, t, 5.7, 6.4, (770, 288), (450, 145), "GET /p/<id>.gif", PINK, 50)
    packet(c, t, 7.2, 8.6, (440, 120), (130, 140), "new events", (120, 190, 255), 50)
    toast(c, t)
    caption(c, t)
    fade = seg(t, DUR - 0.5, DUR)
    im = c.frame()
    return Image.blend(im, Image.new("RGB", im.size, BG), fade) if fade > 0 else im


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "how-it-works.gif")
    tmp = tempfile.mkdtemp()
    try:
        n = int(DUR * FPS)
        for i in range(n):
            render(i / FPS).save(os.path.join(tmp, f"f{i:04d}.png"))
        pal = os.path.join(tmp, "pal.png")
        src = ["-framerate", str(FPS), "-i", os.path.join(tmp, "f%04d.png")]
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *src, "-vf", "palettegen=max_colors=128:stats_mode=diff", pal], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *src, "-i", pal, "-lavfi",
                        "paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle", "-loop", "0", out], check=True)
        print(out, os.path.getsize(out) // 1024, "KiB")
    finally:
        shutil.rmtree(tmp)


if __name__ == "__main__":
    main()
