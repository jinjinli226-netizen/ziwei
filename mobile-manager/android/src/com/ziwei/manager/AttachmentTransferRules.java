package com.ziwei.manager;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Base64;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** The binary bridge accepts only one bounded upload chunk or a streamed attachment download. */
final class AttachmentTransferRules {
    static final int CHUNK_BYTES = 8 * 1024 * 1024;
    static final long FILE_BYTES = 500L * 1024 * 1024;
    private static final String IDENTIFIER = "[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}";
    private static final String UPLOADS = "/api/conversations/" + IDENTIFIER + "/attachments/uploads";
    private static final Pattern CHUNK = Pattern.compile(UPLOADS + "/" + IDENTIFIER + "\\?offset=(0|[1-9][0-9]{0,9})");
    private static final Pattern DOWNLOAD = Pattern.compile("/api/conversations/" + IDENTIFIER + "/attachments/(?!uploads(?:$|[/?]))" + IDENTIFIER);
    private AttachmentTransferRules() { }

    static boolean imagesOnly(String[] accepted) {
        if (accepted == null || accepted.length == 0) return false;
        for (String value : accepted) if (value == null || !value.trim().toLowerCase(java.util.Locale.ROOT).startsWith("image/")) return false;
        return true;
    }

    static boolean creation(String path, String method) { return "POST".equals(method) && path != null && path.matches(UPLOADS); }
    static boolean idempotency(String path, String method, String value) {
        return creation(path, method) && value != null && value.matches("[A-Za-z0-9._:-]{1,128}");
    }
    static void uploadPath(String path) {
        if (path == null) throw OidcRules.invalid();
        Matcher match = CHUNK.matcher(path);
        if (!match.matches() || Long.parseLong(match.group(1)) > FILE_BYTES) throw OidcRules.invalid();
        OidcRules.apiPath(path);
    }
    static void downloadPath(String path) {
        if (path == null || !DOWNLOAD.matcher(path).matches()) throw OidcRules.invalid();
        OidcRules.apiPath(path);
    }
    static String filename(String value) {
        if (value == null || value.trim().isEmpty() || value.length() > 255 || value.matches("(?s).*[\\\\/\\x00-\\x1f\\x7f].*")) throw OidcRules.invalid();
        return value;
    }
    static String mimeType(String value) {
        if (value == null || value.length() > 255 || !value.matches("[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+")) throw OidcRules.invalid();
        return value;
    }
    static byte[] decodeChunk(String value) {
        if (value == null || value.isEmpty() || value.length() > ((CHUNK_BYTES + 2) / 3) * 4 || value.length() % 4 != 0
                || !value.matches("[A-Za-z0-9+/]*={0,2}")) throw OidcRules.invalid();
        byte[] bytes = Base64.getDecoder().decode(value);
        if (bytes.length > CHUNK_BYTES || !Base64.getEncoder().encodeToString(bytes).equals(value)) throw OidcRules.invalid();
        return bytes;
    }
    interface Check { void run() throws IOException; }
    static long copy(InputStream input, OutputStream output, long expected, Check check) throws IOException {
        if (expected > FILE_BYTES) throw new IOException("Attachment exceeds the download limit");
        byte[] buffer = new byte[64 * 1024]; long total = 0; int count;
        for (;;) {
            check.run(); count = input.read(buffer); if (count < 0) break;
            if (total + count > FILE_BYTES) throw new IOException("Attachment exceeds the download limit");
            check.run(); output.write(buffer, 0, count); total += count;
        }
        check.run();
        if (expected >= 0 && total != expected) throw new IOException("Attachment download was incomplete");
        return total;
    }
}
