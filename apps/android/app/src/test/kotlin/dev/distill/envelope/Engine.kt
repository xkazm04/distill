package dev.distill.envelope

import java.io.File
import org.json.JSONObject

/** packages/engine, passed in by Gradle (app/build.gradle.kts); falls back to the path from the app module. */
object Engine {
    val dir: File = File(System.getProperty("distill.engine") ?: "../../../packages/engine").canonicalFile

    fun json(relative: String): JSONObject {
        val f = File(dir, relative)
        check(f.isFile) { "missing engine file ${f.path}; run npm run export-schemas -w @distill/engine" }
        return JSONObject(f.readText(Charsets.UTF_8))
    }
}
