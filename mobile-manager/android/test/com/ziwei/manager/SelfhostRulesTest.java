package com.ziwei.manager;
public final class SelfhostRulesTest {
    private static int checks;
    private static void check(boolean value){checks++;if(!value)throw new AssertionError("Selfhost check "+checks);}
    public static void main(String[] args){
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
        System.out.println(checks+" self-hosted preview, foreground suppression and capped retry checks passed");
    }
}
