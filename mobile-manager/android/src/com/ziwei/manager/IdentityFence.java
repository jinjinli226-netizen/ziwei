package com.ziwei.manager;

/** Account/process epoch never changes during token refresh; stale login/refresh/API receipts cannot win. */
final class IdentityFence {
    private long epoch;
    private long refreshEpoch=-1;
    private String subject = "", handle = "";
    synchronized long epoch() { return epoch; }
    synchronized boolean current(long before) { return before == epoch; }
    synchronized String handle() { return handle; }
    synchronized void invalidate() { epoch++; subject=""; handle=""; refreshEpoch=-1; }
    synchronized boolean refreshing(){return refreshEpoch>=0;}
    synchronized boolean beginRefresh(long before){if(before!=epoch||refreshEpoch>=0)return false;refreshEpoch=before;return true;}
    synchronized void finishRefresh(long before){if(refreshEpoch==before)refreshEpoch=-1;}
    synchronized boolean install(long before, String value) {
        if (before != epoch || value == null || value.isEmpty() || !subject.isEmpty() && !subject.equals(value)) return false;
        if (subject.isEmpty()) { subject=value; handle=OidcRules.random(); }
        return true;
    }
    synchronized void restore(long before, String value, String savedHandle) {
        if (!install(before, value) || savedHandle == null || !savedHandle.matches("[A-Za-z0-9_-]{43}")) throw OidcRules.invalid();
        handle=savedHandle;
    }
}
