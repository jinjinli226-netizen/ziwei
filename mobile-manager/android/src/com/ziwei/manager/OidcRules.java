package com.ziwei.manager;

import java.math.BigInteger;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Dependency-free, fail-closed protocol rules shared by Android and offline JVM tests. */
final class OidcRules {
    static final String ISSUER = "https://auth.qzelynth.top/realms/ziwei";
    static final String API = "https://ziwei.qzelynth.top";
    static final String AUDIENCE = "ziwei-workspace-api";
    static final String CLIENT = "ziwei-android-manager";
    static final String CALLBACK = "com.ziwei.manager:/oauth2redirect";
    static final String SCOPE = "openid profile email workspace:read workspace:write";
    // Public client registration and native authorization remain enforced by the server.
    static final boolean CONFIGURED = true;
    private OidcRules() { }
    static String random() { byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
    static String challenge(String verifier) {
        try { return Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII))); }
        catch (Exception failure) { throw invalid(); }
    }
    static final class Pending {
        final String verifier = random(), state = random(), nonce = random();
        final long created; private boolean used;
        Pending(long now) { created = now; }
        synchronized String consume(String value, long now) {
            try {
                URI uri = new URI(value);
                if (used || now < created || now - created >= 300_000 || uri.getRawFragment() != null
                        || !CALLBACK.equals(value.split("\\?", 2)[0]) || uri.getRawQuery() == null) throw invalid();
                Map<String, String> query = new LinkedHashMap<>();
                for (String pair : uri.getRawQuery().split("&", -1)) {
                    String[] parts = pair.split("=", 2); if (parts.length != 2) throw invalid();
                    String key = URLDecoder.decode(parts[0], "UTF-8"), item = URLDecoder.decode(parts[1], "UTF-8");
                    if (query.put(key, item) != null || item.length() > 8192) throw invalid();
                }
                if (!state.equals(query.get("state")) || query.containsKey("iss") && !ISSUER.equals(query.get("iss"))) throw invalid();
                used = true;
                if (query.containsKey("error") || !query.containsKey("code") || query.get("code").isEmpty()
                        || query.get("code").length() > 4096) throw invalid();
                return query.get("code");
            } catch (Exception failure) { throw invalid(); }
        }
    }
    static String apiPath(String value) {
        try {
            if (value == null || value.length() > 16384 || !value.startsWith("/api/") || value.contains("\\") || value.contains("//")) throw invalid();
            URI uri = new URI(value); String raw = uri.getRawPath();
            if (uri.isAbsolute() || uri.getRawAuthority() != null || uri.getRawFragment() != null || raw == null
                    || raw.matches("(?i).*%(?:2e|2f|5c|25|00|0a|0d).*") || raw.contains(";")
                    || !raw.matches("[A-Za-z0-9/_%~.@!$&'()*+,=:-]+")) throw invalid();
            for (String segment : raw.split("/")) if (segment.equals(".") || segment.equals("..")) throw invalid();
            String decoded=uri.getPath();
            if (decoded.startsWith("/api/identity") || decoded.startsWith("/api/auth") && !decoded.equals("/api/auth/me")) throw invalid();
            if (value.matches("(?s).*[\\x00-\\x20\\x7f].*")) throw invalid();
            return value;
        } catch (Exception failure) { throw invalid(); }
    }
    static boolean requestId(String value){return value!=null&&value.matches("[A-Za-z0-9_:-]{1,120}");}
    static byte[] body(String method,String value){
        if(method==null||!method.matches("GET|HEAD|POST|PUT|PATCH|DELETE"))throw invalid();
        if(value==null||value.isEmpty())return null;
        if(method.equals("GET")||method.equals("HEAD")||value.length()>16*1024*1024)throw invalid();
        byte[] bytes=value.getBytes(StandardCharsets.UTF_8);if(bytes.length>16*1024*1024)throw invalid();return bytes;
    }
    static final class Claims {
        final String subject; final long expires;
        Claims(String subject, long expires) { this.subject = subject; this.expires = expires; }
    }
    static Claims verify(String jwt, String jwks, boolean idToken, String nonce, long now) {
        return verify(jwt,jwks,idToken,nonce,now,false);
    }
    static Claims verify(String jwt, String jwks, boolean idToken, String nonce, long now, boolean refreshedId) {
        try {
            if (jwt == null || jwt.length() > 65536) throw invalid();
            String[] parts = jwt.split("\\.", -1); if (parts.length != 3) throw invalid();
            Map<String,Object> header = object(utf8(decode(parts[0]))), claims = object(utf8(decode(parts[1])));
            if (!"RS256".equals(header.get("alg")) || header.containsKey("crit") || header.containsKey("jku") || header.containsKey("x5u")) throw invalid();
            String kid = string(header, "kid"); if (!kid.matches("[A-Za-z0-9._:-]{1,128}")) throw invalid();
            Object keys = object(jwks).get("keys"); if (!(keys instanceof List) || ((List<?>)keys).size() > 64) throw invalid();
            Map<?,?> selected = null;
            for (Object value : (List<?>)keys) if (value instanceof Map && kid.equals(((Map<?,?>)value).get("kid"))) { if (selected != null) throw invalid(); selected = (Map<?,?>)value; }
            if (selected == null || !"RSA".equals(selected.get("kty")) || selected.containsKey("use") && !"sig".equals(selected.get("use"))
                    || selected.containsKey("alg") && !"RS256".equals(selected.get("alg"))) throw invalid();
            Object operations=selected.get("key_ops"); if(operations != null && (!(operations instanceof List) || !((List<?>)operations).contains("verify"))) throw invalid();
            BigInteger modulus = new BigInteger(1, decode(string(selected, "n"))), exponent = new BigInteger(1, decode(string(selected, "e")));
            if (modulus.bitLength() < 2048 || modulus.bitLength() > 8192 || exponent.bitLength() > 32 || exponent.compareTo(BigInteger.valueOf(3)) < 0 || !exponent.testBit(0)) throw invalid();
            Signature signature = Signature.getInstance("SHA256withRSA");
            signature.initVerify(KeyFactory.getInstance("RSA").generatePublic(new RSAPublicKeySpec(modulus, exponent)));
            signature.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            if (!signature.verify(decode(parts[2]))) throw invalid();
            if (!ISSUER.equals(claims.get("iss")) || !CLIENT.equals(claims.get("azp"))) throw invalid();
            String audience = idToken ? CLIENT : AUDIENCE;
            Object aud = claims.get("aud");
            if (!(audience.equals(aud) || aud instanceof List && ((List<?>)aud).size() == 1 && audience.equals(((List<?>)aud).get(0)))) throw invalid();
            String subject = string(claims, "sub"); if (subject.isEmpty() || subject.length() > 1024) throw invalid();
            long issued = integer(claims, "iat"), expires = integer(claims, "exp");
            if (issued < 0 || issued > now + 5 || expires <= now - 5 || expires <= issued || expires - issued > (idToken?600:300)
                    || claims.containsKey("nbf") && integer(claims,"nbf") > now + 5) throw invalid();
            if (idToken ? nonce == null || !(refreshedId&&!claims.containsKey("nonce"))&&!nonce.equals(claims.get("nonce")) : !"Bearer".equals(claims.get("typ"))) throw invalid();
            return new Claims(subject, expires);
        } catch (Exception failure) { throw invalid(); }
    }
    static String string(Map<?,?> object, String key) { Object value = object.get(key); if (!(value instanceof String)) throw invalid(); return (String)value; }
    static long integer(Map<?,?> object, String key) { Object value = object.get(key); if (!(value instanceof Long)) throw invalid(); return (Long)value; }
    static Map<String,Object> object(String source) { Object value = new Json(source).parse(); if (!(value instanceof Map)) throw invalid(); @SuppressWarnings("unchecked") Map<String,Object> result = (Map<String,Object>)value; return result; }
    private static byte[] decode(String value) { if (value.isEmpty() || !value.matches("[A-Za-z0-9_-]+")) throw invalid(); return Base64.getUrlDecoder().decode(value); }
    private static String utf8(byte[] value) throws Exception { return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(value)).toString(); }
    static IllegalArgumentException invalid() { return new IllegalArgumentException("Identity response rejected"); }
    /** Strict JSON rejects duplicate keys and noninteger numeric claims, unlike permissive platform parsing. */
    private static final class Json {
        private final String text; private int at;
        Json(String value) { if (value == null || value.length() > 262144) throw invalid(); text=value; }
        Object parse() { Object value=value(0); space(); if(at!=text.length())throw invalid(); return value; }
        void space(){while(at<text.length()&&" \r\n\t".indexOf(text.charAt(at))>=0)at++;}
        boolean take(char c){space();if(at<text.length()&&text.charAt(at)==c){at++;return true;}return false;}
        Object value(int depth) {
            space(); if(depth>20||at>=text.length())throw invalid(); char c=text.charAt(at);
            if(c=='"')return quoted();
            if(take('{')) { Map<String,Object> map=new LinkedHashMap<>();if(take('}'))return map;do{space();String key=quoted();if(!take(':')||map.containsKey(key))throw invalid();map.put(key,value(depth+1));}while(take(','));if(!take('}'))throw invalid();return map; }
            if(take('[')) { List<Object> list=new ArrayList<>();if(take(']'))return list;do{if(list.size()>=2048)throw invalid();list.add(value(depth+1));}while(take(','));if(!take(']'))throw invalid();return list; }
            for(String literal:new String[]{"true","false","null"})if(text.startsWith(literal,at)){at+=literal.length();return literal.equals("null")?null:Boolean.valueOf(literal);}
            int start=at;if(c=='-')at++;while(at<text.length()&&Character.isDigit(text.charAt(at)))at++;String number=text.substring(start,at);
            if(!number.matches("-?(0|[1-9][0-9]*)"))throw invalid();try{return Long.valueOf(number);}catch(NumberFormatException invalid){throw invalid();}
        }
        String quoted(){space();if(at>=text.length()||text.charAt(at++)!='"')throw invalid();StringBuilder out=new StringBuilder();while(at<text.length()){char c=text.charAt(at++);if(c=='"')return out.toString();if(c<' ')throw invalid();if(c=='\\'){if(at>=text.length())throw invalid();char escape=text.charAt(at++);int pos="\"\\/bfnrt".indexOf(escape);if(pos>=0)c="\"\\/\b\f\n\r\t".charAt(pos);else if(escape=='u'){if(at+4>text.length())throw invalid();try{c=(char)Integer.parseInt(text.substring(at,at+4),16);}catch(NumberFormatException invalid){throw invalid();}at+=4;}else throw invalid();}out.append(c);}throw invalid();}
    }
}
