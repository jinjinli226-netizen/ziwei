package com.ziwei.manager;

import android.content.Context;

/** Compile-time provider seam. The push build links the official SDK directly, without reflection. */
interface PushSdk {
    interface Callback { void success(String token); void failure(); }
    boolean available();
    boolean deviceConfigured(Context context);
    boolean systemChannelRegistered(Context context);
    void register(Context context, String accessId, String accessKey, Callback callback);
    void unregister(Context context, Runnable complete);
}
