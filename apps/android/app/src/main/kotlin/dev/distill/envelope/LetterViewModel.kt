package dev.distill.envelope

import android.app.Application
import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface Stage {
    data object Home : Stage
    data class Working(val message: String) : Stage
    data object Done : Stage
    data class Failed(val message: String) : Stage
}

class LetterViewModel(app: Application) : AndroidViewModel(app) {
    var stage: Stage by mutableStateOf(Stage.Home)
        private set
    var letter: Letter? by mutableStateOf(null)
        private set
    var where: Where? by mutableStateOf(null)
        private set
    var localState: String? by mutableStateOf(null)
        private set
    var steps = mutableStateListOf<ReplyStep>()
        private set
    /** What the person types. Lives in memory on this device only; never stored, never sent to the cloud. */
    val answers = mutableStateMapOf<String, String>()
    var wizardNote: String? by mutableStateOf(null)
        private set
    var draft: ReplyDraft? by mutableStateOf(null)
        private set
    var draftWhere: Where? by mutableStateOf(null)
        private set
    var draftNote: String? by mutableStateOf(null)
        private set
    var drafting by mutableStateOf(false)
        private set

    private var letterText = ""

    fun home() { stage = Stage.Home }

    fun fromText(text: String) = begin { text.trim() }
    fun fromImage(uri: Uri) = begin { Ocr.read(getApplication(), uri) }
    fun fromBitmap(bitmap: Bitmap) = begin { Ocr.read(bitmap) }

    private fun begin(source: suspend () -> String) {
        letter = null; where = null; steps.clear(); answers.clear(); draft = null; draftNote = null; wizardNote = null
        stage = Stage.Working("Reading the letter on this phone...")
        viewModelScope.launch {
            val text = try {
                val t = source()
                if (isSingleUrl(t)) withContext(Dispatchers.IO) { fetchPage(t) } else t
            } catch (e: Exception) {
                stage = Stage.Failed("Could not read this: ${e.message ?: "unknown problem"}")
                return@launch
            }
            if (text.isBlank()) {
                stage = Stage.Failed("No text was found. Try a clearer, well lit photo, or paste the text.")
                return@launch
            }
            letterText = text
            localState = Ai.localModelState()
            stage = Stage.Working("Asking the AI what the letter says...")
            when (val out = Ai.run(Task.READ_LETTER, readLetterPrompt(text))) {
                is AiOutcome.Failed -> stage = Stage.Failed(out.message)
                is AiOutcome.Ok -> {
                    val parsed = parseLetter(out.text)
                    if (parsed == null) {
                        stage = Stage.Failed("The AI answer could not be understood. Please try again.")
                    } else {
                        letter = parsed
                        where = out.where
                        stage = Stage.Done
                        buildWizard()
                    }
                }
            }
        }
    }

    private suspend fun buildWizard() {
        when (val out = Ai.run(Task.BUILD_REPLY_WIZARD, buildReplyWizardPrompt(letterText))) {
            is AiOutcome.Failed -> wizardNote = out.message
            is AiOutcome.Ok -> {
                val s = parseReplyWizard(out.text)
                if (s.isEmpty()) wizardNote = "This letter does not seem to need a reply."
                else steps.addAll(s)
            }
        }
    }

    fun draftReply() {
        val l = letter ?: return
        val given = steps.mapNotNull { s ->
            answers[s.stepId]?.takeIf { it.isNotBlank() }?.let { ReplyAnswer(s.stepId, s.question, it) }
        }
        if (given.isEmpty()) { draftNote = "Answer at least one question first."; return }
        drafting = true; draftNote = null
        viewModelScope.launch {
            // Values class: route() makes this device-only. When the phone has no local model it says so.
            when (val out = Ai.run(Task.DRAFT_REPLY, draftReplyPrompt(l, given))) {
                is AiOutcome.Failed -> draftNote = out.message
                is AiOutcome.Ok -> {
                    val d = parseReplyDraft(out.text)
                    if (d == null) draftNote = "The reply could not be understood. Please try again."
                    else { draft = d; draftWhere = out.where }
                }
            }
            drafting = false
        }
    }

    private fun isSingleUrl(t: String) = t.trim().let { it.startsWith("http", true) && !it.contains(Regex("\\s")) }

    /** Fetch a shared link and keep its visible text only. */
    private fun fetchPage(url: String): String {
        val c = URL(url.trim()).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000; c.readTimeout = 10_000
        val html = c.inputStream.bufferedReader().use { it.readText().take(400_000) }
        return html.replace(Regex("(?is)<(script|style)[^>]*>.*?</\\1>"), " ")
            .replace(Regex("<[^>]+>"), " ")
            .replace(Regex("&nbsp;"), " ")
            .replace(Regex("\\s+"), " ").trim()
    }
}
