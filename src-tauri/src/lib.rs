use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

const REPO: &str = "Tecmat/5emanager";

// ---------------------------------------------------------------------------
// Beacon LAN (P2P "stile Soul Knight"): il dispositivo host apre un mini server
// HTTP+WS sulla rete locale. Gli altri dispositivi lo trovano scansionando la
// /24 (GET /api/info) e si connettono con un tap a ws://<ip>:<porta>/ws.
// Il trasporto di gioco e' un WebSocket diretto host<->client (niente WebRTC,
// funziona anche su WebKitGTK). I messaggi nativi -> web passano da
// window.__lanEvt(["open"|"msg"|"close", clientId, payload?]).
// ---------------------------------------------------------------------------

struct BeaconState {
    app: tauri::AppHandle,
    name: String,
    version: String,
    port: u16,
    clients: Mutex<HashMap<String, tokio::sync::mpsc::UnboundedSender<axum::extract::ws::Message>>>,
    counter: AtomicU64,
}

struct BeaconHandle {
    state: Arc<BeaconState>,
    shutdown: tokio::sync::oneshot::Sender<()>,
}

static BEACON: OnceLock<Mutex<Option<BeaconHandle>>> = OnceLock::new();

fn beacon_slot() -> &'static Mutex<Option<BeaconHandle>> {
    BEACON.get_or_init(|| Mutex::new(None))
}

/// invia un evento al JS della webview: window.__lanEvt([kind, id, payload?])
fn lan_emit(app: &tauri::AppHandle, parts: &[&str]) {
    if let Ok(js) = serde_json::to_string(&parts) {
        let code = format!("window.__lanEvt({js})");
        for w in app.webview_windows().values() {
            let _ = w.eval(&code);
        }
    }
}

async fn beacon_info(
    axum::extract::State(state): axum::extract::State<Arc<BeaconState>>,
) -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "app": "5emanager",
        "kind": "p2p-host",
        "name": state.name,
        "version": state.version,
        "port": state.port,
    }))
}

async fn beacon_ws(
    ws: axum::extract::ws::WebSocketUpgrade,
    axum::extract::State(state): axum::extract::State<Arc<BeaconState>>,
) -> axum::response::Response {
    ws.on_upgrade(move |socket| beacon_socket(socket, state))
}

async fn beacon_socket(socket: axum::extract::ws::WebSocket, state: Arc<BeaconState>) {
    use axum::extract::ws::Message;
    let id = format!("c{}", state.counter.fetch_add(1, Ordering::SeqCst));
    let (mut tx, mut rx) = socket.split();
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    state.clients.lock().unwrap().insert(id.clone(), out_tx);
    lan_emit(&state.app, &["open", &id]);
    let st2 = state.clone();
    let id2 = id.clone();
    // lettura: client -> JS
    tokio::spawn(async move {
        while let Some(Ok(msg)) = rx.recv().await {
            match msg {
                Message::Text(t) => lan_emit(&st2.app, &["msg", &id2, t.as_str()]),
                Message::Close(_) => break,
                _ => {}
            }
        }
        st2.clients.lock().unwrap().remove(&id2);
        lan_emit(&st2.app, &["close", &id2]);
    });
    // scrittura: JS -> client
    while let Some(msg) = out_rx.recv().await {
        if tx.send(msg).await.is_err() {
            break;
        }
    }
}

/// avvia il beacon LAN (HTTP /api/info + WS /ws) sulla porta data; ritorna l'indirizzo in ascolto
#[tauri::command]
async fn lan_beacon_start(
    app: tauri::AppHandle,
    port: u16,
    name: String,
) -> Result<String, String> {
    // stop di un eventuale beacon precedente
    if let Some(h) = beacon_slot().lock().unwrap().take() {
        let _ = h.shutdown.send(());
    }
    let state = Arc::new(BeaconState {
        app,
        name: if name.trim().is_empty() {
            "Host 5e Manager".to_string()
        } else {
            name.trim().to_string()
        },
        version: env!("CARGO_PKG_VERSION").to_string(),
        port,
        clients: Mutex::new(HashMap::new()),
        counter: AtomicU64::new(1),
    });
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let router = axum::Router::new()
        .route("/api/info", axum::routing::get(beacon_info))
        .route("/ws", axum::routing::get(beacon_ws))
        .with_state(state.clone());
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("impossibile ascoltare sulla porta {port} (gia' in uso?): {e}"))?;
    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    beacon_slot().lock().unwrap().replace(BeaconHandle {
        state,
        shutdown: shutdown_tx,
    });
    Ok(format!("0.0.0.0:{port}"))
}

