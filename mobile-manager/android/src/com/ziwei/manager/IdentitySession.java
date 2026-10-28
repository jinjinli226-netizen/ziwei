package com.ziwei.manager;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.ref.WeakReference;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

/** Native-only tokens, fixed public OIDC client, single-flight refresh and account/logout fencing. */
final class IdentitySession {
    static final ExecutorService NETWORK=Executors.newFixedThreadPool(4);
    private static IdentitySession instance;
    private final Context context;
    private final IdentityStore store;
    private final Object lock=new Object();
    private final IdentityFence fence=new IdentityFence();
    private String refresh="",access="",subject="",nonce="",message="";
    private long expires;
    private OidcRules.Pending pending;
    private long pendingEpoch;
    private WeakReference<IdentityBridge> listener=new WeakReference<>(null);
    static synchronized IdentitySession get(Context context){if(instance==null)instance=new IdentitySession(context.getApplicationContext());return instance;}
    private IdentitySession(Context context){
        this.context=context;store=new IdentityStore(context);
        if(!OidcRules.CONFIGURED){message="统一登录候选尚未完成客户端登记和服务端验收";return;}
        try{String saved=store.read();if(saved!=null){Map<String,Object> data=OidcRules.object(saved);refresh=OidcRules.string(data,"refresh");subject=OidcRules.string(data,"subject");nonce=OidcRules.string(data,"nonce");String handle=OidcRules.string(data,"handle");if(refresh.isEmpty()||refresh.length()>65536||!handle.matches("[A-Za-z0-9_-]{43}"))throw OidcRules.invalid();fence.restore(fence.epoch(),subject,handle);}}
        catch(Exception invalid){store.clear();refresh="";subject="";nonce="";fence.invalidate();message="本机登录无法恢复，请重新登录";}
    }
    void listen(IdentityBridge bridge){synchronized(lock){listener=new WeakReference<>(bridge);}}
    void detach(IdentityBridge bridge){synchronized(lock){if(listener.get()==bridge)listener.clear();}}
    String status(){synchronized(lock){try{return new JSONObject().put("available",true).put("mode","oidc").put("configured",OidcRules.CONFIGURED).put("authenticated",!refresh.isEmpty()).put("message",message).toString();}catch(Exception ignored){return "{\"available\":false,\"mode\":\"oidc\",\"configured\":false,\"authenticated\":false}";}}}
    private void changed(){IdentityBridge bridge;synchronized(lock){bridge=listener.get();}if(bridge!=null)bridge.emit();}
    long epoch(){return fence.epoch();}
    boolean current(long epoch){return fence.current(epoch);}
    String handle(){return fence.handle();}
    boolean sameHandle(String value){return value!=null&&!value.isEmpty()&&value.equals(fence.handle());}
    private void clearLocked(String reason){fence.invalidate();pending=null;refresh="";access="";subject="";nonce="";expires=0;message=reason;store.clear();lock.notifyAll();}
    void invalidate(long before,String reason){boolean cleared=false;synchronized(lock){if(fence.current(before)){clearLocked(reason);cleared=true;}}if(cleared){NativeNotifications.clear(context);changed();}}
    void login(Activity activity){
        if(!OidcRules.CONFIGURED){changed();return;}
        final OidcRules.Pending flow;
        synchronized(lock){clearLocked("正在系统浏览器中登录");flow=new OidcRules.Pending(SystemClock.elapsedRealtime());pending=flow;pendingEpoch=fence.epoch();}
        NativeNotifications.clear(context);changed();
        String url=OidcRules.ISSUER+"/protocol/openid-connect/auth?response_type=code&client_id="+encode(OidcRules.CLIENT)+"&redirect_uri="+encode(OidcRules.CALLBACK)+"&scope="+encode(OidcRules.SCOPE)+"&code_challenge_method=S256&code_challenge="+encode(OidcRules.challenge(flow.verifier))+"&state="+flow.state+"&nonce="+flow.nonce;
        try{activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE));}
        catch(RuntimeException unavailable){synchronized(lock){if(pending==flow){pending=null;message="未找到可用的系统浏览器";}}changed();}
    }
    void callback(Intent intent){
        if(intent==null||!Intent.ACTION_VIEW.equals(intent.getAction())||intent.getData()==null)return;
        String uri=intent.getData().toString();intent.setData(null);
        final OidcRules.Pending flow;final long before;final String code;
        synchronized(lock){flow=pending;before=pendingEpoch;if(flow==null||!fence.current(before))return;try{code=flow.consume(uri,SystemClock.elapsedRealtime());}catch(IllegalArgumentException invalid){message="登录回调已失效或未通过验证";changed();return;}pending=null;}
        NETWORK.execute(()->{try{Map<String,Object> tokens=token("grant_type=authorization_code&client_id="+encode(OidcRules.CLIENT)+"&redirect_uri="+encode(OidcRules.CALLBACK)+"&code="+encode(code)+"&code_verifier="+encode(flow.verifier));install(tokens,flow.nonce,before,true);changed();}
            catch(Exception failure){if(failure instanceof IllegalArgumentException||failure instanceof InvalidGrant)invalidate(before,"登录验证或安全保存失败，请重新登录");else{synchronized(lock){if(fence.current(before))message="登录未完成，请检查网络或客户端登记后重试";}changed();}}});
    }
    void logout(){
        final String oldRefresh,oldAccess;
        synchronized(lock){oldRefresh=refresh;oldAccess=access;clearLocked("已退出此应用的统一登录");}
        NativeNotifications.clear(context);changed();
        // Revoke snapshots only after local invalidation; no IDP global logout or browser-cookie sharing.
        NETWORK.execute(()->{for(String token:new String[]{oldRefresh,oldAccess})if(!token.isEmpty())try{http(OidcRules.ISSUER+"/protocol/openid-connect/revoke","POST",Collections.singletonMap("Content-Type","application/x-www-form-urlencoded"),("client_id="+encode(OidcRules.CLIENT)+"&token="+encode(token)).getBytes(StandardCharsets.UTF_8),10000,262144,null);}catch(Exception ignored){}});
    }
    private Map<String,Object> token(String body)throws Exception{
        Response response=http(OidcRules.ISSUER+"/protocol/openid-connect/token","POST",Collections.singletonMap("Content-Type","application/x-www-form-urlencoded"),body.getBytes(StandardCharsets.UTF_8),15000,262144,null);
        Map<String,Object> data;
        try{data=OidcRules.object(response.text());}catch(IllegalArgumentException invalid){if(response.status==200)throw new InvalidGrant();throw new IOException("Identity unavailable");}
        if(response.status!=200){if("invalid_grant".equals(data.get("error")))throw new InvalidGrant();throw new IOException("Identity unavailable");}
        return data;
    }
    private void install(Map<String,Object> tokens,String expectedNonce,long before,boolean initial)throws Exception{
        if(!"Bearer".equalsIgnoreCase(OidcRules.string(tokens,"token_type")))throw OidcRules.invalid();
        String nextAccess=OidcRules.string(tokens,"access_token"),nextRefresh=OidcRules.string(tokens,"refresh_token");
        if(nextRefresh.isEmpty()||nextRefresh.length()>65536)throw OidcRules.invalid();
        Response keys=http(OidcRules.ISSUER+"/protocol/openid-connect/certs","GET",Collections.emptyMap(),null,15000,262144,null);if(keys.status!=200)throw new IOException("Identity keys unavailable");
        long now=System.currentTimeMillis()/1000;OidcRules.Claims claims=OidcRules.verify(nextAccess,keys.text(),false,null,now);
        if(initial||tokens.containsKey("id_token")){OidcRules.Claims id=OidcRules.verify(OidcRules.string(tokens,"id_token"),keys.text(),true,expectedNonce,now,!initial);if(!id.subject.equals(claims.subject))throw OidcRules.invalid();}
        synchronized(lock){
            if(!fence.current(before))throw new IOException("Identity changed");
            if(!subject.isEmpty()&&!subject.equals(claims.subject))throw OidcRules.invalid();
            if(!fence.install(before,claims.subject))throw OidcRules.invalid();
            try{store.write(new JSONObject().put("refresh",nextRefresh).put("subject",claims.subject).put("nonce",expectedNonce).put("handle",fence.handle()).toString());}
            catch(Exception failure){throw new InvalidGrant();}
            refresh=nextRefresh;access=nextAccess;subject=claims.subject;nonce=expectedNonce;expires=claims.expires;message="";
        }
    }
    private String bearer(long before)throws Exception{
        String oldRefresh,oldNonce;
        for(;;){synchronized(lock){
            if(!fence.current(before)||refresh.isEmpty()||!OidcRules.CONFIGURED)throw new InvalidGrant();
            if(!access.isEmpty()&&expires>System.currentTimeMillis()/1000+30)return access;
            if(fence.refreshing()){lock.wait(20000);continue;}
            if(!fence.beginRefresh(before))continue;oldRefresh=refresh;oldNonce=nonce;break;
        }}
        boolean accepted=false;
        try{Map<String,Object> tokens=token("grant_type=refresh_token&client_id="+encode(OidcRules.CLIENT)+"&refresh_token="+encode(oldRefresh));accepted=true;install(tokens,oldNonce,before,false);synchronized(lock){if(!fence.current(before))throw new InvalidGrant();return access;}}
        catch(InvalidGrant revoked){invalidate(before,"登录已失效，请重新登录");throw revoked;}
        catch(IllegalArgumentException rejected){invalidate(before,"登录验证失败，请重新登录");throw new InvalidGrant();}
        catch(Exception failure){if(accepted){invalidate(before,"刷新凭据未能完成安全验证，请重新登录");throw new InvalidGrant();}throw failure;}
        finally{synchronized(lock){fence.finishRefresh(before);lock.notifyAll();}}
    }
    Response request(String path,String method,Map<String,String> headers,byte[] body,long before)throws Exception{
        return request(path,method,headers,body,before,null);
    }
    Response request(String path,String method,Map<String,String> headers,byte[] body,long before,IdentityRead read)throws Exception{
        if(read!=null)read.check();
        OidcRules.apiPath(path);if(!method.matches("GET|HEAD|POST|PUT|PATCH|DELETE")||body!=null&&body.length>16*1024*1024)throw OidcRules.invalid();
        if((method.equals("GET")||method.equals("HEAD"))&&body!=null&&body.length>0)throw OidcRules.invalid();
        Map<String,String> outgoing=new HashMap<>();
        for(Map.Entry<String,String> entry:headers.entrySet()){
            String key=entry.getKey().toLowerCase(java.util.Locale.ROOT),value=entry.getValue();
            if(!key.matches("accept|content-type|if-none-match|if-modified-since")||value.length()>2048||value.indexOf('\r')>=0||value.indexOf('\n')>=0)throw OidcRules.invalid();
            if(key.equals("content-type")&&!value.equalsIgnoreCase("application/json"))throw OidcRules.invalid();outgoing.put(key,value);
        }
        outgoing.put("Authorization","Bearer "+bearer(before));
        if(read!=null)read.check();
        if(body!=null)outgoing.put("Content-Type","application/json");
        // Check again after waiting for refresh. http also checks immediately before opening the request body.
        if(!fence.current(before))throw new InvalidGrant();
        Response response=http(OidcRules.API+path,method,outgoing,body,method.equals("GET")?60000:120000,32*1024*1024,before,read);
        if(!fence.current(before))throw new InvalidGrant();
        if(response.status==401)invalidate(before,"登录已失效，请重新登录");
        return response; // A dispatched mutation is never retried, including after 401.
    }
    String notificationBearer(String handle)throws Exception{long before=fence.epoch();if(!sameHandle(handle))throw new InvalidGrant();String result=bearer(before);if(!sameHandle(handle)||!fence.current(before))throw new InvalidGrant();return result;}
    void unauthorizedHandle(String handle){if(sameHandle(handle))invalidate(fence.epoch(),"登录已失效，请重新登录");}
    static final class Response{
        final int status;final Map<String,String> headers;final byte[] body;
        Response(int status,Map<String,String> headers,byte[] body){this.status=status;this.headers=headers;this.body=body;}
        String text(){return new String(body,StandardCharsets.UTF_8);}
    }
    private Response http(String address,String method,Map<String,String> headers,byte[] body,int timeout,int limit,Long before)throws Exception{
        return http(address,method,headers,body,timeout,limit,before,null);
    }
    private Response http(String address,String method,Map<String,String> headers,byte[] body,int timeout,int limit,Long before,IdentityRead read)throws Exception{
        // Callers supply only fixed issuer endpoints or an already validated API path.
        HttpsURLConnection connection=(HttpsURLConnection)new URL(address).openConnection();
        try{
            if(read!=null&&!read.attach(connection))throw new IOException("Native read cancelled");
            connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setConnectTimeout(Math.min(timeout,15000));connection.setReadTimeout(timeout);connection.setRequestMethod(method);
            connection.setRequestProperty("Accept","application/json");connection.setRequestProperty("Accept-Encoding","identity");
            for(Map.Entry<String,String> header:headers.entrySet())connection.setRequestProperty(header.getKey(),header.getValue());
            if(before!=null&&!fence.current(before))throw new InvalidGrant();
            if(read!=null)read.check();
            if(body!=null&&body.length>0&&!method.equals("GET")&&!method.equals("HEAD")){connection.setDoOutput(true);connection.setFixedLengthStreamingMode(body.length);try(java.io.OutputStream output=connection.getOutputStream()){output.write(body);}}
            int status=connection.getResponseCode();if(read!=null)read.check();if(status>=300&&status<400&&status!=304)throw new IOException("Redirect rejected");
            if(connection.getContentLengthLong()>limit)throw new IOException("Response too large");
            Map<String,String> safe=new HashMap<>();for(String name:new String[]{"Content-Type","ETag","Cache-Control"}){String value=connection.getHeaderField(name);if(value!=null)safe.put(name.toLowerCase(java.util.Locale.ROOT),value);}
            InputStream stream=status>=400?connection.getErrorStream():connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            if(stream!=null)try(InputStream input=stream){byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1){if(read!=null)read.check();if(bytes.size()+count>limit)throw new IOException("Response too large");if(before!=null&&!fence.current(before))throw new InvalidGrant();bytes.write(buffer,0,count);}}
            return new Response(status,safe,bytes.toByteArray());
        }finally{if(read!=null)read.detach(connection);connection.disconnect();}
    }
    private static String encode(String value){try{return URLEncoder.encode(value,"UTF-8");}catch(Exception impossible){throw OidcRules.invalid();}}
    static final class InvalidGrant extends IOException{InvalidGrant(){super("Native identity required");}}
}
