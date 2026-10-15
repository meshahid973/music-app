mod storage;

use serde_json::Value;
use tauri::Manager;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn yt_dlp_executable(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Prefer a normal installation if the user already has yt-dlp on PATH.
    if Command::new("yt-dlp").arg("--version").output().is_ok() {
        return Ok(PathBuf::from("yt-dlp"));
    }

    // Otherwise, keep a private copy in Resonance's app data directory and
    // install it automatically on first use.
    let app_data = app.path().app_data_dir()
        .map_err(|error| format!("Could not locate Resonance's app data folder: {error}"))?;
    let tools_dir = app_data.join("tools");
    fs::create_dir_all(&tools_dir)
        .map_err(|error| format!("Could not prepare the downloader folder: {error}"))?;
    let executable = tools_dir.join("yt-dlp.exe");

    if executable.is_file() {
        return Ok(executable);
    }

    let escaped_path = executable.to_string_lossy().replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile '{escaped_path}'"
    );
    let result = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &script])
        .output()
        .map_err(|error| format!("Resonance could not download yt-dlp automatically: {error}. Check your internet connection and try again."))?;

    if !result.status.success() || !executable.is_file() {
        let _ = fs::remove_file(&executable);
        let detail = String::from_utf8_lossy(&result.stderr);
        let detail = detail.lines().rev().find(|line| !line.trim().is_empty())
            .unwrap_or("The download did not complete.");
        return Err(format!("Resonance could not install yt-dlp automatically: {detail} Check your internet connection and try again."));
    }

    Ok(executable)
}

#[tauri::command]
fn download_audio(
    app: tauri::AppHandle,
    url: String,
    output_dir: String,
    format: String,
) -> Result<String, String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Enter a valid http:// or https:// URL.".into());
    }

    let output_path = Path::new(&output_dir);
    if !output_path.is_dir() {
        return Err("Your selected Music folder is unavailable. Choose the folder again in Resonance.".into());
    }

    let allowed_formats = ["best", "mp3", "m4a", "opus", "flac", "wav"];
    if !allowed_formats.contains(&format.as_str()) {
        return Err("That audio format is not supported.".into());
    }

    let executable = yt_dlp_executable(&app)?;
    let mut command = Command::new(executable);
    command
        .arg("--no-warnings")
        .arg("--no-playlist")
        .arg("--newline")
        .arg("--no-progress")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("-P")
        .arg(output_path)
        .arg("-o")
        .arg("%(title)s.%(ext)s");

    if format == "best" {
        command.arg("-f").arg("bestaudio/best");
    } else {
        command
            .arg("-f")
            .arg("bestaudio/best")
            .arg("-x")
            .arg("--audio-format")
            .arg(&format)
            .arg("--audio-quality")
            .arg("0")
            .arg("--embed-metadata");
    }

    let result = command.arg(url).output().map_err(|error| {
        format!("Could not start yt-dlp: {error}")
    })?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let detail = stderr.lines().rev().find(|line| !line.trim().is_empty())
            .unwrap_or("yt-dlp could not download this URL.");
        return Err(format!("Download failed: {detail}"));
    }

    let stdout = String::from_utf8_lossy(&result.stdout);
    let saved_path = stdout.lines().rev().find(|line| {
        let line = line.trim();
        !line.is_empty() && Path::new(line).is_absolute()
    }).map(str::trim).unwrap_or("");

    if saved_path.is_empty() {
        return Err("yt-dlp finished, but Resonance could not identify the saved file path.".into());
    }
    Ok(saved_path.to_string())
}

#[tauri::command]
fn inspect_media_url(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Enter a valid http:// or https:// URL.".into());
    }

    let executable = yt_dlp_executable(&app)?;
    let result = Command::new(executable)
        .arg("--dump-single-json")
        .arg("--no-warnings")
        .arg("--no-playlist")
        .arg("--skip-download")
        .arg(url)
        .output()
        .map_err(|error| format!("Could not start yt-dlp: {error}"))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(stderr.lines().rev().find(|line| !line.trim().is_empty())
            .unwrap_or("Could not inspect this media URL.").to_string());
    }

    let data: Value = serde_json::from_slice(&result.stdout)
        .map_err(|_| "yt-dlp returned invalid media information.".to_string())?;
    let title = data.get("title").and_then(Value::as_str).unwrap_or("Audio download");
    let duration = data.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
    Ok(serde_json::json!({ "title": title, "duration": duration }).to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![download_audio, inspect_media_url, storage::save_appdata_snapshot, storage::load_appdata_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running Resonance native music player");
}