/// invia un messaggio JSON a un client connesso al beacon
#[tauri::command]
fn lan_beacon_send(client_id: String, msg: String) -> Result<(), String> {
    let slot = beacon_slot().lock().unwrap();
    let Some(h) = slot.as_ref() else {
        return Err("beacon non avviato".into());
    };
    let clients = h.state.clients.lock().unwrap();
    let Some(tx) = clients.get(&client_id) else {
        return Err(format!("client {client_id} non connesso"));
    };
    tx.send(axum::extract::ws::Message::Text(msg.into()))
        .map_err(|e| e.to_string())
}

/// broadcast a tutti i client del beacon
#[tauri::command]
fn lan_beacon_broadcast(msg: String) -> Result<usize, String> {
    let slot = beacon_slot().lock().unwrap();
    let Some(h) = slot.as_ref() else {
        return Err("beacon non avviato".into());
    };
    let clients = h.state.clients.lock().unwrap();
    let m = axum::extract::ws::Message::Text(msg.into());
    let mut n = 0;
    for tx in clients.values() {
        if tx.send(m.clone()).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

/// ferma il beacon LAN
#[tauri::command]
async fn lan_beacon_stop() -> Result<(), String> {
    if let Some(h) = beacon_slot().lock().unwrap().take() {
        let _ = h.shutdown.send(());
    }
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    platform: String,
    current: String,
    latest: String,
    available: bool,
    page_url: String,
    asset_url: Option<String>,
    asset_name: Option<String>,
    checked_at: String,
}

fn parse_version(v: &str) -> Vec<u64> {
    let clean = v
        .trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()
        .unwrap_or("");
    let mut parts: Vec<u64> = clean
        .split('.')
        .map(|p| p.parse::<u64>().unwrap_or(0))
        .collect();
    while parts.len() < 3 {
        parts.push(0);
    }
    parts
}

fn compare_versions(a: &str, b: &str) -> i64 {
    let pa = parse_version(a);
    let pb = parse_version(b);
    for i in 0..pa.len().max(pb.len()) {
        let d = pa.get(i).copied().unwrap_or(0) as i64 - pb.get(i).copied().unwrap_or(0) as i64;
        if d != 0 {
            return d;
        }
    }
    0
}

/// token GitHub per repo privati: env GITHUB_TOKEN → ~/.config/emanager/github-token → `gh auth token`
fn find_token() -> Option<String> {
    if let Ok(t) = std::env::var("GITHUB_TOKEN") {
        let t = t.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = std::path::Path::new(&home).join(".config/emanager/github-token");
        if let Ok(t) = std::fs::read_to_string(&p) {
            let t = t.trim().to_string();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    if let Ok(out) = std::process::Command::new("gh")
        .args(["auth", "token"])
        .output()
    {
        if out.status.success() {
            let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !t.is_empty() {
                return Some(t);
            }
        }
    }
    None
}

fn http_client(token: Option<&str>) -> Result<reqwest::Client, String> {
    let mut builder = reqwest::Client::builder()
        .user_agent(concat!("5emanager-updater/", env!("CARGO_PKG_VERSION")));
    if let Some(t) = token {
        builder = builder.default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&format!("Bearer {t}"))
                    .map_err(|e| e.to_string())?,
            );
            h
        });
    }
    builder.build().map_err(|e| e.to_string())
}

/// primo <title> della prima <entry> del feed atom delle release
fn parse_atom_tag(xml: &str) -> Option<String> {
    let entry = xml.find("<entry>")?;
    let rest = &xml[entry..];
    let t0 = rest.find("<title>")? + 7;
    let t1 = rest[t0..].find("</title>")? + t0;
    let tag = rest[t0..t1].trim();
    if tag.starts_with('v') && tag[1..].chars().next().is_some_and(|c| c.is_ascii_digit())
        || tag.chars().next().is_some_and(|c| c.is_ascii_digit())
    {
        Some(tag.to_string())
    } else {
        None
    }
}

