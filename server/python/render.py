"""PDF -> SVG/PNG renderer used by the TikZ Studio backend.

Kept as a separate process so the Node server does not depend on a native
PDF toolchain. Requires PyMuPDF (pip install pymupdf).
"""
import argparse
import json
import os
import sys


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--svg")
    ap.add_argument("--png")
    ap.add_argument("--dpi", type=int, default=192)
    ap.add_argument("--page", type=int, default=0)
    args = ap.parse_args()

    try:
        import pymupdf  # type: ignore
    except ImportError:
        try:
            import fitz as pymupdf  # type: ignore
        except ImportError:
            print(json.dumps({"ok": False, "error": "pymupdf-not-installed"}))
            return 2

    if not os.path.exists(args.pdf):
        print(json.dumps({"ok": False, "error": "pdf-missing"}))
        return 3

    doc = pymupdf.open(args.pdf)
    if doc.page_count == 0:
        print(json.dumps({"ok": False, "error": "pdf-empty"}))
        return 4

    index = max(0, min(args.page, doc.page_count - 1))
    page = doc[index]
    rect = page.rect
    result = {
        "ok": True,
        "width": round(rect.width, 3),
        "height": round(rect.height, 3),
        "pages": doc.page_count,
        "page": index,
    }

    if args.svg:
        # text_as_path keeps the preview visually identical even when the
        # browser lacks the LaTeX fonts.
        svg = page.get_svg_image(text_as_path=True)
        with open(args.svg, "w", encoding="utf-8") as fh:
            fh.write(svg)
        result["svgBytes"] = len(svg.encode("utf-8"))

    if args.png:
        pix = page.get_pixmap(dpi=args.dpi, alpha=True)
        pix.save(args.png)
        result["pngBytes"] = os.path.getsize(args.png)
        result["pngWidth"] = pix.width
        result["pngHeight"] = pix.height

    doc.close()
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main())
