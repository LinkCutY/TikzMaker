import sys, json, time, tempfile, os
from PIL import Image
from rapid_latex_ocr import LaTeXOCR

path = sys.argv[1]
boxes = json.loads(sys.argv[2])
img = Image.open(path).convert('RGB')
engine = LaTeXOCR()
out = []
tmpdir = tempfile.mkdtemp()
for i, box in enumerate(boxes):
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    pad = 4
    crop = img.crop((max(0, x0 - pad), max(0, y0 - pad), min(img.width, x1 + pad), min(img.height, y1 + pad)))
    if crop.width < 8 or crop.height < 8:
        out.append({'box': box, 'latex': '', 'error': 'too small'}); continue
    crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
    tmp = os.path.join(tmpdir, 'crop_%d.png' % i)
    crop.save(tmp)
    t0 = time.time()
    try:
        res = engine(tmp)
        latex = res[0] if isinstance(res, (tuple, list)) else res
        out.append({'box': box, 'latex': str(latex), 'ms': int((time.time() - t0) * 1000)})
    except Exception as e:
        out.append({'box': box, 'latex': '', 'error': type(e).__name__ + ': ' + str(e)[:80]})
print(json.dumps(out, ensure_ascii=False))
