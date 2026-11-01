package com.warriorbiswas.quire;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.content.SharedPreferences;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Runs the AI against a stand-in for NVIDIA and a real, tiny model, so llama.cpp itself is exercised. */
@RunWith(AndroidJUnit4.class)
public class AiTest {
    private static final class StandIn implements Runnable {
        final ServerSocket server;
        volatile int chatStatus = 200;
        volatile String answer = "<think>Hidden</think>Online answer.";
        volatile String models = "[\"moonshotai/kimi-k2-instruct\",\"meta/llama-3.3-70b-instruct\"]";
        final Set<String> retired = new HashSet<>();
        final List<String> chatModels = new ArrayList<>();
        volatile String authorization;
        volatile String range;
        volatile byte[] file;

        StandIn() throws IOException {
            server = new ServerSocket(0, 16, InetAddress.getByName("127.0.0.1"));
            new Thread(this).start();
        }

        String url() {
            return "http://127.0.0.1:" + server.getLocalPort();
        }

        @Override
        public void run() {
            while (!server.isClosed()) {
                try (Socket socket = server.accept()) {
                    respond(socket);
                } catch (IOException | org.json.JSONException ignored) {
                }
            }
        }

        private void respond(Socket socket) throws IOException, org.json.JSONException {
            InputStream in = socket.getInputStream();
            ByteArrayOutputStream head = new ByteArrayOutputStream();
            while (!head.toString("UTF-8").endsWith("\r\n\r\n")) {
                int b = in.read();
                if (b < 0) return;
                head.write(b);
            }
            String request = head.toString("UTF-8");
            String path = request.split(" ")[1];
            int length = 0;
            String rangeHeader = null;
            for (String line : request.split("\r\n")) {
                String lower = line.toLowerCase();
                if (lower.startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                if (lower.startsWith("authorization:")) authorization = line.substring(14).trim();
                if (lower.startsWith("range:")) rangeHeader = line.substring(6).trim();
            }
            byte[] body = new byte[length];
            for (int read = 0; read < length; ) read += in.read(body, read, length - read);
            OutputStream out = socket.getOutputStream();

            if (path.endsWith("/tiny.gguf")) {
                range = rangeHeader;
                int from = 0;
                if (rangeHeader != null) {
                    Matcher m = Pattern.compile("bytes=(\\d+)-").matcher(rangeHeader);
                    assertTrue(m.find());
                    from = Integer.parseInt(m.group(1));
                }
                send(out, rangeHeader == null ? "200 OK" : "206 Partial Content", "application/octet-stream", file, from);
            } else if (path.endsWith("/models")) {
                JSONArray ids = new JSONArray(models), data = new JSONArray();
                for (int i = 0; i < ids.length(); i++) data.put(new JSONObject().put("id", ids.getString(i)));
                send(out, chatStatus == 401 ? "401 Unauthorized" : "200 OK", "application/json", new JSONObject().put("data", data).toString().getBytes(StandardCharsets.UTF_8), 0);
            } else {
                String model = new JSONObject(new String(body, StandardCharsets.UTF_8)).getString("model");
                chatModels.add(model);
                if (retired.contains(model)) {
                    send(out, "404 Not Found", "text/plain", new byte[0], 0);
                } else if (chatStatus != 200) {
                    send(out, chatStatus + " Error", "text/plain", new byte[0], 0);
                } else {
                    StringBuilder events = new StringBuilder();
                    int middle = answer.length() / 2;
                    for (String piece : new String[] {answer.substring(0, middle), answer.substring(middle)}) {
                        JSONObject delta = new JSONObject().put("content", piece);
                        JSONObject choice = new JSONObject().put("delta", delta);
                        events.append("data: ").append(new JSONObject().put("choices", new JSONArray().put(choice))).append("\n\n");
                    }
                    events.append("data: [DONE]\n\n");
                    send(out, "200 OK", "text/event-stream", events.toString().getBytes(StandardCharsets.UTF_8), 0);
                }
            }
        }

        private static void send(OutputStream out, String status, String type, byte[] data, int from) throws IOException {
            String head = "HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + (data.length - from) + "\r\nConnection: close\r\n\r\n";
            out.write(head.getBytes(StandardCharsets.UTF_8));
            out.write(data, from, data.length - from);
            out.flush();
        }
    }

    private StandIn nvidia;
    private byte[] tiny;
    private String tinySha;

