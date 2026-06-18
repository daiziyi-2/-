#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clipboard;
mod commands;
mod tray;

use clipboard_app_lib::{AppState, Db};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

fn main() {
    let data_dir = dirs::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("clipboard-app");

    let db = Db::new(data_dir).expect("DB init failed");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState { db: Mutex::new(db) })
        .invoke_handler(tauri::generate_handler![
            commands::get_records,
            commands::search_records,
            commands::get_image_data,
            commands::delete_record,
            commands::toggle_pin,
            commands::delete_all_records,
            commands::get_settings,
            commands::save_settings,
            commands::get_window_size,
            commands::save_window_size,
            commands::get_shortcut_hint,
            commands::paste_record,
            commands::hide_window,
        ])
        .setup(|app| {
            tray::build_tray(app)?;
            clipboard::spawn_clipboard_poller(app.handle().clone());
            clipboard::spawn_cleanup_task(app.handle().clone());

            // Register global shortcut: Alt+Shift+V
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut("Alt+Shift+V", move |_app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            })?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("run failed");
}
