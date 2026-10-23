#!/usr/bin/env python3
"""Merkle tree over the full HTS dataset (data/hts) for TariffFeedV2. Stdlib only. NEVER signs or sends.

Leaf = keccak256(keccak256(abi.encode(string route, string hsCode, uint8 rateType, uint32 bps,
                                      uint64 amountMicro, bytes16 unit, bytes3 currency)))
Inner node = keccak256(sorted(a, b))  (OpenZeppelin MerkleProof compatible)

  python3 scripts/hts_merkle.py                    # build -> data/hts/merkle/{root.json,vectors.json}
  python3 scripts/hts_merkle.py --proof "ANY->US" 0101.21.00.10
  python3 scripts/hts_merkle.py --calldata          # unsigned publishRoot(...) calldata for a FeedV2
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from keccak import keccak256

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
HTS = os.path.join(ROOT, "data", "hts")
OUT = os.path.join(HTS, "merkle")
KIND = {"free": 0, "ad_valorem": 1, "specific": 2, "compound": 3, "other": 4}

def w(n): return n.to_bytes(32, "big")
def s_enc(x):
    b = x.encode(); return w(len(b)) + b + b"\0" * (-len(b) % 32)
def left(x, n): b = (x or "").encode()[:n]; return b + b"\0" * (32 - len(b))
def encode_leaf(route, hs, kind, bps, amt, unit, cur):
    head = [None, None, w(kind), w(bps), w(amt), left(unit, 16), left(cur, 3)]
    tails = [s_enc(route), s_enc(hs)]
    off = 32 * 7
    head[0] = w(off); head[1] = w(off + len(tails[0]))
    return b"".join(head) + b"".join(tails)
def leaf_hash(*a): return keccak256(keccak256(encode_leaf(*a)))

def leaves():
    base = json.load(open(os.path.join(HTS, "hts_base.json")))
    add = json.load(open(os.path.join(HTS, "additional.json")))
    out = []
    for b in base:
        if b["type"] not in KIND: continue
        out.append(("ANY->US", b["hts"], KIND[b["type"]], b["bps"] or 0, b["amountMicro"] or 0,
                    b["unit"] or "", b["currency"] or ""))
    for a in add:
        out.append((f'{a["origin"]}->US', f'{a["hts"]}#{a["heading"]}', 1, a["bps"], 0, "", ""))
    return out

def h2(a, b): return keccak256(a + b if a < b else b + a)
def build(ls):
    hs = sorted(leaf_hash(*l) for l in ls)
    layers = [hs]
    while len(layers[-1]) > 1:
        p = layers[-1]
        layers.append([h2(p[i], p[i + 1]) if i + 1 < len(p) else p[i] for i in range(0, len(p), 2)])
    return layers
def proof(layers, leaf):
    i = layers[0].index(leaf); pr = []
    for lay in layers[:-1]:
        j = i ^ 1
        if j < len(lay): pr.append(lay[j])
        i //= 2
    return pr
def verify(root, leaf, pr):
    h = leaf
    for p in pr: h = h2(h, p)
    return h == root

def calldata_publish(root, count, revision, uri):
    sel = keccak256(b"publishRoot(bytes32,uint32,string,string)")[:4]
    t1, t2 = s_enc(revision), s_enc(uri)
    return "0x" + (sel + root + w(count) + w(128) + w(128 + len(t1)) + t1 + t2).hex()

def main():
    meta = json.load(open(os.path.join(HTS, "meta.json")))
    ls = leaves(); layers = build(ls); root = layers[-1][0]
    if "--proof" in sys.argv:
        r, hs = sys.argv[sys.argv.index("--proof") + 1:][:2]
        l = next(x for x in ls if x[0] == r and x[1] == hs)
        lh = leaf_hash(*l); pr = proof(layers, lh); assert verify(root, lh, pr)
        print(json.dumps({"leaf": dict(zip(["route", "hsCode", "rateType", "bps", "amountMicro", "unit", "currency"], l)),
                          "leafHash": "0x" + lh.hex(), "root": "0x" + root.hex(), "proof": ["0x" + p.hex() for p in pr]}, indent=2))
        return
    uri = f'https://github.com/fitzyracing1/space-money/tree/main/data/hts ({meta["revisionName"]})'
    if "--calldata" in sys.argv:
        print(calldata_publish(root, len(ls), meta["revisionName"], uri)); return
    os.makedirs(OUT, exist_ok=True)
    picks = {}
    for l in ls:
        k = ("add" if "#" in l[1] else "base", l[2], l[0])
        picks.setdefault(k, l)
    vec = []
    for l in picks.values():
        lh = leaf_hash(*l)
        vec.append({"route": l[0], "hsCode": l[1], "rateType": l[2], "bps": l[3], "amountMicro": l[4], "unit": l[5],
                    "currency": l[6], "leafHash": "0x" + lh.hex(), "proof": ["0x" + p.hex() for p in proof(layers, lh)]})
    json.dump({"root": "0x" + root.hex(), "vectors": vec}, open(os.path.join(OUT, "vectors.json"), "w"), indent=1)
    info = {"root": "0x" + root.hex(), "leafCount": len(ls), "depth": len(layers) - 1, "revision": meta["revisionName"],
            "uri": uri, "leafEncoding": "keccak256(keccak256(abi.encode(string route,string hsCode,uint8 rateType,uint32 bps,uint64 amountMicro,bytes16 unit,bytes3 currency)))",
            "rateTypes": KIND, "routes": "base: ANY->US + hts; Chapter 99 layer: <ISO2|ANY>->US + '<hts>#<9903 heading>'",
            "publishRootCalldata": calldata_publish(root, len(ls), meta["revisionName"], uri)}
    json.dump(info, open(os.path.join(OUT, "root.json"), "w"), indent=2)
    print(json.dumps({k: v for k, v in info.items() if k != "publishRootCalldata"}, indent=2))

if __name__ == "__main__":
    main()
