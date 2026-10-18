package com.ziwei.manager;

import android.content.Context;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/** A fixed-origin, read-only, memory-only authenticated feed. Never logs request or receipt data. */
final class NotificationFeed {
    static final class Work {
        final AtomicBoolean cancelled = new AtomicBoolean();
        final long deadline = SystemClock.elapsedRealtime() + 45_000;
        volatile HttpsURLConnection connection;
        android.net.Network network;
        boolean waiting;
        void cancel() { cancelled.set(true); HttpsURLConnection current = connection; if (current != null) current.disconnect(); }
        void check() throws IOException {
            if (cancelled.get() || SystemClock.elapsedRealtime() >= deadline) throw new IOException("Cancelled or expired");
        }
        int timeout() throws IOException { check(); return (int)Math.max(1, Math.min(waiting ? 35_000 : 10_000, deadline - SystemClock.elapsedRealtime())); }
    }
    static final class Failure extends IOException {
        final int status;
        Failure(int status) { super("Notification feed unavailable"); this.status = status; }
    }
    static final class Item {
        final String id, title, summary;
        final JSONObject target;
        Item(String id, String title, String summary, JSONObject target) {
            this.id = id; this.title = title; this.summary = summary; this.target = target;
        }
    }
    static final class Page {
        final String accountId, workspaceId, workspaceSlug, cursor;
        final boolean hasMore;
        final List<Item> items;
        Page(String accountId, String workspaceId, String workspaceSlug, String cursor, boolean hasMore, List<Item> items) {
            this.accountId = accountId; this.workspaceId = workspaceId; this.workspaceSlug = workspaceSlug; this.cursor = cursor;
            this.hasMore = hasMore; this.items = items;
        }
    }
    private NotificationFeed() { }

