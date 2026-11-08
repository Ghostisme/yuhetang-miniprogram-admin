"""Assemble verified component artifacts into one cumulative deployment archive."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('unified_release', ROOT / 'deploy/unified/update.py')
UPDATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATE)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def git(repo, *arguments):
    return subprocess.check_output(['git', '-C', str(repo), *arguments], encoding='utf-8').strip()


def clean_commit(repo):
    require(not git(repo, 'status', '--porcelain'), 'Commit the working tree before packaging: ' + str(repo))
    return git(repo, 'rev-parse', 'HEAD')


def name_ok(name):
    path = PurePosixPath(name)
    require(bool(name) and not path.is_absolute() and '..' not in path.parts and str(path) == name
            and '\\' not in name and ':' not in name, 'Invalid archive path: ' + name)
    return name


def check_outer(path):
    line = Path(str(path) + '.sha256').read_text(encoding='ascii').strip()
    value, name = line.split('  ', 1)
    require(name == path.name and value == UPDATE.digest(path), 'Archive checksum failed: ' + str(path))


def checked_payload(payload):
    checks = payload.get('SHA256SUMS', b'').decode('utf-8').splitlines()
    seen = set()
    for line in checks:
        value, name = line.split('  ', 1)
        require(name in payload and name not in seen and hashlib.sha256(payload[name]).hexdigest() == value,
                'Component manifest failed: ' + name)
        seen.add(name)
    require(seen == set(payload) - {'SHA256SUMS'}, 'Component checksum manifest is incomplete')
    return payload


def read_zip(path, prefix=''):
    check_outer(path)
    payload = {}
    with zipfile.ZipFile(path) as archive:
        require(archive.testzip() is None, 'Damaged ZIP: ' + str(path))
        for member in archive.infolist():
            if member.is_dir():
                continue
            require(member.filename.startswith(prefix), 'Unexpected ZIP prefix')
            require(not stat.S_ISLNK(member.external_attr >> 16), 'ZIP contains a symbolic link')
            name = name_ok(member.filename[len(prefix):])
            require(name not in payload, 'Duplicate ZIP member')
            payload[name] = archive.read(member)
    return checked_payload(payload)


def read_tar(path, prefix):
    check_outer(path)
    payload = {}
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            if member.isdir():
                continue
            require(member.isfile() and member.name.startswith(prefix), 'Invalid TAR member')
            name = name_ok(member.name[len(prefix):])
            require(name not in payload, 'Duplicate TAR member')
            payload[name] = archive.extractfile(member).read()
    return checked_payload(payload)


def built_after_sources(repo, entry):
    require(entry.is_file(), 'Build the component first: ' + str(entry))
    paths = git(repo, 'ls-files', 'src', 'config', 'package.json', 'package-lock.json', 'babel.config.js', 'vite.config.ts', 'tsconfig.json').splitlines()
    recent = max((repo / name).stat().st_mtime for name in paths)
    require(entry.stat().st_mtime >= recent, 'Build output predates current sources: ' + str(entry))


def add_tree(payload, source, prefix):
    for path in sorted(source.rglob('*')):
        require(not path.is_symlink(), 'Symbolic link in artifact: ' + str(path))
        if not path.is_file():
            continue
        name = name_ok(path.relative_to(source).as_posix())
        require(path.name != 'project.private.config.json' and not path.name.startswith('.env')
                and path.suffix not in {'.pem', '.key', '.map', '.p12', '.pfx', '.pyc'}, 'Unexpected private/debug artifact: ' + name)
        payload[prefix + name] = path.read_bytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-id', default=dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
    parser.add_argument('--component-release', default='20261108-142200')
    parser.add_argument('--backend-repo', type=Path, default=ROOT.parent / 'yuhetang-miniprogram-backend')
    parser.add_argument('--miniprogram-repo', type=Path, default=ROOT.parent / 'yuhetang-miniprogram')
    args = parser.parse_args()
    require(re.fullmatch(r'\d{8}-\d{6}', args.release_id) is not None, 'Release ID must be YYYYMMDD-HHMMSS')
    require(re.fullmatch(r'\d{8}-\d{6}', args.component_release) is not None, 'Invalid component release ID')
    backend, mini = args.backend_repo.resolve(), args.miniprogram_repo.resolve()
    commits = {name: clean_commit(repo) for name, repo in
               (('admin', ROOT), ('java', backend), ('miniprogram', mini))}
    component = args.component_release
    java_path = backend / ('releases/yuhetang-java-docker-' + component + '.tar.gz')
    admin_path = ROOT / ('releases/yuhetang-admin-' + component + '.zip')
    java = read_tar(java_path, 'yuhetang-java-docker-' + component + '/')
    admin = read_zip(admin_path)
    validation = json.loads(java['validation.json'])
    require(validation['sourceCommit'] == commits['java'] and not validation['sourceWorkingTreeDirty'],
            'The Java release does not match the clean backend commit')
    require(validation['backendTests']['tests'] >= 148 and not any(validation['backendTests'][key] for key in ('failures', 'errors', 'skipped')),
            'The Java component lacks passing test evidence')
    jar_sha = hashlib.sha256(java['reservation.jar']).hexdigest()
    require(jar_sha == validation['backendJarSha256'], 'Java validation/JAR mismatch')
    built_after_sources(ROOT, ROOT / 'dist/index.html')
    require(admin['index.html'] == (ROOT / 'dist/index.html').read_bytes(), 'Admin ZIP is not the latest build')
    for name, content in admin.items():
        if name != 'SHA256SUMS':
            require(content == (ROOT / 'dist' / name).read_bytes(), 'Admin ZIP/build differ: ' + name)
    built_after_sources(mini, mini / 'dist/weapp/app.js')
    built_after_sources(mini, mini / 'dist/h5/index.html')
    payload = {}
    for prefix, files in (('server/java/', java), ('server/admin/', admin)):
        payload.update({prefix + name: value for name, value in files.items()})
    add_tree(payload, mini / 'dist/weapp', 'client/miniprogram/dist/weapp/')
    add_tree(payload, mini / 'dist/h5', 'client/h5/')
    project = json.loads((mini / 'project.config.json').read_text(encoding='utf-8'))
    require(project['appid'] == 'wxce054e18303efb8a' and project['miniprogramRoot'] == 'dist/weapp/', 'Unexpected mini app/root')
    payload['client/miniprogram/project.config.json'] = (json.dumps(project, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    require(b'https://mp-admin.hetuonian.cn' in payload['client/miniprogram/dist/weapp/common.js'], 'Mini build is not targeting the production origin')
    require(b'127.0.0.1:8098' not in b''.join(v for k, v in payload.items() if k.startswith('client/') and k.endswith('.js')),
            'Mini build still contains the old local API')

    # Reuse the already reviewed photo datasets, not a production database dump.
    for stem in ('yuhetang-client-services-20261108-125710', 'yuhetang-local-content-20261108-131541'):
        data = read_zip(ROOT / ('releases/' + stem + '.zip'), stem + '/')
        for name, value in data.items():
            if name.startswith('initial-data/'):
                payload['optional-data/' + name] = value
    add_tree(payload, backend / 'initial-data/official-stores', 'optional-data/initial-data/official-stores/')
    for name in ('initialize-official-stores.py', 'initialize-client-services.py', 'initialize-local-content.py'):
        payload['optional-data/tools/' + name] = (backend / 'tools' / name).read_bytes()
    payload['tools/configure-staff-wechat.py'] = (backend / 'tools/configure-staff-wechat.py').read_bytes()
    for name in ('消息通知验收与店长接入.md', '客服会话接入与结束.md', '客户品项独立初始化.md', '本地示例内容补充.md', '官网门店初始化.md'):
        payload['docs/' + name] = (backend / 'docs' / name).read_bytes()
    payload['docs/客服接待与官方工具.md'] = (ROOT / 'deploy/unified/客服接待说明.md').read_bytes()
    for name in ('update.py', 'update.sh'):
        payload[name] = (ROOT / 'deploy/unified' / name).read_bytes().replace(b'\r\n', b'\n')
    readme = (ROOT / 'deploy/unified/README.md').read_text(encoding='utf-8')
    payload['README.md'] = readme.replace('{{RELEASE_ID}}', args.release_id).replace('{{JAVA_SHA256}}', jar_sha).encode('utf-8')
    payload['validation/java-component.json'] = java['validation.json']
    login_report = json.loads((mini / 'backups/login-verification/result.json').read_text(encoding='utf-8'))
    require(login_report['status'] == 'passed' and not login_report['liveApisUsed'], 'Missing isolated customer login verification')
    built_h5 = {p.relative_to(mini / 'dist/h5').as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in (mini / 'dist/h5').rglob('*') if p.is_file()}
    require(login_report.get('h5Files') == built_h5, 'Login verification does not match the current H5 build')
    payload['validation/client-login.json'] = (json.dumps(login_report, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    payload['validation/client-unit-tests.txt'] = (mini / 'backups/login-unit-tests.txt').read_bytes()
    payload['docs/小程序客户登录说明.md'] = (mini / 'README.md').read_bytes()
    for source, target in (('backups/customer-chat-verification/result.json', 'admin-chat.json'),
                           ('backups/chat-customer-verification/result.json', 'client-chat.json')):
        report = json.loads((ROOT / source).read_text(encoding='utf-8'))
        require(report['status'] == 'passed' and not report.get('liveApisUsed', True), 'Missing passing isolated browser report')
        payload['validation/' + target] = (json.dumps(report, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    result = subprocess.run(['python', '-B', str(ROOT / 'tools/test_unified_update.py')], text=True, capture_output=True)
    require(result.returncode == 0, result.stdout + result.stderr)
    payload['validation/unified-updater-tests.txt'] = (result.stdout + result.stderr).encode('utf-8')
    sources = {name: dict(commit=commit, repository='https://github.com/Ghostisme/' +
               {'java': 'yuhetang-miniprogram-backend', 'admin': 'yuhetang-miniprogram-admin', 'miniprogram': 'yuhetang-miniprogram'}[name])
               for name, commit in commits.items()}
    manifest = dict(schemaVersion=1, releaseId=args.release_id, createdAt=dt.datetime.now(dt.timezone.utc).isoformat(),
                    componentRelease=component, javaJarSha256=jar_sha, sources=sources,
                    apiOrigin='https://mp-admin.hetuonian.cn', callbackOrigin='https://booking.hetuonian.cn',
                    database='yuwatang_reservation', databaseInstall=False, automaticDataImport=False,
                    dockerRuntimeValidated=False, cloudDeployed=False, realWechatDeliveryValidated=False,
                    files=[dict(path=name, bytes=len(value), sha256=hashlib.sha256(value).hexdigest()) for name, value in sorted(payload.items())])
    payload['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    payload['SHA256SUMS'] = ''.join(hashlib.sha256(value).hexdigest() + '  ' + name + '\n' for name, value in sorted(payload.items())).encode('utf-8')
    releases = ROOT / 'releases'
    title = 'yuhetang-full-update-' + args.release_id
    folder, archive_path = releases / title, releases / (title + '.tar.gz')
    require(not folder.exists() and not archive_path.exists() and not Path(str(archive_path) + '.sha256').exists(), 'Release identifiers are immutable')
    folder.mkdir(parents=True)
    for name, value in sorted(payload.items()):
        file = folder / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(value)
    UPDATE.verify_package(folder)
    # Archive entries get explicit Linux permissions even when packaged on Windows.
    with tarfile.open(archive_path, 'w:gz', compresslevel=6) as archive:
        for name, value in sorted(payload.items()):
            info = tarfile.TarInfo(title + '/' + name)
            info.size, info.mode = len(value), 0o755 if name == 'update.sh' else 0o644
            info.mtime, info.uid, info.gid = int(dt.datetime.now().timestamp()), 0, 0
            archive.addfile(info, io.BytesIO(value))
    with tarfile.open(archive_path, 'r:gz') as archive:
        members = archive.getmembers()
        require(len(members) == len(payload), 'Final archive file count mismatch')
        for member in members:
            name = member.name[len(title) + 1:]
            require(member.name.startswith(title + '/') and member.isfile(), 'Invalid final TAR member')
            require(member.mode == (0o755 if name == 'update.sh' else 0o644), 'Final TAR permission mismatch')
            require(archive.extractfile(member).read() == payload[name], 'Final TAR checksum mismatch: ' + name)
    sidecar = Path(str(archive_path) + '.sha256')
    sidecar.write_text(UPDATE.digest(archive_path) + '  ' + archive_path.name + '\n', encoding='ascii')
    (releases / (title + '.README.md')).write_bytes(payload['README.md'])
    print(json.dumps(dict(archive=str(archive_path), bytes=archive_path.stat().st_size, sha256=UPDATE.digest(archive_path),
                          checksum=str(sidecar), files=len(payload), folder=str(folder), sources=sources), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
