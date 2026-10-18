//! SQLite storage for the desktop music library. JSON files from old releases remain
//! untouched, and are imported transactionally on the first successful launch.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

static DB_LOCK: Mutex<()> = Mutex::new(());
const SQLITE_NAME: &str = "resonance_library.sqlite3";
const LEGACY_NAME: &str = "resonance_library.json";
const LEGACY_BACKUP_NAME: &str = "resonance_library.json.bak";
const MAX_LIBRARY_BYTES: usize = 128 * 1024 * 1024;

fn error(err: impl std::fmt::Display) -> String {
    format!("Library database: {err}")
}

fn valid_library(json: &str) -> Result<Value, String> {
    if json.len() > MAX_LIBRARY_BYTES {
        return Err("Library is too large to migrate safely".into());
    }
    let value: Value = serde_json::from_str(json).map_err(error)?;
    let Some(obj) = value.as_object() else {
        return Err("Library data must be an object".into());
    };
    for key in ["tracks", "playlists"] {
        if !obj.get(key).is_some_and(Value::is_array) {
            return Err(format!("Library has no valid {key} list"));
        }
    }
    for key in ["tracks", "playlists"] {
        for item in obj[key].as_array().unwrap() {
            if !item.get("id").and_then(Value::as_str).is_some_and(|id| !id.is_empty()) {
                return Err(format!("Library contains an invalid {key} identifier"));
            }
        }
    }
    Ok(value)
}

fn connect(path: &Path) -> Result<Connection, String> {
    let mut conn = Connection::open(path).map_err(error)?;
    conn.busy_timeout(Duration::from_secs(5)).map_err(error)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS tracks (
             id TEXT PRIMARY KEY NOT NULL,
             position INTEGER NOT NULL,
             payload TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS playlists (
             id TEXT PRIMARY KEY NOT NULL,
             position INTEGER NOT NULL,
             payload TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS metadata (
             key TEXT PRIMARY KEY NOT NULL,
             payload TEXT NOT NULL
         );",
    ).map_err(error)?;
    Ok(conn)
}

fn update_rows(tx: &rusqlite::Transaction<'_>, table: &str, rows: &[Value]) -> Result<(), String> {
    // Table is a hardcoded internal identifier, never supplied from IPC.
    let mut existing = HashMap::<String, (i64, String)>::new();
    {
        let mut stmt = tx.prepare(&format!("SELECT id, position, payload FROM {table}")).map_err(error)?;
        let values = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?))
        }).map_err(error)?;
        for value in values {
            let (id, position, payload) = value.map_err(error)?;
            existing.insert(id, (position, payload));
        }
    }
    let mut upsert = tx.prepare(&format!(
        "INSERT INTO {table}(id, position, payload) VALUES(?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET position=excluded.position, payload=excluded.payload"
    )).map_err(error)?;
    let mut seen = std::collections::HashSet::<String>::new();
    for (position, item) in rows.iter().enumerate() {
        let id = item["id"].as_str().ok_or("Missing library item ID")?;
        if !seen.insert(id.to_owned()) {
            return Err(format!("Duplicate {table} ID in library"));
        }
        let json = serde_json::to_string(item).map_err(error)?;
        if existing.remove(id).is_some_and(|(old_pos, old_json)| old_pos == position as i64 && old_json == json) {
            continue;
        }
        upsert.execute(params![id, position as i64, json]).map_err(error)?;
    }
    drop(upsert);
    let mut delete = tx.prepare(&format!("DELETE FROM {table} WHERE id = ?1")).map_err(error)?;
    for id in existing.keys() {
        delete.execute([id]).map_err(error)?;
    }
    Ok(())
}

fn save(conn: &mut Connection, json: &str) -> Result<(), String> {
    let mut value = valid_library(json)?;
    let tracks = value["tracks"].take();
    let playlists = value["playlists"].take();
    // Keep all unknown state keys so future features and Spotify metadata survive.
    let mut root = value.as_object().ok_or("Library data is not an object")?.clone();
    root.remove("tracks");
    root.remove("playlists");
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(error)?;
    update_rows(&tx, "tracks", tracks.as_array().ok_or("Missing tracks")?)?;
    update_rows(&tx, "playlists", playlists.as_array().ok_or("Missing playlists")?)?;
    tx.execute(
        "INSERT INTO metadata(key,payload) VALUES('state',?1)
         ON CONFLICT(key) DO UPDATE SET payload=excluded.payload",
        [serde_json::to_string(&root).map_err(error)?],
    ).map_err(error)?;
    tx.commit().map_err(error)
}