    @Before
    public void setUp() throws Exception {
        nvidia = new StandIn();
        OnlineAI.endpoint = nvidia.url() + "/v1";
        try (InputStream in = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("tiny.gguf")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[65536];
            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
            tiny = out.toByteArray();
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(tiny)) hex.append(String.format("%02x", b));
        tinySha = hex.toString();
        nvidia.file = tiny;
        ModelFile.writing = new ModelFile("tiny.gguf", nvidia.url() + "/tiny.gguf", tiny.length, tinySha);
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        ModelFile.use(context);
        ModelFile.writing.delete();
        new OnlineAI(context).setKey(null);
    }

    @After
    public void tearDown() throws Exception {
        nvidia.server.close();
    }

    private void installModel() throws Exception {
        ModelFile.directory.mkdirs();
        try (OutputStream out = new FileOutputStream(ModelFile.writing.path())) {
            out.write(tiny);
        }
    }

    private static String unquote(String json) throws Exception {
        return new JSONArray("[" + json + "]").getString(0);
    }

    private static JSONObject call(ActivityScenario<MainActivity> app, String expression) throws Exception {
        return new JSONObject(unquote(AppTest.evalAsync(app, expression)));
    }

    private static void setKey(ActivityScenario<MainActivity> app, String key) throws Exception {
        AppTest.eval(app, "Q.ai.setKey('" + key + "'); 0");
    }

    @Test
    public void keyIsSealedAndNeverReachesThePage() throws Exception {
        try (ActivityScenario<MainActivity> app = AppTest.launch()) {
            assertEquals("true", AppTest.eval(app, "Q.ai.supported"));
            assertEquals("false", AppTest.eval(app, "Q.ai.hasKey()"));
            setKey(app, "nvapi-secret");
            assertEquals("true", AppTest.eval(app, "Q.ai.hasKey()"));
            assertEquals("undefined", AppTest.eval(app, "typeof QuirkAI.getKey").replace("\"", ""));
            assertEquals("{\"ok\":\"Kimi K2\"}", unquote(AppTest.evalAsync(app, "Q.ai.checkKey()")));
            assertEquals("Bearer nvapi-secret", nvidia.authorization);
        }
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences saved = context.getSharedPreferences("ai", Context.MODE_PRIVATE);
        assertNotNull(saved.getString("key", null));
        assertFalse(saved.getAll().toString().contains("nvapi-secret"));
        assertTrue(new OnlineAI(context).hasKey());
    }

    @Test
    public void onlineAnswersDropReasoningAndUseTheBestReachableModel() throws Exception {
        try (ActivityScenario<MainActivity> app = AppTest.launch()) {
            setKey(app, "k");
            JSONObject summary = call(app, "Q.ai.summary('Mitosis divides a cell.')");
            assertEquals(summary.toString(), "Online answer.", summary.getString("ok"));
            assertEquals("moonshotai/kimi-k2-instruct", nvidia.chatModels.get(nvidia.chatModels.size() - 1));

            nvidia.answer = "Here you go:\n[{\"front\":\"Q\",\"back\":\"A\"}]";
            JSONObject cards = call(app, "Q.ai.flashcards('Notes.')");
            assertEquals("A", cards.getJSONArray("ok").getJSONObject(0).getString("back"));

            nvidia.answer = "[{\"question\":\"Q?\",\"options\":[\"A. one\",\"B. two\",\"C. three\",\"D. four\"],\"answer\":1}]";
            JSONObject quiz = call(app, "Q.ai.quiz('Notes.')");
            assertEquals("two", quiz.getJSONArray("ok").getJSONObject(0).getJSONArray("options").getString(1));

            nvidia.answer = "[{\"title\":\"Topic\",\"children\":[{\"title\":\"Branch\"}]}]";
            assertEquals("Topic", call(app, "Q.ai.mindMap('Notes.')").getJSONObject("ok").getString("title"));

            nvidia.answer = "Online answer.";
            nvidia.retired.add("moonshotai/kimi-k2-instruct");
            assertEquals("Online answer.", call(app, "Q.ai.complete('System', 'Hi')").getString("ok"));
            assertEquals("meta/llama-3.3-70b-instruct", nvidia.chatModels.get(nvidia.chatModels.size() - 1));
        }
    }

