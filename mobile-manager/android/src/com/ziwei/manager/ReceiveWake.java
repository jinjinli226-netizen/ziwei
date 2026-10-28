package com.ziwei.manager;

import java.util.function.BooleanSupplier;

/** Network epoch check and wait share one monitor, so recovery immediately before waiting is not lost. */
final class ReceiveWake {
    private long epoch;
    synchronized long epoch(){return epoch;}
    synchronized void networkChanged(){epoch++;notifyAll();}
    synchronized void signal(){notifyAll();}
    synchronized void pause(long millis,long expectedEpoch,BooleanSupplier current) throws InterruptedException {
        if(!current.getAsBoolean()||expectedEpoch>=0&&expectedEpoch!=epoch)return;
        wait(millis);
    }
}
