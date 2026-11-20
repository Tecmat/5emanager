package com.tecmat.emanager;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Scarica l'APK di aggiornamento e apre subito il prompt di installazione di Android,
 * senza uscire dall'app (niente browser). Se manca il permesso "installa app sconosciute",
 * apre le impostazioni dell'app.
 * NB: scritto in Java (il template Capacitor non applica kotlin-android nel modulo app).
 */
@CapacitorPlugin(name = "UpdateInstaller")
public class UpdateInstallerPlugin extends Plugin {

    /** url della richiesta in sospeso: quando l'utente torna dalle impostazioni col permesso concesso, il download riparte da solo */
    private String pendingUrl;

    /** callback di startActivityForResult: al ritorno dalle impostazioni, se il permesso c'è, retry automatico */
    @ActivityCallback
    private void onInstallPermissionResult(PluginCall call, ActivityResult result) {
        String url = pendingUrl;
        pendingUrl = null;
        if (call == null || url == null) return;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls()) {
            doDownloadAndInstall(call, url); // permesso ora concesso: riparto da solo
        } else {
            call.reject("Permesso 'installa app sconosciute' non concesso: abilitalo dalle impostazioni e riprova");
        }
    }

    /** apre le impostazioni di sistema dell'app (per concedere fotocamera/installazione) */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("impossibile aprire le impostazioni: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url mancante");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            // apro le impostazioni del permesso: al ritorno (onInstallPermissionResult) il download riparte da solo
            pendingUrl = url;
            notifyListeners("needsInstallPermission", new JSObject());
            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            startActivityForResult(call, settings, "onInstallPermissionResult");
            return;
        }
        doDownloadAndInstall(call, url);
    }

    private void doDownloadAndInstall(PluginCall call, String url) {
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                dir.mkdirs();
                File out = new File(dir, "update.apk");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                conn.connect();
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    call.reject("download APK: HTTP " + code);
                    return;
                }
                long total = conn.getContentLengthLong();
                try (InputStream input = conn.getInputStream();
                     FileOutputStream fos = new FileOutputStream(out)) {
                    byte[] buf = new byte[64 * 1024];
                    long received = 0;
                    int n;
                    while ((n = input.read(buf)) >= 0) {
                        fos.write(buf, 0, n);
                        received += n;
                        JSObject progress = new JSObject();
                        progress.put("received", received);
                        progress.put("total", total);
                        notifyListeners("update-progress", progress);
                    }
                }
                Uri uri = FileProvider.getUriForFile(getContext(),
                        getContext().getPackageName() + ".fileprovider", out);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(Intent.createChooser(intent, "Installa aggiornamento 5e Manager"));
                call.resolve();
            } catch (Exception e) {
                call.reject("download/installazione fallita: " + e.getMessage());
            }
        }).start();
    }
}
