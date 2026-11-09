#!/usr/bin/env python3
"""Extract public server-rendered session records from the two official pages."""

import json
import sys
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo


class Parser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.sessions = []
        self.current = None
        self.depth = 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = attrs.get("class", "").split()
        if self.current is None and "sess-wrap" in classes:
            self.current = {
                "tags": [],
                "links": [],
                "speakers": "",
                "description": "",
                "room": "",
                "title": "",
                "times": [],
            }
            self.depth = 1
        elif self.current is not None:
            self.depth += 1
        if self.current is not None:
            if "sess-link" in classes:
                self.current["id"] = attrs.get("data-session-id")
                self.current["url"] = attrs.get("href", "")
            if tag == "time" and attrs.get("datetime"):
                self.current["times"].append(attrs["datetime"])
            if (
                tag == "a"
                and "sess-link" not in classes
                and attrs.get("href", "").startswith("http")
            ):
                self.current["links"].append({"url": attrs["href"], "label": ""})
        self.stack.append((tag, classes))
        if (
            tag in ("br", "p")
            and self.current is not None
            and any("sess__seodesc" in c for _, c in self.stack)
        ):
            self.current["description"] += "\n"

    def handle_endtag(self, tag):
        # Void elements never generate end tags.
        if tag in (
            "input",
            "img",
            "br",
            "meta",
            "link",
            "hr",
            "source",
            "wbr",
            "area",
            "embed",
            "param",
            "track",
            "base",
        ):
            return
        if self.stack:
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    removed = self.stack[i:]
                    self.stack = self.stack[:i]
                    break
            else:
                removed = []
        else:
            removed = []
        if self.current is not None:
            self.depth -= len(removed)
            if self.depth <= 0:
                self.sessions.append(self.current)
                self.current = None

    def handle_data(self, value):
        if not self.current:
            return
        cl = [c for _, cs in self.stack for c in cs]
        for name, key in [
            ("sess__title", "title"),
            ("sess__room", "room"),
            ("sess__speakers", "speakers"),
            ("sess__seodesc", "description"),
        ]:
            if name in cl:
                self.current[key] += value
        if "tag" in cl and value.strip():
            self.current["tags"].append(value.strip())
        if (
            self.current["links"]
            and self.stack
            and self.stack[-1][0] == "a"
            and "sess__seolinks" in cl
        ):
            self.current["links"][-1]["label"] += value.strip()

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)


# HTML void elements need no stack entry.
_old = Parser.handle_starttag


def start(self, tag, attrs):
    _old(self, tag, attrs)
    if tag in (
        "input",
        "img",
        "br",
        "meta",
        "link",
        "hr",
        "source",
        "wbr",
        "area",
        "embed",
        "param",
        "track",
        "base",
    ):
        self.stack.pop()
        if self.current is not None:
            self.depth -= 1


Parser.handle_starttag = start

out = []
for path, source in zip(sys.argv[1:], ("main", "colocated")):
    p = Parser()
    p.feed(Path(path).read_text())
    print(source, len(p.sessions), file=sys.stderr)
    for s in p.sessions:
        if not s.get("id") or len(s["times"]) < 2:
            continue
        for field in ("title", "room", "speakers"):
            s[field] = " ".join(s[field].split())
        s["description"] = "\n".join(
            " ".join(x.split()) for x in s["description"].splitlines() if x.strip()
        )
        s["id"] = source + ":" + s["id"]
        s["source"] = source
        s["start"], s["end"] = [
            datetime.fromisoformat(t)
            .replace(tzinfo=ZoneInfo("America/Denver"))
            .isoformat()
            for t in s.pop("times")[:2]
        ]
        out.append(s)
# These three shared logistical listings are published in both official feeds.
out = [
    s
    for s in out
    if s["id"] not in {"colocated:1311891", "colocated:1311892", "colocated:1311893"}
]
ids = [s["id"] for s in out]
assert (
    len(ids) == len(set(ids))
    and len(out) > 400
    and all(s["title"] and s["start"] < s["end"] for s in out)
)
Path("data/sessions.json").write_text(
    json.dumps(
        {
            "updated": datetime.now(ZoneInfo("America/Denver")).date().isoformat(),
            "sessions": out,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
)
dictionary = Path("data/dictionary-v1.json")
if not dictionary.exists():
    dictionary.write_text(json.dumps(sorted(ids), separators=(",", ":")))
else:
    missing = set(ids) - set(json.loads(dictionary.read_text()))
    if missing:
        print(
            f"{len(missing)} new IDs need a new recovery dictionary version",
            file=sys.stderr,
        )
