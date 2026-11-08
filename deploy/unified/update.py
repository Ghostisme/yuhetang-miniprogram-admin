#!/usr/bin/env python3
"""Update only the existing Yuhetang Java container and the mp-admin static site."""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time


class UpdateError(RuntimeError):
    pass


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def regular(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise UpdateError('Expected a regular file: ' + str(path))
    return path


def no_links(path):
    path = Path(path).absolute()
    if any(p.is_symlink() for p in (path, *path.parents)):
        raise UpdateError('Symbolic links are not accepted in the deployment path: ' + str(path))


def verify_package(root):
    root = Path(root).absolute()
    no_links(root)
    manifest = json.loads(regular(root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schemaVersion') != 1 or not re.fullmatch(r'\d{8}-\d{6}', manifest.get('releaseId', '')):
        raise UpdateError('Unsupported release manifest')
    entries = manifest.get('files', [])
    if not isinstance(entries, list) or not entries:
        raise UpdateError('Release manifest has no files')
    expected = {'manifest.json', 'SHA256SUMS'}
    for entry in entries:
        name = entry['path']
        pure = PurePosixPath(name)
        if pure.is_absolute() or '..' in pure.parts or '\\' in name or ':' in name or name in expected or str(pure) != name:
            raise UpdateError('Invalid or duplicate package path: ' + name)
        expected.add(name)
        path = root.joinpath(*pure.parts)
        no_links(path)
        regular(path)
        if path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise UpdateError('Release checksum failed: ' + name)
    actual = set()
    for path in root.rglob('*'):
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            raise UpdateError('Unexpected release file type: ' + str(path))
        if path.is_file():
            actual.add(path.relative_to(root).as_posix())
    if actual != expected:
        raise UpdateError('Release contains missing or unlisted files')
    required = {'update.sh', 'update.py', 'README.md', 'server/admin/index.html',
                'server/java/reservation.jar', 'server/java/Dockerfile', 'server/java/run.sh'}
    if not required <= expected:
        raise UpdateError('Release is missing a required updater, frontend or backend file')
    checks = {}
    for line in regular(root / 'SHA256SUMS').read_text(encoding='utf-8').splitlines():
        checksum, name = line.split('  ', 1)
        if name in checks or name not in expected - {'SHA256SUMS'} or not re.fullmatch(r'[0-9a-f]{64}', checksum):
            raise UpdateError('Invalid checksum manifest')
        checks[name] = checksum
        if digest(root / name) != checksum:
            raise UpdateError('Checksum manifest failed: ' + name)
    if set(checks) != expected - {'SHA256SUMS'}:
        raise UpdateError('Checksum manifest is incomplete')
    if digest(root / 'server/java/reservation.jar') != manifest['javaJarSha256']:
        raise UpdateError('The backend JAR does not match the release')
    return manifest


def atomic_copy(source, destination, mode=0o644):
    destination = Path(destination)
    no_links(destination)
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    fd, temporary = tempfile.mkstemp(prefix='.yuhetang-', dir=destination.parent)
    try:
        with os.fdopen(fd, 'wb') as stream, Path(source).open('rb') as incoming:
            shutil.copyfileobj(incoming, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def public_directories(directory, root):
    """Create only missing static-site directories; umask 077 must not hide assets."""
    directory, root = Path(directory), Path(root)
    directory.relative_to(root)
    no_links(directory)
    missing = []
    current = directory
    while not current.exists():
        missing.append(current)
        current = current.parent
    for current in reversed(missing):
        current.mkdir(mode=0o755)
        os.chmod(current, 0o755)


class Updater:
    java = 'yuhetang-java-api'
    mysql = 'yuwatang-mysql-isolated'
    legacy_service = 'yuwatang-reservation.service'
    environment = Path('/etc/yuwatang-reservation.docker.env')
    app_files = Path('/var/lib/yuwatang-reservation')
    upload_root = Path('/root/yuhetang-upload')
    backup_root = Path('/var/backups/yuhetang-unified')
    origin = 'https://mp-admin.hetuonian.cn'

    def __init__(self, root, site, reload_env=False):
        self.root = Path(root)
        self.manifest = verify_package(self.root)
        self.release = self.manifest['releaseId']
        self.image = 'yuhetang-java-api:' + self.release
        self.site = Path(site)
        self.reload_env = reload_env
        self.backup = None
        self.previous = None
        self.previous_id = None
        self.stopped = False
        self.renamed = False
        self.migration_started = False
        self.index_changed = False
        self.schema_before = None
        self.complete = False

    def command(self, *args, live=False, input=None, include_stderr=False):
        result = subprocess.run(args, input=input, text=True, stdout=None if live else subprocess.PIPE,
                                stderr=subprocess.STDOUT if include_stderr else (None if live else subprocess.PIPE))
        if result.returncode:
            # Commands never contain passwords; do not print captured database/config output.
            raise UpdateError('Command failed (exit %s): %s' % (result.returncode, ' '.join(args)))
        return '' if live else result.stdout.strip()

    def inspect(self, name, template):
        return self.command('docker', 'inspect', '--format', template, name)

    def state(self, name):
        return json.loads(self.inspect(name, '{{json .State}}'))

    def check_legacy_service(self):
        """Detect the previous host installation before stopping a working container."""
        if not shutil.which('systemctl'):
            return
        result = subprocess.run(['systemctl', 'show', self.legacy_service, '--no-pager',
                                 '-p', 'LoadState', '-p', 'ActiveState', '-p', 'UnitFileState'],
                                text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
        if values.get('LoadState') == 'not-found':
            return
        if result.returncode or not values.get('LoadState') or not values.get('ActiveState'):
            raise UpdateError('Cannot verify the previous host Java service: ' + self.legacy_service)
        if values['ActiveState'] not in ('inactive', 'failed') or values.get('UnitFileState', '').startswith('enabled'):
            raise UpdateError('Previous host Java service is active or enabled: ' + self.legacy_service +
                              '. Confirm this project is using Docker, then run: sudo systemctl disable --now ' + self.legacy_service)

    def check_free_ports(self):
        for port in (8790, 8791):
            if self.command('ss', '-H', '-lnt', 'sport = :' + str(port)):
                raise UpdateError('Port ' + str(port) + ' is still occupied after stopping project Java. ' +
                                  'Identify its owner with sudo ss -lntp before retrying; no process was killed.')

    def save_startup_log(self):
        """Keep full logs private; print only a recognized, non-sensitive failure reason."""
        try:
            logs = self.command('docker', 'logs', '--tail', '180', self.java, include_stderr=True)
            path = self.backup / 'java-startup.log'
            with path.open('x', encoding='utf-8') as stream:
                os.chmod(path, 0o600)
                stream.write(logs + '\n')
            print('Private Java startup log: ' + str(path), file=sys.stderr)
            conflict = re.search(r'Port (8790|8791) was already in use', logs)
            if conflict:
                print('STARTUP CAUSE: port ' + conflict.group(1) + ' was already in use. Check the previous host Java service and port owner.', file=sys.stderr)
        except (UpdateError, OSError) as error:
            print('Could not retain startup log; inspect the retained failed container. ' + str(error), file=sys.stderr)

    def local_url(self, path):
        return self.command('curl', '--noproxy', '*', '--resolve', 'mp-admin.hetuonian.cn:443:127.0.0.1',
                            '--fail', '--silent', '--show-error', '--connect-timeout', '3', '--max-time', '10', self.origin + path)

    def health(self):
        body = self.command('curl', '--noproxy', '*', '--fail', '--silent', '--show-error',
                            '--connect-timeout', '2', '--max-time', '4', 'http://127.0.0.1:8790/api/health')
        value = json.loads(body)
        if value.get('status') != 'ok' or value.get('database') != 'connected' or value.get('mode') != 'production':
            raise UpdateError('Java/database production health check failed')

    def mysql_query(self, sql):
        return self.command('docker', 'exec', '-i', self.mysql, 'mysql', '--defaults-extra-file=/run/secrets/client.cnf',
                            '--protocol=socket', '--database=yuwatang_reservation', '--batch', '--skip-column-names', input=sql)

    def schema(self):
        sql = """SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA
FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='yuwatang_reservation' ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME
FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA='yuwatang_reservation' ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,COALESCE(REFERENCED_TABLE_NAME,''),COALESCE(REFERENCED_COLUMN_NAME,'')
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='yuwatang_reservation' ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;
SELECT version,success FROM flyway_schema_history ORDER BY installed_rank;
"""
        return hashlib.sha256(self.mysql_query(sql).encode()).hexdigest()

    def preflight(self):
        if sys.platform != 'linux' or os.geteuid() != 0:
            raise UpdateError('Run on the existing Linux server as root: sudo bash update.sh')
        for tool in ('docker', 'curl', 'bash', 'ss'):
            if not shutil.which(tool):
                raise UpdateError('Required server command is missing: ' + tool)
        if self.command('docker', 'info', '--format', '{{.OSType}}') != 'linux':
            raise UpdateError('Docker must be running on Linux')
        self.check_legacy_service()
        for name, role in ((self.java, 'java-api'), (self.mysql, 'mysql-isolated')):
            if self.inspect(name, '{{index .Config.Labels "com.yuwatang.component"}}') != role or not self.state(name)['Running']:
                raise UpdateError('Expected an existing running ' + role + ' container: ' + name)
        if self.inspect(self.java, '{{.HostConfig.NetworkMode}}') != 'host':
            raise UpdateError('Keep the existing Java host network')
        if self.command('docker', 'port', self.mysql, '3306/tcp') != '127.0.0.1:3307':
            raise UpdateError('The dedicated MySQL port must remain 127.0.0.1:3307')
        self.current_image = self.inspect(self.java, '{{.Config.Image}}')
        if not self.current_image.startswith('yuhetang-java-api:'):
            raise UpdateError('The current Java image is outside the expected project')
        self.previous_id = self.inspect(self.java, '{{.Id}}')
        no_links(self.environment)
        config = regular(self.environment).stat()
        if config.st_uid != 0 or stat.S_IMODE(config.st_mode) != 0o600:
            raise UpdateError('Keep the existing root-owned 0600 Docker environment file')
        import pwd
        account = pwd.getpwnam('yuwatang')
        no_links(self.app_files)
        if account.pw_uid == 0 or not self.app_files.is_dir() or self.app_files.stat().st_uid != account.pw_uid or self.app_files.stat().st_gid != account.pw_gid:
            raise UpdateError('Keep the existing yuwatang application data directory and ownership')
        no_links(self.site)
        if self.site.parent.parent != Path('/opt/1panel/www/sites') or self.site.name != 'index':
            raise UpdateError('Site root must be an existing /opt/1panel/www/sites/SITE/index directory')
        regular(self.site / 'index.html')
        for path in self.site.rglob('*'):
            if path.is_symlink():
                raise UpdateError('Inspect the symbolic link in the existing static site: ' + str(path))
        if shutil.disk_usage('/').free < 3 * 1024**3:
            raise UpdateError('At least 3 GiB free disk is required before preparing backups and the image')
        self.health()
        remote = self.local_url('/api/health')
        if json.loads(remote).get('database') != 'connected':
            raise UpdateError('Existing HTTPS /api/ proxy is not healthy')
        # curl output is text with its final newline stripped; compare text consistently.
        if self.local_url('/admin') != (self.site / 'index.html').read_text(encoding='utf-8').strip():
            raise UpdateError('Existing HTTPS /admin does not serve the selected site root; check 1Panel first')

    def stage(self):
        no_links(self.upload_root)
        self.upload_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = self.upload_root / ('yuhetang-full-update-' + self.release)
        if target.absolute() == self.root.absolute():
            return
        if target.exists():
            verify_package(target)
            if digest(target / 'manifest.json') != digest(self.root / 'manifest.json'):
                raise UpdateError('An existing private release directory contains different files')
        else:
            temporary = Path(tempfile.mkdtemp(prefix='.yuhetang-full-', dir=self.upload_root))
            # Do not remove an interrupted staging directory automatically.
            shutil.copytree(self.root, temporary, dirs_exist_ok=True)
            verify_package(temporary)
            os.chmod(temporary, 0o700)
            os.rename(temporary, target)
        self.root = target

    def prepare_image(self):
        self.command('docker', 'build', '-t', self.image, str(self.root / 'server/java'), live=True)
        found = self.command('docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'sha256sum', self.image, '/app/reservation.jar').split()[0]
        if found != self.manifest['javaJarSha256']:
            raise UpdateError('Built image JAR checksum does not match the unified release')
        self.command('docker', 'run', '--rm', '--network', 'none', '--env-file', str(self.environment),
                     '--entrypoint', '/bin/bash', self.image, '/app/check-db-target.sh', live=True)

    def dump_database(self, destination):
        args = ['docker', 'exec', self.mysql, 'mysqldump', '--defaults-extra-file=/run/secrets/client.cnf',
                '--single-transaction', '--quick', '--no-tablespaces', '--set-gtid-purged=OFF', '--databases', 'yuwatang_reservation']
        with (self.backup / 'database-backup.stderr').open('wb') as errors, gzip.open(destination, 'wb') as output:
            process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors)
            try:
                with process.stdout:
                    shutil.copyfileobj(process.stdout, output)
            except BaseException:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                raise
            else:
                code = process.wait()
        if code:
            raise UpdateError('Dedicated database backup failed; see the private backup error file')
        size = 0
        with gzip.open(destination, 'rb') as restored:
            while chunk := restored.read(1024 * 1024):
                size += len(chunk)
        if size < 100:
            raise UpdateError('The database dump is unexpectedly empty')

    def backup_all(self):
        # Image builds can take time: check again before taking a healthy API offline.
        self.check_legacy_service()
        no_links(self.backup_root)
        self.backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        self.backup = self.backup_root / (self.release + '-' + stamp)
        self.backup.mkdir(mode=0o700)
        if self.inspect(self.java, '{{.Id}}') != self.previous_id:
            raise UpdateError('The Java container changed while the release was being prepared')
        self.stopped = True
        self.command('docker', 'stop', '--timeout', '50', self.java, live=True)
        self.schema_before = self.schema()
        self.dump_database(self.backup / 'database.sql.gz')
        for filename, source in (('uploads.tar.gz', self.app_files), ('admin.tar.gz', self.site)):
            with tarfile.open(self.backup / filename, 'w:gz', dereference=False) as archive:
                archive.add(source, arcname='.')
        atomic_copy(self.site / 'index.html', self.backup / 'admin-index.html', 0o600)
        with tarfile.open(self.backup / 'config-private.tar.gz', 'w:gz', dereference=False) as archive:
            archive.add(self.environment, arcname=self.environment.name)
            database_config = Path('/etc/yuwatang-reservation-db')
            if database_config.is_dir() and not database_config.is_symlink():
                archive.add(database_config, arcname='database-config')
        metadata = dict(release=self.release, previousImage=self.current_image, previousContainerId=self.previous_id,
                        schemaBefore=self.schema_before, siteRoot=str(self.site), database='yuwatang_reservation')
        (self.backup / 'before.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
        files = sorted(p for p in self.backup.iterdir() if p.is_file())
        for path in files:
            os.chmod(path, 0o600)
        (self.backup / 'SHA256SUMS').write_text(''.join(digest(p) + '  ' + p.name + '\n' for p in files), encoding='utf-8')
        print('BACKUP=' + str(self.backup), flush=True)

    def launch(self):
        self.check_free_ports()
        suffix = dt.datetime.now().strftime('%H%M%S-%f')
        self.previous = self.java + '-before-full-' + self.release + '-' + suffix
        self.command('docker', 'rename', self.java, self.previous)
        self.renamed = True
        self.migration_started = True
        self.command('bash', str(self.root / 'server/java/run.sh'), self.image, live=True)

    def wait_ready(self):
        deadline = time.monotonic() + 150
        while time.monotonic() < deadline:
            state = self.state(self.java)
            if not state.get('Running') or state.get('Restarting'):
                raise UpdateError('The new Java process exited or is restarting before becoming healthy')
            if state.get('Health', {}).get('Status') == 'healthy':
                self.health()
                value = self.command('docker', 'exec', self.java, 'sha256sum', '/app/reservation.jar').split()[0]
                if value != self.manifest['javaJarSha256'] or self.inspect(self.java, '{{.Config.Image}}') != self.image:
                    raise UpdateError('The running Java image/JAR changed during the update')
                return
            time.sleep(2)
        raise UpdateError('The new Java did not become healthy within 150 seconds')

    def publish_admin(self):
        files = [entry for entry in self.manifest['files'] if entry['path'].startswith('server/admin/')]
        for entry in files:
            relative = entry['path'][len('server/admin/'):]
            if relative == 'index.html':
                continue
            target = self.site / relative
            public_directories(target.parent, self.site)
            if target.is_file() and not target.is_symlink() and digest(target) == entry['sha256']:
                os.chmod(target, 0o644)
                continue
            atomic_copy(self.root / entry['path'], target)
        # Keep all older hashed assets, and only replace the HTML entry once every new file exists.
        self.index_changed = True
        atomic_copy(self.root / 'server/admin/index.html', self.site / 'index.html')

    def verify_live(self):
        self.wait_ready()
        value = json.loads(self.local_url('/api/health'))
        if value.get('status') != 'ok' or value.get('database') != 'connected':
            raise UpdateError('Updated HTTPS /api/ proxy check failed')
        if self.local_url('/admin') != (self.root / 'server/admin/index.html').read_text(encoding='utf-8').strip():
            raise UpdateError('HTTPS /admin is not serving the new frontend entry')

    def already_active(self):
        if self.reload_env or self.current_image != self.image:
            return False
        if self.command('docker', 'exec', self.java, 'sha256sum', '/app/reservation.jar').split()[0] != self.manifest['javaJarSha256']:
            raise UpdateError('The current release tag contains an unexpected JAR')
        for entry in self.manifest['files']:
            if entry['path'].startswith('server/admin/'):
                target = self.site / entry['path'][len('server/admin/'):]
                if not target.is_file() or target.is_symlink() or digest(target) != entry['sha256']:
                    return False
        self.verify_live()
        return True

    def recover(self):
        if not self.stopped or self.complete:
            return
        if self.migration_started:
            try:
                # Stop the attempted Java before inspecting schema: migrations must
                # not race with the compatibility decision for the previous JAR.
                if self.inspect(self.java, '{{.Config.Image}}') == self.image:
                    self.save_startup_log()
                    self.command('docker', 'update', '--restart=no', self.java)
                    self.command('docker', 'stop', '--timeout', '50', self.java, live=True)
                    self.command('docker', 'rename', self.java, self.java + '-failed-full-' + self.release + '-' + dt.datetime.now().strftime('%H%M%S-%f'))
                else:
                    raise UpdateError('An unexpected Java container replaced the attempted release')
            except UpdateError:
                # A failed launch may not have created any container. A container
                # which still exists must be inspected manually, never replaced.
                existing = self.command('docker', 'ps', '-a', '--filter', 'name=^/' + self.java + '$', '--format', '{{.ID}}')
                if existing:
                    raise UpdateError('Could not stop or identify the attempted Java container')
            try:
                unchanged = self.schema_before == self.schema()
            except Exception:
                unchanged = False
            if not unchanged:
                print('RECOVERY REQUIRED: database schema changed or could not be checked. Previous Java remains stopped. No database was automatically restored.', file=sys.stderr)
                print('Retained previous Java: ' + str(self.previous), file=sys.stderr)
                print('Private backup: ' + str(self.backup), file=sys.stderr)
                return
        if self.renamed:
            self.command('docker', 'rename', self.previous, self.java)
        if self.index_changed:
            atomic_copy(self.backup / 'admin-index.html', self.site / 'index.html')
        self.check_legacy_service()
        self.check_free_ports()
        self.command('docker', 'start', self.java, live=True)
        print('Previous Java restarted; database schema was unchanged. Check its health before retrying.', file=sys.stderr)

    def apply(self):
        self.preflight()
        if self.already_active():
            print('ALREADY ACTIVE: server release ' + self.release + '; no restart or data import was performed.')
            return
        try:
            print('[1/6] Stage and recheck the release in the private upload directory.', flush=True)
            self.stage()
            print('[2/6] Build and verify Java while the previous container is still running.', flush=True)
            self.prepare_image()
            print('[3/6] Stop only Java and back up the dedicated database, uploads, config and frontend.', flush=True)
            self.backup_all()
            print('[4/6] Switch Java and wait for database/application health.', flush=True)
            self.launch()
            self.wait_ready()
            print('[5/6] Publish frontend assets, then atomically replace index.html.', flush=True)
            self.publish_admin()
            print('[6/6] Check the running JAR, local HTTPS API and the new admin entry.', flush=True)
            self.verify_live()
            self.complete = True
            try:
                (self.backup / 'completed.json').write_text(json.dumps(dict(release=self.release, image=self.image,
                    jarSha256=self.manifest['javaJarSha256'], previousContainer=self.previous, status='healthy'), indent=2) + '\n', encoding='utf-8')
            except OSError as error:
                print('Server is healthy, but could not save the completion record: ' + str(error), file=sys.stderr)
            print('SUCCESS: SERVER RELEASE ' + self.release)
            print('Image=' + self.image + ' Health=healthy')
            print('JAR_SHA256=' + self.manifest['javaJarSha256'])
            print('Previous Java retained as: ' + self.previous)
            print('Database/config/upload/frontend backup: ' + str(self.backup))
            print('Data import and WeChat miniprogram upload are separate steps; see README.md.')
        except BaseException:
            try:
                self.recover()
            except Exception as recovery:
                print('Recovery needs inspection: ' + str(recovery), file=sys.stderr)
                print('Private backup: ' + str(self.backup), file=sys.stderr)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--verify-only', action='store_true', help='Verify package bytes only; works on Windows too')
    modes.add_argument('--check', action='store_true', help='Read-only server preflight; no build, backup or restart')
    parser.add_argument('--site-root', type=Path, default=Path('/opt/1panel/www/sites/mp-admin/index'))
    parser.add_argument('--reload-env', action='store_true', help='Recreate Java even if this release is already active')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    try:
        if args.verify_only:
            manifest = verify_package(root)
            print('PACKAGE VERIFIED: ' + manifest['releaseId'] + ' (' + str(len(manifest['files'])) + ' files)')
            return
        updater = Updater(root, args.site_root, args.reload_env)
        if args.check:
            updater.preflight()
            print('PREFLIGHT PASSED. Existing Java, dedicated MySQL and HTTPS site are healthy. No changes made.')
            return
        if sys.platform != 'linux' or os.geteuid() != 0:
            raise UpdateError('Run on the existing Linux server as root: sudo bash update.sh')
        import fcntl
        def interrupted(number, frame):
            raise UpdateError('Update interrupted by signal ' + str(number))
        for number in (signal.SIGTERM, signal.SIGHUP):
            signal.signal(number, interrupted)
        with open('/run/lock/yuhetang-unified-update.lock', 'w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            previous_umask = os.umask(0o077)
            try:
                updater.apply()
            finally:
                os.umask(previous_umask)
    except (UpdateError, OSError, ValueError, KeyError) as error:
        parser.exit(1, 'STOP: ' + str(error) + '\n')


if __name__ == '__main__':
    main()
