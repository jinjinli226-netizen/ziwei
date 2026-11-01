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
import android.provider.DocumentsContract;
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

/** Management UI with optional bounded notification checks. No device agent or accessibility service. */
public final class MainActivity extends Activity {
    private static final int PICK_IMAGES = 301;
    private static final int SAVE_ATTACHMENT = 302;
    private static final int BACKGROUND = Color.rgb(248, 246, 253);
    private FrameLayout root;
    private WebView webView;
    private ValueCallback<Uri[]> imageCallback;
    private boolean imagePickerOnly;
    private boolean handlingBack;
    private OnBackInvokedCallback backCallback;
    private NotificationBridge notificationBridge;
    private IdentityBridge identityBridge;
    private volatile boolean trustedDocument;
    private volatile boolean foreground;
    private volatile long documentGeneration;
    private volatile AttachmentDownload attachmentDownload;

    private static final class AttachmentDownload {
        final IdentityBridge bridge;final String id,path;final long epoch,document;final IdentityRead read;
        AttachmentDownload(IdentityBridge bridge,String id,String path,long epoch,long document){this.bridge=bridge;this.id=id;this.path=path;this.epoch=epoch;this.document=document;read=new IdentityRead(epoch,document,"GET");}
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(BACKGROUND);
        setContentView(root);
        configureInsets();
        createWebView(state);
        IdentitySession.get(this).callback(getIntent());
        NativeNotifications.click(this, getIntent());
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
        trustedDocument = false;
        documentGeneration++;
        root.removeAllViews();
        webView = new WebView(this);
        webView.setBackgroundColor(BACKGROUND);
        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
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
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        notificationBridge = new NotificationBridge(this);
        NativeNotifications.listen(notificationBridge);
        webView.addJavascriptInterface(notificationBridge, "ZiweiNotifications");
        if(identityBridge!=null)identityBridge.detach();
        identityBridge=new IdentityBridge(this);
        webView.addJavascriptInterface(identityBridge,"ZiweiIdentity");
        webView.setWebViewClient(new AppWebViewClient());
        webView.setWebChromeClient(new AppChromeClient());
        webView.setDownloadListener((url, userAgent, disposition, type, length) -> showBlockedLink());
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        if (state == null || webView.restoreState(state) == null
                || !UrlPolicy.isAppDocument(webView.getUrl())) webView.loadUrl(UrlPolicy.START_URL);
    }

    private final class AppWebViewClient extends WebViewClient {
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if(identityBridge!=null)identityBridge.cancelReads();
            documentGeneration++;
            trustedDocument = view == webView && UrlPolicy.isAppDocument(url);
        }

