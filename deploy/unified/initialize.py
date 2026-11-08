#!/usr/bin/env python3
"""Supplement missing stores, independent menus and labelled samples from a full release."""
import argparse
import copy
import datetime as dt
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import urllib.parse
import uuid


SCRIPTS = ('initialize-official-stores.py', 'initialize-client-services.py', 'initialize-local-content.py')
DATASETS = ('initial-data/official-stores/stores.json',
            'initial-data/client-services-20261108/services.json',
            'initial-data/local-content-20261108/content.json')


def verified_data_root(package_root):
    root = Path(package_root).absolute()
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('schemaVersion') != 1 or not re.fullmatch(r'\d{8}-\d{6}', manifest.get('releaseId', '')):
        raise ValueError('Expected a Yuhetang full update package')
    wanted = {'tools/' + name for name in SCRIPTS} | set(DATASETS)
    found = set()
    for entry in manifest['files']:
        name = entry['path']
        if not name.startswith('optional-data/'):
            continue
        pure = PurePosixPath(name)
        if pure.is_absolute() or '..' in pure.parts or '\\' in name or ':' in name or str(pure) != name:
            raise ValueError('Invalid initialization path')
        path = root.joinpath(*pure.parts)
        if any(part.is_symlink() for part in (path, *path.parents)) or not path.is_file():
            raise ValueError('Expected regular initialization files: ' + name)
        with path.open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if path.stat().st_size != entry['bytes'] or actual != entry['sha256']:
            raise ValueError('Initialization file checksum failed: ' + name)
        relative = name[len('optional-data/'):]
        if relative in found:
            raise ValueError('Duplicate initialization file: ' + relative)
        found.add(relative)
    if not wanted <= found:
        raise ValueError('Full package is missing reviewed initialization tools or datasets')
    return root / 'optional-data'


def modules(data_root):
    result = []
    for name in SCRIPTS:
        spec = importlib.util.spec_from_file_location('supplement_' + name.replace('-', '_'), data_root / 'tools' / name)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result.append(module)
    return result


class AdditiveApi:
    """Permit catalog edits only for items this run created, including concurrent-write races."""
    def __init__(self, api, service_module):
        self.api, self.service_module = api, service_module
        self.created_services = {}
        self.new_stores = set()

    def __getattr__(self, name):
        return getattr(self.api, name)

    def get(self, path, binary=False):
        value = self.api.get(path, binary=binary)
        if path == '/api/admin/stores':
            # Earlier import endpoints omit this field on creation; current
            # saveStore adds INHERIT. Make that server default explicit only
            # for stores created in this run so strict verification agrees.
            for store in value:
                if store['id'] in self.new_stores:
                    store.setdefault('catalogMode', 'INHERIT')
        return value

    def request(self, method, path, payload=None, content_type=None, **kwargs):
        match = re.fullmatch(r'/api/admin/stores/([^/]+)/services', path)
        if match:
            sid = urllib.parse.unquote(match.group(1))
            created = self.created_services.setdefault(sid, set())
            if method == 'PUT' and any(item.get('id') not in created for item in payload['items']):
                raise RuntimeError('An existing branch item would be overwritten; stopped: ' + sid)
            value = self.api.request(method, path, payload, content_type, **kwargs)
            if method == 'POST':
                created.add(value['id'])
            return value
        match = re.fullmatch(r'/api/admin/stores/([^/]+)', path)
        if method == 'PUT' and match:
            sid = urllib.parse.unquote(match.group(1))
            if sid not in self.new_stores:
                current = next(s for s in self.api.get('/api/admin/stores') if s['id'] == sid)
                expected = dict(self.service_module.profile(current), catalogMode='INDEPENDENT')
                if payload != expected:
                    raise RuntimeError('An existing store profile would be overwritten; stopped: ' + sid)
        if method == 'PUT' and path == '/api/admin/therapists' and payload.get('id'):
            raise RuntimeError('This supplement cannot overwrite existing therapist records')
        return self.api.request(method, path, payload, content_type, **kwargs)


def missing_menus(api, data, service_module):
    subset = copy.deepcopy(data)
    subset['stores'] = []
    preserved = 0
    for plan in service_module.resolve_stores(data['stores'], api.get('/api/admin/stores')):
        source = copy.deepcopy(plan['source'])
        current = api.get(service_module.store_path(plan['id']) + '/services')
        templates = {item['id']: item for item in data['services']}
        missing = []
        for item in source['items']:
            if service_module.match_item(templates[item['serviceId']], item, current):
                preserved += 1
            else:
                missing.append(item)
        source['items'] = missing
        if missing or plan['before'].get('catalogMode') != 'INDEPENDENT':
            subset['stores'].append(source)
    return subset, preserved


