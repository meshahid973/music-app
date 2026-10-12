use serde_json::Value;
use std::path::Path;
use std::process::Command;

#[tauri::command]
fn download_audio(url: String, output_dir: String, format: String) -> Result<String, String> {
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

    let mut command = Command::new("yt-dlp");
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
        if error.kind() == std::io::ErrorKind::NotFound {
            "yt-dlp was not found. Install yt-dlp and make sure it is available on your Windows PATH, then restart Resonance.".to_string()
        } else {
            format!("Could not start yt-dlp: {error}")
        }
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
fn inspect_media_url(url: String) -> Result<String, String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Enter a valid http:// or https:// URL.".into());
    }

    let result = Command::new("yt-dlp")
        .arg("--dump-single-json")
        .arg("--no-warnings")
        .arg("--no-playlist")
        .arg("--skip-download")
        .arg(url)
        .output()
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "yt-dlp was not found. Install it and make sure it is available on your Windows PATH.".to_string()
            } else {
                format!("Could not start yt-dlp: {error}")
            }
        })?;

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
        .invoke_handler(tauri::generate_handler![download_audio, inspect_media_url])
        .run(tauri::generate_context!())
        .expect("error while running Resonance native music player");
}
