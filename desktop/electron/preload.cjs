// 预加载：把主进程的系统能力以 window.charter 暴露给界面（只暴露这些，不暴露 Node）。
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("charter", {
  invoke: (cmd, ...args) => ipcRenderer.invoke(cmd, ...args),
  onFolderChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on("charter:folder-changed", h);
    return () => ipcRenderer.removeListener("charter:folder-changed", h);
  },
  /** 拖进窗口的文件的完整路径。 */
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ""; } },
  platform: process.platform,
});
