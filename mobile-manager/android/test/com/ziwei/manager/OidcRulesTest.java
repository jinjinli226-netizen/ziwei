package com.ziwei.manager;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;

/** Offline security fixtures only. No provider, account, server or device interaction. */
public final class OidcRulesTest {
    private static int checks;
    interface Checked { void run() throws Exception; }
    static void reject(Checked check) throws Exception { checks++; try { check.run(); } catch (IllegalArgumentException expected) { return; } throw new AssertionError("Expected rejection"); }
    static void yes(boolean value) { checks++; if (!value) throw new AssertionError("Expected true"); }
    static String b64(byte[] data) { return Base64.getUrlEncoder().withoutPadding().encodeToString(data); }
    static String token(KeyPair key, String header, String claims) throws Exception {
        String input = b64(header.getBytes(StandardCharsets.UTF_8)) + "." + b64(claims.getBytes(StandardCharsets.UTF_8));
        Signature signature = Signature.getInstance("SHA256withRSA"); signature.initSign(key.getPrivate()); signature.update(input.getBytes(StandardCharsets.US_ASCII));
        return input + "." + b64(signature.sign());
    }
    public static void main(String[] args) throws Exception {
        yes("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM".equals(OidcRules.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")));
        OidcRules.Pending pending = new OidcRules.Pending(1000);
        yes(pending.state.length() >= 43 && pending.nonce.length() >= 43 && pending.verifier.length() >= 43);
        String callback = OidcRules.CALLBACK + "?code=fixture&state=" + pending.state;
        reject(() -> pending.consume(callback + "&state=extra", 1001));
        yes("fixture".equals(pending.consume(callback, 1001)));
        reject(() -> pending.consume(callback, 1002));
        OidcRules.Pending wrongState=new OidcRules.Pending(1000);
        reject(()->wrongState.consume(OidcRules.CALLBACK+"?code=x&state=other",1001));
        yes("fixture".equals(wrongState.consume(OidcRules.CALLBACK+"?code=fixture&state="+wrongState.state,1002)));
        OidcRules.Pending declined=new OidcRules.Pending(1000);
        reject(()->declined.consume(OidcRules.CALLBACK+"?error=access_denied&state="+declined.state,1001));
        reject(()->declined.consume(OidcRules.CALLBACK+"?code=fixture&state="+declined.state,1002));
        for (String uri : new String[]{"com.ziwei.manager://oauth2redirect", "com.ziwei.manager:/oauth2redirect/", "COM.ziwei.manager:/oauth2redirect", "com.ziwei.manager:/oauth2redirect#x", "com.ziwei.manager:/other"}) {
            OidcRules.Pending fresh = new OidcRules.Pending(1000); reject(() -> fresh.consume(uri + "?code=x&state=" + fresh.state, 1001));
        }
        OidcRules.Pending expired = new OidcRules.Pending(1000); reject(() -> expired.consume(OidcRules.CALLBACK + "?code=x&state=" + expired.state, 301001));
        for (String path : new String[]{"https://evil.test/api/a", "//evil.test/api/a", "/api/../admin", "/api/%2e%2e/admin", "/api/a%2fb", "/api/a%5cb", "/api/auth/login", "/api/%61uth/login", "/api/identity/callback", "/api/%69dentity/callback", "/api/a#x", "/api/a\r\nX:y"}) reject(() -> OidcRules.apiPath(path));
        yes("/api/workspaces/test/employees?view=mobile".equals(OidcRules.apiPath("/api/workspaces/test/employees?view=mobile")));
        yes(OidcRules.requestId("f3945d08-3397-467e-8292-0800200c9a66:1"));
        yes(!OidcRules.requestId("invalid'\n"));
        yes(OidcRules.body("GET", "") == null && OidcRules.body("HEAD", null) == null);
        reject(() -> OidcRules.body("GET", "{}"));
        yes(new String(OidcRules.body("POST", "{\"text\":\"fixture\"}"),StandardCharsets.UTF_8).equals("{\"text\":\"fixture\"}"));
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA"); generator.initialize(2048); KeyPair key = generator.generateKeyPair();
        RSAPublicKey publicKey = (RSAPublicKey)key.getPublic();
        String jwks = "{\"keys\":[{\"kty\":\"RSA\",\"kid\":\"fixture\",\"use\":\"sig\",\"alg\":\"RS256\",\"n\":\"" + b64(unsigned(publicKey.getModulus().toByteArray())) + "\",\"e\":\"" + b64(unsigned(publicKey.getPublicExponent().toByteArray())) + "\"}]}";
        String header = "{\"alg\":\"RS256\",\"kid\":\"fixture\"}";
        String claims = "{\"iss\":\"" + OidcRules.ISSUER + "\",\"sub\":\"subject\",\"aud\":\"" + OidcRules.AUDIENCE + "\",\"azp\":\"" + OidcRules.CLIENT + "\",\"typ\":\"Bearer\",\"iat\":100,\"exp\":400}";
        yes("subject".equals(OidcRules.verify(token(key, header, claims), jwks, false, null, 200).subject));
        reject(() -> OidcRules.verify(token(key,header,claims.replace("400","401")),jwks,false,null,200));
        for (String broken : new String[]{claims.replace("400", "190"), claims.replace("100", "220"), claims.replace(OidcRules.ISSUER, "https://evil.test"), claims.replace(OidcRules.AUDIENCE, "other"), claims.replace("\"aud\":\"" + OidcRules.AUDIENCE + "\"", "\"aud\":[\"" + OidcRules.AUDIENCE + "\",\"other\"]"), claims.replace(OidcRules.CLIENT, "other"), claims.replace("Bearer", "ID"), claims.replace("\"sub\":\"subject\"", "\"sub\":\"\""), claims.replace("\"exp\":400", "\"exp\":400,\"exp\":500")}) reject(() -> OidcRules.verify(token(key, header, broken), jwks, false, null, 200));
        reject(() -> OidcRules.verify(token(key, header.replace("RS256", "none"), claims), jwks, false, null, 200));
        reject(() -> OidcRules.verify(token(key, header.replace("fixture", "missing"), claims), jwks, false, null, 200));
        reject(() -> OidcRules.verify(token(key, header, claims).substring(1), jwks, false, null, 200));
        reject(() -> OidcRules.verify(token(generator.generateKeyPair(),header,claims),jwks,false,null,200));
        reject(() -> OidcRules.verify(token(key,header,claims),jwks.replace("\"use\":\"sig\"","\"use\":\"enc\""),false,null,200));
        reject(() -> OidcRules.verify(token(key,header,claims),jwks.replace("\"keys\":[","\"keys\":[],\"keys\":["),false,null,200));
        String idClaims = claims.replace(OidcRules.AUDIENCE, OidcRules.CLIENT).replace("\"typ\":\"Bearer\",", "\"nonce\":\"nonce-fixture\",");
        yes("subject".equals(OidcRules.verify(token(key, header, idClaims), jwks, true, "nonce-fixture", 200).subject));
        reject(() -> OidcRules.verify(token(key, header, idClaims), jwks, true, "other", 200));
        String refreshedId=idClaims.replace("\"nonce\":\"nonce-fixture\",","");
        reject(()->OidcRules.verify(token(key,header,refreshedId),jwks,true,"nonce-fixture",200));
        yes("subject".equals(OidcRules.verify(token(key,header,refreshedId),jwks,true,"nonce-fixture",200,true).subject));
        yes("subject".equals(OidcRules.verify(token(key,header,idClaims),jwks,true,"nonce-fixture",200,true).subject));
        reject(()->OidcRules.verify(token(key,header,idClaims),jwks,true,"other",200,true));
        IdentityFence fence = new IdentityFence(); long first = fence.epoch(); yes(fence.current(first)); fence.invalidate(); yes(!fence.current(first));
        long login = fence.epoch(); yes(fence.install(login, "subject")); String handle = fence.handle(); yes(!handle.isEmpty()); yes(fence.install(login, "subject") && handle.equals(fence.handle()));
        yes(!fence.install(login, "other")); fence.invalidate(); yes(fence.handle().isEmpty() && !fence.install(login, "subject"));
        long refreshEpoch=fence.epoch();yes(fence.beginRefresh(refreshEpoch));yes(!fence.beginRefresh(refreshEpoch));
        fence.invalidate();long replacement=fence.epoch();yes(fence.beginRefresh(replacement));fence.finishRefresh(refreshEpoch);yes(fence.refreshing());fence.finishRefresh(replacement);yes(!fence.refreshing());
        IdentityFence restored=new IdentityFence();restored.restore(restored.epoch(),"subject",handle);yes(handle.equals(restored.handle()));
        IdentityFence concurrent=new IdentityFence();java.util.concurrent.CountDownLatch ready=new java.util.concurrent.CountDownLatch(12),go=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicInteger winners=new java.util.concurrent.atomic.AtomicInteger();java.util.List<Thread> contenders=new java.util.ArrayList<>();
        for(int index=0;index<12;index++){Thread thread=new Thread(()->{ready.countDown();try{go.await();if(concurrent.beginRefresh(0))winners.incrementAndGet();}catch(InterruptedException interrupted){throw new AssertionError(interrupted);}});contenders.add(thread);thread.start();}
        ready.await();go.countDown();for(Thread thread:contenders)thread.join();yes(winners.get()==1);concurrent.finishRefresh(0);yes(concurrent.beginRefresh(0));
        System.out.println("OIDC security policy passed: " + checks + " checks");
    }
    static byte[] unsigned(byte[] data) { return data.length > 1 && data[0] == 0 ? java.util.Arrays.copyOfRange(data, 1, data.length) : data; }
}
