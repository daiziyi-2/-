use clipboard_app_lib::{AppState, RecordType};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use tauri::{AppHandle, Emitter, Manager};

fn hash_str(s: &str) -> String {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    format!("{:x}", h.finish())
}

fn hash_bytes(data: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    data.hash(&mut h);
    format!("{:x}", h.finish())
}

/// Spawn clipboard polling thread — detects new text and images every 800ms
pub fn spawn_clipboard_poller(handle: AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(800));

            let mut cb = match arboard::Clipboard::new() {
                Ok(c) => c,
                Err(_) => continue,
            };

            // Check text clipboard
            if let Ok(text) = cb.get_text() {
                if !text.trim().is_empty() {
                    let h = hash_str(&text);
                    let state = handle.state::<AppState>();
                    let db = state.lock_db();
                    if h != db.get_last_hash() {
                        db.save_last_hash(&h);
                        let preview: String = text.chars().take(200).collect();
                        let rec = db.add_record(&RecordType::Text, &text, &preview);
                        drop(db);
                        let _ = handle.emit("new-record", rec);
                    } else {
                        drop(db);
                    }
                    continue;
                }
            }

            // Check image clipboard
            if let Ok(img) = cb.get_image() {
                let bytes = img.bytes.to_vec();
                let h = hash_bytes(&bytes);
                let state = handle.state::<AppState>();
                let db = state.lock_db();
                if h != db.get_last_hash() {
                    db.save_last_hash(&h);
                    let filename = format!("{}.png", chrono::Utc::now().timestamp_millis());
                    let fp = db.images_dir.join(&filename);
                    let _ = fs::write(&fp, &bytes);
                    let rec = db.add_record(&RecordType::Image, &filename, "");
                    drop(db);
                    let _ = handle.emit("new-record", rec);
                } else {
                    drop(db);
                }
            }
        }
    });
}

/// Spawn periodic cleanup thread — purges old records every 6 hours
pub fn spawn_cleanup_task(handle: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
        let state = handle.state::<AppState>();
        let db = state.lock_db();
        let days: i32 = db
            .conn
            .query_row("SELECT value FROM settings WHERE key='retention_days'", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap_or_default()
            .parse()
            .unwrap_or(3);
        if days > 0 {
            db.clean_old(days);
        }
    });
}
