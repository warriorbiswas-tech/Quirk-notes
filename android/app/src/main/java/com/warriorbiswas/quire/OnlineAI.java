package com.warriorbiswas.quire;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.HashSet;
import java.util.Set;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Large open models on NVIDIA's servers, reached with the user's own free key from build.nvidia.com.
 * The key stays on this side of the bridge, so the page never holds it.
 */
final class OnlineAI {
    static String endpoint = "https://integrate.api.nvidia.com/v1";

    /** Best first. NVIDIA retires models now and then, so the first one the key can still reach is used. */
    private static final String[][] MODELS = {
            {"deepseek-ai/deepseek-v4-pro", "DeepSeek V4 Pro"},
            {"deepseek-ai/deepseek-v4-flash", "DeepSeek V4 Flash"},
            {"moonshotai/kimi-k2-instruct", "Kimi K2"},
            {"deepseek-ai/deepseek-v3.1", "DeepSeek V3.1"},
            {"qwen/qwen3-235b-a22b", "Qwen3 235B"},
            {"openai/gpt-oss-120b", "gpt-oss 120B"},
            {"meta/llama-3.3-70b-instruct", "Llama 3.3 70B"},
    };

    static final class Problem extends IOException {
        final boolean retired;

        Problem(String message) {
            this(message, false);
        }

        Problem(String message, boolean retired) {
            super(message);
            this.retired = retired;
        }
    }

    private static final String KEY_ALIAS = "quirk.nvidia";

    private final SharedPreferences preferences;
    private final Set<String> retired = new HashSet<>();
    private String key;
    private String[] resolved;

    OnlineAI(Context context) {
        preferences = context.getSharedPreferences("ai", Context.MODE_PRIVATE);
        key = readKey();
    }

    synchronized boolean hasKey() {
        return key != null && !key.isEmpty();
    }

    synchronized void setKey(String value) {
        key = value == null || value.trim().isEmpty() ? null : value.trim();
        resolved = null;
        retired.clear();
        saveKey(key);
    }

    /** Confirms the key with a tiny request and says which model will answer. */
    String check(AiBridge.Run run) throws IOException, JSONException {
        synchronized (this) {
            resolved = null;
            retired.clear();
        }
        String[] model = currentModel(run);
        JSONArray turns = new JSONArray().put(new JSONObject().put("role", "user").put("text", "Reply with OK."));
        stream(model[0], turns, 16, run, null);
        return model[1];
    }

    String generate(String turnsJson, int maxTokens, AiBridge.Run run, LocalLLM.Output output) throws IOException, JSONException {
        JSONArray turns = new JSONArray(turnsJson);
        String[] model = currentModel(run);
        try {
            return stream(model[0], turns, maxTokens, run, output);
        } catch (Problem problem) {
            if (!problem.retired) throw problem;
            // Retired since the list was fetched, so the next best one answers.
            synchronized (this) {
                retired.add(model[0]);
                resolved = null;
            }
            return stream(currentModel(run)[0], turns, maxTokens, run, output);
        }
    }

    private String[] currentModel(AiBridge.Run run) throws IOException, JSONException {
        synchronized (this) {
            if (resolved != null) return resolved;
        }
        HttpURLConnection connection = authorized("models");
        run.connection = connection;
        try {
            verify(connection);
            JSONArray data = new JSONObject(readAll(connection.getInputStream())).getJSONArray("data");
            Set<String> reachable = new HashSet<>();
            for (int i = 0; i < data.length(); i++) reachable.add(data.getJSONObject(i).getString("id"));
            synchronized (this) {
                for (String[] model : MODELS) {
                    if (reachable.contains(model[0]) && !retired.contains(model[0])) return resolved = model;
                }
            }
            throw new Problem("This key can't reach any of the models Quirk Notes uses.");
        } finally {
            connection.disconnect();
        }
    }

