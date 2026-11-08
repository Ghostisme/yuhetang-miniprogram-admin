"""Exercise the release verifier and update failure paths without Docker or a database."""
import contextlib
import gzip
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'deploy/unified/update.py'
SPEC = importlib.util.spec_from_file_location('unified_update', SOURCE)
UPDATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATE)


def package(root):
    payload = {
        'update.py': b'# updater\n', 'update.sh': b'#!/bin/bash\n', 'README.md': b'readme\n',
        'server/java/reservation.jar': b'tested jar', 'server/java/run.sh': b'run',
        'server/java/Dockerfile': b'FROM test', 'server/admin/index.html': b'<html>new</html>\n',
        'server/admin/assets/new.js': b'new js', 'server/admin/media/nested/photo.webp': b'new photo',
        'optional-data/tools/initialize.py': b'# optional; never execute during update',
    }
    for name, value in payload.items():
        file = root / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(value)
    manifest = dict(schemaVersion=1, releaseId='20261108-150000',
                    javaJarSha256=hashlib.sha256(payload['server/java/reservation.jar']).hexdigest(),
                    files=[dict(path=name, bytes=len(value), sha256=hashlib.sha256(value).hexdigest())
                           for name, value in sorted(payload.items())])
    (root / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    (root / 'SHA256SUMS').write_text(''.join(UPDATE.digest(root / name) + '  ' + name + '\n'
                                          for name in sorted([*payload, 'manifest.json'])), encoding='utf-8')
    return manifest


class FakeUpdater(UPDATE.Updater):
    """Keep real staging, backups, publication and recovery; fake external processes only."""
    def __init__(self, root, base):
        super().__init__(root, base / 'site')
        self.upload_root, self.backup_root = base / 'private-upload', base / 'private-backup'
        self.environment, self.app_files = base / 'existing.env', base / 'existing-uploads'
        self.environment.write_text('EXISTING=retained\n', encoding='utf-8')
        self.app_files.mkdir()
        (self.app_files / 'customer.jpg').write_bytes(b'existing customer upload')
        self.site.mkdir()
        (self.site / 'index.html').write_bytes(b'<html>old</html>\n')
        (self.site / 'assets').mkdir()
        (self.site / 'assets/old.js').write_bytes(b'old js')
        self.containers = {self.java: dict(image='yuhetang-java-api:old', running=True, id='old-id')}
        self.trace, self.fail_at, self.change_schema = [], None, False

    def preflight(self):
        self.trace.append('preflight')
        self.current_image = self.inspect(self.java, '{{.Config.Image}}')
        self.previous_id = self.inspect(self.java, '{{.Id}}')

    def prepare_image(self):
        self.trace.append('build-verify')
        if self.fail_at == 'build':
            raise UPDATE.UpdateError('image cannot be built')

    def dump_database(self, destination):
        self.trace.append('backup-database-only-yuwatang_reservation')
        if self.fail_at == 'backup':
            raise UPDATE.UpdateError('backup failed')
        with gzip.open(destination, 'wb') as stream:
            stream.write(b'only yuwatang_reservation')

    def schema(self):
        self.trace.append('schema')
        return 'changed' if self.change_schema and self.migration_started else 'before'

    def inspect(self, name, template):
        if name not in self.containers:
            raise UPDATE.UpdateError('no container')
        row = self.containers[name]
        return row['image'] if template == '{{.Config.Image}}' else row['id']

    def command(self, *args, **kwargs):
        if args[:2] == ('docker', 'stop'):
            self.trace.append('stop:' + args[-1])
            self.containers[args[-1]]['running'] = False
        elif args[:2] == ('docker', 'rename'):
            self.trace.append('rename:' + args[2] + ':' + args[3])
            if args[3] in self.containers:
                raise UPDATE.UpdateError('name already exists')
            self.containers[args[3]] = self.containers.pop(args[2])
        elif args[:2] == ('docker', 'start'):
            self.trace.append('start:' + args[2])
            self.containers[args[2]]['running'] = True
        elif args[:2] == ('docker', 'exec'):
            return self.manifest['javaJarSha256'] + '  /app/reservation.jar'
        elif args[:2] == ('docker', 'ps'):
            return 'new-id' if self.java in self.containers else ''
        elif args[0] == 'bash':
            self.trace.append('launch')
            if self.fail_at == 'launch-before-create':
                raise UPDATE.UpdateError('launch failed')
            self.containers[self.java] = dict(image=self.image, running=True, id='new-id')
            if self.fail_at == 'launch-after-create':
                raise UPDATE.UpdateError('launch failed')
        else:
            raise AssertionError('Unexpected external operation: ' + repr(args))
        return ''

    def wait_ready(self):
        self.trace.append('health')
        if self.fail_at == 'health':
            raise UPDATE.UpdateError('health failed')
        assert self.containers[self.java]['running']

    def verify_live(self):
        self.wait_ready()
        self.trace.append('https-verify')
        if self.fail_at == 'https':
            raise UPDATE.UpdateError('HTTPS failed')
        assert (self.site / 'index.html').read_bytes() == (self.root / 'server/admin/index.html').read_bytes()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.root = self.base / 'release'
        self.root.mkdir()
        self.manifest = package(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def run_update(self, updater, fail=False):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            if fail:
                with self.assertRaises(UPDATE.UpdateError):
                    updater.apply()
            else:
                updater.apply()

    def test_valid_package_is_verified(self):
        self.assertEqual(UPDATE.verify_package(self.root), self.manifest)

    def test_changed_payload_is_rejected(self):
        (self.root / 'server/admin/assets/new.js').write_bytes(b'damaged')
        with self.assertRaisesRegex(UPDATE.UpdateError, 'checksum failed'):
            UPDATE.verify_package(self.root)

    def test_extra_unlisted_file_is_rejected(self):
        (self.root / 'unexpected.env').write_text('must not be packaged')
        with self.assertRaisesRegex(UPDATE.UpdateError, 'unlisted'):
            UPDATE.verify_package(self.root)

    def test_incomplete_checksum_list_is_rejected(self):
        (self.root / 'SHA256SUMS').write_text('')
        with self.assertRaisesRegex(UPDATE.UpdateError, 'incomplete'):
            UPDATE.verify_package(self.root)

    def test_parent_traversal_is_rejected(self):
        data = self.manifest
        data['files'][0]['path'] = '../outside'
        (self.root / 'manifest.json').write_text(json.dumps(data))
        with self.assertRaisesRegex(UPDATE.UpdateError, 'Invalid'):
            UPDATE.verify_package(self.root)

    def test_missing_frontend_entry_is_rejected(self):
        (self.root / 'server/admin/index.html').unlink()
        with self.assertRaises(UPDATE.UpdateError):
            UPDATE.verify_package(self.root)

    def test_build_failure_does_not_stop_any_container(self):
        updater = FakeUpdater(self.root, self.base)
        updater.fail_at = 'build'
        self.run_update(updater, fail=True)
        self.assertTrue(updater.containers[updater.java]['running'])
        self.assertFalse(any(x.startswith('stop:') for x in updater.trace))

    def test_backup_failure_restarts_previous_java(self):
        updater = FakeUpdater(self.root, self.base)
        updater.fail_at = 'backup'
        self.run_update(updater, fail=True)
        self.assertTrue(updater.containers[updater.java]['running'])
        self.assertEqual(updater.containers[updater.java]['image'], 'yuhetang-java-api:old')
        self.assertNotIn('launch', updater.trace)

    def test_launch_failure_without_container_recovers_previous_java(self):
        updater = FakeUpdater(self.root, self.base)
        updater.fail_at = 'launch-before-create'
        self.run_update(updater, fail=True)
        self.assertTrue(updater.containers[updater.java]['running'])
        self.assertEqual(updater.containers[updater.java]['id'], 'old-id')

    def test_failed_health_with_unchanged_schema_recovers_previous_java(self):
        updater = FakeUpdater(self.root, self.base)
        updater.fail_at = 'health'
        self.run_update(updater, fail=True)
        self.assertTrue(updater.containers[updater.java]['running'])
        self.assertEqual(updater.containers[updater.java]['id'], 'old-id')
        # First stop is the original container; the attempted release must stop
        # before the second schema read used to decide compatibility.
        stops = [i for i, item in enumerate(updater.trace) if item.startswith('stop:')]
        schemas = [i for i, item in enumerate(updater.trace) if item == 'schema']
        self.assertLess(stops[1], schemas[1])

    def test_schema_change_keeps_both_java_versions_stopped_for_inspection(self):
        updater = FakeUpdater(self.root, self.base)
        updater.fail_at, updater.change_schema = 'health', True
        self.run_update(updater, fail=True)
        self.assertFalse(any(row['running'] for row in updater.containers.values()))
        self.assertNotIn('start:' + updater.java, updater.trace)
        self.assertTrue((updater.backup / 'database.sql.gz').is_file())

    def test_failed_frontend_verification_restores_old_entry_and_retains_assets(self):
        updater = FakeUpdater(self.root, self.base)
        updater.fail_at = 'https'
        self.run_update(updater, fail=True)
        self.assertEqual((updater.site / 'index.html').read_bytes(), b'<html>old</html>\n')
        self.assertTrue((updater.site / 'assets/old.js').is_file())
        self.assertTrue((updater.site / 'assets/new.js').is_file())
        self.assertTrue(updater.containers[updater.java]['running'])

    def test_success_backs_up_and_publishes_entry_last_without_data_import(self):
        updater = FakeUpdater(self.root, self.base)
        copies = []
        original = UPDATE.atomic_copy
        def record(source, target, mode=0o644):
            copies.append(Path(target))
            return original(source, target, mode)
        with patch.object(UPDATE, 'atomic_copy', side_effect=record):
            self.run_update(updater)
        self.assertEqual(copies[-1], updater.site / 'index.html')
        self.assertEqual(updater.containers[updater.java]['image'], updater.image)
        self.assertFalse(updater.containers[updater.previous]['running'])
        self.assertTrue((updater.site / 'assets/old.js').is_file())
        self.assertEqual(updater.environment.read_text(), 'EXISTING=retained\n')
        self.assertEqual((updater.app_files / 'customer.jpg').read_bytes(), b'existing customer upload')
        self.assertTrue((updater.backup / 'admin.tar.gz').is_file())
        self.assertTrue((updater.backup / 'uploads.tar.gz').is_file())
        self.assertTrue((updater.backup / 'config-private.tar.gz').is_file())
        self.assertEqual(updater.trace.count('launch'), 1)
        self.assertTrue(updater.complete)

    def test_second_run_of_active_release_does_not_restart(self):
        updater = FakeUpdater(self.root, self.base)
        self.run_update(updater)
        before = list(updater.trace)
        self.run_update(updater)
        self.assertEqual(updater.trace.count('launch'), before.count('launch'))

    def test_dump_uses_only_dedicated_database_and_validates_gzip(self):
        updater = FakeUpdater(self.root, self.base)
        updater.backup = self.base / 'dump'
        updater.backup.mkdir()
        process = unittest.mock.Mock()
        process.stdout = io.BytesIO(b'-- named business database only\n' * 10)
        process.wait.return_value = 0
        with patch.object(UPDATE.subprocess, 'Popen', return_value=process) as popen:
            UPDATE.Updater.dump_database(updater, updater.backup / 'db.sql.gz')
        args = popen.call_args.args[0]
        self.assertEqual(args[:3], ['docker', 'exec', 'yuwatang-mysql-isolated'])
        self.assertEqual(args[-2:], ['--databases', 'yuwatang_reservation'])
        self.assertNotIn('--all-databases', args)
        self.assertGreater(len(gzip.decompress((updater.backup / 'db.sql.gz').read_bytes())), 100)

    def test_dump_failure_is_not_accepted_as_backup(self):
        updater = FakeUpdater(self.root, self.base)
        updater.backup = self.base / 'bad-dump'
        updater.backup.mkdir()
        process = unittest.mock.Mock()
        process.stdout = io.BytesIO(b'error')
        process.wait.return_value = 2
        with patch.object(UPDATE.subprocess, 'Popen', return_value=process):
            with self.assertRaisesRegex(UPDATE.UpdateError, 'backup failed'):
                UPDATE.Updater.dump_database(updater, updater.backup / 'db.sql.gz')

    def test_missing_static_directories_ignore_restrictive_umask(self):
        root = self.base / 'static'
        root.mkdir()
        with patch.object(UPDATE.os, 'chmod', wraps=os.chmod) as chmod:
            previous = os.umask(0o077)
            try:
                UPDATE.public_directories(root / 'assets/nested', root)
            finally:
                os.umask(previous)
        self.assertIn(unittest.mock.call(root / 'assets', 0o755), chmod.call_args_list)
        self.assertIn(unittest.mock.call(root / 'assets/nested', 0o755), chmod.call_args_list)


if __name__ == '__main__':
    unittest.main(verbosity=2)
