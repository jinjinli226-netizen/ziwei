package com.ziwei.manager;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import java.lang.ref.WeakReference;

/** Only the packaged, frame-free document can reach these narrowly scoped notification operations. */
public final class NotificationBridge {
    static final int PERMISSION_REQUEST = 302;
    private final WeakReference<MainActivity> activity;
    NotificationBridge(MainActivity activity) { this.activity = new WeakReference<>(activity); }
    private MainActivity trusted(boolean foreground) {
        MainActivity current = activity.get();
        return current != null && current.notificationDocumentTrusted()
                && (!foreground || current.notificationForeground()) ? current : null;
    }
    @JavascriptInterface public String getStatus() {
        MainActivity current = trusted(false);
        return current == null ? "{\"available\":false,\"enabled\":false}" : NativeNotifications.status(current);
    }
    @JavascriptInterface public String configure(String workspaceSlug, boolean enabled) {
        MainActivity current = trusted(true);
        if (current != null) NativeNotifications.configure(current, workspaceSlug, enabled);
        return getStatus();
    }
    @JavascriptInterface public String requestPermission() {
        MainActivity current = trusted(true);
        if (current != null) current.runOnUiThread(() -> {
            if (trusted(true) != current) return;
            NativeNotifications.channel(current);
            if (Build.VERSION.SDK_INT >= 33 && current.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                current.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST);
            } else emit();
        });
        return getStatus();
    }
    @JavascriptInterface public String openSystemSettings() {
        MainActivity current = trusted(true);
        if (current != null) current.runOnUiThread(() -> {
            if (trusted(true) != current) return;
            // Fixed app settings only; no external URL, supplied Intent, package, action or extras.
            Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, current.getPackageName());
            try { current.startActivity(intent); }
            catch (ActivityNotFoundException unavailable) { emit(); }
        });
        return getStatus();
    }
    @JavascriptInterface public String clear() {
        MainActivity current = trusted(false);
        if (current != null) NativeNotifications.clear(current);
        return getStatus();
    }
    @JavascriptInterface public String consumePendingTarget() {
        MainActivity current = trusted(true);
        return current == null ? "null" : NativeNotifications.consume(current);
    }
    void emit() {
        MainActivity current = activity.get();
        if (current != null) current.runOnUiThread(() -> {
            if (trusted(false) != current) return;
            current.emitNotificationStatus(NativeNotifications.status(current));
        });
    }
}
