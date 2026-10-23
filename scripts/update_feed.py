#!/usr/bin/env python3
"""Diff current USITC HTS rates against the on-chain TariffOracle and emit ONLY the changed rates.

Never signs or sends anything. It reads the chain (eth_call), reads USITC, and prints either
  * JSON  (default): {"to","chainId","value","data","updates":[...]}  -> paste into a wallet / review
  * calldata (--format calldata): just the 0x... setRates(...) calldata

Usage:
  python3 scripts/update_feed.py                      # live USITC vs live mainnet oracle
  python3 scripts/update_feed.py --offline            # use data/hts_sample.csv instead of USITC
  python3 scripts/update_feed.py --format calldata
  python3 scripts/update_feed.py --all              # re-attestation: every tracked rate, changed or not
  python3 scripts/update_feed.py --include-new        # also propose HTS codes not yet on-chain
  RPC_URL=... ORACLE=0x... ROUTE="ANY->US" python3 scripts/update_feed.py
  python3 scripts/update_feed.py --self-test          # ABI-encoder check against `cast calldata`
Stdlib only. Exit code 0 always prints a result; "updates": [] means nothing to sign.
"""
import argparse, csv, json, os, re, subprocess, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "..", "data", "hts_sample.csv")
DEP = os.path.join(HERE, "..", "deployments", "mainnet.json")
KEYWORDS = ["telescope", "satellite", "rocket", "solar cells", "gyroscope", "lithium batteries", "spacecraft"]
SEL_GET_RATE = "e3f2804f"   # getRate(string,string)
SEL_SET_RATES = "1f1318b4"  # setRates(string[],string[],uint16[])
SEL_RATE_NOT_FOUND = "0x"   # any revert from getRate == unset
MAX_BPS = 10_000

# ---------------- minimal ABI encoding (string, string[], uint16[]) ----------------
def _w(n): return n.to_bytes(32, "big")
def _str(s):
    b = s.encode()
    return _w(len(b)) + b + b"\0" * ((32 - len(b) % 32) % 32)
def _str_arr(xs):
    tails = [_str(x) for x in xs]
    head, off = b"", 32 * len(xs)
    for t in tails:
        head += _w(off); off += len(t)
    return _w(len(xs)) + head + b"".join(tails)
def _u_arr(xs): return _w(len(xs)) + b"".join(_w(x) for x in xs)
def _encode_dynamic(parts):
    head, tail, off = b"", b"", 32 * len(parts)
    for p in parts:
        head += _w(off + len(tail)); tail += p
    return head + tail
def enc_get_rate(route, hs): return "0x" + SEL_GET_RATE + _encode_dynamic([_str(route), _str(hs)]).hex()
def enc_set_rates(routes, codes, bps):
    return "0x" + SEL_SET_RATES + _encode_dynamic([_str_arr(routes), _str_arr(codes), _u_arr(bps)]).hex()

# ---------------- chain ----------------
def rpc(url, method, params):
    req = urllib.request.Request(url, json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(),
                                 {"Content-Type": "application/json", "User-Agent": "space-money-update-feed"})
    return json.load(urllib.request.urlopen(req, timeout=30))
def onchain_rate(url, oracle, route, hs):
    r = rpc(url, "eth_call", [{"to": oracle, "data": enc_get_rate(route, hs)}, "latest"])
    if "error" in r:
        msg = json.dumps(r["error"])
        if "revert" in msg.lower() or "execution" in msg.lower():
            return None   # RateNotFound -> unset
        raise RuntimeError(f"eth_call failed: {msg}")
    out = bytes.fromhex(r["result"][2:])
    if len(out) < 64: raise RuntimeError("unexpected getRate return")
    return int.from_bytes(out[:32], "big"), int.from_bytes(out[32:64], "big")

# ---------------- USITC ----------------
def parse_general(g):
    g = (g or "").strip()
    if g == "Free": return 0
    m = re.fullmatch(r"([\d.]+)%", g)
    return round(float(m.group(1)) * 100) if m else None   # None = specific/compound duty, not representable
