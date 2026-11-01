package com.warriorbiswas.quire;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import androidx.webkit.WebViewAssetLoader;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/** Runs the Quirk web app from the files bundled in the APK, on a private https origin. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final int PICK_FILES = 1;
    private static final int SAVE_FILE = 2;

    WebView web;
    AiBridge ai;
    private ValueCallback<Uri[]> pendingPick;
    private File exportFile;
    private OutputStream exportStream;

    @SuppressLint("SetJavaScriptEnabled")
    @SuppressWarnings("deprecation")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);

        web = new WebView(this);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setSupportZoom(false);
        s.setTextZoom(100);
        s.setUseWideViewPort(true);

        final WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (HOST.equals(url.getHost())) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                recreate();
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return pickFiles(callback, params);
            }
        });
        web.addJavascriptInterface(new Bridge(), "QuireAndroid");
        ai = new AiBridge(this);
        web.addJavascriptInterface(ai, "QuirkAI");

        // Keeps the page clear of the status bar, navigation bar and keyboard.
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime() | WindowInsets.Type.displayCutout());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                        insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });

        setContentView(root);
        web.loadUrl(START_URL);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        goBack();
    }

    /** Back leaves an open note first, and only then the app. */
    void goBack() {
        web.evaluateJavascript("!!Q.app.editor && (Q.app.closeEditor(), true)", open -> {
            if (!"true".equals(open)) finish();
        });
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (level >= TRIM_MEMORY_RUNNING_LOW) ai.lowOnMemory();
    }

    @Override
    protected void onDestroy() {
        ai.close();
        web.destroy();
        super.onDestroy();
    }

    private boolean pickFiles(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (pendingPick != null) pendingPick.onReceiveValue(null);
        pendingPick = callback;

        List<String> types = new ArrayList<>();
        for (String accept : params.getAcceptTypes()) {
            for (String type : accept.split(",")) {
                type = type.trim();
                if (type.contains("/")) types.add(type);
                if (type.equals("application/zip")) types.add("application/x-zip-compressed");
            }
        }
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(types.size() == 1 ? types.get(0) : "*/*");
        if (types.size() > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toArray(new String[0]));
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        try {
            startActivityForResult(intent, PICK_FILES);
            return true;
        } catch (ActivityNotFoundException e) {
            pendingPick = null;
            return false;
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_FILES && pendingPick != null) {
            pendingPick.onReceiveValue(result == RESULT_OK ? pickedUris(data) : null);
            pendingPick = null;
        } else if (request == SAVE_FILE) {
            if (result == RESULT_OK && data != null && data.getData() != null) {
                writeExport(data.getData());
            } else {
                finishExport("cancelled");
            }
        }
    }

    private static Uri[] pickedUris(Intent data) {
        if (data == null) return null;
        ClipData clip = data.getClipData();
        if (clip != null) {
            Uri[] uris = new Uri[clip.getItemCount()];
            for (int i = 0; i < uris.length; i++) uris[i] = clip.getItemAt(i).getUri();
            return uris;
        }
        return data.getData() != null ? new Uri[] {data.getData()} : null;
    }

    private void writeExport(Uri target) {
        new Thread(() -> {
            String outcome = "saved";
            try (InputStream in = new FileInputStream(exportFile);
                 OutputStream out = getContentResolver().openOutputStream(target, "wt")) {
                if (out == null) throw new IOException("No output for " + target);
                byte[] buffer = new byte[64 * 1024];
                for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            } catch (IOException e) {
                outcome = "failed";
            }
            String result = outcome;
            runOnUiThread(() -> finishExport(result));
        }).start();
    }

    private void finishExport(String outcome) {
        if (exportFile != null) exportFile.delete();
        exportFile = null;
        web.evaluateJavascript("Q.io.androidSaved('" + outcome + "')", null);
    }

    /** Called from js/io.js. Files are too big to pass in one call, so they arrive in pieces. */
    private class Bridge {
        private String name;
        private String type;

        @JavascriptInterface
        public void begin(String name, String type) throws IOException {
            this.name = name;
            this.type = type;
            exportFile = new File(getCacheDir(), "export.tmp");
            exportStream = new FileOutputStream(exportFile);
        }

        @JavascriptInterface
        public void append(String base64) throws IOException {
            exportStream.write(Base64.decode(base64, Base64.DEFAULT));
        }

        @JavascriptInterface
        public void finish() throws IOException {
            exportStream.close();
            exportStream = null;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(type)
                    .putExtra(Intent.EXTRA_TITLE, name);
            runOnUiThread(() -> {
                try {
                    startActivityForResult(intent, SAVE_FILE);
                } catch (ActivityNotFoundException e) {
                    finishExport("failed");
                }
            });
        }
    }
}
