package dev.distill.envelope

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.Firebase
import com.google.firebase.ai.ai
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.type.FirebaseAIOnDeviceNotAvailableException
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.generationConfig
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import kotlinx.coroutines.tasks.await

/** Where an answer ran, taken from the SDK response (never assumed). */
enum class Where { ON_DEVICE, IN_CLOUD }

sealed interface AiOutcome {
    data class Ok(val text: String, val where: Where) : AiOutcome
    /** Plain-words message for the screen. */
    data class Failed(val message: String) : AiOutcome
}

object Ai {
    /** Defaults mirror REMOTE_CONFIG_DEFAULTS in packages/engine/src/types.ts. */
    private const val DEFAULT_MODEL = "gemini-3.5-flash-lite"
    private const val DEFAULT_MODE = "prefer_on_device"

    var configured = false
        private set

    /** True only when google-services.json was present at build time and Firebase started. */
    fun init(context: Context) {
        configured = runCatching {
            FirebaseApp.getApps(context).isNotEmpty() || FirebaseApp.initializeApp(context) != null
        }.getOrDefault(false)
        if (configured) runCatching {
            FirebaseAppCheck.getInstance().installAppCheckProviderFactory(AppCheckProviders.factory())
        }
    }

    /** Anonymous sign-in plus the per-user settings document. It holds no typed value and no letter text. */
    suspend fun signIn() {
        if (!configured) return
        val auth = FirebaseAuth.getInstance()
        val user = auth.currentUser ?: auth.signInAnonymously().await().user ?: return
        FirebaseFirestore.getInstance().collection("users").document(user.uid)
            .set(mapOf("readingLevel" to "plain", "readerLang" to "en", "recastEnabled" to true))
            .await()
    }

    private suspend fun remoteConfig(): Pair<String, String> {
        val rc = FirebaseRemoteConfig.getInstance()
        rc.setDefaultsAsync(mapOf("cloud_model" to DEFAULT_MODEL, "inference_mode" to DEFAULT_MODE)).await()
        runCatching { rc.fetchAndActivate().await() }
        return rc.getString("cloud_model").ifEmpty { DEFAULT_MODEL } to
            rc.getString("inference_mode").ifEmpty { DEFAULT_MODE }
    }

    private fun model(modelName: String, task: Task, mode: String, json: Boolean) =
        Firebase.ai(backend = GenerativeBackend.googleAI()).generativeModel(
            modelName = modelName,
            generationConfig = generationConfig { if (json) responseMimeType = "application/json" },
            onDeviceConfig = OnDeviceConfig(mode = route(task, mode)),
        )

    /** The local model state (unavailable / downloadable / downloading / available), or null when unknown. */
    suspend fun localModelState(): String? {
        if (!configured) return null
        return runCatching {
            when (model(DEFAULT_MODEL, Task.READ_LETTER, DEFAULT_MODE, false).onDeviceExtension?.checkStatus()) {
                OnDeviceModelStatus.AVAILABLE -> "available"
                OnDeviceModelStatus.DOWNLOADABLE -> "downloadable"
                OnDeviceModelStatus.DOWNLOADING -> "downloading"
                OnDeviceModelStatus.UNAVAILABLE -> "unavailable"
                else -> null
            }
        }.getOrNull()
    }

    /** Run one task (every Envelope task answers in JSON). A values task is device-only, no cloud fallback. */
    suspend fun run(task: Task, prompt: String): AiOutcome {
        if (!configured) return AiOutcome.Failed("Firebase is not configured, so the AI cannot run yet.")
        return try {
            val (modelName, mode) = remoteConfig()
            val response = model(modelName, task, mode, json = true).generateContent(prompt)
            val text = response.text?.trim().orEmpty()
            if (text.isEmpty()) return AiOutcome.Failed("The AI gave no answer. Please try again.")
            val where = if (response.inferenceSource == InferenceSource.ON_DEVICE) Where.ON_DEVICE else Where.IN_CLOUD
            AiOutcome.Ok(text, where)
        } catch (e: FirebaseAIOnDeviceNotAvailableException) {
            AiOutcome.Failed("This step needs the AI model on your phone, and it is not available on this phone. Nothing was sent anywhere.")
        } catch (e: Exception) {
            AiOutcome.Failed("The AI could not answer: ${e.message ?: "unknown problem"}")
        }
    }
}
