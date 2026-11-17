package dev.distill.envelope

import com.google.firebase.ai.InferenceMode

/** Mirrors `Task` / `PromptClass` / `route()` in packages/engine (the wire contract). */
enum class PromptClass { PAGE, STRUCTURE, VALUES }

enum class Task(val wire: String, val promptClass: PromptClass) {
    READ_LETTER("readLetter", PromptClass.PAGE),
    BUILD_WIZARD("buildWizard", PromptClass.STRUCTURE),
    SUGGEST_VALUE("suggestValue", PromptClass.VALUES),
}

/**
 * The Sieve. The ONLY place that names the device-only mode: a `values` task (it carries what the person typed)
 * runs on the device and has no cloud fallback. Nothing overrides that.
 */
fun route(task: Task, configuredMode: String = "prefer_on_device"): InferenceMode =
    if (task.promptClass == PromptClass.VALUES) InferenceMode.ONLY_ON_DEVICE
    else when (configuredMode) {
        "only_in_cloud" -> InferenceMode.ONLY_IN_CLOUD
        "prefer_in_cloud" -> InferenceMode.PREFER_IN_CLOUD
        else -> InferenceMode.PREFER_ON_DEVICE
    }
