//! Crash-safe AppData snapshots. Keep the on-disk JSON formats compatible with older releases.
use serde::Serialize;
use serde_json::Value;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static SNAPSHOT_LOCK: Mutex<()> = Mutex::new(());
const MAX_SNAPSHOT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize)]
pub struct LoadedSnapshot {
    pub json: Option<String>,
    pub recovered: bool,
}

fn file_name(kind: &str) -> Result<&'static str, String> {
    match kind {
        "library" => Ok("resonance_library.json"),
        "artwork" => Ok("artwork_sources_v1.json"),
        _ => Err("Unknown AppData snapshot type".into()),
    }
}

fn valid_payload(kind: &str, json: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(json) else {
        return false;
    };
    match kind {
        "library" => value.get("tracks").is_some_and(Value::is_array)
            && value.get("playlists").is_some_and(Value::is_array),
        "artwork" => value.get("version").and_then(Value::as_u64) == Some(1)
            && value.get("entries").is_some_and(Value::is_object),
        _ => false,
    }
}

fn write_synced(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

// Rename over the destination atomically on the same filesystem.
// Windows std::fs::rename cannot replace an existing destination.
#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let from_wide: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to_wide: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    let ok = unsafe {
        MoveFileExW(
            from_wide.as_ptr(),
            to_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if ok == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    fs::rename(from, to)
}

fn save_at(path: &Path, kind: &str, json: &str) -> Result<(), String> {
    if json.len() > MAX_SNAPSHOT_BYTES || !valid_payload(kind, json) {
        return Err("Refusing to overwrite AppData with an invalid snapshot".into());
    }
    let directory = path.parent().ok_or("Invalid AppData snapshot path")?;
    fs::create_dir_all(directory).map_err(|e| format!("Cannot prepare AppData: {e}"))?;

    let tmp = path.with_extension(format!("json.tmp.{}", std::process::id()));
    let backup = path.with_extension("json.bak");
    let backup_tmp = path.with_extension(format!("json.bak.tmp.{}", std::process::id()));

    let result = (|| -> Result<(), String> {
        write_synced(&tmp, json.as_bytes()).map_err(|e| format!("Cannot stage snapshot: {e}"))?;

        // Never replace a good recovery copy with a damaged primary.
        if path.is_file() {
            let previous = fs::read_to_string(path)
                .map_err(|e| format!("Cannot read previous snapshot: {e}"))?;
            if valid_payload(kind, &previous) {
                write_synced(&backup_tmp, previous.as_bytes())
                    .map_err(|e| format!("Cannot stage snapshot backup: {e}"))?;
                replace_file(&backup_tmp, &backup)
                    .map_err(|e| format!("Cannot commit snapshot backup: {e}"))?;
            } else if kind == "library" {
                let backup_json = fs::read_to_string(&backup).ok();
                if !backup_json.as_deref().is_some_and(|saved| valid_payload(kind, saved)) {
                    return Err("Existing AppData snapshot is damaged and has no valid recovery copy".into());
                }
            }
        }

        replace_file(&tmp, path).map_err(|e| format!("Cannot commit AppData snapshot: {e}"))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&tmp);
        let _ = fs::remove_file(&backup_tmp);
    }
    result
}

fn load_at(path: &Path, kind: &str) -> Result<LoadedSnapshot, String> {
    let backup = path.with_extension("json.bak");
    let primary = if path.is_file() { fs::read_to_string(path).ok() } else { None };
    if let Some(json) = primary.as_deref() {
        if valid_payload(kind, json) {
            return Ok(LoadedSnapshot { json: primary, recovered: false });
        }
    }
    if backup.is_file() {
        if let Ok(json) = fs::read_to_string(&backup) {
            if valid_payload(kind, &json) {
                return Ok(LoadedSnapshot { json: Some(json), recovered: true });
            }
        }
    }
    if path.exists() || backup.exists() {
        return Err("AppData snapshot is unreadable and no valid recovery copy exists".into());
    }
    Ok(LoadedSnapshot { json: None, recovered: false })
}

#[tauri::command]
pub async fn save_appdata_snapshot(app: AppHandle, kind: String, json: String) -> Result<(), String> {
    let name = file_name(&kind)?;
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join(name);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SNAPSHOT_LOCK.lock().map_err(|_| "Snapshot lock unavailable")?;
        save_at(&path, &kind, &json)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn load_appdata_snapshot(app: AppHandle, kind: String) -> Result<LoadedSnapshot, String> {
    let name = file_name(&kind)?;
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join(name);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = SNAPSHOT_LOCK.lock().map_err(|_| "Snapshot lock unavailable")?;
        load_at(&path, &kind)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_recovers_a_corrupted_primary_without_overwriting_it() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let folder = std::env::temp_dir().join(format!("resonance-snapshot-{}-{unique}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("resonance_library.json");
        let older = r#"{"tracks":[{"id":"original"}],"playlists":[]}"#;
        let newer = r#"{"tracks":[{"id":"updated"}],"playlists":[]}"#;
        save_at(&path, "library", older).unwrap();
        save_at(&path, "library", newer).unwrap();
        assert!(!load_at(&path, "library").unwrap().recovered);
        fs::write(&path, "{truncated").unwrap();
        let recovered = load_at(&path, "library").unwrap();
        assert!(recovered.recovered);
        assert_eq!(recovered.json.as_deref(), Some(older));
        save_at(&path, "library", older).unwrap();
        assert_eq!(
            fs::read_to_string(path.with_extension("json.bak")).unwrap(),
            older
        );
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn optional_artwork_index_can_rebuild_after_corruption() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let folder = std::env::temp_dir().join(format!("resonance-art-index-{}-{unique}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("artwork_sources_v1.json");
        fs::write(&path, "{corrupt").unwrap();
        let fresh = r#"{"version":1,"entries":{}}"#;
        save_at(&path, "artwork", fresh).unwrap();
        assert_eq!(load_at(&path, "artwork").unwrap().json.as_deref(), Some(fresh));
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn corrupt_primary_without_backup_never_gets_overwritten() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let folder = std::env::temp_dir().join(format!("resonance-damage-{}-{unique}", std::process::id()));
        fs::create_dir_all(&folder).unwrap();
        let path = folder.join("resonance_library.json");
        fs::write(&path, "{truncated").unwrap();
        assert!(load_at(&path, "library").is_err());
        assert!(save_at(&path, "library", r#"{"tracks":[],"playlists":[]}"#).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "{truncated");
        fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn accepts_legacy_library_and_rejects_wrong_shapes() {
        assert!(valid_payload("library", r#"{"tracks":[],"playlists":[]}"#));
        assert!(!valid_payload("library", r#"{"tracks":"broken","playlists":[]}"#));
        assert!(valid_payload("artwork", r#"{"version":1,"entries":{}}"#));
    }
}
