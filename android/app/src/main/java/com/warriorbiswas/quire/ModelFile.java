package com.warriorbiswas.quire;

import android.content.Context;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** The writing model, pinned to one exact file so what runs is what was reviewed. The same one the iPad app uses. */
final class ModelFile {
    static ModelFile writing = new ModelFile(
            "Qwen3-1.7B-Q4_K_M.gguf",
            "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf",
            1_107_409_472L,
            "b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897");

    static File directory;

    final String name, url, sha256;
    final long bytes;

    volatile boolean downloading;
    volatile boolean cancelled;
    volatile long done;
    volatile String problem;

    ModelFile(String name, String url, long bytes, String sha256) {
        this.name = name;
        this.url = url;
        this.bytes = bytes;
        this.sha256 = sha256;
    }

    static void use(Context context) {
        directory = new File(context.getFilesDir(), "Models");
    }

    File path() {
        return new File(directory, name);
    }

    boolean installed() {
        return path().exists();
    }

    /** Picks up where an earlier attempt stopped, and keeps the file only if it is the right one. */
    void download(Runnable changed) {
        File partial = new File(directory, name + ".part");
        downloading = true;
        cancelled = false;
        problem = null;
        changed.run();
        try {
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Couldn't create the models folder.");
            long have = partial.length();
            if (directory.getUsableSpace() < bytes - have + 200_000_000L) {
                throw new IOException("Free up " + (bytes / 1_000_000_000L + 1) + " GB of storage, then try again.");
            }
            HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(60_000);
            if (have > 0) connection.setRequestProperty("Range", "bytes=" + have + "-");
            try {
                int status = connection.getResponseCode();
                if (status != 200 && status != 206) throw new IOException("The download failed (error " + status + "). Try again later.");
                boolean resuming = status == 206;
                done = resuming ? have : 0;
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(partial, resuming)) {
                    byte[] buffer = new byte[256 * 1024];
                    long nextUpdate = 0;
                    for (int n; (n = in.read(buffer)) > 0; ) {
                        if (cancelled) return;
                        out.write(buffer, 0, n);
                        done += n;
                        long now = System.currentTimeMillis();
                        if (now >= nextUpdate) {
                            nextUpdate = now + 250;
                            changed.run();
                        }
                    }
                }
            } finally {
                connection.disconnect();
            }
            if (partial.length() < bytes) throw new IOException("The download stopped early. Try again to continue it.");
            if (!sha256.equals(digest(partial))) {
                partial.delete();
                throw new IOException("The downloaded file was damaged. Try again.");
            }
            if (!partial.renameTo(path())) throw new IOException("Couldn't save the model.");
        } catch (IOException e) {
            problem = e.getMessage() != null ? e.getMessage() : "The download failed. Try again later.";
        } finally {
            downloading = false;
            changed.run();
        }
    }

    void delete() {
        path().delete();
        new File(directory, name + ".part").delete();
        done = 0;
        problem = null;
    }

    private static String digest(File file) throws IOException {
        try (InputStream in = new FileInputStream(file)) {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[1024 * 1024];
            for (int n; (n = in.read(buffer)) > 0; ) sha.update(buffer, 0, n);
            StringBuilder hex = new StringBuilder();
            for (byte b : sha.digest()) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IOException(e);
        }
    }
}
