package com.ziwei.manager;

import java.nio.charset.StandardCharsets;

/** Pure receive policy: bounded real previews, exact visible chat, finite network retry backoff. */
final class SelfhostRules {
    private SelfhostRules() { }
    static boolean preview(String value,int limit){
        if(value==null||value.getBytes(StandardCharsets.UTF_8).length>limit)return false;
        for(int i=0;i<value.length();){int c=value.codePointAt(i);if((Character.isISOControl(c)&&c!='\n'&&c!='\r'&&c!='\t')||(c>=0xD800&&c<=0xDFFF))return false;i+=Character.charCount(c);}return true;
    }
    static boolean suppress(boolean foreground,String visible,String kind,String target){return foreground&&visible!=null&&!visible.isEmpty()&&visible.equals(target)&&"conversation".equals(kind);}
    static boolean itemGone(int status,String code){return status==404&&"MOBILE_NOTIFICATION_NOT_FOUND".equals(code);}
    static boolean processed(String encoded,String id){return encoded!=null&&id!=null&&(","+encoded+",").contains(","+NotificationRules.digest(id)+",");}
    static long backoff(int failures){return Math.min(60_000L,1_000L<<Math.min(6,Math.max(0,failures)));}
}
