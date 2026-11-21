package com.tecmat.emanager;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;

/**
 * Scarica l'APK di aggiornamento e apre subito il prompt di installazione di Android,
 * senza uscire dall'app (niente browser). Se manca il permesso "installa app sconosciute",
 * apre le impostazioni dell'app.
 * NB: scritto in Java (il template Capacitor non applica kotlin-android nel modulo app).
 */
@CapacitorPlugin(name = "UpdateInstaller")
public class UpdateInstallerPlugin extends Plugin {

    /** richiesta in sospeso: quando l'utente torna dalle impostazioni (handleOnResume), se il permesso c'è il download riparte da solo */
    private PluginCall pendingCall;
    private String pendingUrl;

    /** alcuni OEM (Samsung/One UI) non mandano il result dell'activity: al resume ricontrollo il permesso */
    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        PluginCall call = pendingCall;
        String url = pendingUrl;
        if (call == null || url == null) return;
        pendingCall = null;
        pendingUrl = null;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls()) {
            doDownloadAndInstall(call, url); // permesso ora concesso: retry automatico
        } else {
            call.reject("Permesso 'installa app sconosciute' non concesso: Impostazioni → App → 5e Manager → 'Installa app sconosciute' → attiva, poi riprova");
        }
    }

    /** avvia un intent dall'ACTIVITY (non dal context): Samsung/One UI blocca gli startActivity dal context */
    private void startFromActivity(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            if (getActivity() != null) {
                getActivity().startActivity(intent);
                return;
            }
        } catch (Exception ignored) {
        }
        getContext().startActivity(intent);
    }

    /** apre la schermata del permesso "installa app sconosciute" (con fallback alla pagina dell'app) */
    private void goToInstallPermissionSettings() {
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName()));
        try {
            startFromActivity(i);
            return;
        } catch (Exception ignored) {
        }
        try {
            startFromActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName())));
        } catch (Exception ignored) {
        }
    }

    /** true se l'app può già aprire prompt di installazione APK ("installa app sconosciute") */
    @PluginMethod
    public void hasInstallPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(r);
    }

    /** apre subito la schermata del permesso "installa app sconosciute" (usato dall'UI all'avvio/dall'update) */
    @PluginMethod
    public void openInstallPermissionSettings(PluginCall call) {
        try {
            goToInstallPermissionSettings();
            call.resolve();
        } catch (Exception e) {
            call.reject("impossibile aprire le impostazioni del permesso: " + e.getMessage());
        }
    }

    /** apre le impostazioni di sistema dell'app (per concedere fotocamera/installazione) */
    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            startFromActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName())));
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
            // apro le impostazioni del permesso: al ritorno (handleOnResume) il download riparte da solo
            pendingCall = call;
            pendingUrl = url;
            notifyListeners("needsInstallPermission", new JSObject());
            goToInstallPermissionSettings();
            return; // la call resta in sospeso finché l'utente non torna
        }
        doDownloadAndInstall(call, url);
    }

    private static String sha256Hex(byte[] data) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(data);
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    /** firme (SHA-256 dei certificati) di un APK sul disco */
    private String[] archiveSignatures(String apkPath) {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo pi = Build.VERSION.SDK_INT >= 28
                    ? pm.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNING_CERTIFICATES)
                    : pm.getPackageArchiveInfo(apkPath, PackageManager.GET_SIGNATURES);
            if (pi == null) return null;
            Signature[] sigs = Build.VERSION.SDK_INT >= 28
                    ? pi.signingInfo.getApkContentsSigners()
                    : pi.signatures;
            if (sigs == null) return null;
            String[] out = new String[sigs.length];
            for (int i = 0; i < sigs.length; i++) out[i] = sha256Hex(sigs[i].toByteArray());
            Arrays.sort(out);
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    /** firme dell'app correntemente installata */
    private String[] installedSignatures() {
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo pi = Build.VERSION.SDK_INT >= 28
                    ? pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES)
                    : pm.getPackageInfo(getContext().getPackageName(), PackageManager.GET_SIGNATURES);
            Signature[] sigs = Build.VERSION.SDK_INT >= 28 ? pi.signingInfo.getApkContentsSigners() : pi.signatures;
            if (sigs == null) return null;
            String[] out = new String[sigs.length];
            for (int i = 0; i < sigs.length; i++) out[i] = sha256Hex(sigs[i].toByteArray());
            Arrays.sort(out);
            return out;
        } catch (Exception e) {
            return null;
        }
    }

    private void doDownloadAndInstall(PluginCall call, String url) {
        new Thread(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                dir.mkdirs();
                // download su file .part e rename finale: mai installare un file parziale
                File part = new File(dir, "update.apk.part");
                File out = new File(dir, "update.apk");
                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(30000);
                conn.setInstanceFollowRedirects(true);
                conn.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
                conn.connect();
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    call.reject("download APK: HTTP " + code + " (" + url + ")");
                    return;
                }
                String contentType = conn.getContentType();
                long total = conn.getContentLengthLong();
                long received = 0;
                try (InputStream input = conn.getInputStream();
                     FileOutputStream fos = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
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
                if (total > 0 && received != total) {
                    part.delete();
                    call.reject("download incompleto: " + received + "/" + total + " byte — riprova");
                    return;
                }
                // magic PK (zip/APK): se il server ha risposto HTML (es. 404 di un proxy) lo intercettiamo qui
                byte[] magic = new byte[4];
                try (java.io.FileInputStream fis = new java.io.FileInputStream(part)) {
                    if (fis.read(magic) != 4) { part.delete(); call.reject("APK vuoto"); return; }
                }
                if (!(magic[0] == 'P' && magic[1] == 'K')) {
                    part.delete();
                    call.reject("il file scaricato non è un APK valido (content-type: " + contentType + ") — forse l'URL è sbagliato");
                    return;
                }
                if (!part.renameTo(out)) {
                    call.reject("impossibile finalizar el download (rename fallito)");
                    return;
                }
                // --- validazione pre-installazione: su Samsung/One UI un APK con firma diversa o
                // --- downgrade fallisce solo a instala con "app non installata" — qui lo diciamo chiaro
                PackageManager pm = getContext().getPackageManager();
                PackageInfo arch = pm.getPackageArchiveInfo(out.getAbsolutePath(), 0);
                if (arch == null) {
                    call.reject("APK corrotto: il gestore pacchetti non lo riconosce — riprova il download");
                    return;
                }
                PackageInfo inst = pm.getPackageInfo(getContext().getPackageName(), 0);
                long archCode = Build.VERSION.SDK_INT >= 28 ? arch.getLongVersionCode() : arch.versionCode;
                long instCode = Build.VERSION.SDK_INT >= 28 ? inst.getLongVersionCode() : inst.versionCode;
                if (instCode > archCode) {
                    call.reject("Downgrade bloccato: hai installato v" + inst.versionName + " (code " + instCode + "), l'aggiornamento è v" + arch.versionName + " (code " + archCode + ")");
                    return;
                }
                String[] aSigs = archiveSignatures(out.getAbsolutePath());
                String[] iSigs = installedSignatures();
                if (aSigs == null || iSigs == null || !Arrays.equals(aSigs, iSigs)) {
                    call.reject("Firma diversa: questa APK è firmata con una chiave diversa dall'app installata, quindi Android non permette l'aggiornamento in-place. Causa tipica: APK debug-signed contro release-signed (o viceversa). Soluzione: disinstalla 5e Manager e installa questa APK a mano (esporta prima le schede locali: sono solo sul dispositivo).");
                    return;
                }
                Uri uri = FileProvider.getUriForFile(getContext(),
                        getContext().getPackageName() + ".fileprovider", out);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startFromActivity(Intent.createChooser(intent, "Installa aggiornamento 5e Manager"));
                call.resolve();
            } catch (Exception e) {
                call.reject("download/installazione fallita: " + e.getMessage());
            }
        }).start();
    }
}
