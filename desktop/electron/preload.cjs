// 预加载：把主进程的系统能力以 window.charter 暴露给界面（只暴露这些，不暴露 Node）。
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// 5.5.5：只允许调用主进程实际提供的这些命令
const ALLOWED = new Set(["app", "bundled_templates", "calendar_sync", "cjk_font", "copy_file", "default_root", "device_name", "list_dir", "log", "log_path", "mkdirs", "move_file", "notify", "ocr", "open_path", "open_url", "pick_files", "pick_folder", "platform_name", "read_bytes", "read_text", "remove_dir", "remove_file", "reveal", "save_dialog", "stat", "sync_status", "temp_dir", "watch", "write_bytes", "write_text", "zip_files"]);
contextBridge.exposeInMainWorld("charter", {
  invoke: (cmd, ...args) => (ALLOWED.has(cmd) ? ipcRenderer.invoke(cmd, ...args) : Promise.reject(new Error(`不允许的命令：${cmd}`))),
  onFolderChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on("charter:folder-changed", h);
    return () => ipcRenderer.removeListener("charter:folder-changed", h);
  },
  /** 拖进窗口的文件的完整路径。 */
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ""; } },
  platform: process.platform,
});
