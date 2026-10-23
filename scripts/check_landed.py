"""Sanity-check data/landed/landed.json used by site/landed.html (no network)."""
import json
import sys
from pathlib import Path

d = json.loads((Path(__file__).resolve().parent.parent / "data" / "landed" / "landed.json").read_text())
errs = []
for k in ("compliance", "crypto", "meta", "hs"):
    if k not in d:
        errs.append(f"missing {k}")
if not any("ransshipment" in c for c in d.get("compliance", [])):
    errs.append("compliance must mention transshipment")
for h, v in d.get("hs", {}).items():
    for dest in ("US", "PT", "UK"):
        for r in v["dest"].get(dest, []):
            if "status" in r:
                continue
            for f in ("d", "v"):
                if r[f] is not None and not (0 <= r[f] <= 1000):
                    errs.append(f"{h} {dest} {r['o']} {f}={r[f]}")
            if (r["d"] is None or r["v"] is None) and not r["miss"]:
                errs.append(f"{h} {dest} {r['o']}: unknown rate not flagged")
sp = d.get("space", {})
for p in sp.get("providers", []):
    if p.get("per_kg_above_base") is not None and not (p.get("sources") or p.get("official")):
        errs.append(f"space price without source: {p.get('id')}")
if not any("ITAR" in n for n in sp.get("notes", [])):
    errs.append("space notes must carry ITAR/EAR caveat")
if "6109" not in "".join(d.get("hs", {})):
    errs.append("expected HS 6109 coverage")
print("\n".join(errs) or f"ok: {len(d['hs'])} HS6 codes")
sys.exit(1 if errs else 0)
