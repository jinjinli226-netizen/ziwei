"""Isolated kernel/service fixture checks. Never invokes a real service/helper."""
import hashlib, importlib.util, pathlib, tempfile, unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).parent
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
linux=module('linux_source','r01-linux-source-readonly.py')
windows=module('windows_source','r01-windows-source-readonly.py')
boot=module('boot_source','r01-windows-boot-coverage-readonly.py')

class NativeFixtures(unittest.TestCase):
    def test_actual_systemd_invocation_property_is_distinct_from_api_nonce(self):
        text='MainPID=7\nInvocationID=original-fixture-generation\nControlGroup=/fixture.service\nKillMode=control-group\nSendSIGKILL=yes\nDelegate=no\n'
        with patch.object(linux,'command',return_value=text),patch.object(linux,'proc',return_value={'nativeBirth':{'kind':'linux-proc-start-ticks','startTicks':'123'}}),patch.object(linux,'cgroup_snapshot',return_value={'visibilityComplete':True,'recursiveMembershipStable':True,'issues':[]}):
            value=linux.service('fixture.service')
        self.assertEqual(value['identityKind'],'systemd-invocation');self.assertIsNone(value['apiSelfReportedNonce'])
        self.assertEqual(value['invocationIdSha256'],hashlib.sha256(b'original-fixture-generation').hexdigest())
        self.assertEqual(value['originalProcess']['nativeBirth']['startTicks'],'123');self.assertTrue(value['containmentObserved'])
    def test_unavailable_invocation_or_unsafe_manager_never_becomes_complete(self):
        for text in ['MainPID=0\nKillMode=control-group\nSendSIGKILL=yes\nDelegate=no\n',
                     'MainPID=0\nInvocationID=x\nKillMode=process\nSendSIGKILL=yes\nDelegate=no\n',
                     'MainPID=0\nInvocationID=x\nKillMode=control-group\nSendSIGKILL=yes\nDelegate=yes\n']:
            with patch.object(linux,'command',return_value=text),patch.object(linux,'cgroup_snapshot',return_value={'visibilityComplete':True,'recursiveMembershipStable':True,'issues':[]}):
                self.assertFalse(linux.service('fixture.service')['containmentObserved'])
    def cgroup(self,directory):
        root=pathlib.Path(directory);(root/'cgroup.controllers').write_text('pids');scope=root/'fixture.service';scope.mkdir();(scope/'cgroup.procs').write_text('7\n');child=scope/'child';child.mkdir();(child/'cgroup.procs').write_text('8\n');return root,scope
    def test_recursive_cgroup_includes_child_and_proves_each_observed_membership(self):
        with tempfile.TemporaryDirectory() as directory:
            root,scope=self.cgroup(directory)
            with patch.object(linux,'proc',side_effect=lambda pid:{'pid':pid,'cgroup':'0::/fixture.service'+('/child' if pid==8 else '')+'\n'}):value=linux.cgroup_snapshot('/fixture.service',root)
            self.assertEqual([item['pid'] for item in value['members']],[7,8]);self.assertTrue(value['visibilityComplete']);self.assertTrue(value['recursiveMembershipStable']);self.assertEqual(value['issues'],[])
    def test_hidden_member_refuses_visibility(self):
        with tempfile.TemporaryDirectory() as directory:
            root,scope=self.cgroup(directory)
            with patch.object(linux,'proc',return_value={'visible':False,'reason':'native-read-incomplete'}):value=linux.cgroup_snapshot('/fixture.service',root)
            self.assertFalse(value['visibilityComplete']);self.assertIn('CGROUP_MEMBER_NOT_VISIBLE',value['issues'])
    def test_member_added_during_observation_refuses_stability(self):
        with tempfile.TemporaryDirectory() as directory:
            root,scope=self.cgroup(directory)
            def member(pid):
                (scope/'cgroup.procs').write_text('7\n9\n');return {'pid':pid,'cgroup':'0::/fixture.service\n'}
            with patch.object(linux,'proc',side_effect=member):value=linux.cgroup_snapshot('/fixture.service',root)
            self.assertFalse(value['recursiveMembershipStable']);self.assertIn('CGROUP_MEMBERSHIP_CHANGED',value['issues'])
    def test_member_relocated_outside_scope_refuses_binding(self):
        with tempfile.TemporaryDirectory() as directory:
            root,scope=self.cgroup(directory)
            with patch.object(linux,'proc',return_value={'pid':7,'cgroup':'0::/other.service\n'}):value=linux.cgroup_snapshot('/fixture.service',root)
            self.assertIn('CGROUP_MEMBER_BINDING_CHANGED',value['issues'])
    def test_windows_root_exit_or_zero_report_does_not_invent_original_job(self):
        root=windows.exit_projections({'processExit':{'rootPid':7,'rootExitCode':0}})[0]
        self.assertFalse(root['treeZeroReported']);self.assertFalse(root['originalJobProvenanceVerified'])
        tree=windows.exit_projections({'processExit':{'rootPid':7,'treeConfirmed':True,'activeProcesses':0}})[0]
        self.assertTrue(tree['treeZeroReported']);self.assertFalse(tree['originalJobProvenanceVerified'])
    def test_windows_pid_reuse_retains_distinct_native_birth(self):
        first=windows.process_projection({'ProcessId':7,'CreationDate':'first-generation'})
        second=windows.process_projection({'ProcessId':7,'CreationDate':'second-generation'})
        self.assertNotEqual(first['nativeBirth'],second['nativeBirth'])
    def test_logger_keeps_exact_boot_pid_separate_from_historical_other_boot(self):
        data=b'{"pid":12132,"workspace":"bigtron","event":"started","at":"current"}\n{"pid":51880,"event":"action.started","actionId":"old"}\n{"pid":12132,"workspace":"other","event":"action.started","actionId":"current"}\n'
        value=boot.logger_projection(data,12132,'bigtron')
        self.assertEqual(value['samePidRecords'],2);self.assertEqual(value['wrongWorkspaceRecords'],1)
        self.assertEqual([row['actionId'] for row in value['actionRecords']],['current']);self.assertEqual(value['eventCounts']['action.started'],1)
    def test_windows_native_microsoft_birth_is_parsed_without_replacing_raw_identity(self):
        raw='/Date(1791800393290)/'
        self.assertEqual(boot.native_datetime(raw).isoformat(),'2026-10-12T10:19:53.290000+00:00')

if __name__=='__main__':unittest.main()
