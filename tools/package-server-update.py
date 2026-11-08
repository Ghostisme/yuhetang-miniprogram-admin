"""Combine independently verified admin/Java releases without rebuilding a mini client or importing data."""
import argparse
import datetime as dt
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('unified_components', ROOT / 'tools/package-unified.py')
COMPONENTS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPONENTS)
UPDATE, require = COMPONENTS.UPDATE, COMPONENTS.require


def passing_python(repo, name):
    result = subprocess.run([sys.executable, '-B', '-X', 'utf8', str(repo / 'tools' / name)],
                            text=True, encoding='utf-8', capture_output=True)
    require(result.returncode == 0, result.stdout + result.stderr)
    return (result.stdout + result.stderr).encode('utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--java-release', required=True)
    parser.add_argument('--admin-release', required=True)
    parser.add_argument('--backend-repo', type=Path, default=ROOT.parent / 'yuhetang-miniprogram-backend')
    parser.add_argument('--staff-template', type=Path, required=True, help='Explicit public account/template/mapping JSON approved for this update')
    args = parser.parse_args()
    for value in (args.release_id, args.java_release, args.admin_release):
        require(re.fullmatch(r'\d{8}-\d{6}', value) is not None, 'Release identifiers must be YYYYMMDD-HHMMSS')
    backend = args.backend_repo.resolve()
    commits = {'admin': COMPONENTS.clean_commit(ROOT), 'java': COMPONENTS.clean_commit(backend)}
    java_path = backend / ('releases/yuhetang-java-docker-' + args.java_release + '.tar.gz')
    admin_path = ROOT / ('releases/yuhetang-admin-' + args.admin_release + '.zip')
    java = COMPONENTS.read_tar(java_path, 'yuhetang-java-docker-' + args.java_release + '/')
    admin = COMPONENTS.read_zip(admin_path)
    validation = json.loads(java['validation.json'])
    require(validation['sourceCommit'] == commits['java'] and not validation['sourceWorkingTreeDirty'], 'Java artifact must match the clean backend source commit')
    require(validation['backendTests']['tests'] >= 176 and not any(validation['backendTests'][key] for key in ('failures', 'errors', 'skipped')), 'Missing passing notification/menu/backend test evidence')
    jar_sha = hashlib.sha256(java['reservation.jar']).hexdigest()
    require(jar_sha == validation['backendJarSha256'], 'Java validation/JAR mismatch')
    with zipfile.ZipFile(io.BytesIO(java['reservation.jar'])) as jar:
        for name in ('com/yuwatang/reservation/WechatMenuApi.class', 'com/yuwatang/reservation/WechatMenuGateway.class',
                     'com/yuwatang/reservation/WechatMenuService.class', 'db/migration/V10__wechat_service_menu.sql',
                     'com/yuwatang/reservation/AppointmentPolicy.class', 'com/yuwatang/reservation/RescheduleRequests.class',
                     'com/yuwatang/reservation/RescheduleMaintenance.class', 'com/yuwatang/reservation/StaffAppointmentTemplate.class',
                     'db/migration/V11__appointment_reschedule_requests.sql'):
            require('BOOT-INF/classes/' + name in jar.namelist(), 'Java is missing a required implementation or migration: ' + name)
    COMPONENTS.built_after_sources(ROOT, ROOT / 'dist/index.html')
    for name, value in admin.items():
        if name != 'SHA256SUMS':
            require(value == (ROOT / 'dist' / name).read_bytes(), 'Supplied admin ZIP differs from the checked source build: ' + name)
    report_path = ROOT / 'backups/wechat-menu/result.json'
    menu_report = json.loads(report_path.read_text(encoding='utf-8'))
    require(len(menu_report['checks']) >= 7 and not menu_report['errors'] and not menu_report['unknown'] and not menu_report.get('failure'), 'Missing passing isolated admin menu verification')
    require(report_path.stat().st_mtime >= (ROOT / 'dist/index.html').stat().st_mtime, 'Rerun browser verification against this admin build')
    editors_path = ROOT / 'backups/list-editors/result.json'
    editors_report = json.loads(editors_path.read_text(encoding='utf-8'))
    require(len(editors_report['checks']) >= 9 and not editors_report['errors'] and not editors_report['unknown'] and not editors_report.get('failure'), 'Missing passing isolated list editor verification')
    require(editors_path.stat().st_mtime >= (ROOT / 'dist/index.html').stat().st_mtime, 'Rerun list editor verification against this admin build')
    appointment_path = ROOT / 'backups/appointment-changes/result.json'
    appointment_report = json.loads(appointment_path.read_text(encoding='utf-8'))
    require(appointment_report.get('status') == 'passed' and len(appointment_report['checks']) >= 8
            and not appointment_report['errors'] and not appointment_report['unknown'], 'Missing passing staff detail/reschedule browser verification')
    require(appointment_path.stat().st_mtime >= (ROOT / 'dist/index.html').stat().st_mtime, 'Rerun appointment verification against this admin build')
    payload = {prefix + name: value for prefix, files in (('server/java/', java), ('server/admin/', admin)) for name, value in files.items()}
    for name in ('update.py', 'update.sh'):
        payload[name] = (ROOT / 'deploy/unified' / name).read_bytes().replace(b'\r\n', b'\n')
    payload['README.md'] = (ROOT / 'deploy/unified/SERVER-UPDATE.md').read_text(encoding='utf-8').replace('{{RELEASE_ID}}', args.release_id).replace('{{ADMIN_RELEASE}}', args.admin_release).replace('{{JAVA_SHA256}}', jar_sha).encode('utf-8')
    payload['validation/java-component.json'] = java['validation.json']
    payload['validation/admin-menu.json'] = report_path.read_bytes()
    payload['validation/admin-list-editors.json'] = editors_path.read_bytes()
    payload['validation/admin-appointment-changes.json'] = appointment_path.read_bytes()
    payload['validation/unified-updater-tests.txt'] = passing_python(ROOT, 'test_unified_update.py')
    payload['validation/staff-config-tests.txt'] = passing_python(backend, 'test_configure_staff_wechat.py')
    for name in ('服务号菜单配置.md', '线上预约消息测试.md', '预约取消与改约闭环.md'):
        payload['docs/' + name] = (backend / 'docs' / name).read_bytes()
    staff = None
    if args.staff_template:
        staff = json.loads(args.staff_template.read_text(encoding='utf-8'))
        UPDATE.staff_template({'staffNotification': staff})
        payload['configuration/staff-template.json'] = (json.dumps(staff, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    components = {name: dict(release=release, file=path.name, sha256=UPDATE.digest(path)) for name, release, path in
                  (('admin', args.admin_release, admin_path), ('java', args.java_release, java_path))}
    manifest = dict(schemaVersion=1, releaseId=args.release_id, createdAt=dt.datetime.now(dt.timezone.utc).isoformat(),
        javaJarSha256=jar_sha, sources=commits, components=components, scope='existing Java API and admin static website',
        database='yuwatang_reservation', databaseInstall=False, automaticDataImport=False, miniprogramIncluded=False,
        automaticMenuPublish=False, cloudDeployed=False, dockerRuntimeValidated=False, realWechatDeliveryValidated=False,
        files=[dict(path=name, bytes=len(value), sha256=hashlib.sha256(value).hexdigest()) for name, value in sorted(payload.items())])
    if staff:
        manifest['staffNotification'] = staff
    payload['manifest.json'] = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    payload['SHA256SUMS'] = ''.join(hashlib.sha256(value).hexdigest() + '  ' + name + '\n' for name, value in sorted(payload.items())).encode('utf-8')
    title = 'yuhetang-full-update-' + args.release_id
    folder, archive_path = ROOT / 'releases' / title, ROOT / 'releases' / (title + '.tar.gz')
    sidecar = Path(str(archive_path) + '.sha256')
    require(not any(path.exists() for path in (folder, archive_path, sidecar)), 'Release identifiers are immutable')
    for name, value in sorted(payload.items()):
        target = folder / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(value)
    UPDATE.verify_package(folder)
    with tarfile.open(archive_path, 'x:gz', compresslevel=6) as archive:
        for name, value in sorted(payload.items()):
            entry = tarfile.TarInfo(title + '/' + name)
            entry.size, entry.mode = len(value), 0o755 if name.endswith('.sh') else 0o644
            entry.mtime, entry.uid, entry.gid = int(dt.datetime.now().timestamp()), 0, 0
            archive.addfile(entry, io.BytesIO(value))
    with tarfile.open(archive_path, 'r:gz') as archive:
        require(len(archive.getmembers()) == len(payload), 'Final archive file count mismatch')
        for entry in archive:
            require(entry.isfile() and entry.name.startswith(title + '/'), 'Unexpected final archive entry')
            name = entry.name[len(title) + 1:]
            require(entry.mode == (0o755 if name.endswith('.sh') else 0o644) and archive.extractfile(entry).read() == payload[name], 'Final archive bytes or mode differ: ' + name)
    sidecar.write_text(UPDATE.digest(archive_path) + '  ' + archive_path.name + '\n', encoding='ascii')
    guide = ROOT / 'releases' / (title + '.README.md')
    guide.write_bytes(payload['README.md'])
    print(json.dumps(dict(archive=str(archive_path), checksum=str(sidecar), guide=str(guide), bytes=archive_path.stat().st_size,
        sha256=UPDATE.digest(archive_path), files=len(payload), javaJarSha256=jar_sha, components=components), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
