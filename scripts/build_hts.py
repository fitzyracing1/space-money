#!/usr/bin/env python3
"""Build the normalized full US HTS dataset + Chapter 99 additional-duty layer.

Sources (official, public, USITC):
  * HTS JSON export   https://hts.usitc.gov/reststop/exportList?from=0100&to=9999&format=JSON&styles=false
  * Release list      https://hts.usitc.gov/reststop/releaseList          (revision name + date)
  * Chapter 99 PDF    https://hts.usitc.gov/reststop/file?release=currentRelease&filename=Chapter%2099
                      (U.S. notes 16, 20 and 31 to subchapter III hold the Section 232 / 301 product lists)

Outputs (data/hts/):
  hts_base.csv / hts_base.json        every 8- and 10-digit line in chapters 01-98 with parsed General rate
  additional.csv / additional.json    Chapter 99 layer (Section 301 China, Section 232 steel/aluminum/copper)
  search.json                         compact index used by site/feed.html search
  meta.json                           source URLs, revision, date, coverage stats
Run: python3 scripts/build_hts.py [--cache DIR]   (needs pdftotext from poppler-utils)
"""
import csv, json, os, re, subprocess, sys, urllib.request, datetime, collections

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "hts")
EXPORT = "https://hts.usitc.gov/reststop/exportList?from=0100&to=9999&format=JSON&styles=false"
RELEASES = "https://hts.usitc.gov/reststop/releaseList"
CH99 = "https://hts.usitc.gov/reststop/file?release=currentRelease&filename=Chapter%2099"
UA = {"User-Agent": "space-money-hts-builder (github.com/fitzyracing1/space-money)"}

def fetch(url, path):
    if not os.path.exists(path):
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300) as r, open(path, "wb") as f:
            f.write(r.read())
    return path

# ---------------- rate parsing ----------------
UNIT_RE = r"(kg|liter|l|each|doz\.?|pr\.?|gross|bbl|m2|m3|m|t|g|kg cmsc|clean kg|pf\.liter|proof liter|No\.|1000|thousand|x)"
def num(s): return float(s)
def parse_component(c):
    """-> ('av', bps) | ('sp', micro_usd, unit) | None"""
    c = c.strip()
    m = re.fullmatch(r"([\d.]+)%", c)
    if m: return ("av", round(num(m.group(1)) * 100))
    m = re.fullmatch(r"([\d.]+)¢\s*(?:/\s*|\s+)" + UNIT_RE, c)
    if m: return ("sp", round(num(m.group(1)) * 10_000), m.group(2))          # 1¢ = 10_000 micro-USD
    m = re.fullmatch(r"\$([\d.]+)\s*(?:/\s*|\s+)" + UNIT_RE, c)
    if m: return ("sp", round(num(m.group(1)) * 1_000_000), m.group(2))
    return None

def norm_unit(u):
    u = u.rstrip(".")
    return {"l": "liter", "pf.liter": "proof liter", "doz": "doz", "pr": "pair", "x": "each"}.get(u, u)

def parse_rate(g):
    g = (g or "").strip()
    if not g: return None
    if g.lower() == "free": return {"type": "free", "bps": 0}
    parts = [p for p in re.split(r"\s*\+\s*", g) if p]
    comps = [parse_component(p) for p in parts]
    if any(c is None for c in comps): return {"type": "other"}
    av = [c for c in comps if c[0] == "av"]; sp = [c for c in comps if c[0] == "sp"]
    if len(av) > 1 or len(sp) > 1: return {"type": "other"}
    r = {"type": "ad_valorem" if av and not sp else "specific" if sp and not av else "compound"}
    if av: r["bps"] = av[0][1]
    if sp: r["amountMicro"] = sp[0][1]; r["unit"] = norm_unit(sp[0][2]); r["currency"] = "USD"
    return r

def parse_special(s):
    s = (s or "").strip()
    out = []
    for rate, progs in re.findall(r"([^()]+?)\s*\(([^)]*)\)", s):
        out.append({"rate": rate.strip(), "programs": [p.strip() for p in progs.split(",") if p.strip()]})
    return out

# ---------------- chapter 99 note lists ----------------
CODE = re.compile(r"(?<![\d.])(\d{4}(?:\.\d{2}(?:\.\d{2}(?:\d{2})?)?)?)(?![\d.])")
def note_block(lines, start_re, end_re, after=0):
    s = next(i for i in range(after, len(lines)) if re.search(start_re, lines[i]))
    e = next(i for i in range(s + 1, len(lines)) if re.search(end_re, lines[i]))
    return s, e, lines[s:e]

def codes_in(block, valid):
    out = []
    for ln in block:
        if "Harmonized Tariff Schedule" in ln or "Annotated for" in ln or re.search(r"\d+ - [IVX]+ - \d+", ln): continue
        for c in CODE.findall(ln):
            d = c.replace(".", "")
            if c.startswith("99") or d not in valid: continue
            out.append(d)
    return out