    private HttpURLConnection authorized(String path) throws IOException {
        String current;
        synchronized (this) {
            current = key;
        }
        if (current == null) throw new Problem("Add your NVIDIA API key in Settings.");
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint + "/" + path).openConnection();
        connection.setRequestProperty("Authorization", "Bearer " + current);
        connection.setConnectTimeout(30_000);
        // Reasoning models can think for a while before the first word, but they send something all along.
        connection.setReadTimeout(90_000);
        return connection;
    }

    private static void verify(HttpURLConnection connection) throws IOException {
        int status = connection.getResponseCode();
        switch (status) {
            case 200:
                return;
            case 401:
            case 403:
                throw new Problem("NVIDIA didn't accept the API key. Check it in Settings.");
            case 404:
                throw new Problem("That model isn't available from NVIDIA any more.", true);
            case 429:
                throw new Problem("NVIDIA's free tier is busy right now. Try again in a minute.");
            default:
                throw new Problem("NVIDIA couldn't answer (error " + status + "). Try again later.");
        }
    }

    private String stream(String model, JSONArray turns, int maxTokens, AiBridge.Run run, LocalLLM.Output output) throws IOException, JSONException {
        JSONArray messages = new JSONArray();
        for (int i = 0; i < turns.length(); i++) {
            JSONObject turn = turns.getJSONObject(i);
            messages.put(new JSONObject().put("role", turn.getString("role")).put("content", turn.getString("text")));
        }
        JSONObject body = new JSONObject()
                .put("model", model)
                .put("messages", messages)
                // Reasoning counts against the limit too, so allow well past the length of the answer itself.
                .put("max_tokens", Math.min(4096, Math.max(1024, maxTokens * 3)))
                .put("temperature", 0.4)
                .put("top_p", 0.9)
                .put("stream", true);

        HttpURLConnection connection = authorized("chat/completions");
        run.connection = connection;
        try {
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("Accept", "text/event-stream");
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body.toString().getBytes(StandardCharsets.UTF_8));
            }
            verify(connection);

            StringBuilder raw = new StringBuilder();
            long nextPartial = 0;
            try (BufferedReader lines = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                for (String line; (line = lines.readLine()) != null; ) {
                    if (!line.startsWith("data:")) continue;
                    String payload = line.substring(5).trim();
                    if (payload.equals("[DONE]")) break;
                    String piece = contentOf(payload);
                    if (piece == null) continue;
                    raw.append(piece);
                    long now = System.currentTimeMillis();
                    if (output != null && now >= nextPartial) {
                        nextPartial = now + 100;
                        output.partial(raw.toString());
                    }
                }
            }
            return raw.toString();
        } finally {
            connection.disconnect();
        }
    }

    /** Reasoning arrives in its own field, which is left out, or inside think tags, which the page drops. */
    private static String contentOf(String payload) {
        try {
            JSONArray choices = new JSONObject(payload).getJSONArray("choices");
            if (choices.length() == 0) return null;
            JSONObject delta = choices.getJSONObject(0).optJSONObject("delta");
            if (delta == null || delta.isNull("content")) return null;
            return delta.getString("content");
        } catch (JSONException e) {
            return null;
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            for (int n; (n = stream.read(buffer)) > 0; ) out.write(buffer, 0, n);
            return out.toString("UTF-8");
        }
    }

    private SecretKey secret() throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build());
        return generator.generateKey();
    }

    private void saveKey(String value) {
        if (value == null) {
            preferences.edit().remove("key").remove("iv").apply();
            return;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, secret());
            byte[] sealed = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            preferences.edit()
                    .putString("key", Base64.encodeToString(sealed, Base64.NO_WRAP))
                    .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                    .apply();
        } catch (GeneralSecurityException | IOException e) {
            preferences.edit().remove("key").remove("iv").apply();
        }
    }

    /** A key restored from a backup onto another device can't be opened here, and simply counts as no key. */
    private String readKey() {
        String sealed = preferences.getString("key", null), iv = preferences.getString("iv", null);
        if (sealed == null || iv == null) return null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, secret(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(sealed, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IOException | IllegalArgumentException e) {
            return null;
        }
    }
}
