package com.ziwei.manager;

public final class PushRulesTest {
    private static int checks;
    private static void check(boolean value) { checks++; if (!value) throw new AssertionError("Push safety check " + checks); }
    public static void main(String[] args) {
        String id = "abcdefghijklmnopqrstuvwxyz012345";
        check(PushRules.deliveryId(id));
        check(id.equals(PushRules.deliveryFromUri("ziwei-manager://push?deliveryId=" + id)));
        for (String bad : new String[]{
            "https://push?deliveryId="+id, "ziwei-manager://push/?deliveryId="+id,
            "ziwei-manager://push:443?deliveryId="+id, "ziwei-manager://user@push?deliveryId="+id,
            "ziwei-manager://push.evil?deliveryId="+id, "ZIWEI-MANAGER://push?deliveryId="+id,
            "ziwei-manager://push?deliveryId="+id+"#", "ziwei-manager://push?deliveryId="+id+"&url=https://evil",
            "ziwei-manager://push?deliveryId="+id+"&deliveryId="+id, "ziwei-manager://push?deliveryId=%41"+id.substring(1),
            "ziwei-manager://push?deliveryId="+id.substring(1), "ziwei-manager://push?deliveryId="+id+"x",
            "ziwei-manager://push?deliveryId="+id+"/../../api", "ziwei-manager://push?deliveryId="+id+"%0a",
            "ziwei-manager://push?target=conversation&deliveryId="+id, "intent://push?deliveryId="+id}) check(PushRules.deliveryFromUri(bad)==null);
        check(!PushRules.deliveryId(null)); check(!PushRules.deliveryId(""));
        check(PushRules.installationId("installation_synthetic_fixture_123"));
        check(!PushRules.installationId("short")); check(!PushRules.installationId("../other-installation"));
        check(PushRules.installationSecret("0123456789abcdefghijklmnopqrstuvwxyz_ABCDE-"));
        check(!PushRules.installationSecret("0123456789abcdefghijklmnopqrstuvwxyz_ABCDE-\n"));
        check(PushRules.token("0123456789abcdef0123456789abcdef01234567"));
        check(!PushRules.token("synthetic\r\nCookie: invalid")); check(!PushRules.token("x"));
        check(PushRules.accessId("1500012345")); check(!PushRules.accessId("0000000000"));
        check(PushRules.accessKey("Asynthetic123")); check(!PushRules.accessKey("A\nsynthetic123"));
        check(PushRules.current(4,4,"fixture_session=a","fixture_session=a"));
        check(!PushRules.current(4,5,"fixture_session=a","fixture_session=a"));
        check(!PushRules.current(4,4,"fixture_session=a","fixture_session=b"));
        check(!PushRules.current(4,4,"",""));
        check(!PushRules.systemChannel("tpns","synthetic-online-token"));
        check(!PushRules.systemChannel("huawei",null));
        check(!PushRules.systemChannel("fcm",""));
        check(!PushRules.systemChannel("fcm","0"));
        check(PushRules.systemChannel("huawei","synthetic-vendor-registration-token"));
        check(PushRules.systemChannel("fcm","synthetic:vendor_registration-token"));
        check(!PushRules.systemChannel("fcm","synthetic-token\r\nsecret"));
        System.out.println(checks + " push opaque URI, credential and stale receipt checks passed");
    }
}
