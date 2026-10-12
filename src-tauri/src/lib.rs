use serde_json::Value;
use tauri::Manager;
use std::fs;
use std::io::Write;
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



const MAX_COMMUNITY_ART_BYTES: usize = 15 * 1024 * 1024;

fn valid_artwork_format(bytes: &[u8], format: &str) -> bool {
    match format {
        "png" => bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]),
        "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "webp" => bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP",
        _ => false,
    }
}

#[tauri::command]
async fn save_community_artwork(
    api_url: String,
    artwork_id: String,
    destination: String,
    expected_format: String,
) -> Result<String, String> {
    if artwork_id.is_empty()
        || artwork_id.len() > 80
        || !artwork_id.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
        || !(artwork_id.as_bytes()[0].is_ascii_lowercase() || artwork_id.as_bytes()[0].is_ascii_digit())
    {
        return Err("The artwork ID is invalid.".into());
    }
    if !["png", "jpeg", "webp"].contains(&expected_format.as_str()) {
        return Err("That image format is not supported.".into());
    }

    let parsed = reqwest::Url::parse(&api_url)
        .map_err(|_| "The artwork API URL is invalid.".to_string())?;
    let host = parsed.host_str().unwrap_or("");
    let worker_host = parsed.scheme() == "https" && host.ends_with(".workers.dev");
    let local_dev_host = cfg!(debug_assertions)
        && parsed.scheme() == "http"
        && (host == "127.0.0.1" || host == "localhost");
    if !(worker_host || local_dev_host)
        || !matches!(parsed.path(), "" | "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("Artwork downloads must come from the configured HTTPS Cloudflare Worker.".into());
    }

    let path = PathBuf::from(&destination);
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
    let extension_matches = match expected_format.as_str() {
        "png" => extension == "png",
        "jpeg" => extension == "jpg" || extension == "jpeg",
        "webp" => extension == "webp",
        _ => false,
    };
    if !extension_matches || path.file_name().is_none() {
        return Err("Choose a filename with the correct image extension.".into());
    }

    let image_url = format!("{}/api/images/{}", parsed.as_str().trim_end_matches('/'), artwork_id);
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|error| format!("Could not prepare the artwork download: {error}"))?;
    let mut response = client.get(image_url).header("accept", "image/png,image/jpeg,image/webp").send().await
        .map_err(|_| "Could not reach the artwork service. Check your internet connection.".to_string())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("This artwork is no longer available.".into());
    }
    if !response.status().is_success() {
        return Err(format!("Artwork download failed (HTTP {}).", response.status().as_u16()));
    }

    let expected_mime = match expected_format.as_str() {
        "png" => "image/png",
        "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        _ => unreachable!(),
    };
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(';').next().unwrap_or("").trim();
    if content_type != expected_mime {
        return Err("The artwork service returned an unexpected image format.".into());
    }
    if response.content_length().is_some_and(|length| length > MAX_COMMUNITY_ART_BYTES as u64) {
        return Err("This image is larger than the 15 MiB download limit.".into());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "The artwork download was interrupted.".to_string())? {
        if bytes.len().saturating_add(chunk.len()) > MAX_COMMUNITY_ART_BYTES {
            return Err("This image is larger than the 15 MiB download limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if !valid_artwork_format(&bytes, &expected_format) {
        return Err("The downloaded file is not a valid supported image signature.".into());
    }

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "A file with that name already exists. Choose a different filename.".to_string()
            } else {
                format!("Could not save the image to the selected location: {error}")
            }
        })?;
    if let Err(error) = file.write_all(&bytes) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(format!("Could not finish saving the artwork: {error}"));
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![download_audio, inspect_media_url, save_community_artwork])
        .run(tauri::generate_context!())
        .expect("error while running Resonance native music player");
}
