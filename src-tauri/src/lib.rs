use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum RecordType {
    Text,
    Image,
}

impl RecordType {
    pub fn as_str(&self) -> &'static str {
        match self {
            RecordType::Text => "text",
            RecordType::Image => "image",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "image" => RecordType::Image,
            _ => RecordType::Text,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: i64,
    #[serde(rename = "type")]
    pub record_type: RecordType,
    pub content: String,
    pub preview: String,
    pub timestamp: i64,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub highlight: Option<Highlight>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Highlight {
    pub index: usize,
    pub length: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_retention")]
    pub retention_days: i32,
    #[serde(default)]
    pub auto_launch: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub window_size: Option<WindowSize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowSize {
    pub width: i32,
    pub height: i32,
}

fn default_retention() -> i32 { 3 }
fn default_theme() -> String { "auto".into() }

pub struct Db {
    pub conn: Connection,
    pub data_dir: PathBuf,
    pub images_dir: PathBuf,
}

impl Db {
    pub fn new(data_dir: PathBuf) -> Result<Self, Box<dyn std::error::Error>> {
        let images_dir = data_dir.join("images");
        std::fs::create_dir_all(&images_dir)?;
        std::fs::create_dir_all(&data_dir)?;
        let conn = Connection::open(data_dir.join("data.db"))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS records (
                id INTEGER PRIMARY KEY,
                record_type TEXT NOT NULL,
                content TEXT NOT NULL,
                preview TEXT DEFAULT '',
                timestamp INTEGER NOT NULL,
                pinned INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_records_timestamp ON records(timestamp);
            CREATE INDEX IF NOT EXISTS idx_records_pinned ON records(pinned);"
        )?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;").ok();
        Ok(Db { conn, data_dir, images_dir })
    }

    pub fn get_records(&self) -> Vec<Record> {
        let mut stmt = self.conn.prepare(
            "SELECT id, record_type, content, preview, timestamp, pinned FROM records ORDER BY pinned DESC, timestamp DESC"
        ).unwrap();
        stmt.query_map([], |row| Ok(Record {
            id: row.get(0)?,
            record_type: RecordType::from_str(&row.get::<_, String>(1)?),
            content: row.get(2)?,
            preview: row.get(3)?,
            timestamp: row.get(4)?,
            pinned: row.get::<_, i32>(5)? != 0,
            highlight: None,
        })).unwrap().filter_map(|r| r.ok()).collect()
    }

    pub fn add_record(&self, record_type: &RecordType, content: &str, preview: &str) -> Record {
        let ts = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "INSERT INTO records (record_type, content, preview, timestamp, pinned) VALUES (?1,?2,?3,?4,0)",
            params![record_type.as_str(), content, preview, ts]
        ).unwrap();
        
        Record {
            id: self.conn.last_insert_rowid(),
            record_type: record_type.clone(),
            content: content.into(),
            preview: preview.into(),
            timestamp: ts,
            pinned: false,
            highlight: None,
        }
    }

    pub fn remove_record(&self, id: i64) -> Option<Record> {
        let rec = self.get_record(id);
        if rec.is_some() {
            self.conn.execute("DELETE FROM records WHERE id=?1", params![id]).unwrap();
        }
        rec
    }

    pub fn get_record(&self, id: i64) -> Option<Record> {
        self.conn.query_row(
            "SELECT id, record_type, content, preview, timestamp, pinned FROM records WHERE id=?1",
            params![id],
            |row| Ok(Record {
                id: row.get(0)?,
                record_type: RecordType::from_str(&row.get::<_, String>(1)?),
                content: row.get(2)?,
                preview: row.get(3)?,
                timestamp: row.get(4)?,
                pinned: row.get::<_, i32>(5)? != 0,
                highlight: None,
            })
        ).ok()
    }

    pub fn toggle_pin(&self, id: i64) {
        if let Some(rec) = self.get_record(id) {
            self.conn.execute(
                "UPDATE records SET pinned=?1 WHERE id=?2",
                params![if rec.pinned { 0 } else { 1 }, id]
            ).unwrap();
        }
    }

    pub fn delete_all(&self) {
        self.conn.execute("DELETE FROM records", []).unwrap();
    }

    pub fn clean_old(&self, retention_days: i32) {
        let cutoff = chrono::Utc::now().timestamp_millis() - (retention_days as i64 * 86400000);
        self.conn.execute(
            "DELETE FROM records WHERE timestamp<?1 AND pinned=0",
            params![cutoff]
        ).unwrap();
    }

    pub fn search(&self, query: &str) -> Vec<Record> {
        let q = format!("%{}%", query);
        let mut stmt = self.conn.prepare(
            "SELECT id, record_type, content, preview, timestamp, pinned FROM records
             WHERE record_type='text' AND LOWER(content) LIKE LOWER(?1)
             ORDER BY pinned DESC, timestamp DESC"
        ).unwrap();
        let mut records: Vec<Record> = stmt.query_map(params![q], |row| Ok(Record {
            id: row.get(0)?,
            record_type: RecordType::from_str(&row.get::<_, String>(1)?),
            content: row.get(2)?,
            preview: row.get(3)?,
            timestamp: row.get(4)?,
            pinned: row.get::<_, i32>(5)? != 0,
            highlight: None,
        })).unwrap().filter_map(|r| r.ok()).collect();

        // Add highlight info (byte index → char index for JS compatibility)
        let ql = query.to_lowercase();
        for r in &mut records {
            if let Some(byte_idx) = r.content.to_lowercase().find(&ql) {
                let char_idx = r.content[..byte_idx].chars().count();
                r.highlight = Some(Highlight { index: char_idx, length: query.chars().count() });
            }
        }
        records
    }

    pub fn get_settings(&self) -> Settings {
        let mut s = Settings { retention_days: 3, auto_launch: false, theme: "auto".into(), window_size: None };
        let mut stmt = self.conn.prepare("SELECT key, value FROM settings").unwrap();
        for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).unwrap() {
            if let Ok((k, v)) = row {
                match k.as_str() {
                    "retention_days" => s.retention_days = v.parse().unwrap_or(3),
                    "auto_launch" => s.auto_launch = v == "true",
                    "theme" => s.theme = v,
                    "window_size" => {
                        if let Ok(ws) = serde_json::from_str::<WindowSize>(&v) {
                            s.window_size = Some(ws);
                        }
                    }
                    _ => {}
                }
            }
        }
        s
    }

    pub fn save_settings(&self, settings: &Settings) {
        let ws_json = settings.window_size.as_ref()
            .and_then(|ws| serde_json::to_string(ws).ok())
            .unwrap_or_default();
        let auto_launch = if settings.auto_launch { "true" } else { "false" };
        self.conn.execute_batch(&format!(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('retention_days','{}');
             INSERT OR REPLACE INTO settings(key,value) VALUES('auto_launch','{}');
             INSERT OR REPLACE INTO settings(key,value) VALUES('theme','{}');
             INSERT OR REPLACE INTO settings(key,value) VALUES('window_size','{}');",
            settings.retention_days, auto_launch, settings.theme, ws_json
        )).unwrap();
    }

    pub fn save_setting(&self, key: &str, value: &str) {
        self.conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1,?2)",
            params![key, value]
        ).unwrap();
    }

    pub fn get_last_hash(&self) -> String {
        self.conn.query_row(
            "SELECT value FROM settings WHERE key='last_hash'",
            [],
            |r| r.get::<_, String>(0)
        ).unwrap_or_default()
    }

    pub fn save_last_hash(&self, hash: &str) {
        self.conn.execute(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('last_hash',?1)",
            params![hash]
        ).ok();
    }
}

pub struct AppState {
    pub db: Mutex<Db>,
}

impl AppState {
    pub fn lock_db(&self) -> std::sync::MutexGuard<'_, Db> {
        self.db.lock().unwrap()
    }
}
