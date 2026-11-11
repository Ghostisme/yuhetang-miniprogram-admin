#!/usr/bin/env python3
"""Raise only this project's existing mp-admin upload allowance to 12 MiB."""
import argparse
import datetime as dt
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

DOMAIN = 'mp-admin.hetuonian.cn'
CONFIG = Path('/opt/1panel/www/conf.d/mp-admin.conf')


def plan(content):
    # Preserve comments, certificates, includes and upstreams byte for byte.
    active = re.sub(r'(?m)#.*$', '', content)
    domains = re.findall(r'\bserver_name\s+([^;]+);', active)
    if not domains or any(set(value.split()) != {DOMAIN} for value in domains):
        raise ValueError('Expected only the confirmed mp-admin domain in mp-admin.conf')
    if not re.search(r'\bproxy_pass\s+http://127\.0\.0\.1:8790\s*;', active):
        raise ValueError('The existing mp-admin API upstream is not 127.0.0.1:8790')

    def directive(match):
        value = match.group(2).lower()
        number, suffix = re.fullmatch(r'(\d+)([kmg]?)', value).groups()
        size = int(number) * {'': 1, 'k': 1024, 'm': 1024**2, 'g': 1024**3}[suffix]
        return match.group(0) if size == 0 or size >= 12*1024**2 else match.group(1)+'12m'+match.group(3)

    # Do not change commented examples or lower an existing larger allowance.
    lines=[]
    for line in content.splitlines(keepends=True):
        code, marker, comment=line.partition('#')
        lines.append(re.sub(r'(\bclient_max_body_size\s+)(\d+[kKmMgG]?)([ \t]*;)',directive,code)+marker+comment)
    result=''.join(lines)
    if not re.search(r'(?m)^[ \t]*client_max_body_size\s+', active):
        if not re.search(r'\bclient_max_body_size\s+',active):
            result = re.sub(r'(\bserver_name\s+[^;]+;)', r'\1\n    client_max_body_size 12m;', result)
    return result


def command(*args):
    result = subprocess.run(args, text=True, encoding='utf-8', errors='replace', capture_output=True)
    if result.returncode:
        # Do not print nginx -T output or environment configuration.
        raise RuntimeError('Command failed: '+' '.join(args[:4]))
    return result.stdout


def replace(path, content):
    temporary = path.with_name('.'+path.name+'.chat-upload-tmp')
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError('Inspect an existing temporary proxy configuration first')
    original = path.stat()
    try:
        with temporary.open('x', encoding='utf-8', newline='') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, original.st_mode & 0o777)
        if hasattr(os, 'chown'):
            os.chown(temporary, original.st_uid, original.st_gid)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def apply(path, container, check=False, runner=command, backup_root=Path('/var/backups/yuhetang-chat-proxy')):
    if path.is_symlink() or any(p.is_symlink() for p in path.parents) or not path.is_file():
        raise ValueError('Expected the existing regular mp-admin.conf file')
    original = path.read_text(encoding='utf-8')
    updated = plan(original)
    runner('docker', 'exec', container, 'nginx', '-t')
    if original == updated:
        print('CHAT UPLOAD PROXY: existing limit already permits 10 MiB videos.')
        return
    if check:
        print('CHAT UPLOAD PROXY: will set mp-admin.conf to 12m; no file changed.')
        return
    backup = backup_root / dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup.mkdir(parents=True, mode=0o700)
    shutil.copy2(path, backup / 'mp-admin.conf')
    os.chmod(backup / 'mp-admin.conf', 0o600)
    try:
        replace(path, updated)
        runner('docker', 'exec', container, 'nginx', '-t')
        runner('docker', 'exec', container, 'nginx', '-s', 'reload')
    except BaseException:
        replace(path, original)
        runner('docker', 'exec', container, 'nginx', '-t')
        runner('docker', 'exec', container, 'nginx', '-s', 'reload')
        raise
    print('CHAT UPLOAD PROXY: 12m applied; backup='+str(backup))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'linux' or os.geteuid() != 0:
        parser.error('Run on the existing Linux server with sudo')
    candidates = [line.split('\t')[0] for line in command('docker', 'ps', '--format', '{{.Names}}\t{{.Image}}').splitlines()
                  if '\t' in line and 'openresty' in line.split('\t', 1)[1].lower()]
    if len(candidates) != 1:
        raise RuntimeError('Expected exactly one running OpenResty container')
    container = candidates[0]
    source = command('docker', 'exec', container, 'cat', '/usr/local/openresty/nginx/conf/conf.d/mp-admin.conf')
    if source != CONFIG.read_text(encoding='utf-8'):
        raise RuntimeError('The mounted mp-admin configuration differs from its host file')
    apply(CONFIG, container, check=args.check)


if __name__ == '__main__':
    main()
