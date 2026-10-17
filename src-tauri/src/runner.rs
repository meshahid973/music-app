//! Runs yt-dlp with live progress and cancellation. Std only, so it is unit-testable.
use crate::util::{parse_progress_line, Progress};
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

static ACTIVE_PID: Mutex<Option<u32>> = Mutex::new(None);
static CANCELLED: AtomicBool = AtomicBool::new(false);
const MAX_KEPT_LINES: usize = 200;

pub type ProgressCallback = Arc<dyn Fn(Progress) + Send + Sync>;

#[derive(Debug)]
pub struct RunOutput {
    pub success: bool,
    pub cancelled: bool,
    pub stdout: Vec<String>,
    pub stderr: Vec<String>,
}

fn kill_tree(pid: u32) {
    let pid_text = pid.to_string();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // /T also stops ffmpeg and any other child processes yt-dlp started.
        let _ = Command::new("taskkill")
            .creation_flags(0x0800_0000)
            .args(["/PID", pid_text.as_str(), "/T", "/F"])
            .output();
    }
    #[cfg(not(windows))]
    {
        // The child leads its own process group (see run_with_progress), so a negative pid
        // stops the whole tree, like `taskkill /T` on Windows.
        let _ = Command::new("sh").arg("-c").arg(format!("kill -s KILL -- -{pid_text}")).output();
    }
}

/// Asks the running download (if any) to stop. Returns true if a process was running.
pub fn cancel_active() -> bool {
    CANCELLED.store(true, Ordering::SeqCst);
    let pid = ACTIVE_PID.lock().ok().and_then(|guard| *guard);
    match pid {
        Some(pid) => {
            kill_tree(pid);
            true
        }
        None => false,
    }
}

fn read_lines<R: Read + Send + 'static>(stream: R, on_progress: ProgressCallback) -> thread::JoinHandle<Vec<String>> {
    thread::spawn(move || {
        let mut reader = BufReader::new(stream);
        let mut kept: Vec<String> = Vec::new();
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&buffer).trim_end().to_string();
                    if let Some(progress) = parse_progress_line(&line) {
                        on_progress(progress);
                    } else if !line.is_empty() {
                        if kept.len() >= MAX_KEPT_LINES {
                            kept.remove(0);
                        }
                        kept.push(line);
                    }
                }
            }
        }
        kept
    })
}

pub fn run_with_progress(mut command: Command, on_progress: ProgressCallback) -> Result<RunOutput, String> {
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    CANCELLED.store(false, Ordering::SeqCst);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let pid = child.id();
    if let Ok(mut guard) = ACTIVE_PID.lock() {
        *guard = Some(pid);
    }
    // A cancel that arrived between spawn and registering the pid would otherwise be lost.
    if CANCELLED.load(Ordering::SeqCst) {
        kill_tree(pid);
    }

    let stdout_handle = child.stdout.take().map(|s| read_lines(s, on_progress.clone()));
    let stderr_handle = child.stderr.take().map(|s| read_lines(s, on_progress.clone()));
    let status = child.wait().map_err(|error| error.to_string());
    if let Ok(mut guard) = ACTIVE_PID.lock() {
        *guard = None;
    }
    let stdout = stdout_handle.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = stderr_handle.and_then(|h| h.join().ok()).unwrap_or_default();
    let cancelled = CANCELLED.load(Ordering::SeqCst);
    let status = status?;
    Ok(RunOutput { success: status.success() && !cancelled, cancelled, stdout, stderr })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;
    use std::time::{Duration, Instant};

    // The runner uses process-wide state, so these tests must not overlap.
    static SERIAL: StdMutex<()> = StdMutex::new(());

    fn sh(script: &str) -> Command {
        let mut c = Command::new("sh");
        c.arg("-c").arg(script);
        c
    }

    #[test]
    fn captures_output_and_reports_progress() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let seen: Arc<StdMutex<Vec<Option<f64>>>> = Arc::new(StdMutex::new(vec![]));
        let sink = seen.clone();
        let cb: ProgressCallback = Arc::new(move |p| sink.lock().unwrap().push(p.percent));
        let out = run_with_progress(
            sh("echo 'RESONANCE_PROGRESS|downloading| 10.0%|1MiB/s|00:05'; echo 'RESONANCE_PROGRESS|downloading|100%|1MiB/s|00:00' >&2; echo /music/song.mp3"),
            cb,
        ).unwrap();
        assert!(out.success && !out.cancelled);
        assert_eq!(out.stdout, vec!["/music/song.mp3".to_string()]);
        let mut got = seen.lock().unwrap().clone();
        got.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(got, vec![Some(10.0), Some(100.0)]); // progress is read from stdout AND stderr
    }

    #[test]
    fn failure_keeps_stderr() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let out = run_with_progress(sh("echo 'ERROR: nope' >&2; exit 3"), Arc::new(|_| {})).unwrap();
        assert!(!out.success && !out.cancelled);
        assert_eq!(out.stderr.last().map(String::as_str), Some("ERROR: nope"));
    }

    #[test]
    fn cancel_stops_a_running_process_quickly() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let canceller = thread::spawn(|| {
            thread::sleep(Duration::from_millis(400));
            assert!(cancel_active());
        });
        let started = Instant::now();
        let out = run_with_progress(sh("sleep 30"), Arc::new(|_| {})).unwrap();
        canceller.join().unwrap();
        assert!(out.cancelled && !out.success);
        assert!(started.elapsed() < Duration::from_secs(10));
        assert!(!cancel_active()); // nothing is running any more
    }

    #[test]
    fn spawn_error_is_reported() {
        let _g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        assert!(run_with_progress(Command::new("/definitely/not/a/program"), Arc::new(|_| {})).is_err());
    }
}
