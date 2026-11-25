#!/usr/bin/env python3
"""Create a smaller viewing PDF while preserving page content and links.

Requires PyMuPDF and Pillow. The original PNG artwork remains authoritative.
Usage: python3 optimize_public_pdf.py input.pdf output.pdf --report report.json
"""
import argparse
import hashlib
import io
import json
from pathlib import Path

import fitz
from PIL import Image


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_links(page):
    result = []
    for link in page.get_links():
        item = {}
        for key, value in link.items():
            if key in {"xref", "id"}:
                continue
            if isinstance(value, (fitz.Point, fitz.Rect)):
                value = list(value)
            item[key] = value
        result.append(item)
    return result


def image_geometry(page):
    result = []
    for image in page.get_image_info():
        result.append({key: image[key] for key in
                       ("bbox", "transform", "width", "height", "bpc", "colorspace")})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--quality", type=int, default=65)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise ValueError("Keep the original PDF; output must be a different file")
    if not 1 <= args.quality <= 95:
        raise ValueError("JPEG quality must be in [1, 95]")
    original = fitz.open(args.source)
    edited = fitz.open(args.source)
    refs = sorted({image[0] for page in edited for image in page.get_images(full=True)})
    for ref in refs:
        info = edited.extract_image(ref)
        if info["ext"] != "jpeg" or info["colorspace"] != 3 or info["bpc"] != 8:
            raise ValueError(f"Unexpected source image encoding at xref {ref}")
        with Image.open(io.BytesIO(info["image"])) as image:
            out = io.BytesIO()
            image.convert("RGB").save(out, format="JPEG", quality=args.quality,
                                      subsampling=2, optimize=True)
        edited.update_stream(ref, out.getvalue(), compress=False)
        edited.xref_set_key(ref, "Filter", "/DCTDecode")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    edited.save(args.output, garbage=4, deflate=True)
    edited.close()
    published = fitz.open(args.output)
    checks = {
        "pageCountUnchanged": len(original) == len(published),
        "metadataUnchanged": original.metadata == published.metadata,
        "outlineUnchanged": original.get_toc() == published.get_toc(),
        "pageDimensionsUnchanged": True,
        "pageContentStreamsUnchanged": True,
        "textAndWordPositionsUnchanged": True,
        "linksUnchanged": True,
        "imageDimensionsAndPlacementUnchanged": True,
    }
    link_count = 0
    for old, new in zip(original, published):
        checks["pageDimensionsUnchanged"] &= old.rect == new.rect
        checks["pageContentStreamsUnchanged"] &= old.read_contents() == new.read_contents()
        checks["textAndWordPositionsUnchanged"] &= (
            old.get_text("text") == new.get_text("text") and
            old.get_text("words") == new.get_text("words"))
        old_links = normalized_links(old)
        link_count += len(old_links)
        checks["linksUnchanged"] &= old_links == normalized_links(new)
        checks["imageDimensionsAndPlacementUnchanged"] &= image_geometry(old) == image_geometry(new)
    if not all(checks.values()):
        raise AssertionError(checks)
    report = {
        "validationType": "public-viewing PDF image compression",
        "sourceFile": args.source.name,
        "sourceBytes": args.source.stat().st_size,
        "sourceSha256": sha256(args.source),
        "publishedFile": args.output.name,
        "publishedBytes": args.output.stat().st_size,
        "publishedSha256": sha256(args.output),
        "pages": len(published),
        "links": link_count,
        "seriesArtworkCount": 95,
        "embeddedImagesIncludingCover": len(refs),
        "imageEncoding": {"format": "JPEG", "quality": args.quality,
                          "chromaSubsampling": "4:2:0", "resampled": False},
        "checks": checks,
        "passed": all(checks.values()),
        "originalPngsModified": False,
        "reason": "The connector transport could not send the 27.9 MB original PDF in one request.",
        "limits": ["Embedded JPEGs are recompressed with loss; high-resolution original PNGs are provided separately."],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
