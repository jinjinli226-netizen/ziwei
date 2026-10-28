package com.ziwei.manager;

import java.net.URI;
import java.net.URISyntaxException;

/** A single HTTPS origin for bundled UI and existing authenticated API requests. */
final class UrlPolicy {
    static final String ORIGIN = "https://qzelynth.top";
    static final String PREFIX = "/__ziwei_manager__/";
    static final String START_URL = ORIGIN + PREFIX + "index.html";

    private UrlPolicy() { }

    static boolean isTrustedOrigin(String value) {
        URI uri = parse(value);
        return uri != null && "https".equals(uri.getScheme())
                && "qzelynth.top".equals(uri.getRawAuthority())
                && "qzelynth.top".equals(uri.getHost())
                && uri.getPort() == -1 && uri.getUserInfo() == null;
    }

    static String protectedApiPath(String value) {
        URI uri=parse(value);
        if(uri==null)return null;
        boolean api="https".equals(uri.getScheme())&&"ziwei.qzelynth.top".equals(uri.getRawAuthority())
                &&uri.getPort()==-1&&uri.getUserInfo()==null;
        if(!api&&!isTrustedOrigin(value))return null;
        try{return OidcRules.apiPath(uri.getRawPath()+(uri.getRawQuery()==null?"":"?"+uri.getRawQuery())+(uri.getRawFragment()==null?"":"#"+uri.getRawFragment()));}
        catch(IllegalArgumentException rejected){return null;}
    }
    static java.util.Map<String,String> protectedHeaders(java.util.Map<String,String> backend){
        java.util.Map<String,String> headers=new java.util.HashMap<>(backend);
        headers.put("cache-control","no-store, private, no-cache");headers.put("pragma","no-cache");headers.put("expires","0");headers.put("x-content-type-options","nosniff");return headers;
    }

    /** Null is never passed to AssetManager: missing/unsafe paths must not fall through to network. */
    static String assetPath(String value) {
        if (!isTrustedOrigin(value)) return null;
        URI uri = parse(value);
        String path = uri.getPath();
        if (path == null || !path.startsWith(PREFIX)) return null;
        String relative = path.substring(PREFIX.length());
        if (relative.length() == 0) return "index.html";
        if (!relative.matches("[A-Za-z0-9][A-Za-z0-9._/-]*") || relative.contains("//")) return null;
        for (String segment : relative.split("/")) {
            if (segment.length() == 0 || ".".equals(segment) || "..".equals(segment)) return null;
        }
        return relative;
    }

    static boolean isAssetNamespace(String value) {
        URI uri = parse(value);
        return isTrustedOrigin(value) && uri.getPath() != null && uri.getPath().startsWith(PREFIX);
    }

    static boolean isAppDocument(String value) {
        return "index.html".equals(assetPath(value));
    }

    private static URI parse(String value) {
        if (value == null) return null;
        try { return new URI(value); }
        catch (URISyntaxException exception) { return null; }
    }
}
