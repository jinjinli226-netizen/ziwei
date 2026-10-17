package com.ziwei.manager;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;

/** One OS-managed periodic read. The OS may defer it; it never runs an employee or keeps the app alive. */
public final class NotificationJobService extends JobService {
    private final Handler main = new Handler(Looper.getMainLooper());
    private NotificationFeed.Work running;
    @Override public boolean onStartJob(JobParameters parameters) {
        if (running != null) running.cancel();
        NotificationFeed.Work work = new NotificationFeed.Work();
        if (Build.VERSION.SDK_INT >= 28) {
            work.network = parameters.getNetwork();
            if (work.network == null) return false;
        }
        running = work;
        NativeNotifications.check(this, work, () -> main.post(() -> {
            if (running != work) return;
            running = null;
            jobFinished(parameters, false);
        }));
        return true;
    }
    @Override public boolean onStopJob(JobParameters parameters) {
        if (running != null) { running.cancel(); running = null; }
        return false; // The existing periodic schedule remains; no tight retry loop.
    }
    @Override public void onDestroy() {
        if (running != null) { running.cancel(); running = null; }
        super.onDestroy();
    }
}
