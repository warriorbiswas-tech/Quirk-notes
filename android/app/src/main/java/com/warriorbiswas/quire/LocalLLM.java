package com.warriorbiswas.quire;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/** Runs the writing model one request at a time on its own thread. */
final class LocalLLM {
    static final int OK = 0, TOO_LONG = -2;
    private static final int CONTEXT_TOKENS = 8192;
    private static final long IDLE_UNLOAD_SECONDS = 300;

    static {
        System.loadLibrary("quirk");
    }

    interface Output {
        void partial(String raw);
    }

    /** Called from the model's thread with each token's bytes. Returning false stops it. */
    static final class Sink {
        private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        private final AiBridge.Run run;
        private final Output output;
        private long nextPartial;

        Sink(AiBridge.Run run, Output output) {
            this.run = run;
            this.output = output;
        }

        boolean onBytes(byte[] piece) {
            if (run.cancelled) return false;
            bytes.write(piece, 0, piece.length);
            long now = System.currentTimeMillis();
            if (now >= nextPartial) {
                nextPartial = now + 100;
                output.partial(text());
            }
            return true;
        }

        String text() {
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private final ScheduledExecutorService thread = Executors.newSingleThreadScheduledExecutor();
    private long handle;
    private ScheduledFuture<?> idleUnload;

    static final class Failed extends Exception {
        final int status;

        Failed(int status) {
            this.status = status;
        }
    }

    interface Done {
        void finished(String text, Exception problem);
    }

    void generate(String turnsJson, int maxTokens, String grammar, AiBridge.Run run, Output output, Done done) {
        thread.execute(() -> {
            try {
                if (idleUnload != null) idleUnload.cancel(false);
                if (run.cancelled) throw new AiBridge.Cancelled();
                if (handle == 0) {
                    int threads = Math.min(6, Math.max(Runtime.getRuntime().availableProcessors() - 2, 2));
                    handle = nativeOpen(ModelFile.writing.path().getPath(), CONTEXT_TOKENS, threads);
                }
                if (handle == 0) throw new Failed(-1);

                JSONArray turns = new JSONArray(turnsJson);
                byte[][] roles = new byte[turns.length()][], contents = new byte[turns.length()][];
                for (int i = 0; i < turns.length(); i++) {
                    JSONObject turn = turns.getJSONObject(i);
                    roles[i] = turn.getString("role").getBytes(StandardCharsets.UTF_8);
                    contents[i] = turn.getString("text").getBytes(StandardCharsets.UTF_8);
                }
                Sink sink = new Sink(run, output);
                int status = nativeGenerate(handle, roles, contents, maxTokens, 0.4f, grammar, sink);
                if (run.cancelled) throw new AiBridge.Cancelled();
                if (status != OK) throw new Failed(status);
                done.finished(sink.text(), null);
            } catch (Failed | AiBridge.Cancelled | JSONException e) {
                done.finished(null, e);
            } finally {
                idleUnload = thread.schedule(this::unloadNow, IDLE_UNLOAD_SECONDS, TimeUnit.SECONDS);
            }
        });
    }

    /** Frees over a gigabyte of memory; the model reloads on the next request. */
    void unload() {
        thread.execute(this::unloadNow);
    }

    private void unloadNow() {
        if (handle != 0) nativeClose(handle);
        handle = 0;
    }

    private static native long nativeOpen(String path, int contextTokens, int threads);

    private static native void nativeClose(long handle);

    private static native int nativeGenerate(long handle, byte[][] roles, byte[][] contents, int maxTokens, float temperature, String grammar, Sink sink);
}
