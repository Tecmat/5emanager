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
    let mut parts: Vec<u64> = clean.split('.').map(|p| p.parse::<u64>().unwrap_or(0)).collect();
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
    if let Ok(out) = std::process::Command::new("gh").args(["auth", "token"]).output() {
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
    let mut builder = reqwest::Client::builder().user_agent(concat!("5emanager-updater/", env!("CARGO_PKG_VERSION")));
    if let Some(t) = token {
        builder = builder.default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert(
                reqwest::header::AUTHORIZATION,
                reqwest::header::HeaderValue::from_str(&format!("Bearer {t}")).map_err(|e| e.to_string())?,
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
    if tag.starts_with('v') && tag[1..].chars().next().is_some_and(|c| c.is_ascii_digit()) || tag.chars().next().is_some_and(|c| c.is_ascii_digit()) {
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
        let Some(q1) = html[h..].find('"').map(|p| p + h) else { break };
        let href = &html[h..q1];
        i = q1 + 1;
        let Some(dl) = href.find(needle) else { continue };
        if href.ends_with('/') {
            continue;
        }
        let url = if href.starts_with("http") {
            href.to_string()
        } else {
            format!("https://github.com{href}")
        };
        let name = href[dl + needle.len()..].rsplit('/').next().unwrap_or("").to_string();
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
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
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
        .get(format!("https://github.com/{REPO}/releases/expanded_assets/{tag}"))
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

/// percorso del file temporaneo di download (accanto all'eseguibile, così il rename finale resta sulla stessa fs)
fn update_tmp_path() -> Result<std::path::PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("exe senza directory")?;
    Ok(dir.join(".5emanager-update.AppImage"))
}

/// scarica il nuovo AppImage con eventi di progresso `update-progress` { received, total } (token se presente)
#[tauri::command]
async fn download_update(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let dest = update_tmp_path()?;
    let client = http_client(find_token().as_deref())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("download: HTTP {} (repo privato? serve un token GitHub)", resp.status()));
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
