package com.tecmat.emanager;

import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoWSD;

/**
 * Beacon LAN per il P2P "stile Soul Knight": questo dispositivo fa da HOST della
 * campagna direttamente dall'app, senza server. Apre un mini server HTTP+WS su
 * 0.0.0.0:<port>:  GET /api/info risponde {app:"5emanager",kind:"p2p-host",...}
 * (cosi' la scansione LAN degli altri dispositivi lo trova), e ogni connessione
 * WebSocket (qualsiasi path con upgrade) diventa un client di gioco.
 *
 * I messaggi nativi -> web passano da window.__lanEvt(["open"|"msg"|"close", id, payload?]).
 * Il testo e' in chiaro sul socket: rete locale/hotspot, come il resto del P2P.
 * NB: Java puro (il template Capacitor non applica kotlin-android nel modulo app).
 */
@CapacitorPlugin(name = "LanBeacon")
public class LanBeaconPlugin extends Plugin {

    private BeaconServer server;
    private final Map<String, ClientWs> clients = new ConcurrentHashMap<>();
    private final AtomicLong counter = new AtomicLong(1);

    private static class ClientWs extends NanoWSD.WebSocket {
        final String id;
        final LanBeaconPlugin plugin;

        ClientWs(String id, NanoHTTPD.IHTTPSession handshake, LanBeaconPlugin plugin) {
            super(handshake);
            this.id = id;
            this.plugin = plugin;
        }

        @Override
        protected void onOpen() {
            plugin.emit("open", id, null);
        }

        @Override
        protected void onClose(NanoWSD.WebSocketFrame.CloseCode code, String reason, boolean initiatedByRemote) {
            plugin.clients.remove(id);
            plugin.emit("close", id, null);
        }

        @Override
        protected void onMessage(String message) {
            plugin.emit("msg", id, message);
        }

        @Override
        protected void onPong(NanoWSD.WebSocketFrame pong) {
        }

        @Override
        protected void onException(IOException e) {
            plugin.clients.remove(id);
        }
    }

    private class BeaconServer extends NanoWSD {
        private final String name;
        private final String version;

        BeaconServer(int port, String name, String version) {
            super(port);
            this.name = name;
            this.version = version;
        }

        @Override
        public NanoHTTPD.Response serve(NanoHTTPD.IHTTPSession session) {
            if ("/api/info".equals(session.getUri())) {
                try {
                    JSObject j = new JSObject();
                    j.put("app", "5emanager");
                    j.put("kind", "p2p-host");
                    j.put("name", name);
                    j.put("version", version);
                    j.put("port", getListeningPort());
                    return newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "application/json; charset=utf-8", j.toString());
                } catch (Exception e) {
                    return newFixedLengthResponse(NanoHTTPD.Response.Status.INTERNAL_ERROR, "text/plain", "err: " + e.getMessage());
                }
            }
            return super.serve(session); // upgrade WebSocket -> openWebSocket
        }

        @Override
        protected NanoWSD.WebSocket openWebSocket(NanoHTTPD.IHTTPSession handshake) {
            String id = "c" + counter.getAndIncrement();
            ClientWs ws = new ClientWs(id, handshake, LanBeaconPlugin.this);
            clients.put(id, ws);
            return ws;
        }
    }

    /** evento nativo -> JS della webview: window.__lanEvt([...]) */
    private void emit(String kind, String id, String payload) {
        try {
            StringBuilder arr = new StringBuilder("[\"").append(kind).append("\",\"").append(id).append("\"");
            if (payload != null) {
                arr.append(',').append(JSONObject.quote(payload));
            }
            arr.append(']');
            final String js = "window.__lanEvt(" + arr + ")";
            WebView wv = getBridge() != null ? getBridge().getWebView() : null;
            if (wv != null) {
                wv.post(() -> wv.evaluateJavascript(js, null));
            }
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        Integer port = call.getInt("port", 3177);
        String name = call.getString("name", "Host 5e Manager");
        if (name == null || name.trim().isEmpty()) name = "Host 5e Manager";
        final int p = port;
        final String n = name.trim();
        final String version = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
        new Thread(() -> {
            try {
                stopServerSync();
                server = new BeaconServer(p, n, version);
                server.start(NanoHTTPD.SOCKET_READ_TIMEOUT, true);
                JSObject res = new JSObject();
                res.put("address", "0.0.0.0:" + p);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("beacon non avviato (porta " + p + " occupata?): " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void send(PluginCall call) {
        String id = call.getString("clientId");
        String msg = call.getString("msg");
        if (id == null || msg == null) {
            call.reject("clientId/msg mancanti");
            return;
        }
        ClientWs ws = clients.get(id);
        if (ws == null) {
            call.reject("client " + id + " non connesso");
            return;
        }
        try {
            ws.send(msg);
            call.resolve();
        } catch (IOException e) {
            call.reject("send fallita: " + e.getMessage());
        }
    }

    @PluginMethod
    public void broadcast(PluginCall call) {
        String msg = call.getString("msg");
        if (msg == null) {
            call.reject("msg mancante");
            return;
        }
        JSObject res = new JSObject();
        int n = 0;
        for (ClientWs ws : clients.values()) {
            try {
                ws.send(msg);
                n++;
            } catch (IOException ignored) {
            }
        }
        res.put("sent", n);
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopServerSync();
        call.resolve();
    }

    private void stopServerSync() {
        if (server != null) {
            try {
                server.stop();
            } catch (Exception ignored) {
            }
            server = null;
        }
        clients.clear();
    }

    @Override
    protected void handleOnDestroy() {
        stopServerSync();
        super.handleOnDestroy();
    }
}
