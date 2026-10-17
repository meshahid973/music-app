use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_fs::FsExt;

const MAX_URL_LEN: usize = 2048;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// Serialises first-run installs so two simultaneous commands never race on the same file.
static INSTALL_LOCK: Mutex<()> = Mutex::new(());

// Downloads yt-dlp and refuses to install it unless its SHA-256 matches the checksum file
// published with the same release. The output path is passed through an environment
// variable (never interpolated into the script) so odd characters in a path cannot alter it.
const INSTALL_SCRIPT: &str = r#"$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
$base='https://github.com/yt-dlp/yt-dlp/releases/latest/download/'
$out=$env:RESONANCE_YTDLP_OUT; $tmp=$out+'.download'
try {
  Invoke-WebRequest -UseBasicParsing -Uri ($base+'yt-dlp.exe') -OutFile $tmp
  $sums=(Invoke-WebRequest -UseBasicParsing -Uri ($base+'SHA2-256SUMS')).Content
  $line=($sums -split "`n" | Where-Object { $_ -match '^[0-9a-fA-F]{64}\s+\*?yt-dlp\.exe\s*$' } | Select-Object -First 1)
  if (-not $line) { throw 'Could not find the published yt-dlp checksum.' }
  $expected=($line.Trim() -split '\s+')[0].ToLower()
  $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLower()
  if ($expected -ne $actual) { throw 'Checksum mismatch: the download was rejected.' }
  Move-Item -Force -LiteralPath $tmp -Destination $out
} finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -Force -LiteralPath $tmp } }"#;

/// Builds a Command that never flashes a console window on Windows.
fn new_command<S: AsRef<OsStr>>(program: S) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// Accepts only a single http(s) URL (scheme check is case-insensitive, matching the UI).
fn validate_url(raw: &str) -> Result<String, String> {
    let url = raw.trim();
    let lower = url.to_ascii_lowercase();
    let has_scheme = lower.starts_with("https://") || lower.starts_with("http://");
    if !has_scheme
        || url.len() > MAX_URL_LEN
        || url.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("Enter a valid http:// or https:// URL.".into());
    }
    Ok(url.to_string())
}

fn last_line(bytes: &[u8], fallback: &str) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(fallback)
        .trim()
        .to_string()
}

fn yt_dlp_executable(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Prefer a normal installation if the user already has yt-dlp on PATH.
    if new_command("yt-dlp").arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
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

    let _guard = INSTALL_LOCK.lock().map_err(|_| "The downloader installer is unavailable.".to_string())?;
    if executable.is_file() {
        return Ok(executable); // another command finished the install while we waited
    }

    let result = new_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", INSTALL_SCRIPT])
        .env("RESONANCE_YTDLP_OUT", &executable)
        .output()
        .map_err(|error| format!("Resonance could not download yt-dlp automatically: {error}. Check your internet connection and try again."))?;

    if !result.status.success() || !executable.is_file() {
        let _ = fs::remove_file(&executable);
        let detail = last_line(&result.stderr, "The download did not complete.");
        return Err(format!("Resonance could not install yt-dlp automatically: {detail} Check your internet connection and try again."));
    }

    Ok(executable)
}

fn run_download(app: tauri::AppHandle, url: String, output_path: PathBuf, format: String) -> Result<String, String> {
    let executable = yt_dlp_executable(&app)?;
    let mut command = new_command(executable);
    command
        .arg("--no-warnings")
        .arg("--no-playlist")
        .arg("--newline")
        .arg("--no-progress")
        .arg("--socket-timeout")
        .arg("30")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("-P")
        .arg(&output_path)
        .arg("-o")
        .arg("%(title)s.%(ext)s")
        .arg("-f")
        .arg("bestaudio/best");

    if format != "best" {
        command
            .arg("-x")
            .arg("--audio-format")
            .arg(&format)
            .arg("--audio-quality")
            .arg("0")
            .arg("--embed-metadata");
    }

    // `--` guarantees the URL can never be parsed as an option.
    let result = command.arg("--").arg(&url).output()
        .map_err(|error| format!("Could not start yt-dlp: {error}"))?;

    if !result.status.success() {
        return Err(format!("Download failed: {}", last_line(&result.stderr, "yt-dlp could not download this URL.")));
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

// These commands are `async` and do their blocking work on a worker thread. Synchronous
// Tauri commands run on the main thread, which froze the whole window during downloads.
#[tauri::command]
async fn download_audio(
    app: tauri::AppHandle,
    url: String,
    output_dir: String,
    format: String,
) -> Result<String, String> {
    let url = validate_url(&url)?;

    let output_path = PathBuf::from(&output_dir);
    if !output_path.is_dir() {
        return Err("Your selected Music folder is unavailable. Choose the folder again in Resonance.".into());
    }
    // Only save into folders the user granted through the folder picker (or AppData), so a
    // compromised web view cannot use this command to write files anywhere on disk.
    if !app.fs_scope().is_allowed(&output_path) {
        return Err("Resonance doesn't have access to that folder. Choose your Music folder again.".into());
    }

    let allowed_formats = ["best", "mp3", "m4a", "opus", "flac", "wav"];
    if !allowed_formats.contains(&format.as_str()) {
        return Err("That audio format is not supported.".into());
    }

    tauri::async_runtime::spawn_blocking(move || run_download(app, url, output_path, format))
        .await
        .map_err(|error| format!("The download task stopped unexpectedly: {error}"))?
}

fn run_inspect(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let executable = yt_dlp_executable(&app)?;
    let result = new_command(executable)
        .arg("--dump-single-json")
        .arg("--no-warnings")
        .arg("--no-playlist")
        .arg("--skip-download")
        .arg("--socket-timeout")
        .arg("30")
        .arg("--")
        .arg(&url)
        .output()
        .map_err(|error| format!("Could not start yt-dlp: {error}"))?;

    if !result.status.success() {
        return Err(last_line(&result.stderr, "Could not inspect this media URL."));
    }

    let data: Value = serde_json::from_slice(&result.stdout)
        .map_err(|_| "yt-dlp returned invalid media information.".to_string())?;
    let title = data.get("title").and_then(Value::as_str).unwrap_or("Audio download");
    let duration = data.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
    Ok(serde_json::json!({ "title": title, "duration": duration }).to_string())
}

#[tauri::command]
async fn inspect_media_url(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let url = validate_url(&url)?;
    tauri::async_runtime::spawn_blocking(move || run_inspect(app, url))
        .await
        .map_err(|error| format!("The inspection task stopped unexpectedly: {error}"))?
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
