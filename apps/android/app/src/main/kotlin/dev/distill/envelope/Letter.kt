package dev.distill.envelope

import org.json.JSONArray
import org.json.JSONObject

/** Mirrors packages/engine/schemas/letter.json. Absent optional fields are null. */
data class LetterAction(val what: String, val by: String?)

data class Letter(
    val sender: String?,
    val subject: String?,
    val summary: String,
    val deadline: String?,
    val amountDue: String?,
    val actions: List<LetterAction>,
)

/** Mirrors `WizardStep` in packages/engine/src/types.ts and schemas/wizard.json. */
data class WizardStep(
    val stepId: String,
    val fieldIds: List<String>,
    val question: String,
    val explanation: String,
    val example: String?,
    val expectedFormat: String?,
)

private fun JSONObject.str(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).trim().takeIf { it.isNotEmpty() } else null

private fun stripFence(raw: String): String {
    val t = raw.trim()
    if (!t.startsWith("```")) return t
    return t.removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
}

/** Model output is untrusted: parse defensively, drop what does not fit. Shown as plain text only. */
fun parseLetter(raw: String): Letter? {
    val o = runCatching { JSONObject(stripFence(raw)) }.getOrNull() ?: return null
    val summary = o.str("summary") ?: return null
    val acts = o.optJSONArray("actions") ?: JSONArray()
    val actions = (0 until acts.length()).mapNotNull { i ->
        val a = acts.optJSONObject(i) ?: return@mapNotNull null
        val what = a.str("what") ?: return@mapNotNull null
        LetterAction(what, a.str("by"))
    }
    return Letter(o.str("sender"), o.str("subject"), summary, o.str("deadline"), o.str("amountDue"), actions)
}

fun parseWizardSteps(raw: String): List<WizardStep> {
    val o = runCatching { JSONObject(stripFence(raw)) }.getOrNull() ?: return emptyList()
    val arr = o.optJSONArray("steps") ?: return emptyList()
    return (0 until arr.length()).mapNotNull { i ->
        val s = arr.optJSONObject(i) ?: return@mapNotNull null
        val id = s.str("stepId") ?: "s$i"
        val q = s.str("question") ?: return@mapNotNull null
        val e = s.str("explanation") ?: return@mapNotNull null
        val ids = s.optJSONArray("fieldIds")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: listOf(id)
        WizardStep(id, ids, q, e, s.str("example"), s.str("expectedFormat"))
    }
}