        @Override public void onPageFinished(WebView view, String url) {
            trustedDocument = view == webView && UrlPolicy.isAppDocument(url);
            if (trustedDocument && notificationBridge != null) notificationBridge.emit();
        }

        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String url = request.getUrl().toString();
            if (request.isForMainFrame() && !UrlPolicy.isAppDocument(url)) {
                trustedDocument = false;
                showBlockedLink();
                return textResponse(403, "Forbidden", "Blocked document");
            }
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
            String path=UrlPolicy.protectedApiPath(url);
            if(path!=null&&"GET".equals(request.getMethod())&&trustedDocument){
                try{
                    IdentitySession session=IdentitySession.get(MainActivity.this);
                    long before=session.epoch(),document=documentGeneration;
                    IdentitySession.Response response=session.request(path,"GET",java.util.Collections.emptyMap(),null,before);
                    String type=response.headers.get("content-type");if(type==null)type="application/octet-stream";
                    if(!session.current(before)||documentGeneration!=document||!trustedDocument)return textResponse(401,"Unauthorized","Identity changed");
                    return new WebResourceResponse(type.split(";",2)[0].trim(),null,response.status,response.status>=400?"Unavailable":"OK",UrlPolicy.protectedHeaders(response.headers),new ByteArrayInputStream(response.body));
                }catch(Exception rejected){return textResponse(401,"Unauthorized","Native identity required");}
            }
            return textResponse(403,"Forbidden","Blocked resource");
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
                trustedDocument = false;
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
            imagePickerOnly = AttachmentTransferRules.imagesOnly(params.getAcceptTypes());
            Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType(imagePickerOnly ? "image/*" : "*/*");
            pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            pick.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivityForResult(Intent.createChooser(pick, imagePickerOnly ? "选择图片" : "选择附件"), PICK_IMAGES); }
            catch (ActivityNotFoundException exception) {
                cancelImagePicker();
                Toast.makeText(MainActivity.this, "未找到可用的文件选择器", Toast.LENGTH_SHORT).show();
            }
            return true;
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if(request==SAVE_ATTACHMENT){finishAttachmentPicker(result,data);return;}
        if (request != PICK_IMAGES || imageCallback == null) return;
        ValueCallback<Uri[]> callback = imageCallback;
        imageCallback = null;
        LinkedHashSet<Uri> selected = new LinkedHashSet<>();
        if (result == RESULT_OK && data != null && webView != null
                && UrlPolicy.isAppDocument(webView.getUrl())) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int index = 0; index < clip.getItemCount() && index < 21; index++) {
                    addImage(selected, clip.getItemAt(index).getUri());
                }
            } else addImage(selected, data.getData());
        }
        callback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
    }

    void beginAttachmentDownload(IdentityBridge bridge,String id,String path,String name,String mimeType,long before,long document){
        if(attachmentDownload!=null){bridge.downloadResult(this,id,false,false,0,"Another attachment save is pending",before,document);return;}
        AttachmentDownload download=new AttachmentDownload(bridge,id,path,before,document);attachmentDownload=download;
        Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mimeType).putExtra(Intent.EXTRA_TITLE,name);
        try{startActivityForResult(save,SAVE_ATTACHMENT);AttachmentTransferLog.append(getNoBackupFilesDir(),"download_picker",0);}
        catch(RuntimeException unavailable){attachmentDownload=null;bridge.downloadResult(this,id,false,false,0,"No document saver is available",before,document);}
    }
    void cancelAttachmentDownload(String id){
        AttachmentDownload download=attachmentDownload;
        if(download!=null&&(id==null||download.id.equals(id)))download.read.cancel(download.epoch,download.document);
    }
    void cancelStaleAttachmentDownload(){
        AttachmentDownload download=attachmentDownload;
        if(download!=null&&(!IdentitySession.get(this).current(download.epoch)||documentGeneration!=download.document))download.read.cancel(download.epoch,download.document);
    }
    private void finishAttachmentPicker(int result,Intent data){
        final AttachmentDownload download=attachmentDownload;
        if(download==null)return;
        final Uri uri=result==RESULT_OK&&data!=null?data.getData():null;
        if(uri==null){attachmentDownload=null;AttachmentTransferLog.append(getNoBackupFilesDir(),"download_cancelled",0);download.bridge.downloadResult(this,download.id,false,true,0,null,download.epoch,download.document);return;}
        if(!"content".equals(uri.getScheme())){attachmentDownload=null;download.bridge.downloadResult(this,download.id,false,false,0,"Invalid document save location",download.epoch,download.document);return;}
        IdentitySession.NETWORK.execute(()->{
            long bytes=0;boolean saved=false;
            try{
                checkAttachmentDownload(download);AttachmentTransferLog.append(getNoBackupFilesDir(),"download_started",0);
                try(java.io.OutputStream output=getContentResolver().openOutputStream(uri,"w")){
                    if(output==null)throw new IOException("Document could not be opened");
                    bytes=IdentitySession.get(this).downloadAttachment(download.path,output,download.epoch,download.read);
                    checkAttachmentDownload(download);output.flush();
                }
                checkAttachmentDownload(download);saved=true;
                AttachmentTransferLog.append(getNoBackupFilesDir(),"download_saved",bytes);
                download.bridge.downloadResult(this,download.id,true,false,bytes,null,download.epoch,download.document);
            }catch(Exception failure){
                AttachmentTransferLog.append(getNoBackupFilesDir(),"download_failed",bytes);
                download.bridge.downloadResult(this,download.id,false,false,0,"Attachment save did not complete",download.epoch,download.document);
            }finally{
                if(!saved)try{DocumentsContract.deleteDocument(getContentResolver(),uri);}catch(Exception ignored){ }
                if(attachmentDownload==download)attachmentDownload=null;
            }
        });
    }
    private void checkAttachmentDownload(AttachmentDownload download)throws IOException{
        download.read.check();
        if(!trustedDocument||documentGeneration!=download.document||!IdentitySession.get(this).current(download.epoch))throw new IOException("Attachment identity changed");
    }

    private void addImage(LinkedHashSet<Uri> selected, Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme())) return;
        try {
            String mime = getContentResolver().getType(uri);
            if (!imagePickerOnly || mime != null && mime.toLowerCase(Locale.ROOT).startsWith("image/")) selected.add(uri);
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
            trustedDocument = false;
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
        foreground = true;
        NativeNotifications.lifecycle(this, true);
        NativeNotifications.recover(this);
        if (webView != null) { webView.onResume(); dispatchLifecycle("resume"); }
    }

    @Override protected void onPause() {
        foreground = false;
        NativeNotifications.lifecycle(this, false);
        dispatchLifecycle("pause");
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        if (webView != null && UrlPolicy.isAppDocument(webView.getUrl())) webView.saveState(state);
        super.onSaveInstanceState(state);
    }

    @Override protected void onDestroy() {
        foreground = false;
        trustedDocument = false;
        if (notificationBridge != null) NativeNotifications.detach(notificationBridge);
        if(identityBridge!=null)identityBridge.detach();
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

    boolean notificationDocumentTrusted() { return trustedDocument; }
    boolean notificationForeground() { return foreground; }
    long identityDocumentGeneration(){return documentGeneration;}
    void emitNotificationStatus(String json) {
        if (trustedDocument && webView != null && UrlPolicy.isAppDocument(webView.getUrl())) {
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('ziwei:notifications',{detail:" + json + "}));", null);
        }
    }

    void emitIdentityEvent(String name,String json){
        // HTTP/decoded images must not survive an account change; DOM storage/drafts are untouched.
        if("ziwei:identity".equals(name)&&webView!=null)webView.clearCache(true);
        if(trustedDocument&&webView!=null&&UrlPolicy.isAppDocument(webView.getUrl()))
            webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('"+name+"',{detail:"+json+"}));",null);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        IdentitySession.get(this).callback(intent);
        NativeNotifications.click(this, intent);
    }

    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(request, permissions, grantResults);
        if (request == NotificationBridge.PERMISSION_REQUEST) {
            NativeNotifications.recover(this);
            if (notificationBridge != null) notificationBridge.emit();
        }
    }

    private static Map<String, String> assetHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; "
                + "style-src 'self' 'unsafe-inline'; img-src 'self' https://ziwei.qzelynth.top data: blob:; "
                + "connect-src 'none'; font-src 'self'; "
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
