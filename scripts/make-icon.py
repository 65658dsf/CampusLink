"""Render the app's geometric Wi-Fi mark. Requires Pillow (build-time only)."""
from pathlib import Path
from PIL import Image, ImageDraw

scale = 4
image = Image.new('RGBA', (256 * scale, 256 * scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8 * scale, 8 * scale, 248 * scale, 248 * scale), radius=64 * scale, fill='#159778')
for start, control, end in [((53, 98), (128, 36), (203, 98)), ((79, 128), (128, 87), (177, 128)), ((104, 157), (128, 137), (152, 157))]:
    points = []
    for step in range(101):
        t = step / 100
        points.append(tuple(int(((1-t)**2 * start[i] + 2*(1-t)*t*control[i] + t*t*end[i]) * scale) for i in range(2)))
    draw.line(points, fill='white', width=15 * scale)
    for x, y in (points[0], points[-1]):
        r = 7.5 * scale
        draw.ellipse((x-r, y-r, x+r, y+r), fill='white')
draw.ellipse((118*scale, 176*scale, 138*scale, 196*scale), fill='white')
image = image.resize((256, 256), Image.Resampling.LANCZOS)
assets = Path(__file__).resolve().parent.parent / 'assets'
assets.mkdir(exist_ok=True)
image.save(assets / 'icon.png')
image.save(assets / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
