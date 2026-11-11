#!/usr/bin/env python3
"""Cache remote speaker photos and sponsor logos, then write offline data copies."""

import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

OUT = Path("tmp/offline")
IMAGES = OUT / "img"
FIELDS = {"speakers.json": "photo", "sponsors.json": "logo"}


def local_name(url):
    suffix = Path(urlparse(url).path).suffix.lower()
    if not suffix or len(suffix) > 5:
        suffix = ".img"
    return hashlib.sha256(url.encode()).hexdigest()[:16] + suffix


def download(url):
    target = IMAGES / local_name(url)
    if target.exists():
        return url, True
    try:
        request = Request(
            quote(url, safe=":/?&=%@+,;~"), headers={"User-Agent": "kubecal-offline"}
        )
        with urlopen(request, timeout=30) as response:
            body = response.read()
        partial = target.with_suffix(target.suffix + ".part")
        partial.write_bytes(body)
        partial.replace(target)
        return url, True
    except HTTPError as error:
        if error.code != 404:
            print(f"skip {url}: {error}", file=sys.stderr)
        return url, False
    except (OSError, URLError, ValueError) as error:
        print(f"skip {url}: {error}", file=sys.stderr)
        return url, False


def walk(node, field, found):
    if isinstance(node, dict):
        for key, value in node.items():
            if key == field and isinstance(value, str) and value.startswith("http"):
                found.add(value)
            else:
                walk(value, field, found)
    elif isinstance(node, list):
        for item in node:
            walk(item, field, found)


def rewrite(node, field, cached):
    if isinstance(node, dict):
        return {
            key: (
                f"./tmp/offline/img/{local_name(value)}"
                if key == field and value in cached
                else ""
                if key == field and isinstance(value, str) and value.startswith("http")
                else rewrite(value, field, cached)
            )
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [rewrite(item, field, cached) for item in node]
    return node


def main():
    IMAGES.mkdir(parents=True, exist_ok=True)
    (OUT / "data").mkdir(exist_ok=True)
    docs = {name: json.loads(Path("data", name).read_text()) for name in FIELDS}
    urls = set()
    for name, field in FIELDS.items():
        walk(docs[name], field, urls)
    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(download, sorted(urls)))
    cached = {url for url, ok in results if ok}
    for name, field in FIELDS.items():
        out = rewrite(docs[name], field, cached)
        (OUT / "data" / name).write_text(json.dumps(out, ensure_ascii=False))
    print(f"Cached {len(cached)}/{len(urls)} images in {IMAGES}")
    if missing := len(urls) - len(cached):
        print(f"{missing} unavailable image(s) will use placeholders.")


if __name__ == "__main__":
    main()
