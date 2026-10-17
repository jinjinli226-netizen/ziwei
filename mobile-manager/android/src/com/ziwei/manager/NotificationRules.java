package com.ziwei.manager;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Set;

/** Pure Java limits shared by transport, private target storage and JVM boundary tests. */
final class NotificationRules {
    static final int MAX_BODY_BYTES = 64 * 1024;
    static final int MAX_ITEMS = 50;
    static final int MAX_CURSOR_BYTES = 4096;
    static final long INTERVAL_MILLIS = 15 * 60 * 1000L;
    static final long TARGET_TTL_MILLIS = 24 * 60 * 60 * 1000L;
    private NotificationRules() { }

    static boolean workspaceSlug(String value) {
        return value != null && value.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,79}");
    }
    static boolean identifier(String value) {
        return value != null && value.matches("[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}");
    }
    static boolean cursor(String value) {
        return value != null && value.length() > 0 && value.getBytes(StandardCharsets.UTF_8).length <= MAX_CURSOR_BYTES
                && plainText(value, MAX_CURSOR_BYTES);
    }
    static boolean plainText(String value, int maxCodePoints) {
        if (value == null || value.codePointCount(0, value.length()) > maxCodePoints) return false;
        for (int index = 0; index < value.length();) {
            int point = value.codePointAt(index);
            if (Character.isISOControl(point) || point >= 0xD800 && point <= 0xDFFF
                    || point == 0x2028 || point == 0x2029) return false;
            index += Character.charCount(point);
        }
        return true;
    }
    static boolean plainTextUtf8(String value, int maxBytes) {
        return plainText(value, maxBytes) && value.getBytes(StandardCharsets.UTF_8).length <= maxBytes;
    }
    static boolean target(String kind, String id, String employeeId, String messageId, String actionId, Set<String> keys) {
        if (!("conversation".equals(kind) || "task".equals(kind) || "group".equals(kind)) || !identifier(id)) return false;
        if (employeeId != null && !identifier(employeeId) || messageId != null && !identifier(messageId)
                || actionId != null && !identifier(actionId)) return false;
        for (String key : keys) {
            if (!("kind".equals(key) || "id".equals(key) || "employeeId".equals(key)
                    || "messageId".equals(key) || "actionId".equals(key))) return false;
        }
        return true;
    }
    static boolean sameReceipt(long expectedGeneration, long actualGeneration, String beforeCookie, String afterCookie) {
        return expectedGeneration == actualGeneration && beforeCookie != null && beforeCookie.length() > 0
                && beforeCookie.equals(afterCookie);
    }
    static boolean unexpired(long createdAt, long now) {
        return createdAt > 0 && now >= createdAt && now - createdAt <= TARGET_TTL_MILLIS;
    }
    static String digest(String value) {
        try {
            byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte item : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", item & 255));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) { throw new AssertionError(impossible); }
    }
}