def usitc_live():
    rates = {}
    for kw in KEYWORDS:
        url = "https://hts.usitc.gov/reststop/search?keyword=" + urllib.parse.quote(kw)
        for r in json.load(urllib.request.urlopen(url, timeout=30)):
            n = r.get("htsno") or ""
            if len(n.replace(".", "")) < 8 or n in rates: continue
            bps = parse_general(r.get("general"))
            if bps is not None: rates[n] = (bps, (r.get("general") or "").strip(), (r.get("description") or "")[:80])
    return rates
def tracked_codes():
    with open(CSV) as f:
        return [(r["htsno"], int(r["rate_bps"]), r["general_rate"], r["description"]) for r in csv.DictReader(f)]

def self_test():
    routes, codes, bps = ["ANY->US", "ANY->US"], ["9013.90.20.00", "9005.80.40"], [1600, 800]
    ours = enc_set_rates(routes, codes, bps)
    ref = subprocess.check_output(["cast", "calldata", "setRates(string[],string[],uint16[])",
                                   "[" + ",".join(f'"{x}"' for x in routes) + "]", "[" + ",".join(f'"{x}"' for x in codes) + "]",
                                   "[" + ",".join(map(str, bps)) + "]"], text=True).strip()
    g = enc_get_rate("ANY->US", "9013.90.20.00")
    gref = subprocess.check_output(["cast", "calldata", "getRate(string,string)", "ANY->US", "9013.90.20.00"], text=True).strip()
    assert ours == ref, "setRates encoding mismatch"
    assert g == gref, "getRate encoding mismatch"
    print("self-test ok: encoder matches cast calldata")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--format", choices=["json", "calldata"], default="json")
    ap.add_argument("--offline", action="store_true", help="use data/hts_sample.csv as the 'current' USITC rates")
    ap.add_argument("--include-new", action="store_true", help="also propose live HTS codes not yet tracked")
    ap.add_argument("--all", action="store_true", help="re-attest: include unchanged rates too (refreshes lastUpdated)")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test: return self_test()

    dep = json.load(open(DEP))
    oracle = os.environ.get("ORACLE", dep["contracts"]["TariffOracle"])
    url = os.environ.get("RPC_URL", "https://ethereum-rpc.publicnode.com")
    route = os.environ.get("ROUTE", "ANY->US")
    chain_id = int(rpc(url, "eth_chainId", [])["result"], 16)
    if rpc(url, "eth_getCode", [oracle, "latest"]).get("result", "0x") in ("0x", "0x0"):
        sys.exit(f"no contract at ORACLE={oracle} on chain {chain_id} (RPC_URL={url})")

    tracked = tracked_codes()
    current = {c: (b, g, d) for c, b, g, d in tracked} if a.offline else usitc_live()
    codes = [c for c, *_ in tracked] + ([c for c in current if c not in {t[0] for t in tracked}] if a.include_new else [])

    updates, unchanged, missing_upstream = [], 0, []
    for c in codes:
        if c not in current: missing_upstream.append(c); continue
        new_bps, general, desc = current[c]
        if new_bps > MAX_BPS: missing_upstream.append(c); continue
        on = onchain_rate(url, oracle, route, c)
        if on is not None and on[0] == new_bps:
            unchanged += 1
            if not a.all: continue
        updates.append({"route": route, "hsCode": c, "oldBps": None if on is None else on[0],
                        "newBps": new_bps, "usitcGeneral": general, "lastUpdated": None if on is None else on[1],
                        "description": desc})

    data = enc_set_rates([u["route"] for u in updates], [u["hsCode"] for u in updates], [u["newBps"] for u in updates]) if updates else None
    if a.format == "calldata":
        if data: print(data)
        else: print("# no changes: nothing to sign", file=sys.stderr)
        return
    print(json.dumps({
        "note": "UNSIGNED. Review, then send from the wallet holding UPDATER_ROLE. This script never signs.",
        "chainId": chain_id, "to": oracle, "value": "0x0", "function": "setRates(string[],string[],uint16[])",
        "data": data, "updates": updates, "unchangedCount": unchanged,
        "notFoundUpstream": missing_upstream, "source": "offline CSV" if a.offline else "USITC HTS REST API (live)",
    }, indent=2))

if __name__ == "__main__":
    main()
