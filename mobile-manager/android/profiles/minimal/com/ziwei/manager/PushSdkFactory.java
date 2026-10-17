package com.ziwei.manager;

import android.content.Context;

/** Explicit non-push fallback build. It never claims a provider SDK is present. */
final class PushSdkFactory {
    static void prepareProcess() { }
    static PushSdk create() { return new PushSdk() {
        public boolean available() { return false; }
        public boolean deviceConfigured(Context context) { return false; }
        public boolean systemChannelRegistered(Context context) { return false; }
        public void register(Context context, String id, String key, Callback callback) { callback.failure(); }
        public void unregister(Context context, Runnable complete) { complete.run(); }
    }; }
}
