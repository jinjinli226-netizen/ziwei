package com.ziwei.manager;

import android.webkit.JavascriptInterface;
import java.lang.ref.WeakReference;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONObject;

/** A JSON fetch capability for the packaged document; credentials never cross this bridge. */
public final class IdentityBridge {
    private final WeakReference<MainActivity> activity;
    private final IdentitySession session;
    private final AtomicInteger active=new AtomicInteger();
    private final java.util.concurrent.ConcurrentHashMap<String,IdentityRead> reads=new java.util.concurrent.ConcurrentHashMap<>();
    IdentityBridge(MainActivity activity){this.activity=new WeakReference<>(activity);session=IdentitySession.get(activity);session.listen(this);}
    private MainActivity trusted(boolean foreground){MainActivity current=activity.get();return current!=null&&current.notificationDocumentTrusted()&&(!foreground||current.notificationForeground())?current:null;}
    @JavascriptInterface public String getStatus(){return trusted(false)==null?"{\"available\":false,\"mode\":\"oidc\",\"configured\":false,\"authenticated\":false}":session.status();}
    @JavascriptInterface public String login(){MainActivity current=trusted(true);if(current!=null)current.runOnUiThread(()->{if(trusted(true)==current)session.login(current);});return getStatus();}
    @JavascriptInterface public String logout(){if(trusted(false)!=null)session.logout();return getStatus();}
    @JavascriptInterface public void cancel(String id){MainActivity current=trusted(false);if(current==null||!OidcRules.requestId(id))return;IdentityRead read=reads.get(id);if(read!=null)read.cancel(session.epoch(),current.identityDocumentGeneration());}
    @JavascriptInterface public void request(String id,String path,String method,String headersJson,String body){
        MainActivity current=trusted(false);if(current==null||!OidcRules.requestId(id))return;
        final long before=session.epoch();
        final long document=current.identityDocumentGeneration();
        if(active.incrementAndGet()>32){active.decrementAndGet();respond(current,id,0,null,"","Too many pending requests",before,document);return;}
        final IdentityRead read="GET".equals(method)||"HEAD".equals(method)?new IdentityRead(before,document,method):null;
        if(read!=null&&reads.putIfAbsent(id,read)!=null){active.decrementAndGet();respond(current,id,0,null,"","Duplicate request id",before,document);return;}
        IdentitySession.NETWORK.execute(()->{
            try{
                if(read!=null)read.check();
                if(trusted(false)!=current||current.identityDocumentGeneration()!=document||!session.current(before))throw new IdentitySession.InvalidGrant();
                Map<String,Object> raw=OidcRules.object(headersJson);Map<String,String> headers=new HashMap<>();
                for(Map.Entry<String,Object> entry:raw.entrySet()){if(!(entry.getValue() instanceof String))throw OidcRules.invalid();headers.put(entry.getKey(),(String)entry.getValue());}
                IdentitySession.Response response=session.request(path,method,headers,OidcRules.body(method,body),before,read);
                String type=response.headers.get("content-type");
                if(response.status!=204&&response.status!=304&&(type==null||!type.toLowerCase(java.util.Locale.ROOT).split(";",2)[0].trim().equals("application/json")))throw OidcRules.invalid();
                if(!session.current(before)&&response.status!=401)throw new IdentitySession.InvalidGrant();
                respond(current,id,response.status,response.headers,response.text(),null,before,document);
            }catch(Exception failure){respond(current,id,failure instanceof IdentitySession.InvalidGrant?401:0,null,"",failure instanceof IdentitySession.InvalidGrant?"Native identity required":"Native request failed",before,document);}
            finally{if(read!=null)reads.remove(id,read);active.decrementAndGet();}
        });
    }
    private void respond(MainActivity current,String id,int status,Map<String,String> headers,String body,String error,long before,long document){
        try{JSONObject response=new JSONObject().put("id",id).put("status",status).put("headers",new JSONObject(headers==null?new HashMap<>():headers)).put("body",body);if(error!=null)response.put("error",error);
            String json=response.toString();current.runOnUiThread(()->{if(trusted(false)==current&&current.identityDocumentGeneration()==document&&session.current(before))current.emitIdentityEvent("ziwei:identity-response",json);});
        }catch(Exception ignored){ }
    }
    void emit(){MainActivity current=activity.get();if(current!=null)current.runOnUiThread(()->{for(IdentityRead read:reads.values())if(read.epoch!=session.epoch()||read.document!=current.identityDocumentGeneration())read.cancel(read.epoch,read.document);if(trusted(false)==current)current.emitIdentityEvent("ziwei:identity",session.status());});}
    void cancelReads(){for(IdentityRead read:reads.values())read.cancel(read.epoch,read.document);}
    void detach(){cancelReads();session.detach(this);}
}
