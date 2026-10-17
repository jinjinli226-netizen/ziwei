package com.ziwei.manager;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Base64;
import java.security.SecureRandom;
import java.util.LinkedHashSet;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Real provider registration plus session-scoped server subscription. No model or employee actions. */
final class NativePush {
    static final String CLICK_ACTION = "com.ziwei.manager.PUSH_DELIVERY";
    static final String DELIVERY_KEY = "deliveryId";
    private static final String PREFS = "ziwei_system_push_v1";
    private static final Object LOCK = new Object();
    private static final PushSdk SDK = PushSdkFactory.create();
    private static final ThreadPoolExecutor WORKER = new ThreadPoolExecutor(1,1,15,TimeUnit.SECONDS,new LinkedBlockingQueue<>(32));
    private static NotificationFeed.Work activeWork;
    private static volatile boolean transportStarted;
    private static volatile String registeredCookie = "";
    private static boolean enabling, foreground, presenceQueued, unregisterPending;
    private static String conversation = "";
    static { WORKER.allowCoreThreadTimeOut(true); }
    private NativePush() { }
    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS,Context.MODE_PRIVATE); }
    private static void execute(Context c, Runnable action) {
        try { WORKER.execute(action); }
        catch (RejectedExecutionException full) { prefs(c).edit().putString("state","error").putString("message","通知服务忙，请稍后重试").commit(); NativeNotifications.changed(); }
    }
    private static long next(SharedPreferences p, String key) {
        long value=p.getLong(key,0); if(value>=9_007_199_254_740_990L) throw new IllegalStateException("Push epoch exhausted"); return value+1;
    }
    private static void identity(SharedPreferences p) {
        if(PushRules.installationId(p.getString("installationId","")) && PushRules.installationSecret(p.getString("installationSecret",""))) return;
        byte[] secret=new byte[32];new SecureRandom().nextBytes(secret);
        if(!p.edit().putString("installationId",UUID.randomUUID().toString().replace("-",""))
                .putString("installationSecret",Base64.encodeToString(secret,Base64.URL_SAFE|Base64.NO_PADDING|Base64.NO_WRAP)).commit()) throw new IllegalStateException("Push identity unavailable");
    }
    static boolean ready(Context c) { return transportStarted && !registeredCookie.isEmpty() && registeredCookie.equals(NativeNotifications.sessionCookie())
            && "enabled".equals(prefs(c).getString("state","")) && SDK.available() && SDK.deviceConfigured(c) && SDK.systemChannelRegistered(c); }
    static JSONObject augment(Context c, JSONObject status) throws JSONException {
        SharedPreferences p=prefs(c); boolean enabled=status.optBoolean("enabled",false), ready=enabled && ready(c);
        status.put("deliveryMode",ready?"push":enabled?"supplement":"unavailable")
                .put("pushAvailable",SDK.available()).put("pushConfigured",p.getBoolean("configured",false))
                .put("pushState",p.getString("state",SDK.available()?"notConfigured":"unavailable"));
        if(enabled) status.put("message",ready?"系统推送已开启":p.getString("message","系统推送尚未配置，已保留补充检查"));
        status.put("pendingTarget",status.optBoolean("pendingTarget",false)||p.contains("pendingDelivery"));
        return status;
    }
    private static boolean current(Context c,long epoch,long generation,String cookie) {
        return prefs(c).getLong("clientEpoch",0)==epoch && NativeNotifications.receiptCurrent(c,generation,cookie);
    }
    static void enable(Context c,String slug,String account,String workspace,long generation,String cookie) {
        enable(c,slug,account,workspace,generation,cookie,false);
    }
    private static void enable(Context c,String slug,String account,String workspace,long generation,String cookie,boolean recovering) {
        Context app=c.getApplicationContext(); final long epoch;
        synchronized(LOCK) {
            SharedPreferences p=prefs(app);
            if(enabling || ready(app) && transportStarted && account.equals(p.getString("account","")) && workspace.equals(p.getString("workspace",""))) return;
            identity(p);
            boolean sameScope=PushLifecycle.sameScope(p.getString("account",""),p.getString("workspace",""),p.getLong("parentGeneration",-1),account,workspace,generation);
            epoch=PushLifecycle.registrationEpoch(p.getLong("clientEpoch",0),recovering&&sameScope); enabling=true;
            if(activeWork!=null)activeWork.cancel();
            SharedPreferences.Editor edit=p.edit().putLong("clientEpoch",epoch).putLong("parentGeneration",generation)
                    .putString("slug",slug).putString("account",account).putString("workspace",workspace)
                    .putString("state","enabling").putBoolean("configured",false).putString("message","正在连接系统推送；补充检查仍可用");
            if(!sameScope)edit.remove("pendingDelivery").remove("consumedDeliveries");
            if(!edit.commit()) { enabling=false;return; }
        }
        NativeNotifications.changed(); execute(app,()->register(app,slug,account,workspace,generation,cookie,epoch,recovering));
    }
    private static JSONObject credentials(Context c,long epoch) throws JSONException {
        SharedPreferences p=prefs(c);
        return new JSONObject().put("installationId",p.getString("installationId",""))
                .put("installationSecret",p.getString("installationSecret",""))
                .put("clientEpoch",epoch);
    }
    private static void register(Context c,String slug,String account,String workspace,long generation,String cookie,long epoch,boolean recovering) {
        NotificationFeed.Work work=new NotificationFeed.Work();
        synchronized(LOCK) { if(!current(c,epoch,generation,cookie)) { if(prefs(c).getLong("clientEpoch",0)==epoch)enabling=false;return; } activeWork=work; }
        try {
            revokePending(c);
            if(!current(c,epoch,generation,cookie))return;
            JSONObject config=PushApi.request(c,"config","GET",null,cookie,work);
            boolean configured=PushApi.bool(config,"configured");
            if(!"tpns".equals(PushApi.string(config,"provider")) || !"com.ziwei.manager".equals(PushApi.string(config,"packageName"))) throw new JSONException("Wrong push provider");
            if(!configured || !"ready".equals(PushApi.string(config,"status")) || !SDK.available() || !SDK.deviceConfigured(c)) {
                update(c,epoch,"notConfigured",false,"系统推送尚未配置，已保留补充检查");return;
            }
            String id=PushApi.string(config,"accessId"),key=PushApi.string(config,"accessKey");
            if(!PushRules.accessId(id)||!PushRules.accessKey(key))throw new JSONException("Invalid push configuration");
            if(!current(c,epoch,generation,cookie))return;
            synchronized(LOCK){if(unregisterPending)throw new java.io.IOException("Previous unregister pending");prefs(c).edit().putBoolean("sdkStarted",true).commit();}
            CountDownLatch done=new CountDownLatch(1); AtomicReference<String> token=new AtomicReference<>();
            SDK.register(c,id,key,new PushSdk.Callback(){public void success(String value){if(PushRules.token(value))token.compareAndSet(null,value);done.countDown();}public void failure(){done.countDown();}});
            if(!done.await(20,TimeUnit.SECONDS) || token.get()==null)throw new java.io.IOException("Provider registration unavailable");
            // An online TPNS token alone cannot establish an OEM/FCM offline system channel.
            for(int attempt=0;attempt<20&&!SDK.systemChannelRegistered(c);attempt++){
                work.check();if(!current(c,epoch,generation,cookie))return;Thread.sleep(250);
            }
            if(!SDK.systemChannelRegistered(c))throw new java.io.IOException("System channel not registered");
            work.check();if(!current(c,epoch,generation,cookie))return;
            synchronized(LOCK){
                SharedPreferences p=prefs(c);String previousToken=p.getString("registerAttemptToken",p.getString("token",""));
                if(recovering&&!previousToken.isEmpty()&&!previousToken.equals(token.get())){
                    epoch=next(p,"clientEpoch");p.edit().putLong("clientEpoch",epoch).commit();
                }
                p.edit().putString("registerAttemptToken",token.get()).commit();
            }
            String version=c.getPackageManager().getPackageInfo(c.getPackageName(),0).versionName;
            JSONObject request=credentials(c,epoch).put("provider","tpns").put("token",token.get()).put("appVersion",version);
            synchronized(LOCK){if(!current(c,epoch,generation,cookie))return;if(!prefs(c).edit().putBoolean("registrationAttempted",true).commit())throw new java.io.IOException("Registration fence unavailable");}
            JSONObject installation=PushApi.request(c,"installations","POST",request,cookie,work);
            if(!prefs(c).getString("installationId","").equals(PushApi.string(installation,"installationId")) || !account.equals(PushApi.string(installation,"accountId"))) throw new JSONException("Wrong push account");
            long serverGeneration=PushApi.integer(installation,"generation");
            synchronized(LOCK){if(!current(c,epoch,generation,cookie))return;prefs(c).edit().putBoolean("serverKnown",true).commit();}
            if(!current(c,epoch,generation,cookie))return;
            JSONObject subscription=PushApi.request(c,"subscription","PUT",credentials(c,epoch).put("generation",serverGeneration)
                    .put("workspaceSlug",slug).put("enabled",true),cookie,work);
            if(!PushApi.bool(subscription,"enabled") || !account.equals(PushApi.string(subscription,"accountId"))
                    || !workspace.equals(PushApi.string(subscription,"workspaceId")) || !slug.equals(PushApi.string(subscription,"workspaceSlug"))
                    || !NotificationRules.identifier(PushApi.string(subscription,"subscriptionId"))) throw new JSONException("Wrong push subscription");
            long subscriptionEpoch=PushApi.integer(subscription,"epoch");PushApi.integer(subscription,"baselineSequence");
            synchronized(LOCK) {
                if(!current(c,epoch,generation,cookie))return;
                prefs(c).edit().putString("token",token.get()).putLong("serverGeneration",serverGeneration).putLong("subscriptionEpoch",subscriptionEpoch)
                        .putLong("presenceSeq",next(prefs(c),"presenceSeq"))
                        .putString("state","enabled").putBoolean("configured",true).putString("message","系统推送已开启").commit();
                registeredCookie=cookie;transportStarted=true;
            }
            queuePresence(c);
        } catch(Exception failure) {
            update(c,epoch,"error",false,"系统推送暂未连接，已保留补充检查");
        } finally {
            synchronized(LOCK){if(activeWork==work)activeWork=null;if(prefs(c).getLong("clientEpoch",0)==epoch)enabling=false;}
            NativeNotifications.changed();
        }
    }
    private static void update(Context c,long epoch,String state,boolean configured,String message) {
        synchronized(LOCK){if(prefs(c).getLong("clientEpoch",0)==epoch)prefs(c).edit().putString("state",state).putBoolean("configured",configured).putString("message",message).commit();}
        NativeNotifications.changed();
    }
    /** Invalidates local receipts synchronously; a durable secret-only tombstone revokes the server. */
    static void disable(Context c) {
        Context app=c.getApplicationContext();final boolean registered;final long disablingEpoch;
        synchronized(LOCK) {
            SharedPreferences p=prefs(app);if(!p.contains("installationId"))return;
            registered=p.getBoolean("sdkStarted",false)||p.contains("token");long epoch=next(p,"clientEpoch");disablingEpoch=epoch;
            boolean revoke=PushLifecycle.needsRevoke(p.getBoolean("serverKnown",false),p.getBoolean("registrationAttempted",false),p.getBoolean("revokePending",false));
            if(activeWork!=null){activeWork.cancel();activeWork=null;}
            enabling=false;foreground=false;conversation="";registeredCookie="";transportStarted=false;
            p.edit().putLong("clientEpoch",epoch).putLong("revokeEpoch",epoch).putBoolean("revokePending",revoke)
                    .putString("state","disabled").putBoolean("configured",false).remove("token").remove("registerAttemptToken").remove("pendingDelivery").remove("consumedDeliveries")
                    .remove("account").remove("workspace").remove("slug").remove("serverGeneration").remove("subscriptionEpoch").commit();
        }
        execute(app,()->{
            try{revokePending(app);}catch(Exception ignored){/* Durable tombstone is retried on next authorised use. */}
            if(registered && SDK.available()) {
                CountDownLatch done=new CountDownLatch(1);
                synchronized(LOCK){unregisterPending=true;}
                try{SDK.unregister(app,()->{synchronized(LOCK){unregisterPending=false;if(prefs(app).getLong("clientEpoch",0)==disablingEpoch)prefs(app).edit().putBoolean("sdkStarted",false).commit();}done.countDown();});done.await(15,TimeUnit.SECONDS);}catch(Exception ignored){ }
            }
            synchronized(LOCK){transportStarted=false;}
            NativeNotifications.changed();
        });
    }
    private static void revokePending(Context c) throws Exception {
        SharedPreferences p=prefs(c);if(!p.getBoolean("revokePending",false))return;
        long epoch=p.getLong("revokeEpoch",0);NotificationFeed.Work work=new NotificationFeed.Work();
        JSONObject receipt=PushApi.request(c,"logout","POST",credentials(c,epoch),NativeNotifications.sessionCookie(),work);
        if(!PushLifecycle.revokeAcknowledged(200,true,PushApi.bool(receipt,"revoked")))throw new JSONException("Revocation not confirmed");
        synchronized(LOCK){if(prefs(c).getLong("revokeEpoch",0)==epoch)prefs(c).edit().putBoolean("revokePending",false).putBoolean("serverKnown",false).putBoolean("registrationAttempted",false).commit();}
    }
    static void recover(Context c) {
        SharedPreferences p=prefs(c);
        if(p.getBoolean("revokePending",false))execute(c.getApplicationContext(),()->{try{revokePending(c.getApplicationContext());}catch(Exception ignored){ }});
        if(NativeNotifications.enabled(c) && p.contains("account") && p.contains("workspace"))
            enable(c,p.getString("slug",""),p.getString("account",""),p.getString("workspace",""),NativeNotifications.generation(c),NativeNotifications.sessionCookie(),true);
    }
    static void rotated(Context c,String token) {
        if(!PushRules.token(token))return;
        synchronized(LOCK){if(!ready(c)||token.equals(prefs(c).getString("token","")))return;transportStarted=false;}
        SharedPreferences p=prefs(c);enable(c,p.getString("slug",""),p.getString("account",""),p.getString("workspace",""),NativeNotifications.generation(c),NativeNotifications.sessionCookie(),false);
    }
    static void lifecycle(Context c,boolean active) {
        synchronized(LOCK){foreground=active;if(!active)conversation="";}
        if(!active)setForeground(c,"");
    }
    static void setForeground(Context c,String id) {
        if(id==null || !id.isEmpty() && !NotificationRules.identifier(id))return;
        synchronized(LOCK){conversation=foreground?id:"";SharedPreferences p=prefs(c);p.edit().putLong("presenceSeq",next(p,"presenceSeq")).commit();}
        queuePresence(c.getApplicationContext());
    }
    private static void queuePresence(Context c) {
        synchronized(LOCK){if(presenceQueued||!ready(c))return;presenceQueued=true;}
        execute(c,()->{
            long sent=-1;
            try {
                // One serial actor owns active/clear order. The server also fences by persisted sequence.
                for(int index=0;index<2;index++) {
                    final long epoch,generation,seq,serverGeneration;final String slug,chat,cookie;
                    synchronized(LOCK){SharedPreferences p=prefs(c);if(!ready(c))return;epoch=p.getLong("clientEpoch",0);generation=p.getLong("parentGeneration",-1);seq=p.getLong("presenceSeq",0);serverGeneration=p.getLong("serverGeneration",-1);slug=p.getString("slug","");chat=foreground?conversation:"";}
                    cookie=registeredCookie;if(!current(c,epoch,generation,cookie))return;
                    JSONObject request=credentials(c,epoch).put("generation",serverGeneration).put("presenceSeq",seq).put("workspaceSlug",slug)
                            .put("conversationId",chat.isEmpty()?JSONObject.NULL:chat).put("active",!chat.isEmpty());
                    PushApi.request(c,"foreground","POST",request,cookie,new NotificationFeed.Work());sent=seq;
                    if(prefs(c).getLong("presenceSeq",0)==seq)break;
                }
            } catch(Exception ignored){/* Never extend a failed foreground lease locally. Server TTL expires it. */}
            finally {boolean again;synchronized(LOCK){presenceQueued=false;again=ready(c)&&sent>=0&&prefs(c).getLong("presenceSeq",0)!=sent;}if(again)queuePresence(c);}
        });
    }
    static String payloadDelivery(String raw) {
        if(raw==null||raw.length()>256)return null;
        try{JSONTokener parser=new JSONTokener(raw);Object value=parser.nextValue();if(!(value instanceof JSONObject)||parser.nextClean()!=0)return null;JSONObject json=(JSONObject)value;return json.length()==1&&json.opt("deliveryId") instanceof String&&PushRules.deliveryId(json.getString("deliveryId"))?json.getString("deliveryId"):null;}catch(JSONException invalid){return null;}
    }
    static void click(Context c,Intent intent) {
        if(intent==null)return;String id=null;
        if(Intent.ACTION_VIEW.equals(intent.getAction())){id=PushRules.deliveryFromUri(intent.getDataString());if(id!=null)intent.setData(null);}
        else if(CLICK_ACTION.equals(intent.getAction())){id=intent.getStringExtra(DELIVERY_KEY);intent.removeExtra(DELIVERY_KEY);}
        if(!PushRules.deliveryId(id))return;
        synchronized(LOCK){SharedPreferences p=prefs(c);if(!NativeNotifications.enabled(c)||!p.contains("account")||!p.contains("workspace"))return;
            for(String consumed:p.getString("consumedDeliveries","").split(","))if(NotificationRules.digest(id).equals(consumed))return;
            try{p.edit().putString("pendingDelivery",new JSONObject().put("deliveryId",id).put("generation",NativeNotifications.generation(c))
                    .put("accountId",p.getString("account","")).put("workspaceId",p.getString("workspace","")).put("createdAt",System.currentTimeMillis()).toString()).commit();}catch(JSONException ignored){ }}
        NativeNotifications.changed();
    }
    static String consume(Context c) {
        synchronized(LOCK){SharedPreferences p=prefs(c);String raw=p.getString("pendingDelivery",null);p.edit().remove("pendingDelivery").commit();if(raw==null||!NativeNotifications.enabled(c))return "null";
            try{JSONObject pending=new JSONObject(raw);String id=PushApi.string(pending,"deliveryId");
                if(!PushRules.deliveryId(id)||!PushLifecycle.pendingCurrent(pending.getLong("generation"),PushApi.string(pending,"accountId"),PushApi.string(pending,"workspaceId"),NativeNotifications.generation(c),p.getString("account",""),p.getString("workspace",""),pending.getLong("createdAt"),System.currentTimeMillis()))return "null";
                LinkedHashSet<String> consumed=new LinkedHashSet<>();for(String digest:p.getString("consumedDeliveries","").split(","))if(!digest.isEmpty())consumed.add(digest);
                if(!consumed.add(NotificationRules.digest(id)))return "null";
                while(consumed.size()>128)consumed.remove(consumed.iterator().next());
                StringBuilder encoded=new StringBuilder();for(String digest:consumed){if(encoded.length()>0)encoded.append(',');encoded.append(digest);}
                if(!p.edit().putString("consumedDeliveries",encoded.toString()).commit())return "null";
                return new JSONObject().put("accountId",p.getString("account","")).put("workspaceId",p.getString("workspace",""))
                        .put("workspaceSlug",p.getString("slug","")).put("deliveryId",id).toString();
            }catch(JSONException invalid){return "null";}}
    }
    static void message(Context c,String id) {
        if(!PushRules.deliveryId(id)||!NativeNotifications.enabled(c)||!ready(c)||!"granted".equals(NativeNotifications.permission(c)))return;
        // This is for provider data messages only; notification messages are rendered by the provider/OEM.
        int notificationId=0x60000000|(id.hashCode()&0x0fffffff);
        Intent intent=new Intent(c,MainActivity.class).setAction(CLICK_ACTION).putExtra(DELIVERY_KEY,id)
                .setData(android.net.Uri.parse("ziwei-manager://push?deliveryId="+id))
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending=PendingIntent.getActivity(c,notificationId,intent,PendingIntent.FLAG_CANCEL_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification notification=new Notification.Builder(c,NativeNotifications.CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("紫薇").setContentText("有新的员工消息或任务提醒，打开查看")
                .setVisibility(Notification.VISIBILITY_PRIVATE).setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true).build();
        NotificationManager manager=c.getSystemService(NotificationManager.class);if(manager!=null)manager.notify("ziwei-push-"+id,0,notification);
    }
}
