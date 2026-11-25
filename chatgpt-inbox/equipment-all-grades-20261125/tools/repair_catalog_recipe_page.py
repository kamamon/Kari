#!/usr/bin/env python3
"""Repair the legacy Galdros recipe page using the corrected catalog HTML.

Run build_catalog_book.py --html-only first. Preserve the original PDF.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

import fitz
from lxml import html

from optimize_public_pdf import normalized_links


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("html", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    if args.source.resolve() == args.output.resolve():
        raise ValueError("Preserve the source PDF")
    try:
        from weasyprint import HTML
    except ImportError:
        repo = Path(__file__).resolve().parents[3]
        sys.path.insert(0, str(repo.parent / "pdf-deps"))
        from weasyprint import HTML
    root = html.fromstring(args.html.read_text())
    css = root.xpath("//style")[0].text
    section = root.xpath('//section[@class="page"]')[11]
    assert "001 / STATS & CRAFTING" in section.text_content()
    source = '<html lang="ja"><head><meta charset="utf-8"><style>' + css
    source += '@page:first{counter-reset:page 12}</style></head><body>'
    source += html.tostring(section, encoding="unicode") + '</body></html>'
    rendered = HTML(string=source, base_url=str(args.html.parent)).render()
    if len(rendered.pages) != 1:
        raise AssertionError(f"Expected one repaired page, got {len(rendered.pages)}")
    replacement_bytes = rendered.write_pdf()
    replacement = fitz.open(stream=replacement_bytes, filetype="pdf")
    original = fitz.open(args.source)
    edited = fitz.open(args.source)
    edited.delete_page(11)
    edited.insert_pdf(replacement, start_at=11)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    edited.save(args.output, garbage=4, deflate=True)
    edited.close()
    repaired = fitz.open(args.output)
    package = Path(__file__).resolve().parents[1]
    data = json.loads((package / "data/all-equipment.json").read_text())
    ranks = ["初級", "中級", "上級", "極級"]
    grade_rows = 0
    for index, series in enumerate(data["series"]):
        page = repaired[11 + index * 2]
        tail = page.get_text("text").split("全武器・全防具の必要素材", 1)[1]
        for rank in ranks[series["nativeRank"] - 1:]:
            if not re.search(r"(^|\n)" + rank + r"(\n|$)", tail):
                raise AssertionError(f"Recipe rank absent: {series['name']} {rank}")
            grade_rows += 1
    recipe_text = repaired[11].get_text("text").split("全武器・全防具の必要素材", 1)[1]
    recipes = {r["resultId"]: r for r in data["recipes"]}
    candidates = data["weaponCandidates"] + data["armorCandidates"]
    galdros = [c for c in candidates if c["sourceSpeciesId"] == "monster.galdros"]
    verified_recipes = 0
    for rank in range(1, 5):
        segment = re.split(r"(?:^|\n)" + ranks[rank - 1] + r"\n", recipe_text)[1]
        if rank < 4:
            segment = re.split(r"\n" + ranks[rank] + r"\n", segment)[0]
        compact = re.sub(r"\s+", "", segment)
        group = [recipes[c["id"]] for c in galdros if c["rank"] == rank]
        mids = list(dict.fromkeys(i["materialId"] for r in group for i in r["ingredients"]))
        for recipe in group:
            amounts = {i["materialId"]: i["count"] for i in recipe["ingredients"]}
            sequence = "/".join(str(amounts.get(mid, 0)) for mid in mids)
            if sequence not in compact:
                raise AssertionError(f"Galdros recipe quantities absent: {recipe['resultId']}")
            verified_recipes += 1
    checks = {
        "pageCount200": len(repaired) == len(original) == 200,
        "other199PageContentStreamsUnchanged": all(
            old.read_contents() == new.read_contents()
            for index, (old, new) in enumerate(zip(original, repaired)) if index != 11),
        "other199PageTextAndPositionsUnchanged": all(
            old.get_text("words") == new.get_text("words")
            for index, (old, new) in enumerate(zip(original, repaired)) if index != 11),
        "allLinksUnchanged": all(normalized_links(old) == normalized_links(new)
                                 for old, new in zip(original, repaired)),
        "all250RecipeGradeRowsPresent": grade_rows == 250,
        "galdros48RecipeQuantitiesPresent": verified_recipes == 48,
    }
    if not all(checks.values()):
        raise AssertionError(checks)
    report = {
        "validationType": "Galdros page 12 missing-rank recipe display repair",
        "originalFile": args.source.name,
        "originalSha256": digest(args.source),
        "repairedFile": args.output.name,
        "repairedSha256": digest(args.output),
        "repairedPage": 12,
        "previouslyMissingRecipeRanks": ["上級", "極級"],
        "change": "Compact material labels render all four ranks without dropping the upper two rows.",
        "equipmentDataChanged": False,
        "recipeGradeRowsChecked": grade_rows,
        "galdrosRecipesChecked": verified_recipes,
        "checks": checks,
        "passed": all(checks.values()),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
