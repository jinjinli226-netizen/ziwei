package com.ziwei.manager;

import android.content.Context;
import android.os.Build;
import android.util.Log;
import com.tencent.android.tpush.XGIOperateCallback;
import com.tencent.android.tpush.XGPushConfig;
import com.tencent.android.tpush.XGPushManager;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.huawei.agconnect.AGConnectInstance;
import java.util.Locale;

/** Direct links to official TPNS 1.4.4.12 and OEM/FCM adapters, initialized only after opt-in. */
final class TpnsPushSdk implements PushSdk {
    public boolean available() { return true; }
    private static boolean pair(String id,String key) { return !id.isEmpty()&&!key.isEmpty(); }
    public boolean deviceConfigured(Context context) {
        String brand=(Build.MANUFACTURER+" "+Build.BRAND).toLowerCase(Locale.ROOT);
        if(brand.contains("xiaomi")||brand.contains("redmi")||brand.contains("blackshark"))return pair(BuildConfig.MI_APP_ID,BuildConfig.MI_APP_KEY);
        if(brand.contains("huawei"))return BuildConfig.HUAWEI_CONFIGURED;
        if(brand.contains("honor"))return !BuildConfig.HONOR_APP_ID.isEmpty();
        if(brand.contains("vivo")||brand.contains("iqoo"))return pair(BuildConfig.VIVO_APP_ID,BuildConfig.VIVO_APP_KEY);
        if(brand.contains("oppo")||brand.contains("realme")||brand.contains("oneplus"))return pair(BuildConfig.OPPO_APP_KEY,BuildConfig.OPPO_APP_SECRET);
        if(brand.contains("meizu"))return pair(BuildConfig.MZ_APP_ID,BuildConfig.MZ_APP_KEY);
        return BuildConfig.FCM_CONFIGURED;
    }
    public boolean systemChannelRegistered(Context context) {
        try { return deviceConfigured(context) && PushRules.systemChannel(XGPushConfig.getOtherPushType(context),XGPushConfig.getOtherPushToken(context)); }
        catch(RuntimeException|LinkageError failure) { return false; }
    }
    public void register(Context context,String accessId,String accessKey,Callback callback) {
        try {
            if(!deviceConfigured(context)) { callback.failure();return; }
            // Never bind a business account/email to a third-party SDK. Server delivery uses the opaque device token.
            XGPushConfig.setAutoInit(false);
            XGPushConfig.enableDebug(context,false);
            new XGPushConfig.Build(context).setLogLevel(Log.ERROR);
            XGPushConfig.setLocationEnable(context,false);
            XGPushConfig.setReportApplistEnable(context,false);
            XGPushConfig.enablePullUpOtherApp(context,false);
            XGPushConfig.enableAutoStart(context,false);
            XGPushConfig.setPowerSaveMode(context,true);
            XGPushConfig.setNotificationChannelID(context,NativeNotifications.CHANNEL);
            XGPushConfig.setNotificationChannelName(context,"员工消息和任务提醒");
            if(pair(BuildConfig.MI_APP_ID,BuildConfig.MI_APP_KEY)) { XGPushConfig.setMiPushAppId(context,BuildConfig.MI_APP_ID);XGPushConfig.setMiPushAppKey(context,BuildConfig.MI_APP_KEY); }
            if(pair(BuildConfig.MZ_APP_ID,BuildConfig.MZ_APP_KEY)) { XGPushConfig.setMzPushAppId(context,BuildConfig.MZ_APP_ID);XGPushConfig.setMzPushAppKey(context,BuildConfig.MZ_APP_KEY); }
            if(pair(BuildConfig.OPPO_APP_KEY,BuildConfig.OPPO_APP_SECRET)) { XGPushConfig.setOppoPushAppId(context,BuildConfig.OPPO_APP_KEY);XGPushConfig.setOppoPushAppKey(context,BuildConfig.OPPO_APP_SECRET); }
            if(BuildConfig.HUAWEI_CONFIGURED)AGConnectInstance.initialize(context);
            if(BuildConfig.FCM_CONFIGURED) {
                if(FirebaseApp.initializeApp(context)==null) { callback.failure();return; }
                FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            }
            XGPushConfig.enableOtherPush(context,true);
            XGPushConfig.enableFcmPush(context,BuildConfig.FCM_CONFIGURED);
            XGPushConfig.setAccessId(context,Long.parseLong(accessId));XGPushConfig.setAccessKey(context,accessKey);
            XGPushManager.enableService(context,true);
            XGPushManager.registerPush(context,new XGIOperateCallback(){
                public void onSuccess(Object data,int flag) { callback.success(data instanceof String?(String)data:""); }
                public void onFail(Object data,int code,String message) { callback.failure(); }
            });
        } catch(RuntimeException|LinkageError failure) { callback.failure(); }
    }
    public void unregister(Context context,Runnable complete) {
        try {
            XGPushConfig.enableAutoStart(context,false);XGPushConfig.enablePullUpOtherApp(context,false);
            XGPushManager.unregisterPush(context,new XGIOperateCallback(){
                private void finish(){try{if(BuildConfig.FCM_CONFIGURED&&!FirebaseApp.getApps(context).isEmpty())FirebaseMessaging.getInstance().setAutoInitEnabled(false);}catch(RuntimeException|LinkageError ignored){}complete.run();}
                public void onSuccess(Object data,int flag){finish();}
                public void onFail(Object data,int code,String message){finish();}
            });
        } catch(RuntimeException|LinkageError failure) { complete.run(); }
        finally {
            // Persist local opt-out even if the remote unregister acknowledgement never arrives.
            try {
                XGPushConfig.setAutoInit(false);XGPushManager.enableService(context,false);
                if(BuildConfig.FCM_CONFIGURED&&!FirebaseApp.getApps(context).isEmpty())FirebaseMessaging.getInstance().setAutoInitEnabled(false);
            }
            catch(RuntimeException|LinkageError ignored) { /* The pre-provider process gate also remains closed. */ }
        }
    }
}
