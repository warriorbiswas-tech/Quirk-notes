package com.warriorbiswas.quire;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.MlKitException;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.vision.digitalink.DigitalInkRecognition;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModel;
import com.google.mlkit.vision.digitalink.DigitalInkRecognitionModelIdentifier;
import com.google.mlkit.vision.digitalink.DigitalInkRecognizer;
import com.google.mlkit.vision.digitalink.DigitalInkRecognizerOptions;
import com.google.mlkit.vision.digitalink.Ink;
import com.google.mlkit.vision.digitalink.RecognitionResult;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.Locale;
import java.util.concurrent.ExecutionException;

/** Turns handwriting into text on the device, the job Vision does in the iPad app. */
final class InkReader {
    private DigitalInkRecognizer recognizer;

    /** @param linesJson an array of lines, each an array of strokes, each a flat array of x, y pairs. */
    synchronized String read(String linesJson, AiBridge.Run run) throws JSONException, MlKitException, ExecutionException, InterruptedException {
        if (recognizer == null) recognizer = open();
        JSONArray lines = new JSONArray(linesJson);
        StringBuilder text = new StringBuilder();
        for (int l = 0; l < lines.length(); l++) {
            if (run.cancelled) throw new InterruptedException();
            JSONArray strokes = lines.getJSONArray(l);
            Ink.Builder ink = Ink.builder();
            for (int s = 0; s < strokes.length(); s++) {
                JSONArray points = strokes.getJSONArray(s);
                Ink.Stroke.Builder stroke = Ink.Stroke.builder();
                for (int p = 0; p + 1 < points.length(); p += 2) {
                    stroke.addPoint(Ink.Point.create((float) points.getDouble(p), (float) points.getDouble(p + 1)));
                }
                ink.addStroke(stroke.build());
            }
            RecognitionResult result = Tasks.await(recognizer.recognize(ink.build()));
            if (!result.getCandidates().isEmpty()) text.append(result.getCandidates().get(0).getText()).append('\n');
        }
        return text.toString().trim();
    }

    private static DigitalInkRecognizer open() throws MlKitException, ExecutionException, InterruptedException {
        DigitalInkRecognitionModelIdentifier id = DigitalInkRecognitionModelIdentifier.fromLanguageTag(Locale.getDefault().toLanguageTag());
        if (id == null) id = DigitalInkRecognitionModelIdentifier.fromLanguageTag("en-US");
        if (id == null) throw new ExecutionException(new IllegalStateException("No handwriting model"));
        DigitalInkRecognitionModel model = DigitalInkRecognitionModel.builder(id).build();
        Tasks.await(RemoteModelManager.getInstance().download(model, new DownloadConditions.Builder().build()));
        return DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build());
    }
}
