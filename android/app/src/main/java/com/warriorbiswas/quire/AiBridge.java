package com.warriorbiswas.quire;

import android.app.ActivityManager;
import android.content.Context;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** What js/ai.js calls. Answers come back through Q.ai.event, since a request can run for minutes. */
final class AiBridge {
    static final class Cancelled extends Exception {
    }

    static final class Run {
        volatile boolean cancelled;
        volatile HttpURLConnection connection;

        void cancel() {
            cancelled = true;
            HttpURLConnection open = connection;
            if (open != null) open.disconnect();
        }
    }

    // The model holds over a gigabyte, and Android closes apps that push a phone past what it has.
    private static final long MODEL_MEMORY = 2_000_000_000L;

    private final MainActivity activity;
    final OnlineAI online;
    private final LocalLLM local = new LocalLLM();
    private final InkReader ink = new InkReader();
    private final ExecutorService workers = Executors.newCachedThreadPool();
    private final Map<Integer, Run> runs = new ConcurrentHashMap<>();

    AiBridge(MainActivity activity) {
        this.activity = activity;
        online = new OnlineAI(activity);
        ModelFile.use(activity);
    }

    void close() {
        for (Run run : runs.values()) run.cancel();
        ModelFile.writing.cancelled = true;
        local.unload();
    }

    void lowOnMemory() {
        local.unload();
    }

    @JavascriptInterface
    public boolean hasKey() {
        return online.hasKey();
    }

    @JavascriptInterface
    public void setKey(String key) {
        online.setKey(key);
    }

    @JavascriptInterface
    public void check(int id) {
        Run run = begin(id);
        workers.execute(() -> {
            try {
                finish(id, online.check(run));
            } catch (IOException | JSONException e) {
                fail(id, run, "online", e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void online(int id, String turns, int maxTokens) {
        Run run = begin(id);
        workers.execute(() -> {
            try {
                finish(id, online.generate(turns, maxTokens, run, raw -> emit(id, "partial", raw, "")));
            } catch (IOException | JSONException e) {
                fail(id, run, "online", e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void local(int id, String turns, int maxTokens, String grammar) {
        Run run = begin(id);
        if (!ModelFile.writing.installed()) {
            fail(id, run, "not_installed", "");
            return;
        }
        if (!enoughMemory()) {
            fail(id, run, "memory", "");
            return;
        }
        local.generate(turns, maxTokens, grammar.isEmpty() ? null : grammar, run, raw -> emit(id, "partial", raw, ""), (text, problem) -> {
            if (problem == null) {
                finish(id, text);
            } else if (problem instanceof LocalLLM.Failed && ((LocalLLM.Failed) problem).status == LocalLLM.TOO_LONG) {
                fail(id, run, "too_long", "");
            } else {
                fail(id, run, "failed", "");
            }
        });
    }

    @JavascriptInterface
    public void readInk(int id, String lines) {
        Run run = begin(id);
        workers.execute(() -> {
            try {
                finish(id, ink.read(lines, run));
            } catch (Exception e) {
                fail(id, run, "ink", String.valueOf(e.getMessage()));
            }
        });
    }

    @JavascriptInterface
    public void cancel(int id) {
        Run run = runs.get(id);
        if (run != null) run.cancel();
    }

    @JavascriptInterface
    public String modelState() {
        ModelFile model = ModelFile.writing;
        try {
            return new JSONObject()
                    .put("installed", model.installed())
                    .put("downloading", model.downloading)
                    .put("done", model.done)
                    .put("total", model.bytes)
                    .put("problem", model.problem == null ? JSONObject.NULL : model.problem)
                    .put("enoughMemory", enoughMemory())
                    .toString();
        } catch (JSONException e) {
            return "{}";
        }
    }

    @JavascriptInterface
    public void download() {
        ModelFile model = ModelFile.writing;
        if (model.downloading || model.installed()) return;
        workers.execute(() -> model.download(this::modelChanged));
    }

    @JavascriptInterface
    public void cancelDownload() {
        ModelFile.writing.cancelled = true;
    }

    @JavascriptInterface
    public void deleteModel() {
        local.unload();
        ModelFile.writing.delete();
    }

    private boolean enoughMemory() {
        if (ModelFile.writing.bytes < MODEL_MEMORY / 4) return true;
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        ((ActivityManager) activity.getSystemService(Context.ACTIVITY_SERVICE)).getMemoryInfo(memory);
        return memory.totalMem >= MODEL_MEMORY * 2;
    }

    private Run begin(int id) {
        Run run = new Run();
        runs.put(id, run);
        return run;
    }

    private void finish(int id, String text) {
        runs.remove(id);
        emit(id, "done", text, "");
    }

    private void fail(int id, Run run, String code, String message) {
        runs.remove(id);
        emit(id, "error", message == null ? "" : message, run.cancelled ? "cancelled" : code);
    }

    private void emit(int id, String type, String text, String code) {
        String call = "Q.ai.event(" + id + "," + JSONObject.quote(type) + "," + JSONObject.quote(text) + "," + JSONObject.quote(code) + ")";
        post(call);
    }

    private void modelChanged() {
        post("Q.ai.modelChanged()");
    }

    private void post(String call) {
        activity.runOnUiThread(() -> {
            WebView web = activity.web;
            if (web != null && !activity.isDestroyed()) web.evaluateJavascript(call, null);
        });
    }
}
