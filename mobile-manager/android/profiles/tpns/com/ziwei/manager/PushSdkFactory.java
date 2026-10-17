package com.ziwei.manager;

final class PushSdkFactory {
    static void prepareProcess() { com.tencent.android.tpush.XGPushConfig.setAutoInit(false); }
    static PushSdk create() { return new TpnsPushSdk(); }
}
