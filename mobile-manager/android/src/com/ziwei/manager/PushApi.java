package com.ziwei.manager;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Same-origin, no-redirect native API. Cookies and installation secrets never leave request memory. */
final class PushApi {
    private static final String PREFIX = "/api/mobile/push/";
    private PushApi() { }
    static JSONObject request(Context context, String route, String method, JSONObject body,
                              String cookie, NotificationFeed.Work work) throws IOException, JSONException {
        boolean allowed = "GET".equals(method) && ("config".equals(route)
                || route.startsWith("deliveries/") && PushRules.deliveryId(route.substring(11)))
                || "POST".equals(method) && ("installations".equals(route) || "foreground".equals(route) || "logout".equals(route))
                || "PUT".equals(method) && "subscription".equals(route);
        if (!allowed) throw new JSONException("Unsupported push route");
        if (!"logout".equals(route) && (cookie == null || cookie.isEmpty())) throw new NotificationFeed.Failure(401);
        byte[] encoded = body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8);
        if (encoded != null && encoded.length > 16_384) throw new JSONException("Push request too large");
        HttpsURLConnection connection = (HttpsURLConnection)new URL(UrlPolicy.ORIGIN + PREFIX + route).openConnection();
        work.connection = connection;
        try {
            work.check(); connection.setInstanceFollowRedirects(false); connection.setUseCaches(false);
            connection.setConnectTimeout(work.timeout()); connection.setReadTimeout(work.timeout());
            connection.setRequestMethod(method); connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cache-Control", "no-store");
            if (cookie != null && !cookie.isEmpty()) connection.setRequestProperty("Cookie", cookie);
            String version = "unknown";
            try { version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; }
            catch (android.content.pm.PackageManager.NameNotFoundException ignored) { }
            connection.setRequestProperty("User-Agent", "ZiweiManager/" + version + " Android Push");
            if (encoded != null) {
                connection.setRequestProperty("Origin", UrlPolicy.ORIGIN);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(encoded.length);
                try (OutputStream output = connection.getOutputStream()) { work.check(); output.write(encoded); }
            }
            int status = connection.getResponseCode(); work.check();
            if (status != 200 && !(status == 201 && "POST".equals(method))) throw new NotificationFeed.Failure(status);
            String type = connection.getContentType();
            if (type == null || !"application/json".equalsIgnoreCase(type.split(";",2)[0].trim())
                    || connection.getContentLengthLong() > PushRules.MAX_BODY_BYTES) throw new JSONException("Invalid push response");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) {
                    work.check();
                    if (bytes.size() + count > PushRules.MAX_BODY_BYTES) throw new JSONException("Oversized push response");
                    bytes.write(buffer,0,count); connection.setReadTimeout(work.timeout());
                }
            }
            work.check();
            String text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
            JSONTokener parser = new JSONTokener(text); Object parsed = parser.nextValue();
            if (!(parsed instanceof JSONObject) || parser.nextClean() != 0) throw new JSONException("Invalid push JSON");
            JSONObject result = (JSONObject)parsed; Object schema = result.get("schemaVersion");
            if (!(schema instanceof Integer || schema instanceof Long) || ((Number)schema).longValue()!=1) throw new JSONException("Unsupported push schema");
            return result;
        } finally { work.connection=null; connection.disconnect(); }
    }
    static String string(JSONObject object, String name) throws JSONException {
        Object value=object.get(name); if (!(value instanceof String)) throw new JSONException("Expected string"); return (String)value;
    }
    static long integer(JSONObject object, String name) throws JSONException {
        Object value=object.get(name);
        if (!(value instanceof Integer || value instanceof Long) || ((Number)value).longValue()<0) throw new JSONException("Expected epoch");
        return ((Number)value).longValue();
    }
    static boolean bool(JSONObject object, String name) throws JSONException {
        Object value=object.get(name); if (!(value instanceof Boolean)) throw new JSONException("Expected boolean"); return (Boolean)value;
    }
}
