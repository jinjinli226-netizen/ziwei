package com.ziwei.manager;

/** Serial ownership shared by restart, completion, network change and stop. No Android dependency. */
final class ReceiveLease<T> {
    static final class Start<T> { final long generation;final T previous;Start(long generation,T previous){this.generation=generation;this.previous=previous;} }
    private long generation;
    private T work;
    synchronized Start<T> restart(){T previous=work;work=null;generation++;return new Start<>(generation,previous);}
    synchronized boolean current(long token){return token==generation;}
    synchronized boolean attach(long token,T value){if(!current(token))return false;work=value;return true;}
    synchronized void finish(long token,T value){if(current(token)&&work==value)work=null;}
    synchronized T active(){return work;}
}
