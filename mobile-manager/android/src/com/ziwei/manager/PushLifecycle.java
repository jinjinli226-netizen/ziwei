package com.ziwei.manager;

/** Notification intent identity is independent from transport registration fencing. */
final class PushLifecycle {
    private PushLifecycle() { }
    static boolean sameScope(String oldAccount,String oldWorkspace,long oldGeneration,String account,String workspace,long generation) {
        return oldAccount!=null&&!oldAccount.isEmpty()&&oldWorkspace!=null&&!oldWorkspace.isEmpty()
                &&oldAccount.equals(account)&&oldWorkspace.equals(workspace)&&oldGeneration==generation;
    }
    static long registrationEpoch(long current,boolean sameScopeRecovery) {
        if(sameScopeRecovery&&current>0)return current;
        if(current>=9_007_199_254_740_990L)throw new IllegalStateException("Push epoch exhausted");
        return current+1;
    }
    static boolean pendingCurrent(long beforeGeneration,String beforeAccount,String beforeWorkspace,long nowGeneration,
                                  String nowAccount,String nowWorkspace,long createdAt,long now) {
        return sameScope(beforeAccount,beforeWorkspace,beforeGeneration,nowAccount,nowWorkspace,nowGeneration)
                &&NotificationRules.unexpired(createdAt,now);
    }
    static boolean needsRevoke(boolean serverKnown,boolean registrationAttempted,boolean pending) {
        return serverKnown||registrationAttempted||pending;
    }
    static boolean revokeAcknowledged(int status,boolean schemaValid,boolean revoked) { return status==200&&schemaValid&&revoked; }
}
