"""Synthetic rooms only; optionally exercise pinned official Hermes room storage.

No model, account, device, network, subprocess or production DB is used. The
native discussion planner is a counting stub, so this does not claim real
employee execution. Official room/event/SQLite code, when supplied, is real.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

BRIDGE, SOURCE = Path(sys.argv[1]).resolve(), sys.argv[2]
sys.argv = sys.argv[:1]
PRIVATE_ROOTS = []


def offline_guard(event, args):
    if event.startswith('socket.') or event in ('subprocess.Popen', 'os.system', 'os.posix_spawn', 'os.exec'):
        raise RuntimeError('GROUP_PAGE_FIXTURE_EXTERNAL_IO_DENIED')
    if event == 'open' and args and isinstance(args[0], (str, bytes)):
        target = Path(os.fsdecode(args[0])).resolve()
        if target.name in ('.env', 'auth.json', 'credentials.json') and not any(target.is_relative_to(root) for root in PRIVATE_ROOTS):
            raise RuntimeError('GROUP_PAGE_FIXTURE_EXTERNAL_AUTH_DENIED')


sys.addaudithook(offline_guard)
spec = importlib.util.spec_from_file_location('ziwei_group_page_fixture', BRIDGE)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def room(room_id='room-one'):
    return {'room_id': room_id, 'name': 'Synthetic room', 'members': [{'profile': 'fixture-one'}],
            'authority_gateway_id': 'fixture-authority', 'authority_epoch': 1}


def page(after=0, count=2, latest=4, room_id='room-one'):
    return {'events': [{'room_id': room_id, 'seq': seq, 'event_id': 'event-' + str(seq), 'kind': 'message.user',
                       'payload': {'text': 'Synthetic ' + str(seq)}} for seq in range(after + 1, after + count + 1)],
            'cursor': after + count, 'latest_seq': latest, 'has_more': after + count < latest,
            'authority': {'gateway_id': 'fixture-authority', 'epoch': 1}}


class MockPageTests(unittest.TestCase):
    def setUp(self):
        self.private = tempfile.TemporaryDirectory(prefix='ziwei-groups-page-')
        PRIVATE_ROOTS.append(Path(self.private.name).resolve())
        self.addCleanup(self.private.cleanup)
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {'HERMES_HOME': self.private.name}).start()
        self.calls, self.plans = [], []
        self.next_page = page()
        self.rooms = types.ModuleType('gateway.hosted_rooms')
        self.rooms.room_state = lambda db, **kw: room(kw['room_id'])
        self.rooms.read_events = self.read_events
        self.discussion = types.ModuleType('gateway.hosted_room_discussion')
        self.discussion.plan_next_task = self.plan
        gateway = types.ModuleType('gateway')
        gateway.hosted_rooms, gateway.hosted_room_discussion = self.rooms, self.discussion
        patch.dict(sys.modules, {'gateway': gateway, 'gateway.hosted_rooms': self.rooms,
                                'gateway.hosted_room_discussion': self.discussion}).start()

    def read_events(self, db, **kw):
        self.calls.append(kw)
        return self.next_page

    def plan(self, current, events, **kw):
        self.plans.append(events)
        return types.SimpleNamespace(task=None)

    def read(self, **args):
        return bridge.groups('read', {'groupId': 'room-one', 'limit': 2, 'afterSeq': 0, **args})

    def test_first_second_and_empty_pages_preserve_original_page_and_never_plan(self):
        one = self.read()
        self.assertIs(one['events'], self.next_page)
        self.assertEqual(one['pagination'], {'limit': 2, 'afterSeq': 0, 'nextAfterSeq': 2, 'hasMore': True})
        self.assertTrue(one['pagedRead'])
        self.assertIsNone(one['decision'])
        self.assertIsNone(one['plan'])
        self.next_page = page(after=2, count=2, latest=4)
        self.assertFalse(self.read(afterSeq=2)['pagination']['hasMore'])
        self.next_page = page(after=4, count=0, latest=4)
        self.assertEqual(self.read(afterSeq=4)['pagination']['nextAfterSeq'], 4)
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[0], {'room_id': 'room-one', 'since_seq': 0, 'limit': 2})
        self.assertEqual(self.plans, [])

    def test_limit_without_cursor_defaults_to_zero(self):
        result = bridge.groups('read', {'groupId': 'room-one', 'limit': 2})
        self.assertEqual(result['pagination']['afterSeq'], 0)

    def test_invalid_python_inputs_do_not_read_events(self):
        for args in [{'limit': True}, {'limit': 0}, {'limit': 101}, {'limit': '2'}, {'afterSeq': True},
                     {'afterSeq': -1}, {'afterSeq': 9007199254740992}, {'afterSeq': 1.5}]:
            with self.subTest(args=args), self.assertRaisesRegex(bridge.NativeOperationError, 'GROUP_PAGE_INPUT_INVALID'):
                self.read(**args)
        with self.assertRaisesRegex(bridge.NativeOperationError, 'GROUP_PAGE_INPUT_INVALID'):
            bridge.groups('read', {'groupId': 'room-one', 'afterSeq': 0})
        with self.assertRaisesRegex(bridge.NativeOperationError, 'GROUP_PAGE_INPUT_INVALID'):
            bridge.groups('step', {'groupId': 'room-one', 'limit': 2})
        self.assertEqual(self.calls, [])

    def test_corrupt_cursor_sequences_room_authority_and_shape_fail_without_full_log_fallback(self):
        bad = []
        for key, value in [('cursor', 0), ('cursor', True), ('cursor', 9007199254740992), ('latest_seq', 1),
                           ('has_more', 'true'), ('has_more', False), ('events', {}), ('events', page(count=3)['events'])]:
            changed = page(); changed[key] = value; bad.append(changed)
        changed = page(); changed['events'][1]['seq'] = 1; bad.append(changed)
        changed = page(); changed['events'][0]['seq'] = 2; bad.append(changed)
        changed = page(); changed['events'][0]['seq'] = True; bad.append(changed)
        changed = page(); changed['events'][0]['room_id'] = 'other-room'; bad.append(changed)
        changed = page(); changed['authority']['epoch'] = 2; bad.append(changed)
        bad.extend([page(count=0), None, {'events': []}])
        for candidate in bad:
            self.next_page = candidate
            prior = len(self.calls)
            with self.subTest(page=candidate), self.assertRaisesRegex(bridge.NativeOperationError, 'GROUP_PAGE_INVALID'):
                self.read()
            self.assertEqual(len(self.calls), prior + 1)
        self.assertEqual(self.plans, [])

    def test_room_state_with_another_room_id_is_rejected_before_event_read(self):
        self.rooms.room_state = lambda db, **kw: room('wrong-room')
        with self.assertRaisesRegex(bridge.NativeOperationError, 'GROUP_PAGE_INVALID'):
            self.read()
        self.assertEqual(self.calls, [])

    def test_native_error_does_not_retry_or_fall_back(self):
        def broken(db, **kw):
            self.calls.append(kw)
            raise RuntimeError('synthetic storage failure')
        self.rooms.read_events = broken
        with self.assertRaisesRegex(RuntimeError, 'synthetic storage failure'):
            self.read()
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.plans, [])

    def test_full_default_and_step_still_load_complete_log_before_planning(self):
        def native_pages(db, **kw):
            self.calls.append(kw)
            return page(after=kw['since_seq'], count=2, latest=4)
        self.rooms.read_events = native_pages
        for operation in ['read', 'step']:
            prior = len(self.calls)
            result = bridge.groups(operation, {'groupId': 'room-one'})
            self.assertEqual([event['seq'] for event in result['events']['events']], [1, 2, 3, 4])
            self.assertEqual(len(self.calls) - prior, 2)
            self.assertNotIn('pagedRead', result)
            self.assertNotIn('pagination', result)
            self.assertEqual(len(self.plans[-1]), 4)


@unittest.skipUnless(SOURCE and (Path(SOURCE) / 'gateway/hosted_rooms.py').is_file(), 'Official Hermes source not supplied; mock tests still run')
class OfficialRoomStorageTests(unittest.TestCase):
    def setUp(self):
        self.private = tempfile.TemporaryDirectory(prefix='ziwei-official-room-page-')
        PRIVATE_ROOTS.append(Path(self.private.name).resolve())
        self.addCleanup(self.private.cleanup)
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {'HERMES_HOME': self.private.name, 'HERMES_DISABLE_LAZY_INSTALLS': '1'}).start()
        patch.object(sys, 'path', [str(Path(SOURCE).resolve()), *sys.path]).start()
        from gateway import hosted_rooms
        self.rooms = hosted_rooms
        self.plans = []
        discussion = types.ModuleType('gateway.hosted_room_discussion')
        discussion.plan_next_task = lambda current, events, **kw: self.plan(events)
        patch.dict(sys.modules, {'gateway.hosted_room_discussion': discussion}).start()
        self.db = Path(self.private.name) / 'hosted_rooms.db'
        members = [{'member_id': 'fixture-one', 'profile': 'fixture-one', 'handle': 'fixture-one',
                    'display_name': 'Fixture', 'target': {'kind': 'local', 'profile': 'fixture-one'}}]
        for rid, count in [('room-one', 125), ('room-other', 3)]:
            self.rooms.create_room(self.db, room_id=rid, name=rid, members=members, authority_gateway_id='fixture-authority')
            for index in range(count):
                self.rooms.append_event(self.db, room_id=rid, event_id=rid + '-' + str(index), kind='message.user',
                                        actor={'kind': 'user', 'id': 'synthetic-user'}, payload={'text': 'Synthetic ' + str(index)},
                                        authority_gateway_id='fixture-authority', authority_epoch=1)

    def plan(self, events):
        self.plans.append(events)
        return types.SimpleNamespace(task=None)

    def snapshot(self):
        with sqlite3.connect(self.db) as connection:
            return list(connection.iterdump())

    def test_real_native_storage_two_pages_empty_and_cross_room_are_read_only(self):
        before = self.snapshot()
        original = self.rooms.read_events
        with patch.object(self.rooms, 'read_events', wraps=original) as read:
            one = bridge.groups('read', {'groupId': 'room-one', 'limit': 30, 'afterSeq': 0})
            two = bridge.groups('read', {'groupId': 'room-one', 'limit': 30, 'afterSeq': one['pagination']['nextAfterSeq']})
            empty = bridge.groups('read', {'groupId': 'room-one', 'limit': 30, 'afterSeq': 125})
            other = bridge.groups('read', {'groupId': 'room-other', 'limit': 30, 'afterSeq': 0})
            self.assertEqual(read.call_count, 4)
        self.assertEqual([event['seq'] for event in one['events']['events']], list(range(1, 31)))
        self.assertEqual([event['seq'] for event in two['events']['events']], list(range(31, 61)))
        self.assertEqual(empty['events']['events'], [])
        self.assertFalse(empty['pagination']['hasMore'])
        self.assertTrue(all(event['room_id'] == 'room-other' for event in other['events']['events']))
        self.assertEqual(self.plans, [])
        self.assertEqual(self.snapshot(), before)

    def test_real_native_storage_default_and_step_still_plan_from_all_125_events(self):
        before = self.snapshot()
        original = self.rooms.read_events
        for operation in ['read', 'step']:
            with patch.object(self.rooms, 'read_events', wraps=original) as read:
                result = bridge.groups(operation, {'groupId': 'room-one'})
                self.assertEqual(read.call_count, 2)
            self.assertEqual(len(result['events']['events']), 125)
            self.assertEqual(len(self.plans[-1]), 125)
            self.assertNotIn('pagedRead', result)
        self.assertEqual(self.snapshot(), before)


if __name__ == '__main__':
    unittest.main(verbosity=2)
