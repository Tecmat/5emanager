use tauri::{Emitter, Manager};

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_version])
        .setup(|app| {
            let _ = app.handle().emit("app-ready", ());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("errore nell'avvio di 5e Manager");
}
