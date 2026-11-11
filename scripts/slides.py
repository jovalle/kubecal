#!/usr/bin/env python3
"""Cache public slide files for the browser viewer."""

import csv
import hashlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

OUT = Path("slides/2026")
# shortcut: files over 100 MiB use the source link; raise the limit for larger decks.
LIMIT = 100 * 1024 * 1024
SIGNATURES = {
    ".pdf": b"%PDF-",
    ".jpg": b"\xff\xd8\xff",
    ".png": b"\x89PNG\r\n\x1a\n",
    ".pptx": b"PK\x03\x04",
    ".zip": b"PK\x03\x04",
}


def name_for(url):
    parsed = urlparse(url)
    suffix = Path(parsed.path.rsplit("~", 1)[-1]).suffix.lower()
    if (
        parsed.scheme != "https"
        or parsed.hostname != "sessionize.com"
        or suffix not in SIGNATURES
    ):
        raise ValueError("Unsupported slide URL")
    filename = (
        re.sub(
            r"[^a-zA-Z0-9._-]", "_", unquote(Path(parsed.path.rsplit("~", 1)[-1]).stem)
        )[:160].strip(".")
        or "slides"
    )
    return hashlib.sha256(url.encode()).hexdigest()[:24] + "-" + filename + suffix


def valid(path):
    if not path.is_file() or path.stat().st_size > LIMIT:
        return False
    with path.open("rb") as stream:
        return stream.read(len(SIGNATURES[path.suffix])) == SIGNATURES[path.suffix]


def main():
    sessions = json.loads(Path("data/sessions.json").read_text())["sessions"]
    urls = sorted(
        {
            link["url"]
            for session in sessions
            for link in session["links"]
            if link["label"].strip().lower() == "slides"
        }
    )
    OUT.mkdir(parents=True, exist_ok=True)

    def fetch(url):
        try:
            name = name_for(url)
            target = OUT / name
            if valid(target):
                return url, name
            png = target.with_suffix(".png")
            if target.suffix == ".jpg" and valid(png):
                return url, png.name
            request = Request(url, headers={"User-Agent": "kubecal-slides"})
            with urlopen(request, timeout=90) as response:
                body = response.read(LIMIT + 1)
            if target.suffix == ".jpg" and body.startswith(SIGNATURES[".png"]):
                target = png
            if len(body) > LIMIT or not body.startswith(SIGNATURES[target.suffix]):
                raise ValueError("Invalid or oversized slide file")
            partial = target.with_suffix(target.suffix + ".part")
            partial.write_bytes(body)
            partial.replace(target)
            return url, target.name
        except (OSError, ValueError) as error:
            print(f"Slide unavailable: {url}: {error}", file=sys.stderr)
            return url, None

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = dict(pool.map(fetch, urls))
    available = {url: name for url, name in results.items() if name}
    (OUT / "manifest.json").write_text(json.dumps(available, separators=(",", ":")))
    with (OUT / "manifest.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["file", "source_url", "bytes", "status"])
        for url, name in results.items():
            writer.writerow(
                [
                    name or "",
                    url,
                    (OUT / name).stat().st_size if name else "",
                    "ok" if name else "unavailable",
                ]
            )
    print(
        f"Cached {len(available)}/{len(urls)} slides ({sum((OUT / n).stat().st_size for n in available.values())} bytes)"
    )


if __name__ == "__main__":
    main()
