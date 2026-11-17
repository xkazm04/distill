package dev.distill.envelope

import kotlin.reflect.KClass
import kotlin.reflect.full.primaryConstructor
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The Kotlin mirrors carry exactly the field names of the JSON files in packages/engine/schemas, and a field is non-null here
 * exactly when the schema requires it. Fails when either side drifts.
 */
class SchemaDriftTest {
    private class Mirror(val file: String, val path: List<String>, val type: KClass<*>)

    private val mirrors = listOf(
        Mirror("letter.json", emptyList(), Letter::class),
        Mirror("letter.json", listOf("actions"), LetterAction::class),
        Mirror("replyWizard.json", listOf("steps"), ReplyStep::class),
        Mirror("replyDraft.json", emptyList(), ReplyDraft::class),
    )

    /** Walks properties by name; an array property steps into its items. */
    private fun objectAt(schema: JSONObject, path: List<String>): JSONObject = path.fold(schema) { node, key ->
        val p = node.getJSONObject("properties").getJSONObject(key)
        if (p.getString("type") == "array") p.getJSONObject("items") else p
    }

    @Test
    fun kotlinMirrorsMatchTheEngineSchemas() {
        for (m in mirrors) {
            val where = "${m.file} ${m.path.joinToString(".").ifEmpty { "(root)" }} vs ${m.type.simpleName}"
            val node = objectAt(Engine.json("schemas/${m.file}"), m.path)
            val props = node.getJSONObject("properties").keys().asSequence().toSet()
            val required = node.optJSONArray("required")?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() }.orEmpty()
            val params = m.type.primaryConstructor!!.parameters

            assertEquals("field names: $where", props.toSortedSet(), params.map { it.name!! }.toSortedSet())
            for (p in params) {
                assertEquals("${p.name} is required in the schema exactly when non-null in Kotlin: $where", p.name in required, !p.type.isMarkedNullable)
            }
        }
    }

    @Test
    fun parsersReadEveryField() {
        val letter = parseLetter(
            """{"sender":"s","subject":"t","lang":"cs","summary":"m","deadline":"d","amountDue":"a","actions":[{"what":"w","by":"b"}]}""",
        )
        assertEquals(Letter("s", "t", "cs", "m", "d", "a", listOf(LetterAction("w", "b"))), letter)
        val steps = parseReplyWizard("""{"steps":[{"stepId":"r0","question":"q","explanation":"e","example":"x","expectedFormat":"f"}]}""")
        assertEquals(listOf(ReplyStep("r0", "q", "e", "x", "f")), steps)
        assertEquals(ReplyDraft("r", "t"), parseReplyDraft("""{"reply":"r","translation":"t"}"""))
    }

    @Test
    fun untrustedOutputIsTrimmedToWhatFits() {
        val raw = "```json\n" + """{"steps":[{"question":"q"},{"question":"q","explanation":"e"},1,""" +
            (1..6).joinToString(",") { """{"stepId":"r$it","question":"q$it","explanation":"e"}""" } + "]}\n```"
        val steps = parseReplyWizard(raw)
        assertEquals(5, steps.size)
        assertEquals("r1", steps[0].stepId)
        assertEquals(emptyList<ReplyStep>(), parseReplyWizard("not json"))
        assertEquals(null, parseReplyDraft("""{"translation":"only"}"""))
        assertEquals(null, parseLetter("""{"actions":[]}"""))
    }
}
