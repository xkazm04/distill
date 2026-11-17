package dev.distill.envelope

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Prompts.kt carries the engine's wording verbatim: every case in packages/engine/test/fixtures/prompts.golden.json
 * (written by the engine's own test) is rebuilt here from the same inputs and must match character for character.
 */
class PromptsGoldenTest {
    @Test
    fun everyEnginePromptIsMirroredVerbatim() {
        val cases = Engine.json("test/fixtures/prompts.golden.json").getJSONArray("cases")
        val seen = mutableSetOf<String>()
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val task = c.getString("task")
            val lang = c.getString("readerLang")
            val built = when (task) {
                "readLetter" -> readLetterPrompt(c.getString("letterText"), lang)
                "buildReplyWizard" -> buildReplyWizardPrompt(c.getString("letterText"), lang)
                "draftReply" -> {
                    val letter = parseLetter(c.getJSONObject("letter").toString())!!
                    val a = c.getJSONArray("answers")
                    val answers = (0 until a.length()).map { j ->
                        a.getJSONObject(j).let { ReplyAnswer(it.getString("stepId"), it.getString("question"), it.getString("value")) }
                    }
                    draftReplyPrompt(letter, answers, lang)
                }
                else -> error("Envelope has no prompt for engine task \"$task\"; add it to Prompts.kt")
            }
            assertEquals("case ${c.getString("name")}", c.getString("prompt"), built)
            seen += task
        }
        assertEquals(Task.entries.map { it.wire }.toSet(), seen)
    }
}
