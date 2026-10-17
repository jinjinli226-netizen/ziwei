package com.ziwei.manager;

import java.net.URI;
import java.net.URISyntaxException;

/** Bounds for untrusted provider payloads. They never contain navigation targets or URLs. */
final class PushRules {
    static final int MAX_BODY_BYTES = 65_536;
    private PushRules() { }
    static boolean deliveryId(String value) { return value != null && value.matches("[A-Za-z0-9_-]{32}"); }
    static boolean installationId(String value) { return value != null && value.matches("[A-Za-z0-9_-]{16,128}"); }
    static boolean installationSecret(String value) { return value != null && value.matches("[A-Za-z0-9_-]{43}"); }
    static boolean token(String value) { return value != null && value.matches("[A-Za-z0-9_-]{16,128}"); }
    static boolean accessId(String value) { return value != null && value.matches("[1-9][0-9]{9}"); }
    static boolean accessKey(String value) { return value != null && value.matches("[A-Za-z0-9_-]{12,128}"); }
    static boolean systemChannel(String type, String vendorToken) {
        return type != null && type.matches("xiaomi|huawei|huaweiv5|honor|vivo|oppo|meizu|fcm")
                && vendorToken != null && vendorToken.matches("[\\x21-\\x7e]{8,8192}");
    }
    static String deliveryFromUri(String value) {
        if (value == null || value.length() > 160) return null;
        try {
            URI uri = new URI(value);
            if (!"ziwei-manager".equals(uri.getScheme()) || !"push".equals(uri.getRawAuthority())
                    || !"push".equals(uri.getHost()) || uri.getUserInfo() != null || uri.getPort() != -1
                    || uri.getRawFragment() != null || uri.getRawPath() == null || !uri.getRawPath().isEmpty()) return null;
            String query = uri.getRawQuery();
            if (query == null || !query.startsWith("deliveryId=")) return null;
            String id = query.substring("deliveryId=".length());
            return deliveryId(id) ? id : null;
        } catch (URISyntaxException invalid) { return null; }
    }
    static boolean current(long before, long after, String beforeCookie, String currentCookie) {
        return NotificationRules.sameReceipt(before, after, beforeCookie, currentCookie);
    }
}
