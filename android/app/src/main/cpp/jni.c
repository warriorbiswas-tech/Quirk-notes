#include <jni.h>
#include <stdlib.h>
#include <string.h>

#include "Engines.h"

typedef struct {
    JNIEnv *env;
    jobject sink;
    jmethodID on_bytes;
} output;

static bool on_text(const char *bytes, int32_t length, void *user) {
    output *out = user;
    JNIEnv *env = out->env;
    jbyteArray piece = (*env)->NewByteArray(env, length);
    if (!piece) return false;
    (*env)->SetByteArrayRegion(env, piece, 0, length, (const jbyte *)bytes);
    jboolean more = (*env)->CallBooleanMethod(env, out->sink, out->on_bytes, piece);
    (*env)->DeleteLocalRef(env, piece);
    if ((*env)->ExceptionCheck(env)) return false;
    return more;
}

// Java strings reach C as modified UTF-8, which spells emoji differently, so the text arrives as real UTF-8 bytes.
static char **copy_all(JNIEnv *env, jobjectArray items, jsize count) {
    char **copies = calloc((size_t)count, sizeof(char *));
    if (!copies) return NULL;
    for (jsize i = 0; i < count; i++) {
        jbyteArray item = (*env)->GetObjectArrayElement(env, items, i);
        jsize length = (*env)->GetArrayLength(env, item);
        copies[i] = malloc((size_t)length + 1);
        if (!copies[i]) {
            for (jsize j = 0; j < i; j++) free(copies[j]);
            free(copies);
            return NULL;
        }
        (*env)->GetByteArrayRegion(env, item, 0, length, (jbyte *)copies[i]);
        copies[i][length] = 0;
        (*env)->DeleteLocalRef(env, item);
    }
    return copies;
}

static void free_all(char **items, jsize count) {
    for (jsize i = 0; i < count; i++) free(items[i]);
    free(items);
}

JNIEXPORT jlong JNICALL
Java_com_warriorbiswas_quire_LocalLLM_nativeOpen(JNIEnv *env, jclass type, jstring path, jint context, jint threads) {
    const char *model = (*env)->GetStringUTFChars(env, path, NULL);
    if (!model) return 0;
    margin_llm *llm = margin_llm_open(model, context, threads);
    (*env)->ReleaseStringUTFChars(env, path, model);
    return (jlong)(intptr_t)llm;
}

JNIEXPORT void JNICALL
Java_com_warriorbiswas_quire_LocalLLM_nativeClose(JNIEnv *env, jclass type, jlong handle) {
    margin_llm_close((margin_llm *)(intptr_t)handle);
}

JNIEXPORT jint JNICALL
Java_com_warriorbiswas_quire_LocalLLM_nativeGenerate(JNIEnv *env, jclass type, jlong handle, jobjectArray roles, jobjectArray contents,
                                                     jint max_tokens, jfloat temperature, jstring grammar, jobject sink) {
    jsize count = (*env)->GetArrayLength(env, roles);
    char **role_copies = copy_all(env, roles, count);
    char **content_copies = role_copies ? copy_all(env, contents, count) : NULL;
    if (!content_copies) {
        if (role_copies) free_all(role_copies, count);
        return margin_error_prompt;
    }
    const char *rules = grammar ? (*env)->GetStringUTFChars(env, grammar, NULL) : NULL;

    jclass sink_type = (*env)->GetObjectClass(env, sink);
    output out = {env, sink, (*env)->GetMethodID(env, sink_type, "onBytes", "([B)Z")};
    jint status = margin_llm_generate((margin_llm *)(intptr_t)handle, (const char *const *)role_copies, (const char *const *)content_copies,
                                      count, max_tokens, temperature, rules, on_text, &out);

    if (rules) (*env)->ReleaseStringUTFChars(env, grammar, rules);
    free_all(role_copies, count);
    free_all(content_copies, count);
    return status;
}
