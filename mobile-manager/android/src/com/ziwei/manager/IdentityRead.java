package com.ziwei.manager;

import java.io.IOException;
import java.net.HttpURLConnection;

/** Session/document owned read cancellation. A mutation never becomes cancellable. */
final class IdentityRead {
    final long epoch,document;
    private final boolean read;
    private boolean cancelled;
    private HttpURLConnection connection;
    IdentityRead(long epoch,long document,String method){this.epoch=epoch;this.document=document;read="GET".equals(method)||"HEAD".equals(method);}
    synchronized void check()throws IOException{if(cancelled)throw new IOException("Native read cancelled");}
    boolean attach(HttpURLConnection value){synchronized(this){if(!cancelled){connection=value;return true;}}value.disconnect();return false;}
    synchronized void detach(HttpURLConnection value){if(connection==value)connection=null;}
    boolean cancel(long currentEpoch,long currentDocument){
        HttpURLConnection active;
        synchronized(this){if(!read||epoch!=currentEpoch||document!=currentDocument)return false;cancelled=true;active=connection;connection=null;}
        if(active!=null)active.disconnect();return true;
    }
}
