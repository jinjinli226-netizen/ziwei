package com.ziwei.manager;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;

/** Fake connections only; validates ownership, queued cancellation and read-only disconnection. */
public final class IdentityReadTest {
    private static int checks;
    static void yes(boolean value){checks++;if(!value)throw new AssertionError("Expected true");}
    static final class Connection extends HttpURLConnection {
        boolean disconnected;
        Connection()throws Exception{super(new URL("https://fixture.invalid"));}
        @Override public void disconnect(){disconnected=true;}
        @Override public boolean usingProxy(){return false;}
        @Override public void connect(){throw new AssertionError("Offline fixture must not connect");}
    }
    public static void main(String[] args)throws Exception{
        IdentityRead read=new IdentityRead(2,3,"GET");Connection connection=new Connection();yes(read.attach(connection));
        yes(!read.cancel(1,3)&&!connection.disconnected);yes(!read.cancel(2,4)&&!connection.disconnected);
        yes(read.cancel(2,3)&&connection.disconnected);
        try{read.check();throw new AssertionError("Cancelled read accepted");}catch(IOException expected){checks++;}
        IdentityRead queued=new IdentityRead(2,3,"HEAD");yes(queued.cancel(2,3));Connection never=new Connection();yes(!queued.attach(never)&&never.disconnected);
        IdentityRead mutation=new IdentityRead(2,3,"POST");Connection write=new Connection();yes(mutation.attach(write));yes(!mutation.cancel(2,3)&&!write.disconnected);mutation.check();checks++;
        IdentityRead finished=new IdentityRead(2,3,"GET");Connection done=new Connection();yes(finished.attach(done));finished.detach(done);yes(finished.cancel(2,3)&&!done.disconnected);
        System.out.println("Native read cancellation passed: "+checks+" checks");
    }
}
