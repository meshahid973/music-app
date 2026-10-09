//! Native filesystem discovery only. Metadata and persistence remain unchanged.
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

const MAX_DEPTH: usize = 8;
const MAX_FILES: usize = 250_000;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScanResult {
    audio_paths: Vec<String>,
    cover_paths: Vec<String>,
}

fn category(path: &Path) -> Option<bool> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac" | "opus" | "webm"
        | "wma" | "alac" | "aiff" => Some(true),
        "jpg" | "jpeg" | "png" | "webp" | "avif" | "bmp" | "gif" | "svg" => Some(false),
        _ => None,
    }
}

fn scan_paths(paths: Vec<String>) -> Result<NativeScanResult, String> {
    let mut result = NativeScanResult::default();
    let mut seen = HashSet::<PathBuf>::new();
    let mut stack: Vec<(PathBuf, usize)> = paths
        .into_iter()
        .map(|path| (PathBuf::from(path), 0))
        .collect();

    while let Some((path, depth)) = stack.pop() {
        if !seen.insert(path.clone()) {
            continue;
        }
        let kind = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata.file_type(),
            Err(error) => {
                // The user may have moved/deleted a file between drop and scan.
                eprintln!("Skipping inaccessible music path {}: {error}", path.display());
                continue;
            }
        };
        // Never traverse symlink/junction loops, including dragged shortcuts.
        if kind.is_symlink() {
            continue;
        }
        if kind.is_file() {
            match category(&path) {
                Some(true) => result.audio_paths.push(path.to_string_lossy().into_owned()),
                Some(false) => result.cover_paths.push(path.to_string_lossy().into_owned()),
                None => {}
            }
            if result.audio_paths.len() + result.cover_paths.len() > MAX_FILES {
                return Err(format!("Music folder contains more than {MAX_FILES} supported files"));
            }
        } else if kind.is_dir() {
            if depth > MAX_DEPTH {
                continue;
            }
            let entries = match fs::read_dir(&path) {
                Ok(entries) => entries,
                Err(error) => {
                    eprintln!("Skipping unreadable music directory {}: {error}", path.display());
                    continue;
                }
            };
            for entry in entries.flatten() {
                let entry_path = entry.path();
                // At the maximum depth, inspect immediate files but never recurse.
                stack.push((entry_path, depth + 1));
            }
        }
    }

    result.audio_paths.sort();
    result.cover_paths.sort();
    Ok(result)
}

#[tauri::command]
pub async fn scan_music_paths(paths: Vec<String>) -> Result<NativeScanResult, String> {
    // Disk traversal must never block the WebView's UI/executor.
    tauri::async_runtime::spawn_blocking(move || scan_paths(paths))
        .await
        .map_err(|error| format!("Music scan worker failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn finds_nested_files_case_insensitively_without_duplicates() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("resonance-scan-{}-{nonce}", std::process::id()));
        let folder = root.join("album");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("SONG.MP3"), b"test").unwrap();
        fs::write(folder.join("cover.JpG"), b"test").unwrap();
        fs::write(folder.join("notes.txt"), b"test").unwrap();

        let root_string = root.to_string_lossy().into_owned();
        let result = scan_paths(vec![root_string.clone(), root_string]).unwrap();
        assert_eq!(result.audio_paths.len(), 1);
        assert_eq!(result.cover_paths.len(), 1);
        assert!(result.audio_paths[0].ends_with("SONG.MP3"));
        assert!(result.cover_paths[0].ends_with("cover.JpG"));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skips_missing_and_unsupported_paths() {
        let result = scan_paths(vec![
            "/this/path/does/not/exist/resonance.mp3".to_string(),
            "unrecognized.txt".to_string(),
        ])
        .unwrap();
        assert!(result.audio_paths.is_empty());
        assert!(result.cover_paths.is_empty());
    }
}
