"""Download all public Fragrantica-derived datasets into data/raw/<source_key>/.

Credential-free routes only (Kaggle anonymous download endpoint for public datasets,
Hugging Face resolve URLs, GitHub raw URLs). Downloaded files are untrusted DATA:
this script only writes bytes to disk and safely extracts data-file types from zips;
nothing downloaded is ever executed or unpickled.

Re-runnable: skips sources whose files already exist (use --force to refetch).
"""
import argparse, json, shutil, sys, urllib.request, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
DATA_EXT = {".csv", ".json", ".jsonl", ".parquet", ".xlsx", ".xls", ".md", ".txt", ".db"}

KAGGLE = "https://www.kaggle.com/api/v1/datasets/download/{}"
SOURCES = [
    # key, kind, url, license, note
    # Inspected and deliberately NOT downloaded (see BUILD_REPORT): kaggle fatimakadhem/perfumes and the
    # github pn-david / MagdalenaRomaniecka repos are byte/row-identical copies of olga_fra; tajvarhirad/perfume
    # (molecules), qasimrajput/perfume-recomendation (user survey), kamilejaz/perfume (eBay) are not Fragrantica.
    # Downloaded for the record but NOT merged (not Fragrantica-origin / translated): nandini_perfume (Luckyscent),
    # hf_doevent_perfume (no Fragrantica ids/urls; different taxonomy), arab_160 (Spanish-language fragrantica.es subset).
    ("decant_kaggle", "kaggle", "ledecanteur/fragrantica-perfumes", "CC BY-NC-SA 4.0",
     "Decant full Fragrantica dump (https://codeberg.org/decant, kaggle ledecanteur/fragrantica-perfumes)"),
    ("olga_fra", "kaggle", "olgagmiufana1/fragrantica-com-fragrance-dataset", "CC BY-NC-SA 4.0",
     "Fragrantica.com Fragrance Dataset (fra_cleaned.csv / fra_perfumes.csv)"),
    ("nandini_perfume", "kaggle", "nandini1999/perfume-recommendation-dataset", "CC0 Public Domain",
     "Perfume Recommendation Dataset (final_perfume_data.csv)"),
    ("sabitahmad_fra", "kaggle", "sabitahmad/fragrantica-all-perfume-database", "Apache 2.0", ""),
    ("wilsonanthony_fra", "kaggle", "wilsonanthony/fragrantica-perfumes", "Unknown", ""),
    ("imerghichi_notes", "kaggle", "imerghichi/notes-perfumes", "Unknown", ""),
    ("arab_160", "kaggle", "hombrequemejorhuele/arab-perfume-note-pyramids-152-fragrantica", "CC BY 4.0", ""),
    ("hf_doevent_perfume", "url",
     "https://huggingface.co/datasets/doevent/perfume/resolve/main/perfumes.csv", "MIT (per HF card)",
     "HF doevent/perfume, 26k perfumes (2024)"),
    ("gh_rdemarqui", "url",
     "https://raw.githubusercontent.com/rdemarqui/perfume_recommender/HEAD/database/perfume_database.xlsx",
     "not stated", "github rdemarqui/perfume_recommender (only xlsx fetched; pickles are never fetched)"),
    ("gh_astyxxx", "url",
     "https://raw.githubusercontent.com/aStyxxx/dataset_Fragrantica_perfumes/HEAD/perfumes_actual.csv",
     "not stated", "github aStyxxx/dataset_Fragrantica_perfumes"),
]


def fetch(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": "scent-atlas-pipeline/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        shutil.copyfileobj(r, f, 1 << 20)


def safe_extract(zpath, outdir):
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            name = Path(info.filename)
            if info.is_dir() or name.is_absolute() or ".." in name.parts:
                continue
            if name.suffix.lower() not in DATA_EXT:
                continue  # skip images/executables/anything not a data file
            target = outdir / name.name  # flatten
            with z.open(info) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst, 1 << 20)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for key, kind, ref, lic, note in SOURCES:
        if args.only and key not in args.only:
            continue
        d = RAW / key
        if d.exists() and any(d.iterdir()) and not args.force:
            print(f"[skip] {key} (exists)")
            continue
        d.mkdir(parents=True, exist_ok=True)
        try:
            if kind == "kaggle":
                url = KAGGLE.format(ref)
                zp = d / "_download.zip"
                fetch(url, zp)
                safe_extract(zp, d)
                zp.unlink()
            else:
                url = ref
                fetch(url, d / Path(url).name)
            print(f"[ok]   {key}: {[p.name for p in d.iterdir()]}")
        except Exception as e:  # noqa
            print(f"[FAIL] {key}: {e}", file=sys.stderr)
            if not any(d.iterdir()):
                d.rmdir()
    (RAW / "_sources.json").write_text(json.dumps(
        [dict(key=k, kind=kd, ref=r, license=l, note=n) for k, kd, r, l, n in SOURCES], indent=1))


if __name__ == "__main__":
    main()
