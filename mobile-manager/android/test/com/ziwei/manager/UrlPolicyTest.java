package com.ziwei.manager;

/** Runs on the host JDK: trust and traversal boundaries do not need an Android listener. */
public final class UrlPolicyTest {
    private static int checks;
    public static void main(String[] args) {
        yes(UrlPolicy.isTrustedOrigin("https://qzelynth.top/api/auth/status"));
        yes(UrlPolicy.isAppDocument(UrlPolicy.START_URL + "#employees"));
        yes(UrlPolicy.isAppDocument("https://qzelynth.top/__ziwei_manager__/"));
        same("view.js", UrlPolicy.assetPath("https://qzelynth.top/__ziwei_manager__/view.js?v=1"));
        same("images/avatar.webp", UrlPolicy.assetPath("https://qzelynth.top/__ziwei_manager__/images/avatar.webp"));
        yes(UrlPolicy.isTrustedOrigin("https://qzelynth.top/api/images/preview.png"));
        for (String url : new String[] {
                "http://qzelynth.top/__ziwei_manager__/index.html",
                "https://qzelynth.top.evil.test/__ziwei_manager__/index.html",
                "https://qzelynth.top@evil.test/__ziwei_manager__/index.html",
                "https://user:password@qzelynth.top/__ziwei_manager__/index.html",
                "https://qzelynth.top:8443/__ziwei_manager__/index.html",
                "file:///android_asset/index.html", "content://documents/index.html",
                "javascript:alert(1)", "data:text/html,example", "https://qzelynth.top/%",
                "https://example.com/", "mailto:team@example.com", "tel:123456",
                "intent://example/#Intent;scheme=https;end", "market://details?id=com.example",
                "//qzelynth.top/__ziwei_manager__/index.html", null }) {
            no(UrlPolicy.isTrustedOrigin(url));
            no(UrlPolicy.isAppDocument(url));
            same(null, UrlPolicy.assetPath(url));
        }
        for (String path : new String[] { "../secret", "%2e%2e/secret", "images/%2e%2e/secret",
                "%252e%252e/secret", "images%5csecret", "images//avatar.webp", "/index.html",
                "images/./avatar.webp", "image%00.png", "icon%3f.svg", "中文.png" }) {
            same(null, UrlPolicy.assetPath("https://qzelynth.top/__ziwei_manager__/" + path));
        }
        no(UrlPolicy.isAppDocument("https://qzelynth.top/api/auth/status"));
        no(UrlPolicy.isAppDocument("https://qzelynth.top/api/images/preview.png"));
        no(UrlPolicy.isAppDocument("https://qzelynth.top/test-111/members"));
        no(UrlPolicy.isAppDocument("https://qzelynth.top/__ziwei_manager__/app.js"));
        same(null, UrlPolicy.assetPath("https://qzelynth.top/__ziwei_manager__/../api"));
        System.out.println("URL policy passed: " + checks + " checks");
    }
    private static void yes(boolean value) { checks++; if (!value) throw new AssertionError("Expected true"); }
    private static void no(boolean value) { checks++; if (value) throw new AssertionError("Expected false"); }
    private static void same(String expected, String actual) {
        checks++;
        if (!(expected == null ? actual == null : expected.equals(actual))) {
            throw new AssertionError("Expected " + expected + ", got " + actual);
        }
    }
}
