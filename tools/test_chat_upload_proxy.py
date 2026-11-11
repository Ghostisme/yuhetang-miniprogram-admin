"""Exercise configuration edits and real file rollback without accessing Docker."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

SPEC=importlib.util.spec_from_file_location('chat_proxy',Path(__file__).resolve().parents[1]/'deploy/unified/chat-upload-proxy.py')
PROXY=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROXY)
BASE='server {\n    server_name mp-admin.hetuonian.cn;\n    client_max_body_size 6m;\n    location /api/ { proxy_pass http://127.0.0.1:8790; }\n}\n'


class ProxyTests(unittest.TestCase):
    def test_raises_existing_limit_and_is_idempotent(self):
        updated=PROXY.plan(BASE)
        self.assertEqual(BASE.replace('6m','12m'),updated)
        self.assertEqual(updated,PROXY.plan(updated))

    def test_adds_missing_limit(self):
        self.assertIn('client_max_body_size 12m;',PROXY.plan(BASE.replace('    client_max_body_size 6m;\n','')))

    def test_handles_inline_server_and_location_limits(self):
        content=BASE.replace('\n',' ').replace('location /api/ {','location /api/ { client_max_body_size 2m;')
        self.assertEqual(2,PROXY.plan(content).count('client_max_body_size 12m;'))

    def test_preserves_comments_large_limits_and_unlimited(self):
        for size in ('0','20m','1g'):
            content=BASE.replace('6m',size)+'# client_max_body_size 6m;\n'
            self.assertEqual(content,PROXY.plan(content))

    def test_refuses_unrelated_domains_or_upstreams(self):
        for content in (BASE.replace('mp-admin.hetuonian.cn','other.example'),BASE.replace('8790','8080'),BASE.replace('mp-admin.hetuonian.cn;','mp-admin.hetuonian.cn other.example;')):
            with self.assertRaises(ValueError):PROXY.plan(content)

    def test_check_is_read_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'mp-admin.conf';path.write_text(BASE,encoding='utf-8')
            PROXY.apply(path,'fixture',check=True,runner=lambda *args:'',backup_root=Path(directory)/'backups')
            self.assertEqual(BASE,path.read_text(encoding='utf-8'));self.assertFalse((Path(directory)/'backups').exists())

    def test_failed_validation_restores_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'mp-admin.conf';path.write_text(BASE,encoding='utf-8');calls=[]
            def runner(*args):
                calls.append(args)
                if len(calls)==2:raise RuntimeError('fixture nginx test rejected')
            with self.assertRaisesRegex(RuntimeError,'fixture nginx'):
                PROXY.apply(path,'fixture',runner=runner,backup_root=Path(directory)/'backups')
            self.assertEqual(BASE,path.read_text(encoding='utf-8'))
            self.assertEqual(4,len(calls));self.assertTrue(list((Path(directory)/'backups').glob('*/mp-admin.conf')))


if __name__=='__main__':unittest.main()
