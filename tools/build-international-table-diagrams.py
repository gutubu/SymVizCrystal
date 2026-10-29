"""Extract the user's original International Tables diagram images unchanged.

This is an offline extractor for the supplied fifth-edition Volume A PDF. It
copies whole embedded image XObjects, not reconstructed symmetry diagrams or
cropped page screenshots. Every PNG is checked against the decoded source
pixels, and the manifest keeps the book/page/image provenance.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
DEPENDENCIES = ROOT / "outputs" / "international-tables" / "dependencies"
if DEPENDENCIES.is_dir():
    sys.path.insert(0, str(DEPENDENCIES))

try:
    import fitz
except ImportError as error:
    raise SystemExit(
        "PyMuPDF is required. Install it in outputs/international-tables/dependencies."
    ) from error


BOOKMARK = re.compile(r"sgtable7o1o(\d{3})\.pdf")
SETTING = re.compile(
    r"^(?:UNIQUE AXIS|HEXAGONAL AXES|RHOMBOHEDRAL AXES|ORIGIN CHOICE)\b"
)
MIN_WIDTH = 1100
MIN_HEIGHT = 400


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def printed_page(page: fitz.Page) -> int | None:
    """Read the centered page number, not an assumed PDF-to-book offset."""
    middle = page.rect.width / 2
    candidates = [
        word
        for word in page.get_text("words")
        if re.fullmatch(r"\d{1,3}", word[4])
        and word[1] > page.rect.height * 0.90
        and abs((word[0] + word[2]) / 2 - middle) < page.rect.width * 0.2
    ]
    if not candidates:
        return None
    return int(max(candidates, key=lambda word: word[1])[4])


def figure_setting(page: fitz.Page, image: dict) -> str:
    """Keep only headings above this diagram, excluding later cell-choice text."""
    header = page.get_text(
        "text", clip=fitz.Rect(0, 0, page.rect.width, image["bbox"][1])
    )
    headings = []
    for line in header.splitlines():
        clean = " ".join(line.split())
        if SETTING.match(clean) and clean not in headings:
            headings.append(clean)
    return " / ".join(headings) if headings else "STANDARD SETTING"


def extract(source: Path) -> None:
    output = ROOT / "public" / "symmetry-demo" / "international-tables"
    report_path = ROOT / "reports" / "international-table-diagrams-validation.json"
    source_bytes = source.read_bytes()
    source_hash = sha256(source_bytes)
    document = fitz.open(source)
    if document.page_count != 910:
        raise ValueError("This extractor expects the supplied 910-page Volume A PDF.")

    toc = document.get_toc()
    starts = {
        int(match.group(1)): entry[2]
        for entry in toc
        if (match := BOOKMARK.fullmatch(entry[1]))
    }
    if set(starts) != set(range(1, 231)):
        raise ValueError("The source must have exactly all 230 3D space-group bookmarks.")
    # The 17 sgtable6o1oNNN entries are plane groups and deliberately excluded.
    next_chapter = min(entry[2] for entry in toc if entry[2] > starts[230])
    if next_chapter != 726:
        raise ValueError("Unexpected final space-group boundary; review the source edition.")

    output.mkdir(parents=True, exist_ok=True)
    groups = []
    pixel_checks = 0
    orientation_checks = 0
    source_filters = set()
    figures_total = 0
    exclusions = {"smallCellChoiceOrFormulaImages": 0, "onePixelGlyphImages": 0}

    for number in range(1, 231):
        start = starts[number]
        end = starts.get(number + 1, next_chapter) - 1
        figures = []
        for pdf_page in range(start, end + 1):
            page = document[pdf_page - 1]
            images = page.get_image_info(xrefs=True)
            main = []
            for image in images:
                if image["width"] >= MIN_WIDTH and image["height"] >= MIN_HEIGHT:
                    main.append(image)
                elif max(image["width"], image["height"]) <= 1:
                    exclusions["onePixelGlyphImages"] += 1
                else:
                    exclusions["smallCellChoiceOrFormulaImages"] += 1
            if len(main) > 1:
                raise ValueError(f"Review multiple main figures on PDF page {pdf_page}.")
            for image in main:
                page_text = page.get_text()
                if not re.search(rf"No\.\s*{number}\b", page_text):
                    raise ValueError(f"Figure page {pdf_page} does not name group {number}.")
                a, b, c, d, _, _ = image["transform"]
                if abs(b) > 1e-6 or abs(c) > 1e-6 or a <= 0 or d <= 0:
                    raise ValueError(
                        f"Image placement on PDF page {pdf_page} requires orientation review."
                    )
                orientation_checks += 1
                xref = image["xref"]
                original = fitz.Pixmap(document, xref)
                embedded = document.extract_image(xref)
                if embedded["ext"] == "png":
                    png = embedded["image"]
                else:
                    png = original.tobytes("png")
                decoded = fitz.Pixmap(png)
                if (
                    decoded.width != original.width
                    or decoded.height != original.height
                    or decoded.n != original.n
                    or decoded.alpha != original.alpha
                    or decoded.samples != original.samples
                ):
                    raise ValueError(f"Source pixels changed on PDF page {pdf_page}.")
                pixel_checks += 1

                filename = f"{number:03d}-p{pdf_page}.png"
                (output / filename).write_bytes(png)
                setting = figure_setting(page, image)
                book_page = printed_page(page)
                if book_page is None:
                    raise ValueError(f"Missing printed page number on PDF page {pdf_page}.")
                source_filter = document.xref_get_key(xref, "Filter")[1]
                source_filters.add(source_filter)
                caption = (
                    f"No.{number} · {setting} · 原书第 {book_page} 页"
                    f"（PDF 第 {pdf_page} 页）"
                )
                if "DIFFERENT CELL CHOICES" in setting:
                    caption += "；保留晶胞选择 1、2、3 的原版合图"
                figures.append(
                    {
                        "id": f"{number:03d}-p{pdf_page}",
                        "src": f"./international-tables/{filename}",
                        "pdfPage": pdf_page,
                        "printedPage": book_page,
                        "setting": setting,
                        "caption": caption,
                        "width": decoded.width,
                        "height": decoded.height,
                        "sha256": sha256(png),
                        "pixelSha256": sha256(original.samples),
                        "imageXref": xref,
                        "sourceFilter": source_filter,
                        "sourceBitsPerComponent": image["bpc"],
                        "pageImageBounds": list(image["bbox"]),
                        "pageImageTransform": list(image["transform"]),
                        "extraction": "whole embedded image; decoded pixels unchanged",
                    }
                )
        if not figures:
            raise ValueError(f"No original diagram found for space group {number}.")
        groups.append(
            {"id": number, "startPage": start, "endPage": end, "figures": figures}
        )
        figures_total += len(figures)

    # The viewer uses b2 settings for these two monoclinic groups. Their original
    # diagrams are the b-axis synoptic figures, not the b1 Pc/P2/c diagrams.
    for number, expected_page in [(7, 147), (13, 187)]:
        match = next(
            figure
            for figure in groups[number - 1]["figures"]
            if figure["pdfPage"] == expected_page
        )
        if "UNIQUE AXIS b, DIFFERENT CELL CHOICES" not in match["setting"]:
            raise ValueError(f"The b2 synoptic source for No.{number} is mismatched.")
    for number in [146, 148, 155, 160, 161, 166, 167]:
        if not any(
            "HEXAGONAL AXES" in figure["setting"]
            for figure in groups[number - 1]["figures"]
        ):
            raise ValueError(f"Missing H-setting original diagram for No.{number}.")

    legend_start = next(entry[2] for entry in toc if entry[1] == "1.4")
    legend_specs = [
        (0, "1.4.1.", "镜面与滑移面：垂直、平行于投影面"),
        (1, "1.4.3.", "倾斜的对称面；对称面图形符号说明"),
        (2, "1.4.5.", "垂直投影面的旋转、螺旋、旋转反演轴与对称点"),
        (3, "1.4.6.", "平行及倾斜于投影面的对称轴"),
    ]
    legend_figures = []
    for offset, section, description in legend_specs:
        pdf_page = legend_start + offset
        page = document[pdf_page - 1]
        if section not in page.get_text():
            raise ValueError(f"Unexpected graphical-symbol legend on PDF page {pdf_page}.")
        book_page = printed_page(page)
        if book_page is None:
            raise ValueError(f"Missing legend printed page number on PDF page {pdf_page}.")
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        png = pixmap.tobytes("png")
        filename = f"symbols-p{pdf_page}.png"
        (output / filename).write_bytes(png)
        legend_figures.append(
            {
                "id": f"symbols-p{pdf_page}",
                "src": f"./international-tables/{filename}",
                "pdfPage": pdf_page,
                "printedPage": book_page,
                "setting": "GRAPHICAL SYMBOLS FOR SYMMETRY ELEMENTS",
                "caption": f"国际表原版符号图例 · {description} · 原书第 {book_page} 页（PDF 第 {pdf_page} 页）",
                "width": pixmap.width,
                "height": pixmap.height,
                "sha256": sha256(png),
                "pixelSha256": sha256(pixmap.samples),
                "imageXref": None,
                "renderScale": 2,
                "pageImageBounds": list(page.rect),
                "extraction": "whole original PDF page rendered at 2x; no cropping or redrawing",
            }
        )

    reading_guides = []
    for pdf_page, section, description in [
        (37, "2.2.6.3.", "空间群多投影图的排列；单斜晶胞选择合图的读法"),
        (39, "2.2.6.4.", "单斜晶胞选择 1/2/3 与正交空间群投影方向示意"),
    ]:
        page = document[pdf_page - 1]
        if section not in page.get_text():
            raise ValueError(f"Unexpected reading guide on PDF page {pdf_page}.")
        book_page = printed_page(page)
        if book_page is None:
            raise ValueError(f"Missing guide printed page number on PDF page {pdf_page}.")
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        png = pixmap.tobytes("png")
        name = f"guide-p{pdf_page:03d}"
        (output / f"{name}.png").write_bytes(png)
        reading_guides.append(
            {
                "id": name,
                "src": f"./international-tables/{name}.png",
                "pdfPage": pdf_page,
                "printedPage": book_page,
                "setting": "GUIDE TO SPACE-GROUP DIAGRAMS",
                "caption": f"国际表原版读图指南 · {description} · 原书第 {book_page} 页（PDF 第 {pdf_page} 页）",
                "width": pixmap.width,
                "height": pixmap.height,
                "sha256": sha256(png),
                "pixelSha256": sha256(pixmap.samples),
                "imageXref": None,
                "renderScale": 2,
                "pageImageBounds": list(page.rect),
                "extraction": "whole original PDF page rendered at 2x; no cropping or redrawing",
            }
        )

    manifest = {
        "version": 1,
        "groupCount": len(groups),
        "figureCount": figures_total,
        "source": {
            "filename": source.name,
            "sha256": source_hash,
            "pageCount": document.page_count,
            "byteLength": len(source_bytes),
            "title": "International Tables for Crystallography, Volume A: Space-group symmetry",
            "edition": "Fifth edition, 2005; space-group tables copyright IUCr 2006",
            "providedBy": "user-provided local PDF",
            "method": "space-group figures: whole embedded images, decoded pixels unchanged; symbol legends and reading guides: whole original PDF pages rendered at 2x, with no cropping or redrawing",
            "legendFigures": legend_figures,
            "readingGuideFigures": reading_guides,
        },
        "groups": groups,
    }
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    (output / "manifest.json").write_bytes(manifest_bytes)
    report = {
        "passed": True,
        "sourceSha256": source_hash,
        "sourcePageCount": document.page_count,
        "manifestSha256": sha256(manifest_bytes),
        "groupCount": len(groups),
        "figureCount": figures_total,
        "checks": {
            "complete3DSpaceGroupBookmarks": len(starts),
            "pixelIdenticalToDecodedEmbeddedImage": pixel_checks,
            "unrotatedUnflippedImagePlacement": orientation_checks,
            "printedPageNumbersRead": pixel_checks,
            "originalGraphicalSymbolLegendPages": len(legend_figures),
            "originalReadingGuidePages": len(reading_guides),
            "missingGroups": [],
        },
        "mainFigureSelection": {"minWidth": MIN_WIDTH, "minHeight": MIN_HEIGHT},
        "excludedImageOccurrences": exclusions,
        "sourceFilters": sorted(source_filters),
        "exceptions": [],
        "methods": {
            "spaceGroupFigures": "whole embedded image extraction; all 288 decoded source-pixel arrays match",
            "legendFigures": "four whole original PDF pages rendered at 2x; no cropping or redrawing",
            "readingGuideFigures": "two whole original PDF pages rendered at 2x; no cropping or redrawing",
        },
        "legendFigures": [
            {key: figure[key] for key in ["id", "pdfPage", "printedPage", "width", "height", "sha256"]}
            for figure in legend_figures
        ],
        "readingGuideFigures": [
            {key: figure[key] for key in ["id", "pdfPage", "printedPage", "width", "height", "sha256"]}
            for figure in reading_guides
        ],
        "settingNotes": [
            "No.7 Pn b2 uses the original b-axis cell-choice 1/2/3 synoptic figure on PDF page 147; b2 text is on 148.",
            "No.13 P2/n b2 uses the original b-axis cell-choice 1/2/3 synoptic figure on PDF page 187; b2 text is on 188.",
            "R groups retain H-setting diagrams; No.166 and No.167 R-setting text refers back to the H-setting drawings.",
            "Both origin-choice figure groups are retained whenever present in the source.",
            "No.230 ends at PDF page 725, before chapter 8.1 on page 726; printed page numbering is read rather than assumed.",
            "The supplied cover says fifth edition 2005; the extracted space-group entry footers say IUCr 2006.",
        ],
        "groups": [
            {
                "id": group["id"],
                "startPage": group["startPage"],
                "endPage": group["endPage"],
                "figurePages": [figure["pdfPage"] for figure in group["figures"]],
                "settings": [figure["setting"] for figure in group["figures"]],
            }
            for group in groups
        ],
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "passed": True,
                "groupCount": len(groups),
                "figureCount": figures_total,
                "sourceSha256": source_hash,
                "output": str(output),
                "validation": str(report_path),
            },
            ensure_ascii=True,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path, help="User-provided Volume A PDF")
    arguments = parser.parse_args()
    extract(arguments.source.resolve(strict=True))
