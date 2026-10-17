package com.ziwei.manager;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;

/** Management UI only. No device agent, accessibility service, background worker or JS bridge. */
public final class MainActivity extends Activity {
    private static final int PICK_IMAGES = 301;
    private static final int BACKGROUND = Color.rgb(248, 246, 253);
    private FrameLayout root;
    private WebView webView;
    private ValueCallback<Uri[]> imageCallback;
    private boolean handlingBack;
    private OnBackInvokedCallback backCallback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        setContentView(root);
        configureInsets();
        createWebView(state);
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
    }

    private void configureInsets() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return insets;
            });
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
    }

    @SuppressWarnings("deprecation")
    private void createWebView(Bundle state) {
        handlingBack = false;
        root.removeAllViews();
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setGeolocationEnabled(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSafeBrowsingEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " ZiweiManager/" + appVersion() + " Android");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppChromeClient());
        webView.setDownloadListener((url, userAgent, disposition, type, length) -> showBlockedLink());
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        if (state == null || webView.restoreState(state) == null
                || !UrlPolicy.isAppDocument(webView.getUrl())) webView.loadUrl(UrlPolicy.START_URL);
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (request.isForMainFrame() && !UrlPolicy.isAppDocument(url)) {
                showBlockedLink();
                return textResponse(403, "Forbidden", "Blocked document");
            }
            if (!UrlPolicy.isTrustedOrigin(url)) return textResponse(403, "Forbidden", "Blocked origin");
            if (UrlPolicy.isAssetNamespace(url)) {
                if (!"GET".equals(request.getMethod())) return textResponse(405, "Method Not Allowed", "GET only");
                String path = UrlPolicy.assetPath(url);
                if (path == null) return textResponse(404, "Not Found", "Unknown resource");
                try {
                    InputStream data = getAssets().open(path);
                    return new WebResourceResponse(mimeType(path), "UTF-8", 200, "OK", assetHeaders(), data);
                } catch (IOException exception) {
                    return textResponse(404, "Not Found", "Unknown resource");
                }
            }
            // Existing API/images continue as subresources over validated TLS.
            return null;
        }

        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return true;
            if (UrlPolicy.isAppDocument(request.getUrl().toString())) return false;
            showBlockedLink();
            return true;
        }

        @SuppressWarnings("deprecation")
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (UrlPolicy.isAppDocument(url)) return false;
            showBlockedLink();
            return true;
        }

        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();
            // Never override Android's certificate validation, including for subresources/API calls.
            if (UrlPolicy.isAppDocument(error.getUrl())) showPageError("安全连接失败，请检查网络后重试");
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showPageError("页面暂时无法打开");
        }

        @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (view == webView) {
                cancelImagePicker();
                root.removeView(view);
                view.destroy();
                webView = null;
                showPageError("页面已停止，点按重新打开");
            }
            return true;
        }
    }

    private final class AppChromeClient extends WebChromeClient {
        @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }

        @Override public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture,
                Message resultMsg) {
            showBlockedLink();
            return false;
        }

        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                FileChooserParams params) {
            cancelImagePicker();
            if (!UrlPolicy.isAppDocument(view.getUrl())) {
                callback.onReceiveValue(null);
                return true;
            }
            imageCallback = callback;
            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("image/*");
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivityForResult(Intent.createChooser(pick, "选择图片"), PICK_IMAGES); }
            catch (ActivityNotFoundException exception) {
                cancelImagePicker();
                Toast.makeText(MainActivity.this, "未找到可用的图片选择器", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_IMAGES || imageCallback == null) return;
        ValueCallback<Uri[]> callback = imageCallback;
        imageCallback = null;
        LinkedHashSet<Uri> selected = new LinkedHashSet<>();
        if (result == RESULT_OK && data != null && webView != null
                && UrlPolicy.isAppDocument(webView.getUrl())) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int index = 0; index < clip.getItemCount() && index < 20; index++) {
                    addImage(selected, clip.getItemAt(index).getUri());
                }
            } else addImage(selected, data.getData());
        }
        callback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
    }

    private void addImage(LinkedHashSet<Uri> selected, Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme())) return;
        try {
            String mime = getContentResolver().getType(uri);
            if (mime != null && mime.toLowerCase(Locale.ROOT).startsWith("image/")) selected.add(uri);
        } catch (RuntimeException exception) { /* Provider did not return a readable image. */ }
    }

    private void cancelImagePicker() {
        if (imageCallback != null) {
            imageCallback.onReceiveValue(null);
            imageCallback = null;
        }
    }

    private String appVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (android.content.pm.PackageManager.NameNotFoundException exception) { return "unknown"; }
    }

    private void showBlockedLink() {
        runOnUiThread(() -> {
            if (!isFinishing() && !isDestroyed()) {
                Toast.makeText(this, "请在紫薇内继续操作", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void showPageError(String message) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            root.removeAllViews();
            LinearLayout panel = new LinearLayout(this);
            panel.setOrientation(LinearLayout.VERTICAL);
            panel.setGravity(Gravity.CENTER);
            panel.setPadding(48, 48, 48, 48);
            TextView label = new TextView(this);
            label.setText(message);
            label.setGravity(Gravity.CENTER);
            label.setTextSize(17);
            panel.addView(label);
            Button retry = new Button(this);
            retry.setText("重新打开");
            retry.setOnClickListener(view -> {
                if (webView != null) webView.destroy();
                createWebView(null);
            });
            panel.addView(retry);
            root.addView(panel, new FrameLayout.LayoutParams(-1, -1));
        });
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { handleBack(); }

    private void handleBack() {
        if (handlingBack) return;
        if (webView == null || !UrlPolicy.isAppDocument(webView.getUrl())) { finish(); return; }
        handlingBack = true;
        WebView current = webView;
        current.evaluateJavascript("(function(){return !window.dispatchEvent(new CustomEvent('ziwei:back',{cancelable:true}));})()",
                handled -> {
                    handlingBack = false;
                    if (isFinishing() || current != webView || "true".equals(handled)) return;
                    if (current.canGoBack()) current.goBack(); else finish();
                });
    }

    private void dispatchLifecycle(String name) {
        if (webView != null && UrlPolicy.isAppDocument(webView.getUrl())) {
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('ziwei:" + name
                    + "',{detail:{at:Date.now()}}));", null);
        }
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) { webView.onResume(); dispatchLifecycle("resume"); }
    }

    @Override protected void onPause() {
        dispatchLifecycle("pause");
        CookieManager.getInstance().flush();
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (webView != null && UrlPolicy.isAppDocument(webView.getUrl())) webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override protected void onDestroy() {
        cancelImagePicker();
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
        }
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private static Map<String, String> assetHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; "
                + "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                + "connect-src 'self' wss://qzelynth.top; font-src 'self'; "
                + "form-action 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'");
        return headers;
    }

    private static WebResourceResponse textResponse(int code, String reason, String message) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason, assetHeaders(),
                new ByteArrayInputStream(message.getBytes(StandardCharsets.UTF_8)));
    }

    private static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }
}
