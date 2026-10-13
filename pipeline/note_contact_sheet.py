"""Contact sheet of the top-N notes: python pipeline/note_contact_sheet.py [--top 300] [--start 0] [--cols 15] [--cell 140] [--out path]"""
import argparse, sqlite3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--top", type=int, default=300); ap.add_argument("--start", type=int, default=0)
ap.add_argument("--cols", type=int, default=15); ap.add_argument("--cell", type=int, default=140)
ap.add_argument("--out", default=str(ROOT / "data" / "images" / "notes_contact_sheet.jpg"))
a = ap.parse_args()
db = sqlite3.connect(ROOT / "data" / "master.db")
rows = db.execute("SELECT slug,name,image_local FROM notes ORDER BY perfume_count DESC, slug").fetchall()[a.start:a.start + a.top]
cell, lab = a.cell, 26
cols = a.cols; nrows = -(-len(rows) // cols)
sheet = Image.new("RGB", (cols * cell, nrows * (cell + lab)), "white")
d = ImageDraw.Draw(sheet)
try: font = ImageFont.truetype("arial.ttf", 12)
except Exception: font = ImageFont.load_default()
for i, (slug, name, rel) in enumerate(rows):
    x, y = (i % cols) * cell, (i // cols) * (cell + lab)
    if rel and (ROOT / "data" / rel).exists():
        sheet.paste(Image.open(ROOT / "data" / rel).convert("RGB").resize((cell, cell)), (x, y))
    else:
        d.rectangle([x, y, x + cell - 1, y + cell - 1], fill="#ddd")
    d.text((x + 3, y + cell + 1), f"{a.start + i + 1}. {name}"[:24], fill="black", font=font)
sheet.save(a.out, quality=85)
print(a.out, sheet.size)
