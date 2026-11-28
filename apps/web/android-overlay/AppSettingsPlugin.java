package com.tecmat.emanager;

import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Apre le impostazioni di sistema dell'app (usato quando il permesso fotocamera
 * e' negato: l'utente deve andare in Impostazioni -> App -> 5e Manager -> Autorizzazioni).
 * NB: scritto in Java (il template Capacitor non applica kotlin-android nel modulo app).
 */
@CapacitorPlugin(name = "AppSettings")
public class AppSettingsPlugin extends Plugin {

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (getActivity() != null) getActivity().startActivity(i);
            else getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("impossibile aprire le impostazioni: " + e.getMessage());
        }
    }
}
