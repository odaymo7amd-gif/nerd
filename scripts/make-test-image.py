# يولّد صورة صفحة اختبار لفحص مسار OCR. للأغراض التطويرية فقط.
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

directory = Path("data/fixtures")
directory.mkdir(parents=True, exist_ok=True)

image = Image.new("RGB", (1400, 500), "white")
draw = ImageDraw.Draw(image)
font = ImageFont.load_default(size=72)
draw.text((60, 120), "NERD OCR TEST PAGE", fill="black", font=font)
draw.text((60, 260), "STUDY SKILLS AND REVISION", fill="black", font=font)

path = directory / "test-page.png"
image.save(path)
print(f"تم إنشاء {path}")
