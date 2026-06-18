use base64::Engine;
use clipboard_app_lib::{AppState, Record, RecordType, Settings, WindowSize};
use std::fs;
use tauri::{State, WebviewWindow};

#[tauri::command]
pub fn get_records(s: State<AppState>) -> Vec<Record> {
    s.lock_db().get_records()
}

#[tauri::command]
pub fn search_records(s: State<AppState>, q: String) -> Vec<Record> {
    let db = s.lock_db();
    if q.is_empty() { db.get_records() } else { db.search(&q) }
}

#[tauri::command]
pub fn get_image_data(s: State<AppState>, path: String) -> Option<String> {
    let db = s.lock_db();
    let fp = db.data_dir.join(&path);
    if !fp.exists() { return None; }
    let data = fs::read(&fp).ok()?;
    let mime = match fp.extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        _ => "image/png",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Some(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub fn delete_record(s: State<AppState>, id: i64) {
    let db = s.lock_db();
    if let Some(r) = db.remove_record(id) {
        if r.record_type == RecordType::Image {
            let _ = fs::remove_file(db.data_dir.join(&r.content));
        }
    }
}

#[tauri::command]
pub fn toggle_pin(s: State<AppState>, id: i64) {
    s.lock_db().toggle_pin(id);
}

#[tauri::command]
pub fn delete_all_records(s: State<AppState>) {
    let db = s.lock_db();
    for r in db.get_records() {
        if r.record_type == RecordType::Image {
            let _ = fs::remove_file(db.data_dir.join(&r.content));
        }
    }
    db.delete_all();
}

#[tauri::command]
pub fn get_settings(s: State<AppState>) -> Settings {
    s.lock_db().get_settings()
}

#[tauri::command]
pub fn save_settings(s: State<AppState>, settings: Settings) {
    s.lock_db().save_settings(&settings);
}

#[tauri::command]
pub fn get_window_size(s: State<AppState>) -> Option<WindowSize> {
    s.lock_db().get_settings().window_size
}

#[tauri::command]
pub fn save_window_size(s: State<AppState>, size: WindowSize) {
    let ws_json = serde_json::to_string(&size).unwrap_or_default();
    s.lock_db().save_setting("window_size", &ws_json);
}

#[tauri::command]
pub fn get_shortcut_hint() -> String {
    "Alt+Shift+V".into()
}

#[tauri::command]
pub fn paste_record(s: State<AppState>, id: i64) -> bool {
    let db = s.lock_db();
    match db.get_record(id) {
        Some(r) if r.record_type == RecordType::Text => {
            arboard::Clipboard::new().ok().map_or(false, |mut c| c.set_text(r.content).is_ok())
        }
        Some(r) if r.record_type == RecordType::Image => {
            let fp = db.data_dir.join(&r.content);
            if !fp.exists() { return false; }
            image::open(&fp).ok().map_or(false, |img| {
                let rgba = img.to_rgba8();
                let (w, h) = rgba.dimensions();
                let img_data = arboard::ImageData {
                    width: w as usize,
                    height: h as usize,
                    bytes: rgba.into_raw().into(),
                };
                arboard::Clipboard::new().ok().map_or(false, |mut c| c.set_image(img_data).is_ok())
            })
        }
        _ => false,
    }
}

#[tauri::command]
pub fn hide_window(w: WebviewWindow) {
    let _ = w.hide();
}
