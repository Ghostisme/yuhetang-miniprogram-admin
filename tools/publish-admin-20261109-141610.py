"""Publish the verified 20261109-141610 admin ZIP on the existing 1Panel site."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import uuid
import zipfile

RELEASE = '20261109-141610'
ARCHIVE_NAME = f'yuhetang-admin-{RELEASE}.zip'
ARCHIVE_SHA256 = 'd1f509bd5a556703224cab2bccbd506aee4bfecad6aa8466e46aa83b9f4a19d2'
DOMAIN = 'mp-admin.hetuonian.cn'
SITE = Path('/opt/1panel/www/sites/mp-admin/index')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read_package(archive):
    require(hashlib.sha256(archive.read_bytes()).hexdigest() == ARCHIVE_SHA256,
            f'ZIP checksum mismatch: {archive}')
    with zipfile.ZipFile(archive) as z:
        names = z.namelist()
        require(len(names) == len(set(names)), 'ZIP contains duplicate filenames')
        payload = {}
        for entry in z.infolist():
            name, path = entry.filename, PurePosixPath(entry.filename)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in name,
                    f'Unexpected ZIP path: {name}')
            require(name in {'index.html', 'favicon.svg', 'SHA256SUMS'} or
                    name.startswith(('assets/', 'media/')), f'Unexpected ZIP file: {name}')
            require(stat.S_ISREG(entry.external_attr >> 16), f'Not a regular ZIP file: {name}')
            payload[name] = z.read(entry)
    manifest = {}
    for line in payload.pop('SHA256SUMS').decode('ascii').splitlines():
        digest, name = line.split('  ', 1)
        require(re.fullmatch(r'[0-9a-f]{64}', digest), 'Invalid checksum manifest')
        manifest[name] = digest
    require(set(manifest) == set(payload), 'ZIP manifest does not match its files')
    for name, data in payload.items():
        require(hashlib.sha256(data).hexdigest() == manifest[name], f'File checksum mismatch: {name}')
    require('index.html' in payload, 'Missing admin index.html')
    return payload


def atomic_write(target, data, mode=0o644):
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.yht-publish-', delete=False) as f:
            temporary = Path(f.name)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        temporary.chmod(mode)
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def verify_http(files):
    for name, expected in files.items():
        path = '/admin' if name == 'index.html' else '/' + name
        result = subprocess.run([
            'curl', '--noproxy', '*', '--resolve', f'{DOMAIN}:443:127.0.0.1',
            '--connect-timeout', '3', '--max-time', '20', '--fail', '--silent', '--show-error',
            '--header', 'Cache-Control: no-cache', f'https://{DOMAIN}{path}?yht_release={RELEASE}'
        ], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        require(result.returncode == 0,
                f'HTTPS check failed for {path}: {result.stderr.decode("utf-8", errors="replace").strip()}')
        require(result.stdout == expected, f'HTTPS did not serve the expected file: {path}')


def publish(site, payload, backup_root, verify):
    site = site.resolve(strict=True)
    require(site.is_dir() and (site / 'index.html').is_file(), f'Existing admin site not found: {site}')
    # A working HTTPS entry must point at this exact site before any page is changed.
    verify({'index.html': (site / 'index.html').read_bytes()})
    for name in payload:
        target = site / name
        require(target.resolve().is_relative_to(site), f'Target leaves the site directory: {name}')
        require(not target.is_symlink() and (not target.exists() or target.is_file()),
                f'Target must be a regular file: {name}')
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = backup_root / (RELEASE + '-' + dt.datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8])
    backup.mkdir(mode=0o700)
    previous = {}
    for name in payload:
        target = site / name
        if target.exists():
            previous[name] = stat.S_IMODE(target.stat().st_mode)
            atomic_write(backup / name, target.read_bytes(), 0o600)
    atomic_write(backup / 'backup.json', json.dumps({'release': RELEASE, 'site': str(site),
                 'previous_modes': previous}, indent=2).encode('utf-8'), 0o600)
    print(f'BACKUP={backup}', flush=True)
    try:
        print('[3/4] Publish assets, then atomically replace index.html.', flush=True)
        for name, data in payload.items():
            if name != 'index.html':
                atomic_write(site / name, data)
        atomic_write(site / 'index.html', payload['index.html'])
        references = re.findall(r'(?:src|href)="(/assets/[^"?]+)', payload['index.html'].decode('utf-8'))
        require(references, 'No compiled assets were found in index.html')
        print('[4/4] Verify the admin entry and its JS/CSS through local HTTPS.', flush=True)
        verify({name: payload[name] for name in ['index.html'] + [p.lstrip('/') for p in references]})
    except BaseException:
        # Keep the previous entry until its matching old files have been restored.
        try:
            for name, mode in previous.items():
                if name != 'index.html':
                    atomic_write(site / name, (backup / name).read_bytes(), mode)
            atomic_write(site / 'index.html', (backup / 'index.html').read_bytes(), previous['index.html'])
            print('ROLLBACK: Previous frontend files restored. Backup retained.', flush=True)
        except BaseException as recovery_error:
            print(f'RECOVERY REQUIRED: {recovery_error}. Use backup: {backup}', flush=True)
        raise
    print(f'SUCCESS: ADMIN RELEASE {RELEASE}', flush=True)
    print(f'Open https://{DOMAIN}/admin and refresh with Ctrl+F5.', flush=True)
    return backup


def main():
    require(hasattr(os, 'geteuid') and os.geteuid() == 0, 'Run with sudo python3 on the Ubuntu server.')
    os.umask(0o022)
    archive = Path(__file__).resolve().parent / ARCHIVE_NAME
    print('[1/4] Verify the ZIP and every file inside it.', flush=True)
    payload = read_package(archive)
    print('[2/4] Check the current website and back up files before publishing.', flush=True)
    publish(SITE, payload, Path('/var/backups/yuhetang-admin'), verify_http)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'STOP: {error}', flush=True)
        raise SystemExit(1)
