package com.ziwei.manager;

public final class PushLifecycleTest {
    private static int checks;
    private static void check(boolean value){checks++;if(!value)throw new AssertionError("Push lifecycle check "+checks);}
    public static void main(String[] args){
        long parentGeneration=7,registrationEpoch=23,created=1_700_000_000_000L;
        String account="fixture-account",workspace="fixture-workspace";
        // Process has died. Its persisted account/subscription and a notification's opaque ticket survive.
        boolean transportStarted=false;
        boolean pending=PushLifecycle.pendingCurrent(parentGeneration,account,workspace,parentGeneration,account,workspace,created,created+1000);
        check(!transportStarted&&pending);
        // onResume recovery uses an idempotent transport write, preserving the ticket's server epoch and native scope.
        long recoveredEpoch=PushLifecycle.registrationEpoch(registrationEpoch,true);
        check(recoveredEpoch==registrationEpoch);
        check(PushLifecycle.sameScope(account,workspace,parentGeneration,account,workspace,parentGeneration));
        check(PushLifecycle.pendingCurrent(parentGeneration,account,workspace,parentGeneration,account,workspace,created,created+2000));
        // Even a separate transport retry counter cannot invalidate an otherwise authorised local intent.
        long tokenRotationEpoch=PushLifecycle.registrationEpoch(recoveredEpoch,false);
        check(tokenRotationEpoch==24);
        check(PushLifecycle.pendingCurrent(parentGeneration,account,workspace,parentGeneration,account,workspace,created,created+3000));
        // The web's current authenticated delivery resolver still decides whether a rotated server ticket is valid.
        // Explicit disable/logout invalidates the independent parent notification generation immediately.
        long disabledGeneration=parentGeneration+1;
        check(!PushLifecycle.pendingCurrent(parentGeneration,account,workspace,disabledGeneration,account,workspace,created,created+3000));
        check(!PushLifecycle.pendingCurrent(parentGeneration,account,workspace,parentGeneration,"another-account",workspace,created,created+3000));
        check(!PushLifecycle.pendingCurrent(parentGeneration,account,workspace,parentGeneration,account,"another-workspace",created,created+3000));
        check(!PushLifecycle.pendingCurrent(parentGeneration,account,workspace,parentGeneration,account,workspace,created,created+86_400_001L));
        check(!PushLifecycle.pendingCurrent(parentGeneration,account,workspace,parentGeneration,account,workspace,created,created-1));
        check(PushLifecycle.registrationEpoch(0,true)==1);
        check(PushLifecycle.registrationEpoch(23,false)==24);
        check(!PushLifecycle.sameScope("",workspace,parentGeneration,account,workspace,parentGeneration));
        check(!PushLifecycle.sameScope(account,"",parentGeneration,account,workspace,parentGeneration));
        // No config means no installation HTTP was attempted: closing cannot strand an unknown revoke.
        boolean serverKnown=false,registrationAttempted=false,revokePending=false;
        check(!PushLifecycle.needsRevoke(serverKnown,registrationAttempted,revokePending));
        long configuredEpoch=PushLifecycle.registrationEpoch(2,false);check(configuredEpoch==3);
        // Persist attempted before HTTP. A missing receipt or secret-only absent 404 must remain durable.
        registrationAttempted=true;revokePending=PushLifecycle.needsRevoke(serverKnown,registrationAttempted,revokePending);check(revokePending);
        check(!PushLifecycle.revokeAcknowledged(404,true,false));
        check(!PushLifecycle.revokeAcknowledged(200,false,true));
        check(!PushLifecycle.revokeAcknowledged(200,true,false));
        check(PushLifecycle.needsRevoke(false,false,revokePending));
        // Authenticated, quota-bounded server fencing returns the only accepted revocation acknowledgement.
        check(PushLifecycle.revokeAcknowledged(200,true,true));revokePending=false;registrationAttempted=false;
        check(!PushLifecycle.needsRevoke(false,registrationAttempted,revokePending));
        check(PushLifecycle.registrationEpoch(configuredEpoch,false)==4);
        try{PushLifecycle.registrationEpoch(9_007_199_254_740_990L,false);throw new AssertionError("Epoch wrapped");}catch(IllegalStateException expected){checks++;}
        System.out.println(checks+" cold-start notification, transport recovery, logout and scope lifecycle checks passed");
    }
}
