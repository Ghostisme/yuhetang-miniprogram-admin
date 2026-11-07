"""Package this repository's built admin as a flat static-site ZIP."""
import argparse
import datetime as dt
import hashlib
from pathlib import Path
import re
import stat
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-id", default=dt.datetime.now().strftime("%Y%m%d-%H%M%S"))
    args = parser.parse_args()
    assert re.fullmatch(r"\d{8}(?:-\d{6})?", args.release_id), "Use YYYYMMDD-HHMMSS"
    dist = ROOT / "dist"
    payload = {}
    for path in sorted(dist.rglob("*")):
        if not path.is_file():
            continue
        name = path.relative_to(dist).as_posix()
        assert name in ("index.html", "favicon.svg") or name.startswith(("assets/", "media/")), name
        assert not path.is_symlink() and not name.endswith((".map", ".env", ".key", ".pem")), name
        payload[name] = path.read_bytes()
    assert "index.html" in payload and any(n.startswith("assets/") for n in payload), "Run npm run build first"
    for asset in re.findall(r'(?:src|href)="(/assets/[^"?]+)', payload["index.html"].decode()):
        assert asset.lstrip("/") in payload, asset
    payload["SHA256SUMS"] = "".join(hashlib.sha256(data).hexdigest() + "  " + name + "\n"
                                    for name, data in sorted(payload.items())).encode("ascii")
    releases = ROOT / "releases"
    releases.mkdir(exist_ok=True)
    target = releases / ("yuhetang-admin-" + args.release_id + ".zip")
    sidecar = target.with_suffix(".zip.sha256")
    assert not target.exists() and not sidecar.exists(), "Release identifiers are immutable"
    timestamp = dt.datetime.now().timetuple()[:6]
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, data in payload.items():
            info = zipfile.ZipInfo(name, date_time=timestamp)
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=6)
    with zipfile.ZipFile(target) as archive:
        assert sorted(archive.namelist()) == sorted(payload)
        for name, data in payload.items():
            assert archive.read(name) == data, name
            assert archive.getinfo(name).external_attr >> 16 == stat.S_IFREG | 0o644, name
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    sidecar.write_text(digest + "  " + target.name + "\n", encoding="ascii")
    print(f"Verified {len(payload)} files, mode 0644, flat ZIP: {target}\nSHA256: {digest}")


if __name__ == "__main__":
    main()
