import sys, json
import numpy as np
from PIL import Image
from rapidocr_onnxruntime import RapidOCR

def run(path, scale=3):
    img = Image.open(path).convert('RGB')
    w, h = img.size
    big = np.array(img.resize((w * scale, h * scale), Image.LANCZOS))
    engine = RapidOCR()
    result, _ = engine(big)
    items = []
    for box, text, score in (result or []):
        xs = [p[0] / scale for p in box]; ys = [p[1] / scale for p in box]
        items.append({
            'text': text,
            'score': round(float(score), 3),
            'box': [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)],
        })
    items.sort(key=lambda it: (it['box'][1], it['box'][0]))
    return items

if __name__ == '__main__':
    path = sys.argv[1]
    scale = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    items = run(path, scale)
    print(json.dumps({'items': items, 'count': len(items)}, ensure_ascii=False))
