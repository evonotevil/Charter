// 各操作系统不同的部分：默认数据文件夹、同步盘状态、文字识别、中文字体。

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn home() -> PathBuf { dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")) }

#[allow(dead_code)]
fn now_ms() -> f64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

/// 数据和模板目录里的 JSON 文件。
#[allow(dead_code)]
fn data_files(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for sub in ["数据", "模板"] {
        if let Ok(rd) = std::fs::read_dir(root.join(sub)) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().map(|x| x == "json").unwrap_or(false) { out.push(p); }
            }
        }
    }
    out
}

// MARK: - macOS

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use std::process::Command;

    pub fn default_root() -> PathBuf {
        let icloud = home().join("Library/Mobile Documents/com~apple~CloudDocs");
        if icloud.exists() { icloud.join("Charter") } else { home().join("Documents/Charter") }
    }

    fn jxa(script: &str, args: &[&str]) -> Option<String> {
        let out = Command::new("/usr/bin/osascript").arg("-l").arg("JavaScript").arg("-e").arg(script).args(args).output().ok()?;
        if !out.status.success() { return None; }
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    /// 读取 iCloud 给每个文件标记的上传、下载、错误和冲突信息（与 Swift 版 SyncMonitor 相同的判断）。
    const SYNC_SCRIPT: &str = r#"
ObjC.import('Foundation');
function val(url, key) { var v = Ref(); url.getResourceValueForKeyError(v, key, null); return v[0]; }
function run(argv) {
  var root = $.NSURL.fileURLWithPath(argv[0]);
  var ub = val(root, $.NSURLIsUbiquitousItemKey);
  var isUb = (ub && !ub.isNil() && ub.boolValue) || argv[0].indexOf('Mobile Documents') >= 0;
  if (!isUb) return JSON.stringify({kind: 'local'});
  var token = $.NSFileManager.defaultManager.ubiquityIdentityToken;
  if (!token || token.isNil()) return JSON.stringify({kind: 'signedOut'});
  var pending = 0, conflicts = [], error = null;
  for (var i = 1; i < argv.length; i++) {
    var u = $.NSURL.fileURLWithPath(argv[i]);
    var c = val(u, $.NSURLUbiquitousItemHasUnresolvedConflictsKey);
    if (c && !c.isNil() && c.boolValue) conflicts.push(argv[i].split('/').pop());
    var e = val(u, $.NSURLUbiquitousItemUploadingErrorKey);
    if (e && !e.isNil()) error = ObjC.unwrap(e.localizedDescription);
    var up = val(u, $.NSURLUbiquitousItemIsUploadingKey), down = val(u, $.NSURLUbiquitousItemIsDownloadingKey), done = val(u, $.NSURLUbiquitousItemIsUploadedKey);
    if ((up && !up.isNil() && up.boolValue) || (down && !down.isNil() && down.boolValue) || (done && !done.isNil() && !done.boolValue)) pending++;
  }
  if (conflicts.length) return JSON.stringify({kind: 'conflict', files: conflicts});
  if (error) return JSON.stringify({kind: 'failed', message: error});
  if (pending) return JSON.stringify({kind: 'syncing', count: pending});
  return JSON.stringify({kind: 'synced'});
}"#;

    pub fn sync_status(root: &Path) -> Value {
        let files: Vec<String> = data_files(root).iter().map(|p| p.to_string_lossy().to_string()).collect();
        let mut args: Vec<&str> = vec![root.to_str().unwrap_or("")];
        args.extend(files.iter().map(|s| s.as_str()));
        let mut v: Value = jxa(SYNC_SCRIPT, &args).and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_else(|| if root.to_string_lossy().contains("Mobile Documents") { json!({"kind": "synced"}) } else { json!({"kind": "local"}) });
        if v["kind"] == "synced" { v["at"] = json!(now_ms()); }
        v
    }

    /// Vision 文字识别（中、日、韩、英）。
    const OCR_SCRIPT: &str = r#"
ObjC.import('Foundation'); ObjC.import('Vision');
function run(argv) {
  var data = $.NSData.dataWithContentsOfFile(argv[0]);
  var handler = $.VNImageRequestHandler.alloc.initWithDataOptions(data, $({}));
  var req = $.VNRecognizeTextRequest.alloc.init;
  req.recognitionLevel = 0;
  req.usesLanguageCorrection = true;
  req.recognitionLanguages = $(['zh-Hans', 'zh-Hant', 'en-US', 'ja-JP', 'ko-KR']);
  handler.performRequestsError($([req]), null);
  var results = req.results, out = [];
  for (var i = 0; i < results.count; i++) {
    var c = results.objectAtIndex(i).topCandidates(1);
    if (c.count > 0) out.push(ObjC.unwrap(c.objectAtIndex(0).string));
  }
  return out.join('\n');
}"#;

    pub fn ocr(png: &[u8]) -> Result<String, String> {
        let tmp = tempfile::Builder::new().suffix(".png").tempfile().map_err(|e| e.to_string())?;
        std::fs::write(tmp.path(), png).map_err(|e| e.to_string())?;
        jxa(OCR_SCRIPT, &[tmp.path().to_str().unwrap_or("")]).ok_or_else(|| "文字识别失败".to_string())
    }

    pub fn cjk_font_path() -> Option<PathBuf> {
        ["/Library/Fonts/Arial Unicode.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]
            .iter().map(PathBuf::from).find(|p| p.exists())
    }
}

// MARK: - Windows

#[cfg(windows)]
mod imp {
    use super::*;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Graphics::Imaging::BitmapDecoder;
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::Win32::Foundation::{CloseHandle, GENERIC_READ};
    use windows::Win32::Storage::CloudFilters::{
        CfGetPlaceholderInfo, CF_IN_SYNC_STATE_IN_SYNC, CF_PLACEHOLDER_BASIC_INFO, CF_PLACEHOLDER_INFO_BASIC,
    };
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
    };

    pub fn default_root() -> PathBuf {
        for var in ["OneDriveConsumer", "OneDrive", "OneDriveCommercial"] {
            if let Ok(p) = std::env::var(var) {
                let p = PathBuf::from(p);
                if p.exists() { return p.join("Charter"); }
            }
        }
        let icloud = home().join("iCloudDrive");
        if icloud.exists() { return icloud.join("Charter"); }
        dirs::document_dir().unwrap_or_else(home).join("Charter")
    }

    fn wide(p: &Path) -> Vec<u16> { p.as_os_str().encode_wide().chain(std::iter::once(0)).collect() }

    /// 通过 Windows 云文件接口读取同步状态（OneDrive、iCloud for Windows 等同步盘都使用它）。
    /// 返回 None 表示这不是同步盘管理的文件。
    fn in_sync(p: &Path) -> Option<bool> {
        unsafe {
            let w = wide(p);
            let h = CreateFileW(PCWSTR(w.as_ptr()), GENERIC_READ.0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                None, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, None).ok()?;
            let mut info: [u8; 1024] = [0; 1024];
            let r = CfGetPlaceholderInfo(h, CF_PLACEHOLDER_INFO_BASIC, info.as_mut_ptr() as *mut _, info.len() as u32, None);
            let _ = CloseHandle(h);
            r.ok()?;
            // The API writes into a byte buffer, which need not be aligned for this struct.
            let basic = std::ptr::read_unaligned(info.as_ptr() as *const CF_PLACEHOLDER_BASIC_INFO);
            Some(basic.InSyncState == CF_IN_SYNC_STATE_IN_SYNC)
        }
    }

    pub fn sync_status(root: &Path) -> Value {
        let files = data_files(root);
        let mut managed = 0;
        let mut pending = 0;
        for f in &files {
            match in_sync(f) {
                Some(true) => managed += 1,
                Some(false) => { managed += 1; pending += 1; }
                None => {}
            }
        }
        if managed == 0 {
            // 根目录本身是同步盘占位符时（刚创建、还没有文件），也算作同步盘
            return if in_sync(root).is_some() { json!({"kind": "synced", "at": now_ms()}) } else { json!({"kind": "local"}) };
        }
        if pending > 0 { json!({"kind": "syncing", "count": pending}) } else { json!({"kind": "synced", "at": now_ms()}) }
    }

    pub fn ocr(png: &[u8]) -> Result<String, String> {
        let run = || -> windows::core::Result<String> {
            let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;
            let stream = InMemoryRandomAccessStream::new()?;
            let writer = DataWriter::CreateDataWriter(&stream)?;
            writer.WriteBytes(png)?;
            writer.StoreAsync()?.get()?;
            writer.FlushAsync()?.get()?;
            writer.DetachStream()?;
            stream.Seek(0)?;
            let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
            let bitmap = decoder.GetSoftwareBitmapAsync()?.get()?;
            let result = engine.RecognizeAsync(&bitmap)?.get()?;
            let mut lines = vec![];
            for line in result.Lines()? { lines.push(line.Text()?.to_string()); }
            Ok(lines.join("\n"))
        };
        run().map_err(|e| format!("文字识别失败：{e}"))
    }

    pub fn cjk_font_path() -> Option<PathBuf> {
        let dir = std::env::var("WINDIR").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("C:\\Windows")).join("Fonts");
        ["simhei.ttf", "Deng.ttf", "simkai.ttf", "simfang.ttf", "malgun.ttf", "YuGothR.ttc"]
            .iter().map(|f| dir.join(f)).find(|p| p.exists() && p.extension().map(|e| e != "ttc").unwrap_or(false))
    }
}

// MARK: - 其他（Linux）

#[cfg(not(any(target_os = "macos", windows)))]
mod imp {
    use super::*;

    pub fn default_root() -> PathBuf { dirs::document_dir().unwrap_or_else(home).join("Charter") }
    pub fn sync_status(_root: &Path) -> Value { json!({"kind": "local"}) }
    pub fn ocr(png: &[u8]) -> Result<String, String> {
        // 装了 tesseract 时使用它
        let tmp = tempfile::Builder::new().suffix(".png").tempfile().map_err(|e| e.to_string())?;
        std::fs::write(tmp.path(), png).map_err(|e| e.to_string())?;
        let out = std::process::Command::new("tesseract").arg(tmp.path()).arg("-").arg("-l").arg("chi_sim+eng").output()
            .map_err(|_| "这台电脑没有安装文字识别组件".to_string())?;
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    }
    pub fn cjk_font_path() -> Option<PathBuf> {
        ["/usr/share/fonts/truetype/arphic/uming.ttc", "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
         "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc"]
            .iter().map(PathBuf::from).find(|p| p.exists() && p.extension().map(|e| e != "ttc").unwrap_or(false))
    }
}

pub use imp::{cjk_font_path, default_root, ocr, sync_status};
