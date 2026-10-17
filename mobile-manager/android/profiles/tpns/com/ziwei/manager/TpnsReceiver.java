package com.ziwei.manager;

import android.content.Context;
import android.content.Intent;
import com.tencent.android.tpush.XGPushBaseReceiver;
import com.tencent.android.tpush.XGPushClickedResult;
import com.tencent.android.tpush.XGPushRegisterResult;
import com.tencent.android.tpush.XGPushShowedResult;
import com.tencent.android.tpush.XGPushTextMessage;

/** Provider callbacks accept only a bounded opaque delivery ID. Never log provider objects. */
public final class TpnsReceiver extends XGPushBaseReceiver {
    public void onRegisterResult(Context c,int code,XGPushRegisterResult result) { if(code==0&&result!=null)NativePush.rotated(c,result.getToken()); }
    public void onUnregisterResult(Context c,int code) { }
    public void onSetTagResult(Context c,int code,String value) { }
    public void onDeleteTagResult(Context c,int code,String value) { }
    public void onSetAccountResult(Context c,int code,String value) { }
    public void onDeleteAccountResult(Context c,int code,String value) { }
    public void onSetAttributeResult(Context c,int code,String value) { }
    public void onQueryTagsResult(Context c,int code,String request,String value) { }
    public void onDeleteAttributeResult(Context c,int code,String value) { }
    public void onTextMessage(Context c,XGPushTextMessage message) {
        if(message!=null)NativePush.message(c,NativePush.payloadDelivery(message.getCustomContent()));
    }
    public void onNotificationClickedResult(Context c,XGPushClickedResult result) {
        if(result==null || result.getActionType()!=XGPushClickedResult.NOTIFACTION_CLICKED_TYPE)return;
        String id=NativePush.payloadDelivery(result.getCustomContent());if(!PushRules.deliveryId(id))return;
        // This explicit in-app intent never opens a provider supplied Activity/URL.
        Intent intent=new Intent(c,MainActivity.class).setAction(NativePush.CLICK_ACTION).putExtra(NativePush.DELIVERY_KEY,id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
        try{c.startActivity(intent);}catch(RuntimeException unavailable){ }
    }
    public void onNotificationShowedResult(Context c,XGPushShowedResult result) { }
}
