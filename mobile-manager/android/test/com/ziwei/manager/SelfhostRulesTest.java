package com.ziwei.manager;
public final class SelfhostRulesTest {
    private static int checks;
    private static void check(boolean value){checks++;if(!value)throw new AssertionError("Selfhost check "+checks);}
    public static void main(String[] args) throws Exception {
        check(SelfhostRules.preview("员工回复\nhttps://example.com/a?x=1\t完成",1024));
        check(SelfhostRules.preview(new String(new char[1024]).replace('\0','a'),1024));
        check(!SelfhostRules.preview(new String(new char[1025]).replace('\0','a'),1024));
        check(!SelfhostRules.preview("a\u0000b",1024));check(!SelfhostRules.preview("\ud800",1024));
        check(!SelfhostRules.preview("中文",5));check(SelfhostRules.preview("中文",6));
        check(SelfhostRules.suppress(true,"chat-one","conversation","chat-one"));
        check(!SelfhostRules.suppress(false,"chat-one","conversation","chat-one"));
        check(!SelfhostRules.suppress(true,"","conversation","chat-one"));
        check(!SelfhostRules.suppress(true,"chat-two","conversation","chat-one"));
        check(!SelfhostRules.suppress(true,"chat-one","task","chat-one"));
        long previous=0;for(int i=0;i<100;i++){long delay=SelfhostRules.backoff(i);check(delay>=previous&&delay<=60_000&&delay>=1_000);previous=delay;}
        check(SelfhostRules.backoff(-1)==1000);check(SelfhostRules.backoff(Integer.MAX_VALUE)==60_000);
        ReceiveLease<Object> lease=new ReceiveLease<>();Object oldWork=new Object(),newWork=new Object();
        ReceiveLease.Start<Object> oldRun=lease.restart();check(lease.attach(oldRun.generation,oldWork));
        ReceiveLease.Start<Object> newRun=lease.restart();check(newRun.previous==oldWork);check(lease.attach(newRun.generation,newWork));
        lease.finish(oldRun.generation,oldWork);check(lease.active()==newWork);check(!lease.current(oldRun.generation));
        check(!lease.attach(oldRun.generation,oldWork));check(lease.active()==newWork);
        ReceiveLease.Start<Object> stopped=lease.restart();check(stopped.previous==newWork);check(lease.active()==null);
        lease.finish(newRun.generation,newWork);check(lease.active()==null);check(!lease.current(newRun.generation));
        Object resumedWork=new Object();check(lease.attach(stopped.generation,resumedWork));lease.finish(newRun.generation,newWork);check(lease.active()==resumedWork);
        lease.finish(stopped.generation,resumedWork);check(lease.active()==null);
        check(SelfhostRules.itemGone(404,"MOBILE_NOTIFICATION_NOT_FOUND"));check(!SelfhostRules.itemGone(404,null));
        check(!SelfhostRules.itemGone(404,"MOBILE_NOTIFICATION_WORKSPACE_NOT_FOUND"));check(!SelfhostRules.itemGone(401,"MOBILE_NOTIFICATION_NOT_FOUND"));
        // Recovery arrives after the old failure comparison but before the actual pause.
        ReceiveWake wake=new ReceiveWake();long before=wake.epoch();wake.networkChanged();long clock=System.nanoTime();
        wake.pause(60_000,before,()->true);check((System.nanoTime()-clock)/1_000_000<1000);
        // Recovery while already sleeping uses the same monitor and wakes the actual production class.
        long current=wake.epoch();Thread waiter=new Thread(()->{try{wake.pause(60_000,current,()->true);}catch(InterruptedException failure){throw new AssertionError(failure);}});
        waiter.start();try{long deadline=System.nanoTime()+1_000_000_000L;while(waiter.getState()!=Thread.State.TIMED_WAITING&&System.nanoTime()<deadline)Thread.yield();
            check(waiter.getState()==Thread.State.TIMED_WAITING);wake.networkChanged();waiter.join(1000);check(!waiter.isAlive());
        }finally{if(waiter.isAlive()){waiter.interrupt();waiter.join(1000);}}
        // A slow page exceeds the 45s budget. Persisted resolved/404 prefixes skip fresh work on retry.
        for(int unavailablePrefix:new int[]{0,12}){
            String processed="";int displays=0,skipped404=0;boolean committed=false;
            for(int round=0;round<3&&!committed;round++){
                int elapsed=2000;boolean completed=true;
                for(int i=0;i<30;i++){
                    String id="slow-"+i;if(SelfhostRules.processed(processed,id))continue;
                    if(elapsed+2000>=45_000){completed=false;break;}elapsed+=2000;
                    if(i<unavailablePrefix)skipped404++;else displays++;
                    if(!processed.isEmpty())processed+=",";processed+=NotificationRules.digest(id);
                }
                committed=completed;
            }
            check(committed);check(displays==30-unavailablePrefix);check(skipped404==unavailablePrefix);
        }
        System.out.println(checks+" self-hosted preview, foreground suppression and capped retry checks passed");
    }
}
