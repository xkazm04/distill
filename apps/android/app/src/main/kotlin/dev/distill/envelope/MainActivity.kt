package dev.distill.envelope

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

private val Teal = Color(0xFF1F4D4A)
private val colors: ColorScheme = lightColorScheme(
    primary = Teal, onPrimary = Color.White, secondaryContainer = Color(0xFFDCEBE9), background = Color(0xFFFAF8F3),
    surface = Color(0xFFFAF8F3),
)

class MainActivity : ComponentActivity() {
    private val vm: LetterViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Ai.init(applicationContext)
        if (savedInstanceState == null) handle(intent)
        setContent {
            MaterialTheme(colorScheme = colors) {
                Surface(Modifier.fillMaxSize()) { App(vm) }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    /** A letter shared from another app: text (or a link), or an image. */
    private fun handle(i: Intent?) {
        if (i?.action != Intent.ACTION_SEND) return
        val type = i.type.orEmpty()
        if (type.startsWith("image/")) {
            val uri: Uri? = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else @Suppress("DEPRECATION") i.getParcelableExtra(Intent.EXTRA_STREAM)
            if (uri != null) vm.fromImage(uri)
        } else {
            i.getStringExtra(Intent.EXTRA_TEXT)?.let { vm.fromText(it) }
        }
    }
}

@Composable
private fun App(vm: LetterViewModel) {
    LaunchedEffect(Unit) { runCatching { Ai.signIn() } }
    when (val s = vm.stage) {
        Stage.Home -> HomeScreen(vm)
        else -> {
            BackHandler { vm.home() }
            LetterScreen(vm, s)
        }
    }
}

@Composable
private fun Screen(content: @Composable () -> Unit) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) { content() }
}

@Composable
private fun HomeScreen(vm: LetterViewModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    var pasted by rememberSaveable { mutableStateOf("") }
    val gallery = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) vm.fromImage(uri)
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bmp ->
        if (bmp != null) vm.fromBitmap(bmp)
    }
    Screen {
        Text("Envelope", style = MaterialTheme.typography.headlineLarge, color = Teal)
        Text("Understand a letter in plain English. The photo is read on this phone.", style = MaterialTheme.typography.bodyLarge)
        if (!Ai.configured) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp)) {
                    Text("Firebase is not configured", style = MaterialTheme.typography.titleMedium)
                    Text("You can add a letter, but the AI cannot read it until the app is connected to Firebase.")
                }
            }
        }
        Button(onClick = { camera.launch(null) }, Modifier.fillMaxWidth()) { Text("Take a photo of a letter") }
        OutlinedButton(
            onClick = { gallery.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
            Modifier.fillMaxWidth(),
        ) { Text("Choose a photo") }
        Text("Or paste the text of the letter", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(pasted, { pasted = it }, Modifier.fillMaxWidth(), minLines = 4, label = { Text("Letter text") })
        Button(onClick = { vm.fromText(pasted) }, Modifier.fillMaxWidth(), enabled = pasted.isNotBlank()) { Text("Explain this text") }
        Text(
            "You can also share a letter to Envelope from another app.",
            style = MaterialTheme.typography.bodyMedium,
        )
        if (context.packageName.isEmpty()) Spacer(Modifier.height(0.dp))
    }
}

@Composable
private fun LetterScreen(vm: LetterViewModel, stage: Stage) {
    Screen {
        TextButton(onClick = { vm.home() }) { Text("Back") }
        Text("Your letter", style = MaterialTheme.typography.headlineMedium, color = Teal)
        when (stage) {
            is Stage.Working -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator(Modifier.padding(4.dp))
                Text(stage.message, style = MaterialTheme.typography.bodyLarge)
            }
            is Stage.Failed -> Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("This did not work", style = MaterialTheme.typography.titleMedium)
                    Text(stage.message, style = MaterialTheme.typography.bodyLarge)
                    Text("Nothing you typed or photographed has been stored.", style = MaterialTheme.typography.bodyMedium)
                }
            }
            else -> Result(vm)
        }
    }
}

@Composable
private fun SourceChips(where: Where?, local: String?) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (where != null) {
            AssistChip(onClick = {}, label = {
                Text(if (where == Where.ON_DEVICE) "Ran on this device" else "Ran in the cloud")
            })
        }
        if (local != null) AssistChip(onClick = {}, label = { Text("Phone AI model: $local") })
    }
}

@Composable
private fun Result(vm: LetterViewModel) {
    val l = vm.letter ?: return
    SourceChips(vm.where, vm.localState)
    l.subject?.let { Text(it, style = MaterialTheme.typography.titleLarge) }
    l.sender?.let { Text("From: $it", style = MaterialTheme.typography.bodyMedium) }

    Section("What it says") { Text(l.summary, style = MaterialTheme.typography.bodyLarge) }
    if (l.deadline != null || l.amountDue != null) {
        Section("Deadline and money") {
            l.deadline?.let { Text("Deadline: $it", style = MaterialTheme.typography.bodyLarge) }
            l.amountDue?.let { Text("Amount to pay: $it", style = MaterialTheme.typography.bodyLarge) }
        }
    }
    if (l.actions.isNotEmpty()) {
        Section("What to do") {
            l.actions.forEachIndexed { i, a ->
                Text("${i + 1}. ${a.what}" + (a.by?.let { " (by $it)" } ?: ""), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
    Section("Write a reply") {
        vm.wizardNote?.let { Text(it) }
        if (vm.steps.isEmpty() && vm.wizardNote == null) Text("Preparing the questions...")
        vm.steps.forEach { s ->
            Text(s.question, style = MaterialTheme.typography.titleMedium)
            Text(s.explanation, style = MaterialTheme.typography.bodyMedium)
            val hint = listOfNotNull(s.example?.let { "Example: $it" }, s.expectedFormat?.let { "Format: $it" }).joinToString("   ")
            OutlinedTextField(
                vm.answers[s.stepId].orEmpty(), { vm.answers[s.stepId] = it }, Modifier.fillMaxWidth(),
                supportingText = if (hint.isNotEmpty()) ({ Text(hint) }) else null,
            )
        }
        if (vm.steps.isNotEmpty()) {
            Text("What you type stays on this phone. The reply is written by the AI model on this phone only.", style = MaterialTheme.typography.bodyMedium)
            Button(onClick = { vm.draftReply() }, enabled = !vm.drafting, modifier = Modifier.fillMaxWidth()) {
                Text(if (vm.drafting) "Writing..." else "Write my reply")
            }
        }
        vm.draftNote?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
        vm.draft?.let {
            SourceChips(vm.draftWhere, null)
            Text(it, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = Teal)
            content()
        }
    }
}
