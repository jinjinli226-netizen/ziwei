package com.ziwei.manager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.os.Build;
import android.os.IBinder;

/** User-visible, opt-in self-hosted long polling. No third-party transport, wake lock or employee work. */
public final class NotificationConnectionService extends Service {
    static final String CHANNEL="ziwei_connection_v1";
    static final int NOTIFICATION_ID=0x5a5701;
    private static final String STOP="com.ziwei.manager.STOP_RECEIVING";
    private static final Object STATE_LOCK=new Object();
    private static volatile NotificationConnectionService instance;
    private static volatile String state="stopped";
    private final ReceiveWake wake=new ReceiveWake();
    private final ReceiveLease<NotificationFeed.Work> lease=new ReceiveLease<>();
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback callback;
    static boolean running(){return instance!=null&&!"stopped".equals(state);}
    static String connectionState(){return state;}
    static void start(Context c){
        if(!NativeNotifications.shouldReceive(c)||running())return;
        try{c.startForegroundService(new Intent(c,NotificationConnectionService.class));}
        catch(RuntimeException unavailable){synchronized(STATE_LOCK){if(instance==null)state="stopped";}NativeNotifications.changed();}
    }
    static void stop(Context c){NotificationConnectionService current=instance;if(current!=null)current.cancel();c.stopService(new Intent(c,NotificationConnectionService.class));}
    @Override public void onCreate(){
        super.onCreate();synchronized(STATE_LOCK){instance=this;state="connecting";}
        NotificationManager manager=getSystemService(NotificationManager.class);
        NotificationChannel channel=new NotificationChannel(CHANNEL,"持续接收连接",NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("直接连接自建紫薇服务器接收员工消息；可随时停止");channel.setSound(null,null);channel.enableVibration(false);channel.setShowBadge(false);manager.createNotificationChannel(channel);
        Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content=PendingIntent.getActivity(this,NOTIFICATION_ID,open,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,NOTIFICATION_ID,new Intent(this,NotificationConnectionService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification notification=new Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("紫薇持续接收已开启").setContentText("直接接收员工消息和任务提醒，系统省电限制可能使接收延后")
                .setContentIntent(content).setOngoing(true).setOnlyAlertOnce(true).setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(null,"停止接收",stop).build()).build();
        if(Build.VERSION.SDK_INT>=34)startForeground(NOTIFICATION_ID,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(NOTIFICATION_ID,notification);
        connectivity=getSystemService(ConnectivityManager.class);
        callback=new ConnectivityManager.NetworkCallback(){@Override public void onAvailable(Network n){networkChanged();}@Override public void onLost(Network n){networkChanged();}};
        try{connectivity.registerDefaultNetworkCallback(callback);}catch(RuntimeException unavailable){callback=null;}
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&STOP.equals(intent.getAction())){NativeNotifications.clear(this);stopSelf();return START_NOT_STICKY;}
        if(!NativeNotifications.shouldReceive(this)){stopSelf();return START_NOT_STICKY;}
        ReceiveLease.Start<NotificationFeed.Work> start=lease.restart();if(start.previous!=null)start.previous.cancel();
        final long token=start.generation;state(token,"connecting");
        Thread receiver=new Thread(()->receive(token),"ziwei-selfhost-receiver");receiver.setDaemon(true);receiver.start();
        NativeNotifications.changed();return START_STICKY;
    }
    private void receive(long token){
        int failures=0;boolean catchup=true;
        while(lease.current(token)&&NativeNotifications.shouldReceive(this)){
            if(!NativeNotifications.enabled(this)){pause(500,token);continue;}
            long networkBefore=wake.epoch();NotificationFeed.Work next=new NotificationFeed.Work();if(!lease.attach(token,next))break;
            boolean success;try{success=NativeNotifications.receive(this,next,!catchup);}finally{lease.finish(token,next);}
            if(!lease.current(token))break;
            if(success){failures=0;catchup=false;state(token,"connected");NativeNotifications.changed();pause(250,token);}
            else {catchup=true;state(token,"backoff");NativeNotifications.changed();if(networkBefore!=wake.epoch()){failures=0;continue;}pause(SelfhostRules.backoff(failures),token,networkBefore);failures=Math.min(6,failures+1);}
        }
        if(lease.current(token))stopSelf();
    }
    private void pause(long millis,long token){pause(millis,token,-1);}
    private void pause(long millis,long token,long expectedNetworkEpoch){try{wake.pause(millis,expectedNetworkEpoch,()->lease.current(token));}catch(InterruptedException stopped){Thread.currentThread().interrupt();}}
    private void networkChanged(){NotificationFeed.Work current=lease.active();wake.networkChanged();if(current!=null)current.cancel();}
    private void state(long token,String value){synchronized(STATE_LOCK){if(instance==this&&lease.current(token))state=value;}}
    private void cancel(){ReceiveLease.Start<NotificationFeed.Work> stopped=lease.restart();if(stopped.previous!=null)stopped.previous.cancel();synchronized(STATE_LOCK){if(instance==this)state="stopped";}wake.signal();}
    @Override public void onDestroy(){cancel();if(callback!=null)try{connectivity.unregisterNetworkCallback(callback);}catch(RuntimeException ignored){}synchronized(STATE_LOCK){if(instance==this){instance=null;state="stopped";}}stopForeground(STOP_FOREGROUND_REMOVE);NativeNotifications.changed();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
