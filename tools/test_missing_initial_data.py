import copy
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('missing_data', ROOT / 'deploy/unified/initialize.py')
INIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INIT)


class SupplementTests(unittest.TestCase):
    def setUp(self):
        self.menus = SimpleNamespace(profile=lambda store: {k: v for k, v in store.items() if k != 'services'})

    def test_mutated_reviewed_file_is_rejected_before_importing_any_module(self):
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            (root / 'optional-data').mkdir()
            (root / 'optional-data/test.json').write_bytes(b'damaged')
            (root / 'manifest.json').write_text(json.dumps(dict(schemaVersion=1, releaseId='20261108-144900', files=[
                dict(path='optional-data/test.json', bytes=7, sha256='0' * 64)])))
            with self.assertRaisesRegex(ValueError, 'checksum failed'):
                INIT.verified_data_root(root)

    def test_existing_branch_item_cannot_be_overwritten_even_if_it_appears_concurrently(self):
        api = Mock()
        guarded = INIT.AdditiveApi(api, self.menus)
        with self.assertRaisesRegex(RuntimeError, 'existing branch item'):
            guarded.request('PUT', '/api/admin/stores/yuyao/services', {'items': [{'id': 'operator-created'}]})
        api.request.assert_not_called()

    def test_new_item_can_be_finalized_only_in_the_store_where_it_was_created(self):
        api = Mock()
        api.request.return_value = {'id': 'created-this-run'}
        guarded = INIT.AdditiveApi(api, self.menus)
        guarded.request('POST', '/api/admin/stores/yuyao/services', {'name': 'new'})
        guarded.request('PUT', '/api/admin/stores/yuyao/services', {'items': [{'id': 'created-this-run'}]})
        with self.assertRaisesRegex(RuntimeError, 'existing branch item'):
            guarded.request('PUT', '/api/admin/stores/shanghai/services', {'items': [{'id': 'created-this-run'}]})
        self.assertEqual(api.request.call_count, 2)

    def test_existing_store_allows_only_the_independent_catalog_transition(self):
        api = Mock()
        store = dict(id='yuyao', name='余姚路店', phone='021-12345678', description='人工修改', catalogMode='INHERIT')
        api.get.return_value = [copy.deepcopy(store)]
        guarded = INIT.AdditiveApi(api, self.menus)
        guarded.request('PUT', '/api/admin/stores/yuyao', dict(store, catalogMode='INDEPENDENT'))
        with self.assertRaisesRegex(RuntimeError, 'existing store profile'):
            guarded.request('PUT', '/api/admin/stores/yuyao', dict(store, description='覆盖内容', catalogMode='INDEPENDENT'))
        self.assertEqual(api.request.call_count, 1)

    def test_new_store_default_does_not_change_an_existing_profile(self):
        api = Mock()
        api.get.return_value = [dict(id='new-store'), dict(id='existing-store')]
        guarded = INIT.AdditiveApi(api, self.menus)
        guarded.new_stores = {'new-store'}
        result = guarded.get('/api/admin/stores')
        self.assertEqual(result[0]['catalogMode'], 'INHERIT')
        self.assertNotIn('catalogMode', result[1])

    def test_existing_therapist_cannot_be_reset_to_a_sample(self):
        api = Mock()
        guarded = INIT.AdditiveApi(api, self.menus)
        with self.assertRaisesRegex(RuntimeError, 'existing therapist'):
            guarded.request('PUT', '/api/admin/therapists', {'id': 'real-person', 'sample': True})
        api.request.assert_not_called()

    def test_only_missing_items_are_planned_and_custom_prices_remain_untouched(self):
        source = dict(id='yuyao', name='余姚路店', items=[dict(serviceId='massage'), dict(serviceId='moxa')])
        data = dict(stores=[source], services=[dict(id='massage'), dict(id='moxa')])
        existing = dict(id='operator-item', source='STORE', description='人工价格说明', enabled=False)
        menus = Mock()
        menus.resolve_stores.return_value = [dict(source=source, id='yuyao', before=dict(catalogMode='INDEPENDENT'))]
        menus.store_path.return_value = '/api/admin/stores/yuyao'
        menus.match_item.side_effect = lambda template, item, current: existing if item['serviceId'] == 'massage' else None
        api = Mock()
        def get(path):
            if path == '/api/admin/stores':
                return [dict(id=source['id'], name=source['name'], catalogMode='INDEPENDENT')]
            return [copy.deepcopy(existing)]
        api.get.side_effect = get
        filtered, preserved = INIT.missing_menus(api, data, menus)
        self.assertEqual(preserved, 1)
        self.assertEqual(len(filtered['stores'][0]['items']), len(source['items']) - 1)
        self.assertNotIn(source['items'][0]['serviceId'], [i['serviceId'] for i in filtered['stores'][0]['items']])
        self.assertEqual(existing['description'], '人工价格说明')
        api.request.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
