// Charter 桌面端后端：文件读写（原子写入）、文件夹监听、同步状态、OCR、系统字体。
// 界面全部在前端；这里只提供前端无法直接做到的系统能力。

mod os;

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};
use tauri::{Emitter, Manager};

type R<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String { e.to_string() }

#[derive(Serialize)]
struct Stat { exists: bool, #[serde(rename = "isDir")] is_dir: bool, mtime: Option<f64>, size: u64 }

#[derive(Serialize)]
struct Entry { name: String, #[serde(rename = "isDir")] is_dir: bool, mtime: Option<f64>, size: u64 }

fn mtime(m: &fs::Metadata) -> Option<f64> {
    m.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_secs_f64() * 1000.0)
}

#[tauri::command]
fn default_root() -> String { os::default_root().to_string_lossy().to_string() }

#[tauri::command]
fn read_text(path: String) -> R<String> { fs::read_to_string(&path).map_err(err) }

#[tauri::command]
fn read_bytes(path: String) -> R<tauri::ipc::Response> {
    fs::read(&path).map(tauri::ipc::Response::new).map_err(err)
}

/// 原子写入：在同一目录写临时文件后替换，避免同步盘读到写了一半的文件。
fn write_atomic(path: &Path, data: &[u8]) -> R<()> {
    let dir = path.parent().ok_or("路径无效")?;
    fs::create_dir_all(dir).map_err(err)?;
    let mut tmp = tempfile::Builder::new().prefix(".charter-").suffix(".tmp").tempfile_in(dir).map_err(err)?;
    tmp.write_all(data).map_err(err)?;
    tmp.as_file().sync_all().map_err(err)?;
    tmp.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}

#[tauri::command]
fn write_text(path: String, text: String) -> R<()> { write_atomic(Path::new(&path), text.as_bytes()) }

#[tauri::command]
fn write_bytes(request: tauri::ipc::Request) -> R<()> {
    let path = request.headers().get("x-path").and_then(|v| v.to_str().ok()).map(|s| urlencoding_decode(s)).ok_or("缺少路径")?;
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => write_atomic(Path::new(&path), bytes),
        _ => Err("数据格式无效".into()),
    }
}

fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) { out.push(b); i += 3; continue; }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
fn stat(path: String) -> Stat {
    match fs::metadata(&path) {
        Ok(m) => Stat { exists: true, is_dir: m.is_dir(), mtime: mtime(&m), size: m.len() },
        Err(_) => Stat { exists: false, is_dir: false, mtime: None, size: 0 },
    }
}

#[tauri::command]
fn list_dir(path: String) -> R<Vec<Entry>> {
    let mut out = vec![];
    for e in fs::read_dir(&path).map_err(err)? {
        let e = e.map_err(err)?;
        let m = match e.metadata() { Ok(m) => m, Err(_) => continue };
        out.push(Entry { name: e.file_name().to_string_lossy().to_string(), is_dir: m.is_dir(), mtime: mtime(&m), size: m.len() });
    }
    Ok(out)
}

#[tauri::command]
fn mkdirs(path: String) -> R<()> { fs::create_dir_all(&path).map_err(err) }

#[tauri::command]
fn copy_file(from: String, to: String) -> R<()> {
    let to = PathBuf::from(to);
    if to.exists() { return Err("目标文件已存在".into()); }
    if let Some(d) = to.parent() { fs::create_dir_all(d).map_err(err)?; }
    fs::copy(&from, &to).map(|_| ()).map_err(err)
}

#[tauri::command]
fn move_file(from: String, to: String) -> R<()> {
    let to = PathBuf::from(to);
    if to.exists() { return Err("目标文件已存在".into()); }
    if let Some(d) = to.parent() { fs::create_dir_all(d).map_err(err)?; }
    if fs::rename(&from, &to).is_ok() { return Ok(()); }
    fs::copy(&from, &to).map_err(err)?;
    fs::remove_file(&from).map_err(err)
}

#[tauri::command]
fn remove_file(path: String) -> R<()> {
    match fs::remove_file(&path) { Ok(_) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(err(e)) }
}

#[tauri::command]
fn remove_dir(path: String) -> R<()> {
    match fs::remove_dir_all(&path) { Ok(_) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(err(e)) }
}

#[tauri::command]
fn temp_dir() -> String {
    let d = std::env::temp_dir().join("Charter");
    let _ = fs::create_dir_all(&d);
    d.to_string_lossy().to_string()
}

#[tauri::command]
fn device_name() -> String {
    hostname::get().map(|h| h.to_string_lossy().to_string()).unwrap_or_else(|_| "这台电脑".into())
}

#[tauri::command]
async fn sync_status(root: String) -> serde_json::Value {
    tauri::async_runtime::spawn_blocking(move || os::sync_status(Path::new(&root))).await.unwrap_or(serde_json::json!({ "kind": "local" }))
}

#[tauri::command]
async fn ocr(request: tauri::ipc::Request<'_>) -> R<String> {
    let bytes = match request.body() { tauri::ipc::InvokeBody::Raw(b) => b.clone(), _ => return Err("数据格式无效".into()) };
    tauri::async_runtime::spawn_blocking(move || os::ocr(&bytes)).await.map_err(err)?
}

#[tauri::command]
fn cjk_font() -> R<tauri::ipc::Response> {
    match os::cjk_font_path() {
        Some(p) => fs::read(p).map(tauri::ipc::Response::new).map_err(err),
        None => Err("没有找到中文字体".into()),
    }
}

#[tauri::command]
fn bundled_templates(app: tauri::AppHandle) -> R<String> {
    let path = app.path().resolve("charter-templates.json", tauri::path::BaseDirectory::Resource).map_err(err)?;
    fs::read_to_string(path).map_err(err)
}

#[tauri::command]
fn platform_name() -> &'static str {
    if cfg!(target_os = "macos") { "mac" } else if cfg!(windows) { "windows" } else { "linux" }
}

struct Watcher(Mutex<Option<notify::RecommendedWatcher>>);

/// 监听数据文件夹里的 JSON 变化（另一台设备同步过来时），合并成一次事件通知前端。
#[tauri::command]
fn watch(app: tauri::AppHandle, state: tauri::State<Watcher>, path: String) -> R<()> {
    use notify::{RecursiveMode, Watcher as _};
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let mut w = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if ev.paths.iter().any(|p| p.extension().map(|e| e == "json").unwrap_or(false)
                && !p.file_name().map(|n| n.to_string_lossy().starts_with(".charter-")).unwrap_or(false)) {
                let _ = tx.send(());
            }
        }
    }).map_err(err)?;
    let root = PathBuf::from(&path);
    for sub in ["数据", "模板"] {
        let d = root.join(sub);
        if d.exists() { w.watch(&d, RecursiveMode::NonRecursive).map_err(err)?; }
    }
    *state.0.lock().unwrap() = Some(w);
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            // 合并 1.5 秒内的多次变化
            while rx.recv_timeout(Duration::from_millis(1500)).is_ok() {}
            if app.emit("charter://folder-changed", ()).is_err() { break; }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Watcher(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            default_root, read_text, read_bytes, write_text, write_bytes, stat, list_dir, mkdirs, copy_file, move_file,
            remove_file, remove_dir, temp_dir, device_name, sync_status, ocr, cjk_font, bundled_templates, platform_name, watch
        ])
        .run(tauri::generate_context!())
        .expect("Charter 启动失败");
}