/// href degli asset dalla pagina expanded_assets
fn parse_expanded_assets(html: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let needle = "/releases/download/";
    let mut i = 0;
    while let Some(h) = html[i..].find("href=\"").map(|p| p + i + 6) {
        let Some(q1) = html[h..].find('"').map(|p| p + h) else {
            break;
        };
        let href = &html[h..q1];
        i = q1 + 1;
        let Some(dl) = href.find(needle) else {
            continue;
        };
        if href.ends_with('/') {
            continue;
        }
        let url = if href.starts_with("http") {
            href.to_string()
        } else {
            format!("https://github.com{href}")
        };
        let name = href[dl + needle.len()..]
            .rsplit('/')
            .next()
            .unwrap_or("")
            .to_string();
        if !name.is_empty() && !out.iter().any(|(n, _)| n == &name) {
            out.push((name, url));
        }
    }
    out
}

type ReleaseTuple = (String, String, Vec<(String, String)>); // (tag, page_url, assets)

/// ultima release: prima API (con token se presente), poi fallback HTML github.com (repo pubblico, no rate limit)
async fn latest_release() -> Result<ReleaseTuple, String> {
    let token = find_token();
    let client = http_client(token.as_deref())?;
    let api = client
        .get(format!(
            "https://api.github.com/repos/{REPO}/releases/latest"
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await;
    match api {
        Ok(resp) if resp.status().is_success() => {
            let j: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            let tag = j["tag_name"].as_str().unwrap_or("").to_string();
            let page = j["html_url"].as_str().unwrap_or("").to_string();
            let assets = j["assets"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| {
                            let name = a["name"].as_str()?.to_string();
                            let url = a["browser_download_url"].as_str()?.to_string();
                            Some((name, url))
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok((tag, page, assets))
        }
        Ok(resp) => {
            eprintln!("[update] API HTTP {} — fallback HTML", resp.status());
            html_fallback(&client).await
        }
        Err(e) => {
            eprintln!("[update] API err {e} — fallback HTML");
            html_fallback(&client).await
        }
    }
}

async fn html_fallback(client: &reqwest::Client) -> Result<ReleaseTuple, String> {
    let atom = client
        .get(format!("https://github.com/{REPO}/releases.atom"))
        .send()
        .await
        .map_err(|e| format!("github.com non raggiungibile: {e}"))?;
    if !atom.status().is_success() {
        return Err(format!(
            "GitHub: HTTP {} (repo privato senza token? imposta GITHUB_TOKEN, ~/.config/emanager/github-token o `gh auth login`)",
            atom.status()
        ));
    }
    let xml = atom.text().await.map_err(|e| e.to_string())?;
    let tag = parse_atom_tag(&xml).ok_or("feed atom senza release (repo privato senza token?)")?;
    let page = format!("https://github.com/{REPO}/releases/tag/{tag}");
    let mut assets = Vec::new();
    if let Ok(ea) = client
        .get(format!(
            "https://github.com/{REPO}/releases/expanded_assets/{tag}"
        ))
        .send()
        .await
    {
        if ea.status().is_success() {
            if let Ok(html) = ea.text().await {
                assets = parse_expanded_assets(&html);
            }
        }
    }
    Ok((tag, page, assets))
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// confronta la versione corrente con l'ultima release GitHub e individua l'asset AppImage
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let (tag, page_url, assets) = latest_release().await?;
    let latest = tag.trim_start_matches('v').to_string();
    let appimage = assets.iter().find(|(n, _)| n.ends_with(".AppImage"));
    let checked_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();
    Ok(UpdateInfo {
        platform: "desktop".into(),
        available: compare_versions(&latest, &current) > 0,
        current,
        latest,
        page_url,
        asset_url: appimage.map(|(_, u)| u.clone()),
        asset_name: appimage.map(|(n, _)| n.clone()),
        checked_at,
    })
}

/// percorso del file temporaneo di download: prima accanto all'eseguibile (così il rename finale
/// resta sulla stessa fs), poi in cache (se la cartella dell'AppImage è read-only, es. os error 30)
fn update_tmp_candidates(app: &tauri::AppHandle) -> Vec<std::path::PathBuf> {
    let mut v = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join(".5emanager-update.AppImage"));
        }
    }
    if let Ok(dir) = app.path().app_cache_dir() {
        v.push(dir.join("5emanager").join(".5emanager-update.AppImage"));
    }
    v
}

/// scarica il nuovo AppImage con eventi di progresso `update-progress` { received, total } (token se presente).
/// Se la cartella dell'eseguibile non è scrivibile (fs read-only) ripiega sulla cache.
#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let client = http_client(find_token().as_deref())?;
    let mut last_err = String::new();
    for dest in update_tmp_candidates(&app) {
        if let Some(dir) = dest.parent() {
            if std::fs::create_dir_all(dir).is_err() {
                continue;
            }
        }
        // crea prima il file: se la cartella è read-only (os error 30) passo al prossimo percorso
        let mut file = match tokio::fs::File::create(&dest).await {
            Ok(f) => f,
            Err(e) => {
                last_err = format!("{dest:?}: {e}");
                continue;
            }
        };
        // una richiesta HTTP per tentativo (bytes_stream consuma la response)
        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                last_err = e.to_string();
                let _ = std::fs::remove_file(&dest);
                continue;
            }
        };
        if !resp.status().is_success() {
            last_err = format!(
                "download: HTTP {} (repo privato? serve un token GitHub)",
                resp.status()
            );
            let _ = std::fs::remove_file(&dest);
            continue;
        }
        let total = resp.content_length().unwrap_or(0);
        let mut received: u64 = 0;
        let mut failed = false;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            match chunk {
                Ok(chunk) => {
                    if let Err(e) = file.write_all(&chunk).await {
                        last_err = format!("write {dest:?}: {e}");
                        failed = true;
                        break;
                    }
                    received += chunk.len() as u64;
                    let _ = app.emit(
                        "update-progress",
                        serde_json::json!({ "received": received, "total": total }),
                    );
                }
                Err(e) => {
                    last_err = e.to_string();
                    failed = true;
                    break;
                }
            }
        }
        if failed {
            let _ = std::fs::remove_file(&dest);
            continue;
        }
        let _ = file.flush().await;
        return Ok(dest.to_string_lossy().to_string());
    }
    Err(format!(
        "nessuna cartella scrivibile per il download ({last_err})"
    ))
}

