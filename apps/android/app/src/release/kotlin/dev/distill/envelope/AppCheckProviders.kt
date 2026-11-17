package dev.distill.envelope

import com.google.firebase.appcheck.AppCheckProviderFactory
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory

object AppCheckProviders {
    fun factory(): AppCheckProviderFactory = PlayIntegrityAppCheckProviderFactory.getInstance()
}
