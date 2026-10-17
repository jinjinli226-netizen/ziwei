package com.ziwei.manager;

import android.app.Application;
import android.content.Context;

/** Runs before ContentProvider creation, including after an opted-out process is recreated. */
public final class ManagerApplication extends Application {
    @Override protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        PushSdkFactory.prepareProcess();
    }
}
