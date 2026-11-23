#!/usr/bin/env python3
# RTW: Cargo.lock'taki her crates.io paketini OSV (RustSec dahil) veritabaninda sorgular.
# Bilinen bir guvenlik kaydi varsa cikis kodu 1 olur. Bilincli kabul edilen kayitlar
# ALLOW sozlugundedir ve her birinin gerekcesi yazilidir; gerekcesiz kabul yoktur.
#
# Run: python3 scripts/osv-check.py Cargo.lock
import json
import re
import sys
import urllib.request

ALLOW = {
    # basic-toml "bakimsiz" bilgisidir, acik degil. Yalniz uniffi-bindgen (Kotlin/Swift
    # baglama URETICISI) kullanir; uygulamaya giden ikiliye girmez. uniffi onu birakinca kalkar.
    "RUSTSEC-2026-0374",
}


def packages(lock_path):
    text = open(lock_path, encoding="utf-8").read()
    for block in text.split("[[package]]")[1:]:
        if 'source = "registry+' not in block:
            continue
        name = re.search(r'^name = "([^"]+)"', block, re.M).group(1)
        version = re.search(r'^version = "([^"]+)"', block, re.M).group(1)
        yield name, version


def main():
    pkgs = sorted(set(packages(sys.argv[1])))
    body = {
        "queries": [
            {"package": {"name": n, "ecosystem": "crates.io"}, "version": v} for n, v in pkgs
        ]
    }
    req = urllib.request.Request(
        "https://api.osv.dev/v1/querybatch",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        results = json.load(resp)["results"]
    if len(results) != len(pkgs):
        print(f"::error::OSV yanit sayisi {len(results)} != paket sayisi {len(pkgs)}")
        return 1

    failed = False
    for (name, version), result in zip(pkgs, results):
        for vuln in result.get("vulns", []):
            vid = vuln["id"]
            if vid in ALLOW:
                print(f"kabul edildi: {name} {version} {vid}")
                continue
            failed = True
            print(f"::error::{name} {version} {vid}")
    print(f"{len(pkgs)} paket tarandi")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
