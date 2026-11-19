package com.tecmat.emanager

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Scarica l'APK di aggiornamento e apre subito il prompt di installazione di Android,
 * senza uscire dall'app (niente browser). Se manca il permesso "installa app sconosciute",
 * apre le impostazioni dell'app.
 */
@CapacitorPlugin(name = "UpdateInstaller")
class UpdateInstallerPlugin : Plugin() {

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        val url = call.getString("url")
        if (url.isNullOrBlank()) {
            call.reject("url mancante")
            return
        }
        thread {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
                    notifyListeners("needsInstallPermission", JSObject())
                    val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.packageName))
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(intent)
                    call.reject("Permesso 'installa app sconosciute' non concesso: abilitalo e riprova")
                    return@thread
                }
                val dir = File(context.cacheDir, "updates")
                dir.mkdirs()
                val out = File(dir, "update.apk")
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 15000
                conn.readTimeout = 30000
                conn.instanceFollowRedirects = true
                conn.connect()
                if (conn.responseCode !in 200..299) {
                    call.reject("download APK: HTTP ${conn.responseCode}")
                    return@thread
                }
                val total = conn.contentLengthLong
                conn.inputStream.use { input ->
                    FileOutputStream(out).use { fos ->
                        val buf = ByteArray(64 * 1024)
                        var received = 0L
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            fos.write(buf, 0, n)
                            received += n
                            val progress = JSObject()
                            progress.put("received", received)
                            progress.put("total", total)
                            notifyListeners("update-progress", progress)
                        }
                    }
                }
                val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", out)
                val intent = Intent(Intent.ACTION_VIEW)
                intent.setDataAndType(uri, "application/vnd.android.package-archive")
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(Intent.createChooser(intent, "Installa aggiornamento 5e Manager"))
                call.resolve()
            } catch (e: Exception) {
                call.reject("download/installazione fallita: ${e.message}")
            }
        }
    }
}
