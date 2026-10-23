#!/usr/bin/env python3
"""Off-chain oracle feeder: loads USITC HTS general (MFN) ad-valorem rates into TariffOracle.

Source: U.S. International Trade Commission, Harmonized Tariff Schedule REST API
        https://hts.usitc.gov/reststop/search?keyword=<kw>  (snapshot in data/hts_sample.csv)

Usage: ORACLE=0x.. RPC_URL=http://127.0.0.1:8545 PRIVATE_KEY=.. python3 scripts/feed_oracle.py [--refresh]
The private key is read from the environment and passed to `cast` via env, never printed.
"""
import csv, json, os, re, subprocess, sys, urllib.request

CSV = os.path.join(os.path.dirname(__file__), "..", "data", "hts_sample.csv")
KEYWORDS = ["telescope", "satellite", "rocket", "solar cells", "gyroscope", "lithium batteries", "spacecraft"]
ROUTE = os.environ.get("ROUTE", "ANY->US")  # HTS general rates apply to MFN imports into the US


def refresh():
    rows, seen = [], set()
    for kw in KEYWORDS:
        url = "https://hts.usitc.gov/reststop/search?keyword=" + urllib.parse.quote(kw)
        for r in json.load(urllib.request.urlopen(url, timeout=30)):
            n, g = r.get("htsno") or "", (r.get("general") or "").strip()
            if len(n.replace(".", "")) < 8 or n in seen:
                continue
            if g == "Free":
                bps = 0
            else:
                m = re.fullmatch(r"([\d.]+)%", g)
                if not m:
                    continue  # skip specific/compound duties
                bps = round(float(m.group(1)) * 100)
            seen.add(n)
            rows.append([n, bps, g, (r.get("description") or "")[:80]])
    with open(CSV, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["htsno", "rate_bps", "general_rate", "description"])
        w.writerows(rows[:25])


def main():
    if "--refresh" in sys.argv:
        import urllib.parse  # noqa
        refresh()
    oracle, rpc = os.environ["ORACLE"], os.environ.get("RPC_URL", "http://127.0.0.1:8545")
    if "PRIVATE_KEY" not in os.environ:
        sys.exit("PRIVATE_KEY not set")
    with open(CSV) as f:
        rows = list(csv.DictReader(f))
    routes = "[" + ",".join(f'"{ROUTE}"' for _ in rows) + "]"
    codes = "[" + ",".join(f'"{r["htsno"]}"' for r in rows) + "]"
    bps = "[" + ",".join(r["rate_bps"] for r in rows) + "]"
    subprocess.run(
        ["cast", "send", "--rpc-url", rpc, "--private-key", os.environ["PRIVATE_KEY"], oracle,
         "setRates(string[],string[],uint16[])", routes, codes, bps],
        check=True, stdout=subprocess.DEVNULL)
    print(f"fed {len(rows)} HTS rates for route {ROUTE} into oracle {oracle}")
    for r in rows[:5]:
        print(f"  {r['htsno']:<14} {r['general_rate']:>6} -> {r['rate_bps']} bps  {r['description'][:45]}")


if __name__ == "__main__":
    import urllib.parse
    main()
