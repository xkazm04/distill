package dev.distill.envelope

import org.junit.Assert.assertEquals
import org.junit.Test

/** Mirrors packages/engine/test/route.test.ts for the Envelope tasks. */
class RoutingTest {
    private val configured = listOf(null, "prefer_on_device", "only_on_device", "only_in_cloud", "prefer_in_cloud", "garbage", "")

    @Test
    fun aReplyDraftNeverLeavesTheDevice() {
        assertEquals(PromptClass.VALUES, Task.DRAFT_REPLY.promptClass)
        for (c in configured) assertEquals("configured=$c", "only_on_device", routeMode(Task.DRAFT_REPLY, c))
    }

    @Test
    fun pageTasksFollowTheConfiguredModeAndFallBackWhenItIsInvalid() {
        for (t in listOf(Task.READ_LETTER, Task.BUILD_REPLY_WIZARD)) {
            assertEquals(PromptClass.PAGE, t.promptClass)
            assertEquals("prefer_in_cloud", routeMode(t, "prefer_in_cloud"))
            assertEquals("only_on_device", routeMode(t, "only_on_device"))
            for (bad in listOf(null, "", "PREFER_IN_CLOUD", "cloud")) assertEquals("prefer_on_device", routeMode(t, bad))
        }
    }

    @Test
    fun wireNamesAreTheEngineTaskNames() {
        assertEquals(listOf("readLetter", "buildReplyWizard", "draftReply"), Task.entries.map { it.wire })
    }
}
