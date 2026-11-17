package dev.distill.envelope

import com.google.firebase.ai.InferenceMode

/** Mirrors `PromptClass` in packages/engine/src/types.ts. */
enum class PromptClass { PAGE, STRUCTURE, VALUES }

/** Mirrors the Envelope members of `Task` and their class in engine route.ts CLASS_OF. */
enum class Task(val wire: String, val promptClass: PromptClass) {
    READ_LETTER("readLetter", PromptClass.PAGE),
    BUILD_REPLY_WIZARD("buildReplyWizard", PromptClass.PAGE),
    DRAFT_REPLY("draftReply", PromptClass.VALUES),
}

private val WIRE_MODES = listOf("prefer_on_device", "only_on_device", "only_in_cloud", "prefer_in_cloud")

/**
 * The Sieve, as engine `route()`: the wire mode a task runs in. A `values` task (it carries what the person typed)
 * is device-only whatever is configured, with no cloud fallback. Nothing overrides that.
 */
fun routeMode(task: Task, configuredMode: String? = null): String =
    if (task.promptClass == PromptClass.VALUES) "only_on_device"
    else configuredMode?.takeIf { it in WIRE_MODES } ?: "prefer_on_device"

/** The SDK mode for a task. The ONLY place that names the device-only SDK mode. */
fun route(task: Task, configuredMode: String? = null): InferenceMode = when (routeMode(task, configuredMode)) {
    "only_on_device" -> InferenceMode.ONLY_ON_DEVICE
    "only_in_cloud" -> InferenceMode.ONLY_IN_CLOUD
    "prefer_in_cloud" -> InferenceMode.PREFER_IN_CLOUD
    else -> InferenceMode.PREFER_ON_DEVICE
}
