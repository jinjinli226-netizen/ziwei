package com.ziwei.manager;

import java.util.Arrays;
import java.util.HashSet;

/** No Android runtime, account, network or listener. */
public final class NotificationRulesTest {
    private static int checks;
    public static void main(String[] args) {
        yes(NotificationRules.workspaceSlug("test-111"));
        for (String bad : new String[]{null,"","../account","user%2Fsecret","x?baseline=1","x#y","x/y","汉字","x\n"}) no(NotificationRules.workspaceSlug(bad));
        yes(NotificationRules.identifier("action:device-command-a1_3.4"));
        yes(NotificationRules.identifier(repeat("x",160)));
        no(NotificationRules.identifier(repeat("x",161)));
        for (String bad : new String[]{null,"","https://evil.test","../x","id?x=1","x\r\nCookie: secret"}) no(NotificationRules.identifier(bad));
        yes(NotificationRules.cursor("v1.opaque-base64:0"));
        no(NotificationRules.cursor(""));
        no(NotificationRules.cursor("x\n"));
        no(NotificationRules.cursor(repeat("字", 1400)));
        yes(NotificationRules.plainText(repeat("字", 120), 120));
        no(NotificationRules.plainText(repeat("字", 121), 120));
        yes(NotificationRules.plainText(repeat("😀", 120), 120));
        no(NotificationRules.plainText(repeat("😀", 121), 120));
        yes(NotificationRules.plainTextUtf8(repeat("字", 40), 120));
        no(NotificationRules.plainTextUtf8(repeat("字", 41), 120));
        yes(NotificationRules.plainTextUtf8(repeat("😀", 30), 120));
        no(NotificationRules.plainTextUtf8(repeat("😀", 31), 120));
        no(NotificationRules.plainText("unsafe\u0000", 120));
        no(NotificationRules.plainText("unsafe\uD800", 120));
        no(NotificationRules.plainText("unsafe\u2028", 120));
        for (String kind : new String[]{"conversation","task","group"}) yes(NotificationRules.target(kind,"id",null,null,null,keys("kind","id")));
        no(NotificationRules.target("url","id",null,null,null,keys("kind","id")));
        no(NotificationRules.target("conversation","id",null,null,null,keys("kind","id","url")));
        no(NotificationRules.target("conversation","id","https://evil.test",null,null,keys("kind","id","employeeId")));
        yes(NotificationRules.target("task","id","bot-1","message-1","action-1",keys("kind","id","employeeId","messageId","actionId")));
        yes(NotificationRules.sameReceipt(3,3,"session=fake","session=fake"));
        no(NotificationRules.sameReceipt(3,4,"session=fake","session=fake"));
        no(NotificationRules.sameReceipt(3,3,"session=fake","session=other"));
        no(NotificationRules.sameReceipt(3,3,"",""));
        no(NotificationRules.sameReceipt(3,3,null,null));
        yes(NotificationRules.unexpired(100,100));
        yes(NotificationRules.unexpired(100,100 + NotificationRules.TARGET_TTL_MILLIS));
        no(NotificationRules.unexpired(100,101 + NotificationRules.TARGET_TTL_MILLIS));
        no(NotificationRules.unexpired(100,99));
        no(NotificationRules.unexpired(0,100));
        same("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",NotificationRules.digest("abc"));
        System.out.println("Notification rules passed: " + checks + " checks");
    }
    private static HashSet<String> keys(String... keys) { return new HashSet<>(Arrays.asList(keys)); }
    private static String repeat(String value, int count) { StringBuilder output = new StringBuilder(); for(int i=0;i<count;i++) output.append(value); return output.toString(); }
    private static void yes(boolean value) { checks++; if (!value) throw new AssertionError("Expected true"); }
    private static void no(boolean value) { checks++; if (value) throw new AssertionError("Expected false"); }
    private static void same(String expected,String actual) { checks++; if (!expected.equals(actual)) throw new AssertionError("Mismatch"); }
}