    static Page get(Context context, String slug, boolean baseline, String cursor, String cookie, Work work)
            throws IOException, JSONException {
        if (!NotificationRules.workspaceSlug(slug) || cookie == null || cookie.length() == 0
                || !baseline && !NotificationRules.cursor(cursor)) throw new Failure(401);
        return request(context,slug,baseline,cursor,cookie,work,false);
    }
    static Page waitFor(Context context,String slug,String cursor,String cookie,Work work) throws IOException,JSONException {
        return request(context,slug,false,cursor,cookie,work,true);
    }
    private static Page request(Context context,String slug,boolean baseline,String cursor,String cookie,Work work,boolean waiting) throws IOException,JSONException {
        if (!NotificationRules.workspaceSlug(slug) || cookie == null || cookie.isEmpty() || !baseline && !NotificationRules.cursor(cursor)) throw new Failure(401);
        work.waiting=waiting;
        String path = "/api/workspaces/" + slug + "/mobile/notifications-v2" + (waiting ? "/wait" : "") + "?" + (baseline ? "baseline=1"
                : "cursor=" + URLEncoder.encode(cursor, "UTF-8") + "&limit=30" + (waiting ? "&timeout=25" : ""));
        Page page = parse(fetch(context,path,cookie,work), baseline);
        if (!slug.equals(page.workspaceSlug)) throw new JSONException("Wrong feed workspace");
        return page;
    }
    static Item resolve(Context context,String slug,String id,String account,String workspace,String cookie,Work work) throws IOException,JSONException {
        if(!NotificationRules.workspaceSlug(slug)||!NotificationRules.identifier(id)||cookie==null||cookie.isEmpty())throw new Failure(401);
        work.waiting=false;
        String body=fetch(context,"/api/workspaces/"+slug+"/mobile/notifications-v2/items/"+URLEncoder.encode(id,"UTF-8"),cookie,work);
        JSONTokener parser=new JSONTokener(body);Object decoded=parser.nextValue();
        if(!(decoded instanceof JSONObject)||parser.nextClean()!=0)throw new JSONException("Invalid item JSON");
        JSONObject root=(JSONObject)decoded;Object schema=root.get("schemaVersion");
        if(!(schema instanceof Integer||schema instanceof Long)||((Number)schema).longValue()!=2||!account.equals(string(root,"accountId"))||!workspace.equals(string(root,"workspaceId"))||!slug.equals(string(root,"workspaceSlug")))throw new JSONException("Wrong item scope");
        Item item=item(root.getJSONObject("item"));if(!id.equals(item.id))throw new JSONException("Wrong item");return item;
    }
    private static String fetch(Context context,String path,String cookie,Work work) throws IOException,JSONException {
        // No user supplied URL, alternate origin, custom TrustManager or redirect following.
        URL url = new URL(UrlPolicy.ORIGIN + path);
        HttpsURLConnection connection = (HttpsURLConnection)(work.network == null ? url.openConnection() : work.network.openConnection(url));
        work.connection = connection;
        try {
            work.check();
            connection.setInstanceFollowRedirects(false);
            connection.setUseCaches(false);
            connection.setConnectTimeout(work.timeout());
            connection.setReadTimeout(work.timeout());
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Accept-Encoding", "identity");
            connection.setRequestProperty("Cookie", cookie);
            String version = "unknown";
            try { version = context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName; }
            catch (android.content.pm.PackageManager.NameNotFoundException ignored) { }
            connection.setRequestProperty("User-Agent", "ZiweiManager/" + version + " Android Notifications");
            int status = connection.getResponseCode();
            work.check();
            if (status != 200) throw new Failure(status);
            String type = connection.getContentType();
            if (type == null || !"application/json".equalsIgnoreCase(type.split(";", 2)[0].trim())
                    || connection.getContentLengthLong() > NotificationRules.MAX_BODY_BYTES) throw new JSONException("Invalid feed body");
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            try (InputStream input = connection.getInputStream()) {
                byte[] buffer = new byte[4096];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    work.check();
                    if (bytes.size() + count > NotificationRules.MAX_BODY_BYTES) throw new JSONException("Oversized feed body");
                    bytes.write(buffer, 0, count);
                    connection.setReadTimeout(work.timeout());
                }
            }
            work.check();
            String body;
            try {
                body = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                        .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
            } catch (CharacterCodingException invalid) { throw new JSONException("Invalid feed encoding"); }
            return body;
        } finally { work.connection = null; connection.disconnect(); }
    }

    static Page parse(String body, boolean baseline) throws JSONException {
        JSONTokener parser = new JSONTokener(body);
        Object parsed = parser.nextValue();
        if (!(parsed instanceof JSONObject) || parser.nextClean() != 0) throw new JSONException("Invalid feed JSON");
        JSONObject root = (JSONObject)parsed;
        Object schema = root.get("schemaVersion");
        if (!(schema instanceof Integer || schema instanceof Long) || ((Number)schema).longValue() != 2) throw new JSONException("Unsupported feed schema");
        String account = string(root, "accountId"), workspace = string(root, "workspaceId"), slug = string(root, "workspaceSlug"), cursor = string(root, "nextCursor");
        if (!NotificationRules.identifier(account) || !NotificationRules.identifier(workspace) || !NotificationRules.workspaceSlug(slug)
                || !NotificationRules.cursor(cursor) || !(root.get("hasMore") instanceof Boolean)) throw new JSONException("Invalid feed scope");
        boolean more = root.getBoolean("hasMore");
        JSONArray values = root.getJSONArray("items");
        if (values.length() > NotificationRules.MAX_ITEMS || baseline && (values.length() != 0 || more)) throw new JSONException("Invalid feed count");
        List<Item> items = new ArrayList<>();
        HashSet<String> ids = new HashSet<>();
        for (int index = 0; index < values.length(); index++) {
            JSONObject item = values.getJSONObject(index);
            Item value=item(item);if(!ids.add(value.id))throw new JSONException("Duplicate item");items.add(value);
        }
        return new Page(account, workspace, slug, cursor, more, items);
    }

    private static Item item(JSONObject item) throws JSONException {
        String id=string(item,"id"),title=string(item,"title"),summary=string(item,"summary");
        if(!NotificationRules.identifier(id)||title.isEmpty()||!NotificationRules.plainTextUtf8(title,160)||!SelfhostRules.preview(summary,1024))throw new JSONException("Invalid feed item");
        return new Item(id,title,summary,target(item.getJSONObject("target")));
    }
    static JSONObject target(JSONObject raw) throws JSONException {
        HashSet<String> keys = new HashSet<>();
        Iterator<String> iterator = raw.keys();
        while (iterator.hasNext()) keys.add(iterator.next());
        String kind = string(raw, "kind"), id = string(raw, "id");
        String employee = optionalString(raw, "employeeId"), message = optionalString(raw, "messageId"), action = optionalString(raw, "actionId");
        if (!NotificationRules.target(kind, id, employee, message, action, keys)) throw new JSONException("Invalid notification target");
        JSONObject output = new JSONObject().put("kind", kind).put("id", id);
        if (employee != null) output.put("employeeId", employee);
        if (message != null) output.put("messageId", message);
        if (action != null) output.put("actionId", action);
        return output;
    }
    private static String string(JSONObject object, String key) throws JSONException {
        Object value = object.get(key);
        if (!(value instanceof String)) throw new JSONException("Expected string");
        return (String)value;
    }
    private static String optionalString(JSONObject object, String key) throws JSONException {
        return object.has(key) ? string(object, key) : null;
    }
}