def main():
    cache = sys.argv[sys.argv.index("--cache") + 1] if "--cache" in sys.argv else "/tmp/hts-cache"
    os.makedirs(cache, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    raw = json.load(open(fetch(EXPORT, os.path.join(cache, "hts.json"))))
    rel = next(r for r in json.load(open(fetch(RELEASES, os.path.join(cache, "releases.json")))) if r.get("status") == "current")
    pdf = fetch(CH99, os.path.join(cache, "ch99.pdf"))
    txt = os.path.join(cache, "ch99.txt")
    if not os.path.exists(txt): subprocess.run(["pdftotext", "-layout", pdf, txt], check=True)
    lines = open(txt, encoding="utf-8", errors="replace").read().splitlines()

    # ---- base schedule: walk the indent tree, inherit General/units from the nearest ancestor ----
    stack, base = [], []
    for x in raw:
        ind = int(x.get("indent") or 0)
        while stack and stack[-1]["indent"] >= ind: stack.pop()
        node = {"indent": ind, "code": x["htsno"], "desc": (x.get("description") or "").strip(),
                "general": (x.get("general") or "").strip(), "special": (x.get("special") or "").strip(),
                "units": x.get("units") or []}
        stack.append(node)
        code = x["htsno"]; digits = code.replace(".", "")
        if len(digits) not in (8, 10) or digits.startswith("99"): continue
        anc = next((n for n in reversed(stack) if n["general"]), None)
        general = anc["general"] if anc else ""
        special = node["special"] or next((n["special"] for n in reversed(stack) if n["special"]), "")
        r = parse_rate(general) or {"type": "none"}
        path = " > ".join(n["desc"].rstrip(":") for n in stack if n["desc"])
        base.append({"hts": code, "digits": digits, "description": node["desc"], "path": path,
                     "general": general, "inherited": anc is not node if anc else False,
                     "type": r["type"], "bps": r.get("bps"), "amountMicro": r.get("amountMicro"),
                     "unit": r.get("unit"), "currency": r.get("currency"),
                     "units": node["units"], "special": parse_special(special), "specialRaw": special})
    valid = set()
    for b in base:
        d = b["digits"]; valid.update({d[:4], d[:6], d[:8], d})
    by_prefix = collections.defaultdict(list)
    for b in base:
        for k in (4, 6, 8, 10): by_prefix[b["digits"][:k]].append(b)
    def expand(provs):
        seen, out = set(), []
        for p in provs:
            for b in by_prefix.get(p, []):
                if b["hts"] not in seen: seen.add(b["hts"]); out.append(b)
        return out

    # ---- Chapter 99 layer ----
    add = []
    def layer(provs, origin, heading, program, bps, condition="", note=""):
        for b in expand(provs):
            add.append({"hts": b["hts"], "origin": origin, "heading": heading, "program": program,
                        "type": "ad_valorem", "bps": bps, "condition": condition, "note": note})
    # Section 301 China: U.S. note 20 to subchapter III
    s20, _, _ = note_block(lines, r"^20\.\s*\(a\)\s+For the purposes of heading 9903\.88\.01", r"^2[1-9]\.\s")
    def sub(label, nxt, after=s20):
        s = next(i for i in range(after, len(lines)) if re.match(rf"^\s*\({label}\)(\s|$)", lines[i]))
        e = next(i for i in range(s + 1, len(lines))
                 if re.match(rf"^\s*\({nxt}\)(\s|$)", lines[i]) or re.match(r"^\d{1,2}\.\s+\(a\)", lines[i]))
        return lines[s:e], s
    X301 = "USTR product exclusions (9903.88.05-.70) not modelled"
    for lab, nxt, head, prog, bps in [("b", "c", "9903.88.01", "301-China-List1", 2500), ("d", "e", "9903.88.02", "301-China-List2", 2500),
                                      ("f", "g", "9903.88.03", "301-China-List3", 2500)]:
        blk, _ = sub(lab, nxt); layer(codes_in(blk, valid), "CN", head, prog, bps, note=X301)
    blk_s, ss = sub("s", "t")
    i_end = next(i for i, l in enumerate(blk_s) if re.match(r"^\s*\(ii\)\s", l))
    layer(codes_in(blk_s[:i_end], valid), "CN", "9903.88.15", "301-China-List4A", 750, note=X301)
    # Section 301 four-year review (note 31): currently-effective subdivisions only
    s31 = next(i for i, l in enumerate(lines) if re.match(r"^31\.\s*\(a\)\s+As provided in headings 9903\.91", l))
    hd = {r["htsno"]: r for r in raw if r["htsno"].startswith("9903.91.")}
    for lab, nxt, head in [("b", "c", "9903.91.01"), ("c", "d", "9903.91.02"), ("d", "e", "9903.91.03"), ("f", "g", "9903.91.05"),
                           ("g", "h", "9903.91.06"), ("h", "i", "9903.91.07"), ("i", "j", "9903.91.08"), ("j", "k", "9903.91.11")]:
        try: blk, _ = sub(lab, nxt, s31)
        except StopIteration: continue
        m = re.search(r"\+\s*([\d.]+)%", hd[head]["general"]); bps = round(float(m.group(1)) * 100)
        layer(codes_in(blk, valid), "CN", head, "301-China-4yr-review", bps, note=hd[head]["description"][:120])
    # Section 232: U.S. note 16 to subchapter III, lists (c)(i)-(v)
    s16 = next(i for i, l in enumerate(lines) if re.match(r"^16\.\s*\(a\)\s+Except as provided in headings 9903\.82\.01", l))
    c16 = next(i for i in range(s16, len(lines)) if re.match(r"^\s*\(c\)\s", lines[i]))
    roman = ["i", "ii", "iii", "iv", "v", "vi"]
    lists = {}
    pos = c16
    for a, b in zip(roman, roman[1:]):
        s = next(i for i in range(pos, len(lines)) if re.match(rf"^\s*\({a}\)(\s|$)", lines[i]))
        e = next(i for i in range(s + 1, len(lines)) if re.match(rf"^\s*\({b}\)(\s|$)", lines[i]))
        lists[a] = codes_in(lines[s:e], valid); pos = e
    W = "outside ch.72/73/74/76: only if metal >= 15% of article weight (note 16(c))"
    names = {"i": "aluminum", "ii": "aluminum-derivative", "iii": "steel", "iv": "steel-derivative", "v": "copper"}
    for k in ["i", "ii", "iii", "iv", "v"]:
        layer(lists[k], "ANY", "9903.82.02", f"232-{names[k]}", 5000, condition=W)
    for k in ["i", "ii", "iii", "iv"]:
        layer(lists[k], "GB", "9903.82.04", f"232-{names[k]}-UK", 2500, condition=W + "; UK content rules note 16(d)")
    layer(lists["i"], "RU", "9903.85.67", "232-aluminum-Russia", 20000, condition="Russian-smelted/cast aluminum, note 19")
    layer(lists["ii"], "RU", "9903.85.68", "232-aluminum-derivative-Russia", 20000, condition="Russian-smelted/cast aluminum, note 19")

    # ---- write ----
    fields = ["hts", "description", "path", "general", "inherited", "type", "bps", "amountMicro", "unit", "currency", "units", "specialRaw"]
    with open(os.path.join(OUT, "hts_base.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(fields)
        for b in base: w.writerow([("|".join(b[k]) if k == "units" else ("" if b[k] is None else b[k])) for k in fields])
    json.dump([{k: v for k, v in b.items() if k != "digits"} for b in base], open(os.path.join(OUT, "hts_base.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    af = ["hts", "origin", "heading", "program", "type", "bps", "condition", "note"]
    with open(os.path.join(OUT, "additional.csv"), "w", newline="") as f:
        w = csv.writer(f); w.writerow(af); [w.writerow([a[k] for k in af]) for a in add]
    json.dump(add, open(os.path.join(OUT, "additional.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    # compact client-side search index for site/feed.html
    def short(path, n=220):
        return path if len(path) <= n else "… " + path[-n:]
    addmap = collections.defaultdict(list)
    for a in add: addmap[a["hts"]].append([a["origin"], a["heading"], a["bps"], a["program"]])
    json.dump({"revision": rel["description"], "effective": rel.get("releaseStartDate"),
               "cols": ["hts", "path", "general", "type", "units"],
               "rows": [[b["hts"], short(b["path"]), b["general"], b["type"], ",".join(b["units"])] for b in base],
               "add": addmap}, open(os.path.join(OUT, "search.json"), "w"), separators=(",", ":"), ensure_ascii=False)
    stats = {"lines": len(base), "lines10": sum(len(b["digits"]) == 10 for b in base), "lines8": sum(len(b["digits"]) == 8 for b in base),
             "byType": dict(collections.Counter(b["type"] for b in base).most_common()),
             "additional": len(add), "additionalByProgram": dict(collections.Counter(a["program"] for a in add).most_common()),
             "additionalDistinctHts": len({a["hts"] for a in add})}
    meta = {"source": "U.S. International Trade Commission, Harmonized Tariff Schedule of the United States",
            "revision": rel["description"], "revisionName": rel["name"], "revisionDate": rel["date"], "effective": rel.get("releaseStartDate"),
            "urls": {"export": EXPORT, "releases": RELEASES, "chapter99": CH99},
            "builtAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "stats": stats}
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), indent=2)
    print(json.dumps(meta, indent=2))

if __name__ == "__main__":
    main()