fn load_from_database(conn: &Connection) -> Result<Option<String>, String> {
    let state: Option<String> = conn
        .query_row("SELECT payload FROM metadata WHERE key='state'", [], |row| row.get(0))
        .optional().map_err(error)?;
    let Some(state) = state else {
        let count: i64 = conn.query_row(
            "SELECT (SELECT COUNT(*) FROM tracks) + (SELECT COUNT(*) FROM playlists)",
            [], |row| row.get(0),
        ).map_err(error)?;
        if count != 0 {
            return Err("Incomplete database: missing library metadata".into());
        }
        return Ok(None);
    };
    let mut root: Map<String, Value> = serde_json::from_str(&state).map_err(error)?;
    for table in ["tracks", "playlists"] {
        let mut stmt = conn.prepare(&format!("SELECT payload FROM {table} ORDER BY position ASC")).map_err(error)?;
        let list = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(error)?
            .map(|row| serde_json::from_str::<Value>(&row.map_err(error)?).map_err(error))
            .collect::<Result<Vec<_>, _>>()?;
        root.insert(table.to_owned(), Value::Array(list));
    }
    let json = serde_json::to_string(&root).map_err(error)?;
    valid_library(&json)?;
    Ok(Some(json))
}

fn load_or_migrate(dir: &Path) -> Result<Option<String>, String> {
    fs::create_dir_all(dir).map_err(error)?;
    let mut conn = connect(&dir.join(SQLITE_NAME))?;
    if let Some(json) = load_from_database(&conn)? {
        return Ok(Some(json));
    }
    // Only import a legacy JSON file when the database is new and empty.
    // An invalid legacy file is not treated as an empty library.
    let primary = dir.join(LEGACY_NAME);
    let backup = dir.join(LEGACY_BACKUP_NAME);
    let mut damaged = false;
    for path in [primary.as_path(), backup.as_path()] {
        if !path.exists() {
            continue;
        }
        let content = fs::read_to_string(path).map_err(error)?;
        if valid_library(&content).is_ok() {
            save(&mut conn, &content)?;
            return load_from_database(&conn);
        }
        damaged = true;
    }
    if damaged {
        return Err("Existing library JSON is damaged; original files preserved. Restore a backup before importing.".into());
    }
    Ok(None)
}

fn save_at(dir: &Path, json: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(error)?;
    let mut conn = connect(&dir.join(SQLITE_NAME))?;
    // Do not overwrite an unmigrated old library if its migration has failed.
    if load_from_database(&conn)?.is_none() && dir.join(LEGACY_NAME).exists() {
        let _ = load_or_migrate(dir)?;
    }
    save(&mut conn, json)
}

#[tauri::command]
pub async fn load_library_sqlite(app: AppHandle) -> Result<Option<String>, String> {
    let dir = app.path().app_data_dir().map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DB_LOCK.lock().map_err(error)?;
        load_or_migrate(&dir)
    }).await.map_err(error)?
}

#[tauri::command]
pub async fn save_library_sqlite(app: AppHandle, json: String) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(error)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = DB_LOCK.lock().map_err(error)?;
        save_at(&dir, &json)
    }).await.map_err(error)?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("resonance-{label}-{}-{:?}", std::process::id(), std::thread::current().id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn round_trip_preserves_playlists_and_unknown_track_fields() {
        let dir = temp_dir("sqlite-roundtrip");
        let original = r#"{"version":2,"tracks":[{"id":"first","title":"Song","spotify":{"trackId":"abc"}},{"id":"second","filePath":"C:\\\\music\\\\2.mp3"}],"playlists":[{"id":"favorites","trackIds":["first"]}],"volume":0.8,"musicFolderPath":"C:\\\\music"}"#;
        save_at(&dir, original).unwrap();
        let restored = load_or_migrate(&dir).unwrap().unwrap();
        assert_eq!(valid_library(original).unwrap(), valid_library(&restored).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn upgrade_from_json_keeps_legacy_file_and_playlist_membership() {
        let dir = temp_dir("sqlite-upgrade");
        let legacy = r#"{"version":2,"tracks":[{"id":"native:one","title":"Legacy"}],"playlists":[{"id":"favorites","trackIds":["native:one"]}],"shuffle":true}"#;
        fs::write(dir.join(LEGACY_NAME), legacy).unwrap();
        let migrated = load_or_migrate(&dir).unwrap().unwrap();
        assert_eq!(valid_library(&migrated).unwrap(), valid_library(legacy).unwrap());
        assert_eq!(fs::read_to_string(dir.join(LEGACY_NAME)).unwrap(), legacy);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_save_does_not_replace_previous_data() {
        let dir = temp_dir("sqlite-rollback");
        let good = r#"{"tracks":[{"id":"first"}],"playlists":[]}"#;
        save_at(&dir, good).unwrap();
        assert!(save_at(&dir, r#"{"tracks":"broken","playlists":[]}"#).is_err());
        assert_eq!(valid_library(&load_or_migrate(&dir).unwrap().unwrap()).unwrap(), valid_library(good).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn broken_legacy_json_never_becomes_an_empty_library() {
        let dir = temp_dir("sqlite-damaged");
        fs::write(dir.join(LEGACY_NAME), "{broken").unwrap();
        assert!(load_or_migrate(&dir).is_err());
        assert!(save_at(&dir, r#"{"tracks":[],"playlists":[]}"#).is_err());
        assert_eq!(fs::read_to_string(dir.join(LEGACY_NAME)).unwrap(), "{broken");
        fs::remove_dir_all(dir).unwrap();
    }
}