def initialize(api, data_root, apply=False, backup_root=None):
    official, menus, content = modules(data_root)
    # Validate every image before the first business write.
    paths = [data_root / name for name in DATASETS]
    stores_data, menus_data, content_data = [module.load_dataset(path) for module, path in zip((official, menus, content), paths)]
    me = api.get('/api/admin/me')
    required = {'stores:write', 'services:read', 'services:write', 'assets:read', 'assets:write', 'imports:write',
                'rules:write', 'content:read', 'content:write', 'content:publish', 'therapists:read', 'therapists:write'}
    if not me.get('hq') or not required <= set(me.get('permissions', [])):
        raise ValueError('Use the headquarters administrator with initialization permissions')
    if api.get('/api/runtime').get('independentStoreServices') is not True:
        raise ValueError('Update Java to the independent store catalog version first')
    safe_api = AdditiveApi(api, menus)
    existing_stores = api.get('/api/admin/stores')
    plans = official.plan_stores(stores_data['stores'], existing_stores)
    missing = [plan for plan in plans if plan['before'] is None]
    print('Stores: %d reviewed, %d existing profiles preserved, %d missing.' % (len(plans), len(plans) - len(missing), len(missing)), flush=True)
    print('Approved source: 135 independent branch items; 27 labelled sample therapists; 33 assets; 2 products; 2 albums.', flush=True)
    if not apply:
        if missing:
            print('Preview: create missing stores first, then supplement their menus and labelled content. No writes performed.')
        else:
            subset, preserved = missing_menus(safe_api, menus_data, menus)
            print('Branch items: %d existing preserved, %d missing.' % (preserved, sum(len(s['items']) for s in subset['stores'])))
            teachers = api.get('/api/admin/therapists')
            resolved = {plan['source']['id']: plan['id'] for plan in menus.resolve_stores(menus_data['stores'], existing_stores)}
            missing_teachers = sum(content.match_therapist(t, resolved[t['storeId']], teachers) is None for t in content_data['therapists'])
            print('Sample therapists: %d missing. Preview only; no data was written.' % missing_teachers)
        return dict(status='preview', missingStores=len(missing))
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    backup = Path(backup_root or '/var/backups/yuhetang-initialize').absolute() / stamp
    if any(part.is_symlink() for part in (backup, *backup.parents)):
        raise ValueError('Initialization backup paths must not contain symbolic links')
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup, 0o700)
    print('INITIALIZATION_BACKUP=' + str(backup), flush=True)
    report = dict(status='running', api=api.base, preservedStores=len(plans) - len(missing))
    try:
        print('[1/3] Create missing stores; preserve every existing store profile.', flush=True)
        if missing:
            incoming = copy.deepcopy(stores_data)
            incoming['stores'] = [plan['source'] for plan in missing]
            safe_api.new_stores = {plan['id'] for plan in missing}
            report['stores'] = official.initialize(safe_api, incoming, paths[0].parent, True, backup / 'stores')
        else:
            report['stores'] = dict(status='verified', created=[])
        print('[2/3] Create missing independent branch items; preserve existing prices, descriptions and enabled states.', flush=True)
        subset, preserved = missing_menus(safe_api, menus_data, menus)
        report['preservedBranchItems'] = preserved
        if subset['stores']:
            report['menus'] = menus.initialize(safe_api, subset, paths[1].parent, True, backup / 'menus')
        else:
            report['menus'] = dict(status='verified', created=[], uploaded=[])
        print('[3/3] Supplement brand content, images and explicitly labelled sample therapists.', flush=True)
        report['content'] = content.initialize(safe_api, content_data, paths[2].parent, True, backup / 'content')
        remaining, _ = missing_menus(safe_api, menus_data, menus)
        if remaining['stores']:
            raise RuntimeError('Some independent branch catalogs are still incomplete; inspect initialization reports')
        report['status'] = 'verified'
    except BaseException as error:
        report.update(status='incomplete', error=type(error).__name__)
        raise
    finally:
        official.write_json(backup / 'summary.json', report)
    print('SUCCESS: MISSING INITIAL DATA VERIFIED', flush=True)
    print('New stores=%d; new branch items=%d; existing branch items preserved=%d; new sample therapists=%d; existing sample profiles preserved=%d.' %
          (len(report['stores']['created']), len(report['menus']['created']), report['preservedBranchItems'],
           len(report['content']['createdTherapists']), len(report['content']['existingTherapists'])), flush=True)
    print('Brand content status=' + report['content']['contentStatus'] + '; report=' + str(backup / 'summary.json'), flush=True)
    return report


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package-root', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--base-url', default='http://127.0.0.1:8790')
    parser.add_argument('--username', default='admin')
    parser.add_argument('--backup-dir', type=Path)
    parser.add_argument('--apply', action='store_true', help='Supplement missing records; default is preview only')
    parser.add_argument('--validate-only', action='store_true')
    args = parser.parse_args()
    data_root = verified_data_root(args.package_root)
    support = modules(data_root)
    for module, name in zip(support, DATASETS):
        module.load_dataset(data_root / name)
    if args.validate_only:
        print('INIT DATA VERIFIED: all bundled datasets, tools and image checksums; no API connection.')
        return
    api = support[0].Api(args.base_url)
    password = getpass.getpass('Headquarters administrator password: ')
    api.token = api.request('POST', '/api/admin/login', {'username': args.username, 'password': password})['token']
    del password
    initialize(api, data_root, args.apply, args.backup_dir)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, RuntimeError, OSError, KeyError, StopIteration) as error:
        sys.exit('INITIALIZATION STOPPED: ' + str(error))
