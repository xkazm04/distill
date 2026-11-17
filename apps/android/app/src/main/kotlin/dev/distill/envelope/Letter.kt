package dev.distill.envelope

import org.json.JSONArray
import org.json.JSONObject

// Mirrors of the Envelope shapes in packages/engine/src/types.ts. Property names are the wire names; a schema field
// that is required is non-null here and an optional one is nullable. SchemaDriftTest checks both against
// packages/engine/schemas/*.json.

/** schemas/letter.json, `actions` items. */
data class LetterAction(val what: String, val by: String?)

/** schemas/letter.json. */
data class Letter(
    val sender: String?,
    val subject: String?,
    val lang: String?,
    val summary: String,
    val deadline: String?,
    val amountDue: String?,
    val actions: List<LetterAction>,
)

/** schemas/replyWizard.json, `steps` items. */
data class ReplyStep(
    val stepId: String,
    val question: String,
    val explanation: String,
    val example: String?,
    val expectedFormat: String?,
)

/** engine `ReplyAnswer`: what the person typed for one step. Device-only, never stored, never sent to the cloud. */
data class ReplyAnswer(val stepId: String, val question: String, val value: String)

/** schemas/replyDraft.json. */
data class ReplyDraft(val reply: String, val translation: String?)

private fun JSONObject.str(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).trim().takeIf { it.isNotEmpty() } else null

private fun stripFence(raw: String): String {
    val t = raw.trim()
    if (!t.startsWith("```")) return t
    return t.removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
}

private fun obj(raw: String): JSONObject? = runCatching { JSONObject(stripFence(raw)) }.getOrNull()

/** Model output is untrusted: parse defensively, drop what does not fit. Shown as plain text only. */
fun parseLetter(raw: String): Letter? {
    val o = obj(raw) ?: return null
    val summary = o.str("summary") ?: return null
    val acts = o.optJSONArray("actions") ?: JSONArray()
    val actions = (0 until acts.length()).mapNotNull { i ->
        val a = acts.optJSONObject(i) ?: return@mapNotNull null
        val what = a.str("what") ?: return@mapNotNull null
        LetterAction(what, a.str("by"))
    }
    return Letter(o.str("sender"), o.str("subject"), o.str("lang"), summary, o.str("deadline"), o.str("amountDue"), actions)
}

/** At most 5 steps, as the prompt asks; a step without a question or explanation is dropped. */
fun parseReplyWizard(raw: String): List<ReplyStep> {
    val arr = obj(raw)?.optJSONArray("steps") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { i ->
        val s = arr.optJSONObject(i) ?: return@mapNotNull null
        val q = s.str("question") ?: return@mapNotNull null
        val e = s.str("explanation") ?: return@mapNotNull null
        ReplyStep(s.str("stepId") ?: "r$i", q, e, s.str("example"), s.str("expectedFormat"))
    }.distinctBy { it.stepId }.take(5)
}

fun parseReplyDraft(raw: String): ReplyDraft? {
    val o = obj(raw) ?: return null
    val reply = o.str("reply") ?: return null
    return ReplyDraft(reply, o.str("translation"))
}
