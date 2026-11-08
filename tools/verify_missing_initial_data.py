"""Validate supplementation against the release JAR and a disposable H2 database."""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('missing_data', ROOT / 'deploy/unified/initialize.py')
INIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INIT)


def main():
    package = ROOT / 'releases/yuhetang-full-update-20261108-144900'
    data_root = INIT.verified_data_root(package)
    official, menus, content = INIT.modules(data_root)
    store_data = official.load_dataset(data_root / INIT.DATASETS[0])
    menu_data = menus.load_dataset(data_root / INIT.DATASETS[1])
    content_data = content.load_dataset(data_root / INIT.DATASETS[2])
    work = ROOT / 'backups/missing-initial-data' / secrets.token_hex(6)
    work.mkdir(parents=True)
    database_work = Path(tempfile.mkdtemp(prefix='yuhetang-initial-data-'))
    jar = package / 'server/java/reservation.jar'
    java = shutil.which('java')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    with zipfile.ZipFile(jar) as archive:
        h2 = next(n for n in archive.namelist() if n.startswith('BOOT-INF/lib/h2-') and n.endswith('.jar'))
        (database_work / 'h2.jar').write_bytes(archive.read(h2))
    db = 'jdbc:h2:file:' + (database_work / 'verification').as_posix() + ';MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_ON_EXIT=FALSE'
    password = secrets.token_urlsafe(24)
    env = {k: v for k, v in os.environ.items() if not k.startswith(('DB_', 'WECHAT_', 'SERVICE_', 'SMS_', 'PMS_',
                                                                 'CUSTOMER_', 'APP_', 'ADMIN_', 'JWT_', 'SPRING_'))}
    env.update(APP_MODE='local', SPRING_PROFILES_ACTIVE='default', PORT=str(port), BIND_ADDRESS='127.0.0.1',
               APP_DATA_DIR=str(work / 'data'), DB_URL=db, DB_USERNAME='sa', DB_PASSWORD='', ADMIN_PASSWORD=password,
               JWT_SECRET=secrets.token_urlsafe(45), DB_POOL_SIZE='4', DB_POOL_IDLE='1')
    process, output = None, None

    def stop():
        nonlocal process, output
        if process and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        if output:
            output.close()
        process, output = None, None

    def start(label):
        nonlocal process, output
        output = (work / (label + '.log')).open('wb')
        process = subprocess.Popen([java, '-Xmx384m', '-jar', str(jar), '--management.server.port=0'], env=env,
                                   cwd=work, stdout=output, stderr=subprocess.STDOUT,
                                   creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        api = official.Api('http://127.0.0.1:' + str(port))
        deadline = time.monotonic() + 100
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('Isolated Java exited; inspect ' + str(work))
            try:
                api.token = api.request('POST', '/api/admin/login', {'username': 'admin', 'password': password})['token']
                api.get('/api/admin/stores')
                return api
            except (OSError, RuntimeError):
                time.sleep(0.5)
        raise RuntimeError('Isolated Java timed out; inspect ' + str(work))

    try:
        start('bootstrap')
        stop()
        empty = dict(brandName='裕和堂', brandEnglish='YU HE TANG', tagline='', brandStory='', theme='sage',
                     hero={k: '' for k in content_data['content']['hero']}, contact={k: '' for k in content_data['content']['contact']},
                     sections=[], services=[], products=[], galleryGroups=[], assetLibrary=[], customerServiceEnabled=True, version=1)
        literal = json.dumps(empty, ensure_ascii=False).replace("'", "''")
        sql = "DELETE FROM therapist; DELETE FROM store_service; DELETE FROM store WHERE id NOT IN ('shanghai','yuyao'); "
        sql += "UPDATE site_config SET revision=1,published_json='%s',draft_json='%s' WHERE id='brand';" % (literal, literal)
        (database_work / 'reset.sql').write_text(sql, encoding='utf-8')
        subprocess.run([java, '-cp', str(database_work / 'h2.jar'), 'org.h2.tools.RunScript', '-url', db, '-user', 'sa',
                        '-password', '', '-script', str(database_work / 'reset.sql')], check=True, capture_output=True, timeout=30)
        offline = subprocess.run([java, '-cp', str(database_work / 'h2.jar'), 'org.h2.tools.Shell', '-url', db, '-user', 'sa',
                                  '-password', '', '-sql', 'SELECT COUNT(*) AS stores FROM store; SELECT COUNT(*) AS therapists FROM therapist; SELECT COUNT(*) AS accounts FROM app_user;'],
                                 check=True, capture_output=True, timeout=30)
        (work / 'fixture-counts.txt').write_bytes(offline.stdout + offline.stderr)
        api = start('verification')
        fixture = dict(stores=len(api.get('/api/admin/stores')), therapists=len(api.get('/api/admin/therapists')),
                       database=db, process=process.pid, port=port)
        (work / 'fixture.json').write_text(json.dumps(fixture, indent=2), encoding='utf-8')
        assert fixture['stores'] == 2 and fixture['therapists'] == 0, str(work / 'fixture.json')
        for old in api.get('/api/admin/stores'):
            old.update(catalogMode='INHERIT', phone='021-50181919', description='人工已改门店介绍',
                       gallery=['/media/store-01.webp', '/media/store-02.webp'])
            api.request('PUT', '/api/admin/stores/' + old['id'], old)
        template = next(s for s in menu_data['services'] if s['id'] == 'yuht-pedicure')
        source_item = next(i for s in menu_data['stores'] if s['id'] == 'yuyao' for i in s['items'] if i['serviceId'] == template['id'])
        custom = menus.project(template, source_item)
        custom.update(description='人工已改价格与服务说明', enabled=False)
        existing_item = api.request('POST', '/api/admin/stores/yuyao/services', custom)
        before_stores = {s['id']: s for s in api.get('/api/admin/stores')}
        before_items = api.get('/api/admin/stores/yuyao/services')
        before_item = next(s for s in before_items if s['id'] == existing_item['id'])
        accounts = api.get('/api/admin/users')
        customers, appointments = api.get('/api/admin/customers'), api.get('/api/admin/appointments')
        with (work / 'initialization.txt').open('w', encoding='utf-8') as log, contextlib.redirect_stdout(log):
            preview = INIT.initialize(api, data_root)
            assert api.get('/api/admin/stores') == list(before_stores.values())
            first = INIT.initialize(api, data_root, True, work / 'reports')
            first_state = (api.get('/api/admin/stores'), api.get('/api/admin/therapists'), api.get('/api/admin/assets'), api.get('/api/admin/content'))
            second = INIT.initialize(api, data_root, True, work / 'reports')
            assert first_state == (api.get('/api/admin/stores'), api.get('/api/admin/therapists'), api.get('/api/admin/assets'), api.get('/api/admin/content'))
        assert preview['missingStores'] == 7
        assert len(first['stores']['created']) == 7 and len(first['menus']['created']) == 134
        assert first['preservedBranchItems'] == 1 and len(first['content']['createdTherapists']) == 27
        assert not second['stores']['created'] and not second['menus']['created'] and not second['content']['createdTherapists']
        for store in api.get('/api/admin/stores'):
            assert store['catalogMode'] == 'INDEPENDENT'
            if store['id'] in before_stores:
                assert menus.profile(store) == dict(menus.profile(before_stores[store['id']]), catalogMode='INDEPENDENT')
        assert next(s for s in api.get('/api/admin/stores/yuyao/services') if s['id'] == existing_item['id']) == before_item
        site = api.get('/api/site')
        assert len(site['stores']) == 9
        assert (len(site['services']), len(site['products']), len(site['galleryGroups'])) == (4, 2, 2)
        teachers = api.get('/api/admin/therapists')
        assert len(teachers) == 27 and all(t['sample'] and '示例' in t['name'] for t in teachers)
        assert api.get('/api/admin/users') == accounts
        assert api.get('/api/admin/customers') == customers and api.get('/api/admin/appointments') == appointments
        result = dict(status='verified', verification='release-Java-API/disposable-H2', javaJarSha256=hashlib.sha256(jar.read_bytes()).hexdigest(),
                      initializerSha256=hashlib.sha256((ROOT / 'deploy/unified/initialize.py').read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
                      createdStores=7, preservedStores=2, createdBranchItems=134, preservedBranchItems=1, sampleTherapists=27,
                      repeatedImportBusinessChanges=0, existingStoreEditsPreserved=True, existingPriceEditsPreserved=True,
                      accountsCustomersAppointmentsUnchanged=True, liveWechatApisUsed=False, cloudImportPerformed=False)
        (work / 'result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        (work.parent / 'result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(dict(result, evidence=str(work / 'result.json')), ensure_ascii=False))
    finally:
        stop()


if __name__ == '__main__':
    main()
