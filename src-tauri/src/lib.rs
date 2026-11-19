use futures_util::StreamExt;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tokio::io::AsyncWriteExt;

const REPO: &str = "Tecmat/5emanager";

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
    let clean = v.trim().trim_start_matches(['v', 'V']).split(['-', '+']).next().unwrap_or("");
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

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(concat!("5emanager-updater/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())
}

async fn latest_release() -> Result<serde_json::Value, String> {
    let resp = http_client()?
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("GitHub API: HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// confronta la versione corrente con l'ultima release GitHub e individua l'asset AppImage
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let rel = latest_release().await?;
    let latest = rel["tag_name"].as_str().unwrap_or("").trim_start_matches('v').to_string();
    let page_url = rel["html_url"].as_str().unwrap_or("").to_string();
    let mut asset_url = None;
    let mut asset_name = None;
    if let Some(assets) = rel["assets"].as_array() {
        for a in assets {
            let name = a["name"].as_str().unwrap_or("");
            if name.ends_with(".AppImage") {
                asset_name = Some(name.to_string());
                asset_url = a["browser_download_url"].as_str().map(|s| s.to_string());
                break;
            }
        }
    }
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
        asset_url,
        asset_name,
        checked_at,
    })
}

/// percorso del file temporaneo di download (accanto all'eseguibile, così il rename finale resta sulla stessa fs)
fn update_tmp_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("exe senza directory")?;
    Ok(dir.join(".5emanager-update.AppImage"))
}

/// scarica il nuovo AppImage con eventi di progresso `update-progress` { received, total }
#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let dest = update_tmp_path()?;
    let resp = http_client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download: HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&dest).await.map_err(|e| e.to_string())?;
    let mut received: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        let _ = app.emit(
            "update-progress",
            serde_json::json!({ "received": received, "total": total }),
        );
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(dest.to_string_lossy().to_string())
}

/// sostituisce l'AppImage in esecuzione con quello scaricato e riavvia (questa funzione non ritorna)
#[tauri::command]
fn apply_update() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let tmp = update_tmp_path()?;
    if !tmp.exists() {
        return Err("Nessun aggiornamento scaricato (usa prima Scarica e installa)".into());
    }
    // rename sul posto: su Linux si può sostituire un binario in esecuzione (l'inode vecchio resta montato)
    std::fs::rename(&tmp, &exe).map_err(|e| format!("impossibile sostituire {exe:?}: {e} (l'AppImage è in una cartella scrivibile?)"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    std::process::Command::new(&exe).spawn().map_err(|e| e.to_string())?;
    std::process::exit(0);
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version, check_update, download_update, apply_update])
        .setup(|app| {
            let _ = app.handle().emit("app-ready", ());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("errore nell'avvio di 5e Manager");
}