    @Test
    public void problemsReadClearlyWithoutAModelToFallBackOn() throws Exception {
        try (ActivityScenario<MainActivity> app = AppTest.launch()) {
            assertTrue(call(app, "Q.ai.complete('System', 'Hi')").getString("error").contains("not_installed") == false);
            String none = AppTest.eval(app, "Q.ai.isAvailable()");
            assertEquals("false", none);
            setKey(app, "k");
            nvidia.chatStatus = 401;
            assertTrue(call(app, "Q.ai.checkKey()").getString("error").contains("didn't accept"));
            nvidia.chatStatus = 429;
            assertTrue(call(app, "Q.ai.complete('System', 'Hi')").getString("error").contains("busy"));
            nvidia.chatStatus = 200;
            nvidia.answer = "<think>only reasoning</think>";
            assertTrue(call(app, "Q.ai.complete('System', 'Hi')").getString("error").contains("empty"));
            nvidia.answer = "not json";
            assertTrue(call(app, "Q.ai.flashcards('Notes.')").getString("error").contains("couldn’t be read"));
        }
    }

    @Test
    public void downloadResumesAndRejectsADamagedFile() throws Exception {
        ModelFile.directory.mkdirs();
        try (OutputStream out = new FileOutputStream(new File(ModelFile.directory, "tiny.gguf.part"))) {
            out.write(tiny, 0, tiny.length / 2);
        }
        ModelFile.writing.download(() -> { });
        assertTrue(ModelFile.writing.problem, ModelFile.writing.installed());
        assertEquals("bytes=" + (tiny.length / 2) + "-", nvidia.range);
        assertEquals(tiny.length, ModelFile.writing.path().length());

        ModelFile damaged = new ModelFile("damaged.gguf", nvidia.url() + "/tiny.gguf", tiny.length, "00");
        damaged.download(() -> { });
        assertFalse(damaged.installed());
        assertTrue(damaged.problem, damaged.problem.contains("damaged"));
        assertFalse(new File(ModelFile.directory, "damaged.gguf.part").exists());
    }

    @Test
    public void onDeviceModelAnswersKeepsToItsGrammarAndFallsInWhenOnlineFails() throws Exception {
        installModel();
        try (ActivityScenario<MainActivity> app = AppTest.launch()) {
            assertEquals("true", AppTest.eval(app, "Q.ai.isAvailable()"));
            String turns = "[{role:'user',text:'Once upon a time'}]";
            JSONObject free = call(app, "Q.ai.write(" + turns + ", { maxTokens: 24 })");
            assertFalse(free.toString(), free.getString("ok").isEmpty());

            String choice = call(app, "Q.ai.write(" + turns + ", { maxTokens: 8, grammar: 'root ::= \"yes\" | \"no\"' })").getString("ok");
            assertTrue(choice, choice.equals("yes") || choice.equals("no"));

            JSONObject tooLong = call(app, "Q.ai.write([{role:'user',text:'word '.repeat(40000)}], { maxTokens: 8 }).catch((e) => e.code)");
            assertEquals("too_long", tooLong.getString("ok"));

            JSONObject stopped = call(app, "(() => { const c = new AbortController(); const p = Q.ai.write(" + turns + ", { maxTokens: 4000, signal: c.signal }).catch((e) => e.name); setTimeout(() => c.abort(), 50); return p; })()");
            assertEquals("AbortError", stopped.getString("ok"));

            setKey(app, "k");
            nvidia.chatStatus = 500;
            JSONObject fallback = call(app, "Q.ai.write(" + turns + ", { maxTokens: 24 })");
            assertFalse(fallback.toString(), fallback.getString("ok").isEmpty());
            assertFalse(nvidia.chatModels.isEmpty());

            nvidia.chatStatus = 200;
            nvidia.answer = "not json";
            String asked = "Q.ai.write(" + turns + ", { maxTokens: 8, grammar: 'root ::= \"yes\"', usable: (r) => r === 'never' })";
            assertEquals("yes", call(app, asked).getString("ok"));
        }
    }

