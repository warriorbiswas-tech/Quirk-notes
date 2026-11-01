package com.warriorbiswas.quire;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.net.Uri;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.View;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.nio.file.Files;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

@RunWith(AndroidJUnit4.class)
public class AppTest {
    private static final long WAIT_MS = 60_000;

    static String eval(ActivityScenario<MainActivity> app, String js) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        app.onActivity(a -> a.web.evaluateJavascript(js, v -> {
            value.set(v);
            done.countDown();
        }));
        assertTrue("page did not answer: " + js, done.await(30, TimeUnit.SECONDS));
        return value.get();
    }

    static void waitFor(ActivityScenario<MainActivity> app, String js) throws Exception {
        waitFor(app, js, WAIT_MS);
    }

    static void waitFor(ActivityScenario<MainActivity> app, String js, long timeout) throws Exception {
        long end = SystemClock.uptimeMillis() + timeout;
        while (SystemClock.uptimeMillis() < end) {
            if ("true".equals(eval(app, js))) return;
            Thread.sleep(250);
        }
        fail("timed out waiting for: " + js);
    }

    /** Runs an async expression, then returns what it resolved to as JSON. */
    static String evalAsync(ActivityScenario<MainActivity> app, String js) throws Exception {
        eval(app, "window.__r = undefined; Promise.resolve().then(() => " + js + ")"
                + ".then((v) => { window.__r = JSON.stringify({ ok: v === undefined ? null : v }); },"
                + " (e) => { window.__r = JSON.stringify({ error: String(e) }); }); 0");
        waitFor(app, "window.__r !== undefined");
        return eval(app, "window.__r");
    }

    static ActivityScenario<MainActivity> launch() throws Exception {
        ActivityScenario<MainActivity> app = ActivityScenario.launch(MainActivity.class);
        waitFor(app, "document.body.classList.contains('ready')");
        return app;
    }

    @Test
    public void startsWithStorageAndNoIPadWording() throws Exception {
        try (ActivityScenario<MainActivity> app = launch()) {
            assertEquals("true", eval(app, "Q.store.available === true"));
            assertEquals("true", eval(app, "!!window.QuireAndroid"));
            String text = eval(app, "document.body.innerText");
            assertFalse(text, text.contains("Home Screen"));
            assertFalse(text, text.contains("Safari"));
            assertFalse(text, text.contains("Apple Pencil"));
        }
    }

    @Test
    public void notebooksSurviveARestart() throws Exception {
        String title = "Saved " + System.currentTimeMillis();
        try (ActivityScenario<MainActivity> app = launch()) {
            String r = evalAsync(app, "Q.app.createNotebook({ title: '" + title + "' }).then(() => Q.app.flushAll())");
            assertFalse(r, r.contains("error"));
            Thread.sleep(1500);
        }
        try (ActivityScenario<MainActivity> app = launch()) {
            assertEquals("true", eval(app, "Q.app.library.notebooks.some((n) => n.title === '" + title + "')"));
        }
    }

    @Test
    public void shrinksLargeImagesKeepingTheirShape() throws Exception {
        try (ActivityScenario<MainActivity> app = launch()) {
            String r = evalAsync(app, "(async () => { const c = Q.util.makeCanvas(3000, 1500);"
                    + " c.getContext('2d').fillRect(0, 0, 9, 9);"
                    + " const b = await Q.util.canvasToBlob(c, 'image/png');"
                    + " const p = await Q.io.prepareImage(new File([b], 'wide.png', { type: 'image/png' }));"
                    + " return p.w + 'x' + p.h; })()");
            assertEquals(r, "{\"ok\":\"2400x1200\"}", unquote(r));
        }
    }

    @Test
    public void opensAPdf() throws Exception {
        String pdf = "%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n"
                + "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n"
                + "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\\ntrailer<</Root 1 0 R>>";
        try (ActivityScenario<MainActivity> app = launch()) {
            String r = evalAsync(app, "Q.io.loadPdfJs().then((p) => p.getDocument({ data: new TextEncoder().encode('"
                    + pdf + "'), isEvalSupported: false }).promise).then((d) => d.numPages)");
            assertEquals(r, "{\"ok\":1}", unquote(r));
        }
    }

    @Test
    public void savesALargeFileThroughTheBridge() throws Exception {
        Instrumentation inst = InstrumentationRegistry.getInstrumentation();
        File out = new File(inst.getTargetContext().getCacheDir(), "saved.bin");
        out.delete();
        out.createNewFile();
        // Stands in for the system's save screen, answering as if the person chose this file.
        Instrumentation.ActivityMonitor picker = new Instrumentation.ActivityMonitor() {
            @Override
            public Instrumentation.ActivityResult onStartActivity(Intent intent) {
                if (!Intent.ACTION_CREATE_DOCUMENT.equals(intent.getAction())) return null;
                return new Instrumentation.ActivityResult(Activity.RESULT_OK, new Intent().setData(Uri.fromFile(out)));
            }
        };
        inst.addMonitor(picker);
        int size = 7_000_003; // crosses two chunk boundaries and ends mid-chunk
        try (ActivityScenario<MainActivity> app = launch()) {
            String r = evalAsync(app, "(() => { const b = new Uint8Array(" + size + ");"
                    + " for (let i = 0; i < b.length; i++) b[i] = i % 251;"
                    + " return Q.io.deliver(new Blob([b], { type: 'application/zip' }), 'backup.zip'); })()");
            assertEquals(r, "{\"ok\":\"saved\"}", unquote(r));
        } finally {
            inst.removeMonitor(picker);
        }
        byte[] expected = new byte[size];
        for (int i = 0; i < size; i++) expected[i] = (byte) (i % 251);
        assertArrayEquals(expected, Files.readAllBytes(out.toPath()));
    }

    @Test
    public void stylusDrawsAStroke() throws Exception {
        String title = "Ink " + System.currentTimeMillis();
        try (ActivityScenario<MainActivity> app = launch()) {
            String r = evalAsync(app, "Q.app.createNotebook({ title: '" + title + "' })"
                    + ".then(() => Q.app.openNotebook(Q.app.library.notebooks.find((n) => n.title === '" + title + "').id))");
            assertFalse(r, r.contains("error"));
            waitFor(app, "!!Q.app.editor");
            Thread.sleep(1000);
            String count = "Q.app.editor.pages.reduce((sum, p) => sum + p.els.length, 0)";
            assertEquals("0", eval(app, count));
            drawWithStylus(app);
            waitFor(app, count + " === 1");
            app.onActivity(MainActivity::goBack);
            waitFor(app, "!Q.app.editor");
            Thread.sleep(500);
        }
    }

    /** A stylus line across the middle of the page, with pressure, sent as real input events to the app's own view. */
    private static void drawWithStylus(ActivityScenario<MainActivity> app) throws Exception {
        long end = SystemClock.uptimeMillis() + WAIT_MS;
        AtomicReference<Boolean> focused = new AtomicReference<>(false);
        while (!focused.get() && SystemClock.uptimeMillis() < end) {
            app.onActivity(a -> focused.set(a.hasWindowFocus()));
            if (!focused.get()) Thread.sleep(250);
        }
        assertTrue("something is covering the app", focused.get());
        app.onActivity(a -> {
            View v = a.web;
            float x = v.getWidth() / 3f, y = v.getHeight() / 2f, length = v.getWidth() / 3f;
            long down = SystemClock.uptimeMillis();
            a.web.dispatchTouchEvent(stylus(down, down, MotionEvent.ACTION_DOWN, x, y));
            for (int i = 1; i <= 20; i++) {
                a.web.dispatchTouchEvent(stylus(down, down + i * 16L, MotionEvent.ACTION_MOVE, x + length * i / 20f, y + 10 * (i % 2)));
            }
            a.web.dispatchTouchEvent(stylus(down, down + 400, MotionEvent.ACTION_UP, x + length, y));
        });
    }

    private static MotionEvent stylus(long down, long time, int action, float x, float y) {
        MotionEvent.PointerProperties props = new MotionEvent.PointerProperties();
        props.id = 0;
        props.toolType = MotionEvent.TOOL_TYPE_STYLUS;
        MotionEvent.PointerCoords coords = new MotionEvent.PointerCoords();
        coords.x = x;
        coords.y = y;
        coords.pressure = 0.6f;
        coords.size = 1;
        return MotionEvent.obtain(down, time, action, 1, new MotionEvent.PointerProperties[] {props},
                new MotionEvent.PointerCoords[] {coords}, 0, 0, 1, 1, 0, 0, InputDevice.SOURCE_STYLUS, 0);
    }

    /** evaluateJavascript hands strings back JSON-encoded. */
    private static String unquote(String json) {
        return json.substring(1, json.length() - 1).replace("\\\"", "\"");
    }
}
