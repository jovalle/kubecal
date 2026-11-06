#!/usr/bin/env python3
"""Add public Sessionize speaker metadata to an imported snapshot."""

import json
import sys
from pathlib import Path

path = Path("data/sessions.json")
data = json.loads(path.read_text())
people = []
for name, file in zip(("main", "colocated"), sys.argv[1:]):
    feed = json.loads(Path(file).read_text())
    speakers = {str(p["id"]): p for p in feed["speakers"]}
    qs = {q["id"]: q["question"] for q in feed["questions"]}
    for p in speakers.values():
        answers = {
            qs.get(a["questionId"], ""): a.get("answerValue", "")
            for a in p.get("questionAnswers", [])
        }
        people.append(
            {
                "id": name + ":" + str(p["id"]),
                "name": p["fullName"],
                "bio": p.get("bio") or "",
                "tagline": p.get("tagLine") or "",
                "company": answers.get("Company", ""),
                "role": answers.get("Speaker Title", ""),
                "photo": p.get("profilePicture") or "",
                "links": p.get("links", []),
            }
        )
    source = {str(s["id"]): s for s in feed["sessions"]}
    for s in data["sessions"]:
        if s["source"] != name:
            continue
        original = source.get(s["id"].split(":", 1)[1])
        if original:
            s["speakerIds"] = [
                name + ":" + str(id)
                for id in original["speakers"]
                if str(id) in speakers
            ]
            if s["speakerIds"] and not s["speakers"]:
                s["speakers"] = ", ".join(
                    speakers[str(id)]["fullName"]
                    for id in original["speakers"]
                    if str(id) in speakers
                )
path.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
Path("data/speakers.json").write_text(
    json.dumps(people, ensure_ascii=False, separators=(",", ":"))
)
print(len(people), "speaker records")
