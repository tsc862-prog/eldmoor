"""Build the swimlane board snapshot from GitHub into a JSON file.
Usage: python scripts/board-sync.py <repo_root> <out_json> [running_issue_numbers_comma_separated]
The main session publishes the JSON to the board artifact (db doc board/current).
"""
import json, subprocess, sys, datetime, re

root, out = sys.argv[1], sys.argv[2]
running = {int(x) for x in (sys.argv[3].split(',') if len(sys.argv) > 3 and sys.argv[3] else [])}

def gh(*args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, cwd=root, encoding='utf-8')
    if r.returncode: raise SystemExit(r.stderr)
    return json.loads(r.stdout)

open_issues = gh("issue", "list", "--state", "open", "--limit", "200", "--json", "number,title,labels,updatedAt")
closed = gh("issue", "list", "--state", "closed", "--limit", "60", "--json", "number,title,labels,closedAt")
prs = gh("pr", "list", "--state", "open", "--json", "number,title,headRefName,body,url")

# PR -> issues it closes
pr_for = {}
for p in prs:
    for m in re.finditer(r"(?i)closes\s+#(\d+)", p.get("body") or ""):
        pr_for[int(m.group(1))] = p["number"]

LANES = [
    ("fellowship", "Fellowship (focus)", lambda t, L: "focus:fellowship" in L),
    ("dm", "Tabletop & DM", lambda t, L: "Epic: from MMO" in t or t.startswith("DM ") or "DM-created" in t or "Dungeon view" in t or "Bestiary" in t or "Fellowship" in t or "Quest chains" in t or "Night life" in t),
    ("ai", "Agents & minds", lambda t, L: "Brain" in t or "Agent player" in t or "Mind tab" in t),
    ("classes", "Classes", lambda t, L: t.startswith("Classes") or "flesh out classes" in t),
    ("scale", "Scaling", lambda t, L: "scale the world" in t or "Stepping-stone" in t or "Spatial" in t or "Data-driven world" in t or "Chunked" in t or "Races" in t),
    ("social", "Social", lambda t, L: "pillar:social" in L),
    ("world", "Living world", lambda t, L: "pillar:living-world" in L),
    ("territory", "Territory", lambda t, L: "pillar:territory" in L),
    ("economy", "Economy", lambda t, L: "pillar:economy" in L),
    ("watcher", "Watcher tools", lambda t, L: "pillar:watcher" in L),
    ("infra", "Infrastructure & balance", lambda t, L: True),
]

def lane_of(title, labels):
    L = " ".join(labels)
    for key, _, test in LANES:
        if test(title, L): return key
    return "infra"

# Owning agent: an explicit agent:<name> label wins; otherwise the agent that owns the
# card's first area in the CLAUDE.md agent table. ui/render have no dedicated agent yet.
AREA_OWNER = {"world": "world-builder", "creatures": "creature-designer", "characters": "character-builder",
              "ai": "ai-designer", "lore": "lore-keeper", "balance": "balance-tester", "infra": "brain-builder",
              "ui": None, "render": None}
def owner_of(labels):
    for l in labels:
        if l.startswith("agent:"): return l.split(":", 1)[1]
    for l in labels:
        if l.startswith("area:"):
            o = AREA_OWNER.get(l.split(":", 1)[1], None)
            if o: return o
    return None

def area(labels):
    return [l.split(":", 1)[1] for l in labels if l.startswith("area:")]

def size_of(labels):
    return next((l.split(":", 1)[1] for l in labels if l.startswith("size:")), None)

def epic_of(title):
    return title.startswith("Epic:")

cards = []
for i in open_issues:
    labels = [l["name"] for l in i["labels"]]
    n = i["number"]
    if n in running: status = "progress"
    elif n in pr_for: status = "review"
    elif "agent-ready" in labels: status = "ready"
    else: status = "backlog"
    cards.append({"n": n, "title": i["title"], "lane": lane_of(i["title"], labels), "status": status,
                  "areas": area(labels), "epic": epic_of(i["title"]), "pr": pr_for.get(n), "size": size_of(labels), "owner": owner_of(labels)})

today = datetime.datetime.now(datetime.timezone.utc)
for i in closed:
    labels = [l["name"] for l in i["labels"]]
    when = datetime.datetime.fromisoformat(i["closedAt"].replace("Z", "+00:00"))
    if (today - when).days > 3: continue
    cards.append({"n": i["number"], "title": i["title"], "lane": lane_of(i["title"], labels), "status": "done",
                  "areas": area(labels), "epic": epic_of(i["title"]), "closedAt": i["closedAt"], "size": size_of(labels), "owner": owner_of(labels)})

board = {
    "repo": "tsc862-prog/eldmoor",
    "updatedAt": today.isoformat(timespec="seconds"),
    "lanes": [{"key": k, "name": n} for k, n, _ in LANES],
    "columns": [
        {"key": "backlog", "name": "Backlog"},
        {"key": "ready", "name": "Ready"},
        {"key": "progress", "name": "In progress"},
        {"key": "review", "name": "In review"},
        {"key": "done", "name": "Done, last 3 days"},
    ],
    "cards": cards,
}
json.dump(board, open(out, "w", encoding="utf-8"), ensure_ascii=False)
from collections import Counter
print("cards", len(cards), dict(Counter(c["status"] for c in cards)), "lanes", dict(Counter(c["lane"] for c in cards)))