    @Test
    public void handwritingGroupsIntoLinesAndNeverStopsTheTools() throws Exception {
        try (ActivityScenario<MainActivity> app = AppTest.launch()) {
            String stroke = "(x, y) => ({ t: 's', k: 'pen', pts: new Float32Array([x, y, .5, x + 8, y + 12, .5, x + 16, y, .5]) })";
            String page = "{ id: 'ink-test', els: [" + "s(50, 300), s(20, 100), s(60, 104), s(20, 300)".replace("s(", "(" + stroke + ")(") + "], txt: 'PDF words' }";
            JSONObject lines = call(app, "Q.ai.inkLines(" + page + ")");
            JSONArray grouped = lines.getJSONArray("ok");
            assertEquals(2, grouped.length());
            assertEquals(2, grouped.getJSONArray(0).length());
            assertEquals(20.0, grouped.getJSONArray(0).getJSONArray(0).getDouble(0), 0.01);

            // The reader may have to download first, so it gets longer than other calls. Either way the text survives.
            AppTest.eval(app, "window.__ink = undefined; Q.ai.pageTexts([" + page + "]).then((r) => { window.__ink = JSON.stringify(r); }, (e) => { window.__ink = 'threw ' + e; }); 0");
            AppTest.waitFor(app, "window.__ink !== undefined", 240_000);
            JSONObject result = new JSONObject(unquote(AppTest.eval(app, "window.__ink")));
            assertTrue(result.toString(), result.getJSONArray("pages").getString(0).contains("PDF words"));
        }
    }

    @Test
    public void studyScreensWorkFromEndToEnd() throws Exception {
        try (ActivityScenario<MainActivity> app = AppTest.launch()) {
            setKey(app, "k");
            String title = "Study " + System.currentTimeMillis();
            String opened = unquote(AppTest.evalAsync(app, "Q.app.createNotebook({ title: '" + title + "', page: {} })"
                    + ".then(() => Q.app.openNotebook(Q.app.library.notebooks.find((n) => n.title === '" + title + "').id))"
                    + ".then(() => { Q.app.editor.pages[0].els.push({ t: 't', id: 'x', txt: 'Mitosis divides a cell into two.' }); window.__s = Q.app.editor.openStudy(); })"));
            assertFalse(opened, opened.contains("error"));
            AppTest.waitFor(app, "!!document.querySelector('.ai-sheet')");

            String click = "[...document.querySelectorAll('.ai-sheet button')].find((b) => b.textContent === '%s').click(); 0";
            nvidia.answer = "A cell divides **in two**.";
            AppTest.eval(app, "document.querySelector('.ai-input').value = 'What is mitosis?'; 0");
            AppTest.eval(app, String.format(click, "Ask"));
            AppTest.waitFor(app, "(document.querySelector('.ai-msg.assistant') || {}).textContent === 'A cell divides in two.'");

            AppTest.eval(app, String.format(click, "Summary"));
            AppTest.waitFor(app, "!document.querySelector('.ai-msg')");
            nvidia.answer = "# Topic\n- First point.";
            AppTest.eval(app, String.format(click, "Generate"));
            AppTest.waitFor(app, "(document.querySelector('.ai-answer') || {}).textContent === 'Topic•  First point.'");

            AppTest.eval(app, String.format(click, "Cards"));
            nvidia.answer = "[{\"front\":\"Front <b>\",\"back\":\"Back\"}]";
            AppTest.eval(app, String.format(click, "Generate"));
            AppTest.waitFor(app, "(document.querySelector('.ai-card') || {}).textContent === 'Front <b>'");
            AppTest.eval(app, "document.querySelector('.ai-card').click(); 0");
            assertEquals("true", AppTest.eval(app, "document.querySelector('.ai-card').textContent === 'Back'"));

            AppTest.eval(app, String.format(click, "Quiz"));
            nvidia.answer = "[{\"question\":\"Q?\",\"options\":[\"one\",\"two\",\"three\",\"four\"],\"answer\":1}]";
            AppTest.eval(app, String.format(click, "Generate"));
            AppTest.waitFor(app, "document.querySelectorAll('.ai-option').length === 4");
            AppTest.eval(app, String.format(click, "two"));
            AppTest.waitFor(app, "/1 of 1/.test(document.querySelector('.ai-area').textContent)");

            AppTest.eval(app, String.format(click, "Mind map"));
            nvidia.answer = "[{\"title\":\"Topic\",\"children\":[{\"title\":\"Branch\"}]}]";
            AppTest.eval(app, String.format(click, "Generate"));
            AppTest.waitFor(app, "document.querySelectorAll('.ai-node').length === 2");

            AppTest.eval(app, String.format(click, "Teach back"));
            nvidia.answer = "You got it right.";
            AppTest.eval(app, "document.querySelector('.ai-input').value = 'Cells split.'; 0");
            AppTest.eval(app, String.format(click, "Check"));
            AppTest.waitFor(app, "(document.querySelector('.ai-answer') || {}).textContent === 'You got it right.'");

            AppTest.eval(app, "window.__s.sheet.close(); 0");
            app.onActivity(MainActivity::goBack);
            AppTest.waitFor(app, "!Q.app.editor");
        }
    }
}
