package com.ziwei.manager;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import java.lang.ref.WeakReference;
import java.security.SecureRandom;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.json.JSONException;
import org.json.JSONObject;

/** Opt-in self-hosted receiver; one cursor/capability owner for service and supplementary Job. */
final class NativeNotifications {
    static final String CHANNEL = "ziwei_updates_v1";
    static final String CLICK_ACTION = "com.ziwei.manager.NOTIFICATION";
    static final String CLICK_KEY = "notificationKey";
    private static final int JOB_ID = 0x5a574e;
    private static final Object LOCK = new Object();
    private static final String PREFS = "ziwei_notifications_v1";
    private static final ThreadPoolExecutor WORKER = new ThreadPoolExecutor(1, 1, 15, TimeUnit.SECONDS, new LinkedBlockingQueue<>());
    private static WeakReference<NotificationBridge> listener = new WeakReference<>(null);
    private static NotificationFeed.Work activeWork;
    private static long enablingGeneration = -1;
    private static boolean foreground;
    private static String visibleConversation="";
    static { WORKER.allowCoreThreadTimeOut(true); }
    private NativeNotifications() { }

    static void listen(NotificationBridge value) { synchronized (LOCK) { listener = new WeakReference<>(value); } }
    static void detach(NotificationBridge value) { synchronized (LOCK) { if (listener.get() == value) listener.clear(); } }
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private static NotificationManager manager(Context context) { return context.getSystemService(NotificationManager.class); }
    private static JobScheduler scheduler(Context context) { return context.getSystemService(JobScheduler.class); }
    static void changed() { NotificationBridge bridge; synchronized (LOCK) { bridge = listener.get(); } if (bridge != null) bridge.emit(); }
    private static String identity(Context context) { return IdentitySession.get(context).handle(); }
    static long generation(Context context) { return prefs(context).getLong("generation", 0); }
    static boolean enabled(Context context) { return prefs(context).getBoolean("enabled", false); }
    static boolean receiptCurrent(Context context, long generation, String snapshot) {
        return enabled(context) && current(context, generation, snapshot);
    }
    static void channel(Context context) {
        NotificationManager manager = manager(context);
        if (manager != null) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "员工消息和任务提醒", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("员工消息原文和任务结果");
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }
    }
    static String permission(Context context) {
        NotificationManager manager = manager(context);
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return "denied";
        if (manager == null || !manager.areNotificationsEnabled()) return "denied";
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL);
        if (channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return "channel_disabled";
        return "granted";
    }
    static String status(Context context) {
        synchronized (LOCK) {
            SharedPreferences store = prefs(context);
            String permission = permission(context);
            boolean enabled=store.getBoolean("enabled",false),service=NotificationConnectionService.running();
            boolean supplement=scheduler(context)!=null&&scheduler(context).getPendingJob(JOB_ID)!=null;
            String message=store.getString("message","关闭");
            if(enabled&&!service)message=supplement?"持续接收当前未运行；仍保留系统补充检查，可关闭后重新开启连接":"持续接收当前未运行，请关闭后重新开启连接";
            try {
                return new JSONObject().put("available", true).put("enabled", store.getBoolean("enabled", false))
                        .put("subscriptionState", store.getString("state", "disabled")).put("permission", permission)
                        .put("workspaceSlug", store.getString("slug", "")).put("workspaceId", store.getString("workspace", ""))
                        .put("accountId", store.getString("account", "")).put("intervalMinutes", 15)
                        .put("pendingTarget", store.contains("pending")).put("message", message)
                        .put("lastCheckedAt", store.getLong("lastCheckedAt", 0))
                        .put("deliveryMode", enabled ? (service?"selfhost":supplement?"supplement":"unavailable") : "unavailable")
                        .put("foregroundServiceRunning",service).put("connectionState",NotificationConnectionService.connectionState())
                        .put("batteryOptimizationExempt",context.getSystemService(android.os.PowerManager.class).isIgnoringBatteryOptimizations(context.getPackageName()))
                        .put("batterySettingsAvailable",true).put("supplementScheduled",supplement).toString();
            } catch (JSONException impossible) { return "{\"available\":false,\"enabled\":false}"; }
        }
    }
    static void recover(Context context) {
        channel(context);
        synchronized (LOCK) {
            SharedPreferences store = prefs(context);
            if (store.getBoolean("enabled", false)) {
                if(!IdentitySession.get(context).sameHandle(store.getString("identityHandle","")))disableLocked(context,"disabled","登录状态已变化，请重新开启系统通知");
                else if(store.getInt("schemaVersion",0)!=2) disableLocked(context,"disabled","通知版本已更新，请重新开启持续接收");
                else if (!"granted".equals(permission(context))) disableLocked(context, "disabled", "系统通知权限或频道已关闭");
                else if (!schedule(context)) store.edit().putString("message","持续接收已开启，系统未接受补充检查").commit();
            } else if ("enabling".equals(store.getString("state", ""))
                    && enablingGeneration != store.getLong("generation", 0)) {
                // An interrupted baseline is never promoted to an active subscription after process death.
                disableLocked(context, "disabled", "开启未完成，请重试");
            }
        }
        if(enabled(context))NotificationConnectionService.start(context);
        changed();
    }
    static void configure(Context context, String slug, boolean enabled) {
        Context app = context.getApplicationContext();
        channel(app);
        final long generation;
        synchronized (LOCK) {
            if (!enabled) { disableLocked(app, "disabled", "已关闭系统通知"); changed(); return; }
            if (!NotificationRules.workspaceSlug(slug)) return;
            disableLocked(app, "disabled", "准备开启");
            if(identity(app).isEmpty()){prefs(app).edit().putString("message","请先完成统一登录及客户端登记").commit();changed();return;}
            if (!"granted".equals(permission(app))) { prefs(app).edit().putString("message", "请先允许系统通知，并开启提醒频道").commit(); changed(); return; }
            SharedPreferences store = prefs(app);
            generation = store.getLong("generation", 0);
            enablingGeneration = generation;
            store.edit().putString("slug", slug).putString("state", "enabling").putString("message", "正在验证登录和提醒服务").commit();
        }
        changed();
        NotificationConnectionService.start(app);
        WORKER.execute(() -> baseline(app, slug, generation));
    }
    static void clear(Context context) { synchronized (LOCK) { disableLocked(context, "disabled", "已关闭系统通知"); } changed(); }
    private static void disableLocked(Context context, String state, String message) {
        SharedPreferences store = prefs(context);
        long generation = store.getLong("generation", 0) + 1;
        if (activeWork != null) { activeWork.cancel(); activeWork = null; }
        enablingGeneration = -1;
        // First invalidate every late receipt and stored click capability; cancel only this app's job/notifications.
        store.edit().clear().putLong("generation", generation).putBoolean("enabled", false)
                .putString("state", state).putString("message", message).commit();
        visibleConversation="";
        NotificationConnectionService.stop(context);
        JobScheduler scheduler = scheduler(context);
        if (scheduler != null) scheduler.cancel(JOB_ID);
        NotificationManager manager = manager(context);
        if (manager != null) manager.cancelAll();
    }
    private static boolean current(Context context, long generation, String beforeIdentity) {
        return NotificationRules.sameReceipt(generation, prefs(context).getLong("generation", 0), beforeIdentity, identity(context));
    }
    private static void baseline(Context context, String slug, long generation) {
        String snapshot = identity(context);
        NotificationFeed.Work work = new NotificationFeed.Work();
        synchronized (LOCK) {
            if (prefs(context).getLong("generation", 0) != generation) return;
            activeWork = work;
        }
        try {
            NotificationFeed.Page page = NotificationFeed.get(context, slug, true, null, snapshot, work);
            synchronized (LOCK) {
                if (!current(context, generation, snapshot)) { invalidateChangedCookie(context, generation); return; }
                if (!"granted".equals(permission(context))) { disableLocked(context, "disabled", "系统通知权限或频道已关闭"); return; }
                prefs(context).edit().putString("account", page.accountId).putString("workspace", page.workspaceId)
                        .putString("identityHandle",snapshot)
                        .putInt("schemaVersion",2).putString("cursor", page.cursor).putBoolean("enabled", true).putString("state", "enabled")
                        .putString("message", "持续接收已开启；断线后自动重连，系统限制可能使接收延后")
                        .putLong("lastCheckedAt", System.currentTimeMillis()).commit();
                if (!schedule(context)) prefs(context).edit().putString("message","持续接收已开启，系统未接受补充检查").commit();
            }

        } catch (Exception failure) { failed(context, generation, failure, true); }
        finally { synchronized (LOCK) { if (activeWork == work) activeWork = null; if (enablingGeneration == generation) enablingGeneration = -1; } changed(); }
    }
    private static boolean schedule(Context context) {
        JobScheduler scheduler = scheduler(context);
        if (scheduler == null) return false;
        JobInfo existing = scheduler.getPendingJob(JOB_ID);
        if (existing != null) return true;
        JobInfo info = new JobInfo.Builder(JOB_ID, new ComponentName(context, NotificationJobService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(NotificationRules.INTERVAL_MILLIS)
                .setPersisted(false).build();
        try { return scheduler.schedule(info) == JobScheduler.RESULT_SUCCESS; }
        catch (RuntimeException unavailable) { return false; }
    }
    private static void invalidateChangedCookie(Context context, long generation) {
        if (prefs(context).getLong("generation", 0) == generation) disableLocked(context, "disabled", "登录状态已变化，请重新开启系统通知");
    }
    private static void failed(Context context, long generation, Exception failure, boolean enabling) {
        synchronized (LOCK) {
            if (prefs(context).getLong("generation", 0) != generation) return;
            int code = failure instanceof NotificationFeed.Failure ? ((NotificationFeed.Failure)failure).status : 0;
            if (code == 401 || code == 403) disableLocked(context, "disabled", "登录已过期或工作区不可访问，请重新开启");
            else if (code == 400 || code == 404 || code == 405 || code == 409 || code == 410
                    || code >= 300 && code < 400 || failure instanceof JSONException)
                disableLocked(context, "unavailable", "提醒服务尚未可用，请稍后重试");
            else if (enabling) disableLocked(context, "error", "验证提醒服务失败，请检查网络后重试");
            else prefs(context).edit().putString("state", "error").putString("message", "本次检查失败，等待系统再次调度").commit();
        }
    }

    static void check(Context context, NotificationFeed.Work work, Runnable complete) {
        WORKER.execute(() -> {
            try { if(!NotificationConnectionService.running())receive(context.getApplicationContext(), work, false); }
            finally { complete.run(); changed(); }
        });
    }
    static boolean receive(Context context, NotificationFeed.Work work, boolean waiting) {
        final long generation;
        final String slug, account, workspace;
        String cursor;
        synchronized (LOCK) {
            SharedPreferences store = prefs(context);
            if (!store.getBoolean("enabled", false) || activeWork!=null) return false;
            if(store.getInt("schemaVersion",0)!=2){disableLocked(context,"disabled","请重新开启持续接收");return false;}
            if (!"granted".equals(permission(context))) { disableLocked(context, "disabled", "系统通知权限或频道已关闭"); return false; }
            generation = store.getLong("generation", 0);
            activeWork = work;
            slug = store.getString("slug", ""); account = store.getString("account", ""); workspace = store.getString("workspace", ""); cursor = store.getString("cursor", "");
        }
        String snapshot = identity(context);
        try {
            for (int index = 0; index < 2; index++) {
                work.check();
                NotificationFeed.Page page = waiting && index==0 ? NotificationFeed.waitFor(context,slug,cursor,snapshot,work) : NotificationFeed.get(context, slug, false, cursor, snapshot, work);
                synchronized (LOCK) {
                    if (!current(context, generation, snapshot)) { invalidateChangedCookie(context, generation); return false; }
                    if (work.cancelled.get()) return false;
                    if (!account.equals(page.accountId) || !workspace.equals(page.workspaceId)) { disableLocked(context, "disabled", "账号或工作区已变化，请重新开启系统通知"); return false; }
                    if (!"granted".equals(permission(context))) { disableLocked(context, "disabled", "系统通知权限或频道已关闭"); return false; }
                    if (page.hasMore && page.cursor.equals(cursor)) throw new JSONException("Feed did not advance");
                }
                for(NotificationFeed.Item item:page.items){
                    work.check();
                    synchronized(LOCK){
                        if(!receiptCurrent(context,generation,snapshot)||work.cancelled.get())return false;
                        if(SelfhostRules.processed(prefs(context).getString("seen",""),item.id))continue;
                    }
                    NotificationFeed.Item fresh;
                    try{fresh=NotificationFeed.resolve(context,slug,item.id,account,workspace,snapshot,work);}
                    catch(NotificationFeed.Failure missing){
                        if(!SelfhostRules.itemGone(missing.status,missing.code))throw missing;
                        synchronized(LOCK){if(!receiptCurrent(context,generation,snapshot)||work.cancelled.get())return false;rememberLocked(prefs(context),item.id);}continue;
                    }
                    synchronized(LOCK){
                        if(!receiptCurrent(context,generation,snapshot)||work.cancelled.get())return false;
                        deliverLocked(context,generation,slug,account,workspace,fresh);
                    }
                }
                synchronized(LOCK){
                    if(!receiptCurrent(context,generation,snapshot)||work.cancelled.get())return false;
                    if(!prefs(context).edit().putString("cursor", page.cursor).putString("state", "enabled")
                            .putString("message", "持续接收已开启；断线后自动重连，系统限制可能使接收延后")
                            .putLong("lastCheckedAt", System.currentTimeMillis()).commit())throw new java.io.IOException("Cursor receipt unavailable");
                }
                cursor = page.cursor;
                if (!page.hasMore) break;
            }
            return true;
        } catch (Exception failure) {
            if (!work.cancelled.get()) {
                if(failure instanceof NotificationFeed.Failure && ((NotificationFeed.Failure)failure).status==409) resetBaseline(context,generation,slug);
                else failed(context, generation, failure, false);
            }
            return false;
        }
        finally { synchronized (LOCK) { if (activeWork == work) activeWork = null; } }
    }
    private static void deliverLocked(Context context, long generation, String slug, String account, String workspace, NotificationFeed.Item item) throws JSONException {
        SharedPreferences store = prefs(context);
        LinkedHashSet<String> seen = new LinkedHashSet<>();
        String encodedSeen = store.getString("seen", "");
        for (String value : encodedSeen.split(",")) if (!value.isEmpty()) seen.add(value);
        String digest = NotificationRules.digest(item.id);
        if (seen.contains(digest)) return;
        if(SelfhostRules.suppress(foreground,visibleConversation,item.target.optString("kind"),item.target.optString("id"))){
            seen.add(digest);while(seen.size()>128)seen.remove(seen.iterator().next());
            if(!store.edit().putString("seen",join(seen)).commit())throw new JSONException("Suppression receipt unavailable");return;
        }
        byte[] random = new byte[24]; new SecureRandom().nextBytes(random);
        StringBuilder keyBuilder = new StringBuilder();
        for (byte value : random) keyBuilder.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        String key = keyBuilder.toString();
        JSONObject targets = privateTargets(store);
        pruneTargets(targets);
        // At most 64 click capabilities survive; no report, message body, cookie, title or summary is persisted here.
        while (targets.length() >= 64) { Iterator<String> keys = targets.keys(); if (keys.hasNext()) targets.remove(keys.next()); }
        JSONObject envelope = new JSONObject().put("generation", generation).put("createdAt", System.currentTimeMillis())
                .put("accountId", account).put("workspaceId", workspace).put("workspaceSlug", slug).put("eventId", item.id).put("target", item.target);
        targets.put(key, envelope);
        if (!store.edit().putString("targets", targets.toString()).commit()) throw new JSONException("Private target storage unavailable");
        int notificationId = 0x60000000 | ((int)Long.parseLong(digest.substring(0, 8), 16) & 0x0fffffff);
        Intent intent = new Intent(context, MainActivity.class).setAction(CLICK_ACTION).setData(android.net.Uri.parse("ziwei-internal://notification/"+key)).putExtra(CLICK_KEY, key)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(context, notificationId, intent, PendingIntent.FLAG_CANCEL_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(context, CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(item.title).setContentText(item.summary)
                .setStyle(new Notification.BigTextStyle().bigText(item.summary))
                .setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(pending).setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE).setOnlyAlertOnce(true).build();
        manager(context).notify("ziwei-event-"+digest,notificationId, notification);
        seen.add(digest);
        while (seen.size() > 128) seen.remove(seen.iterator().next());
        if(!store.edit().putString("seen", join(seen)).commit())throw new JSONException("Notification receipt unavailable");
    }
    static void lifecycle(Context context,boolean active){synchronized(LOCK){foreground=active;if(!active)visibleConversation="";}}
    static void setForeground(Context context,String chat){if(chat==null||!chat.isEmpty()&&!NotificationRules.identifier(chat))return;synchronized(LOCK){visibleConversation=foreground?chat:"";}}
    static boolean shouldReceive(Context context){SharedPreferences p=prefs(context);return p.getBoolean("enabled",false)&&p.getInt("schemaVersion",0)==2||"enabling".equals(p.getString("state",""))&&enablingGeneration==p.getLong("generation",0);}
    private static void resetBaseline(Context context,long previous,String slug){
        final long generation;
        synchronized(LOCK){
            if(prefs(context).getLong("generation",0)!=previous)return;
            generation=previous+1;enablingGeneration=generation;
            prefs(context).edit().clear().putLong("generation",generation).putBoolean("enabled",false).putString("slug",slug)
                    .putString("state","enabling").putString("message","记录窗口已更新，正在重新建立接收起点").commit();
            visibleConversation="";
            NotificationManager manager=manager(context);
            if(manager!=null)for(android.service.notification.StatusBarNotification notification:manager.getActiveNotifications())
                if(notification.getTag()!=null&&notification.getTag().startsWith("ziwei-event-"))manager.cancel(notification.getTag(),notification.getId());
        }
        WORKER.execute(()->baseline(context,slug,generation));
        // Keep the existing foreground connection service; no forbidden background restart is needed.
    }
    private static void rememberLocked(SharedPreferences store,String id) throws JSONException {
        LinkedHashSet<String> processed=new LinkedHashSet<>();for(String digest:store.getString("seen","").split(","))if(!digest.isEmpty())processed.add(digest);
        processed.add(NotificationRules.digest(id));while(processed.size()>128)processed.remove(processed.iterator().next());
        if(!store.edit().putString("seen",join(processed)).commit())throw new JSONException("Processed item receipt unavailable");
    }
    private static String join(Set<String> values) { StringBuilder result = new StringBuilder(); for (String value : values) { if (result.length() > 0) result.append(','); result.append(value); } return result.toString(); }
    private static JSONObject privateTargets(SharedPreferences store) { try { return new JSONObject(store.getString("targets", "{}")); } catch (JSONException invalid) { return new JSONObject(); } }
    private static void pruneTargets(JSONObject targets) throws JSONException {
        Set<String> remove = new HashSet<>(); Iterator<String> keys = targets.keys();
        while (keys.hasNext()) { String key = keys.next(); JSONObject target = targets.optJSONObject(key); if (target == null || !NotificationRules.unexpired(target.optLong("createdAt", 0), System.currentTimeMillis())) remove.add(key); }
        for (String key : remove) targets.remove(key);
    }

    static void click(Context context, Intent intent) {

        if (intent == null || !CLICK_ACTION.equals(intent.getAction())) return;
        String key = intent.getStringExtra(CLICK_KEY);
        intent.removeExtra(CLICK_KEY);
        if (key == null || !key.matches("[0-9a-f]{48}")) return;
        Context app = context.getApplicationContext();
        final JSONObject envelope;
        final long generation;
        synchronized (LOCK) {
            SharedPreferences store = prefs(app);
            JSONObject targets = privateTargets(store);
            envelope = targets.optJSONObject(key);
            targets.remove(key); store.edit().putString("targets", targets.toString()).commit();
            if (envelope == null || !store.getBoolean("enabled", false)
                    || !NotificationRules.unexpired(envelope.optLong("createdAt", 0), System.currentTimeMillis())) return;
            generation = store.getLong("generation", 0);
            if (generation != envelope.optLong("generation", -1)) return;
        }
        WORKER.execute(() -> {
            String snapshot = identity(app);
            NotificationFeed.Work work = new NotificationFeed.Work();
            synchronized (LOCK) {
                if (prefs(app).getLong("generation", 0) != generation) return;
                if(activeWork!=null)activeWork.cancel();activeWork = work;
            }
            try {
                NotificationFeed.Page page = NotificationFeed.get(app, envelope.getString("workspaceSlug"), true, null, snapshot, work);
                synchronized (LOCK) {
                    if (!current(app, generation, snapshot)) { invalidateChangedCookie(app, generation); return; }
                    if (!page.accountId.equals(envelope.getString("accountId")) || !page.workspaceId.equals(envelope.getString("workspaceId"))) {
                        disableLocked(app, "disabled", "账号或工作区已变化，原通知已失效"); return;
                    }
                    // Web consumes only after boot/login; then its fresh event resolver rechecks item-level access.
                    prefs(app).edit().putString("pending", envelope.toString()).commit();
                }
            } catch (Exception failure) { failed(app, generation, failure, false); }
            finally { synchronized (LOCK) { if (activeWork == work) activeWork = null; } changed(); }
        });
    }
    static String consume(Context context) {

        synchronized (LOCK) {
            SharedPreferences store = prefs(context);
            String raw = store.getString("pending", null);
            store.edit().remove("pending").commit();
            if (raw == null || !store.getBoolean("enabled", false)) return "null";
            try {
                JSONObject envelope = new JSONObject(raw);
                if (store.getLong("generation", 0) != envelope.getLong("generation")
                        || !NotificationRules.unexpired(envelope.getLong("createdAt"), System.currentTimeMillis())
                        || !store.getString("account", "").equals(envelope.getString("accountId"))
                        || !store.getString("workspace", "").equals(envelope.getString("workspaceId"))) return "null";
                return new JSONObject().put("accountId", envelope.getString("accountId")).put("workspaceId", envelope.getString("workspaceId"))
                        .put("workspaceSlug", envelope.getString("workspaceSlug")).put("eventId", envelope.getString("eventId"))
                        .put("target", NotificationFeed.target(envelope.getJSONObject("target"))).toString();
            } catch (JSONException invalid) { return "null"; }
        }
    }
}