fn chmod755(p: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    let _ = p;
    Ok(())
}

fn launch_and_exit(p: &std::path::Path) -> ! {
    if let Err(e) = std::process::Command::new(p).spawn() {
        eprintln!("[update] avvio di {p:?} fallito: {e}");
    }
    std::process::exit(0);
}

/// sostituisce l'AppImage in esecuzione con quello scaricato e riavvia (questa funzione non ritorna).
/// Se la cartella dell'AppImage è read-only, avvia la copia scaricata in cache (la userà al posto suo).
#[tauri::command]
fn apply_update(app: tauri::AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let tmp = update_tmp_candidates(&app).into_iter().find(|p| p.exists());
    let Some(tmp) = tmp else {
        return Err("Nessun aggiornamento scaricato (usa prima Scarica e installa)".into());
    };
    // 1) il tmp è accanto all'exe → rename sul posto (su Linux si può sostituire un binario in esecuzione)
    if tmp.parent() == exe.parent() && std::fs::rename(&tmp, &exe).is_ok() {
        chmod755(&exe)?;
        launch_and_exit(&exe);
    }
    // 2) fallback (fs read-only): copia in cache come nuovo AppImage e avvialo
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("5emanager");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let new_path = dir.join("5e.Manager-new.AppImage");
    std::fs::copy(&tmp, &new_path)
        .map_err(|e| format!("impossibile copiare l'aggiornamento in {new_path:?}: {e}"))?;
    let _ = std::fs::remove_file(&tmp);
    chmod755(&new_path)?;
    launch_and_exit(&new_path);
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            app_version,
            check_update,
            download_update,
            apply_update,
            lan_beacon_start,
            lan_beacon_send,
            lan_beacon_broadcast,
            lan_beacon_stop
        ])
        .setup(|app| {
            let _ = app.handle().emit("app-ready", ());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("errore nell'avvio di 5e Manager");
}
