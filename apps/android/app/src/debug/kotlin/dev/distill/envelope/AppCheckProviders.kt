package dev.distill.envelope

import com.google.firebase.appcheck.AppCheckProviderFactory
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory

/** Debug builds use the App Check debug provider (register the logged debug token in the Firebase console). */
object AppCheckProviders {
    fun factory(): AppCheckProviderFactory = DebugAppCheckProviderFactory.getInstance()
}
