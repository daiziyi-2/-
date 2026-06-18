const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getRecords: () => ipcRenderer.invoke("get-records"),
  searchRecords: (query) => ipcRenderer.invoke("search-records", query),
  getImageData: (fp) => ipcRenderer.invoke("get-image-data", fp),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  copyImage: (fp) => ipcRenderer.invoke("copy-image", fp),
  pasteRecord: (id) => ipcRenderer.invoke("paste-to-clipboard", id),
  deleteRecord: (id) => ipcRenderer.invoke("delete-record", id),
  deleteAllRecords: () => ipcRenderer.invoke("delete-all-records"),
  togglePin: (id) => ipcRenderer.invoke("toggle-pin", id),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (s) => ipcRenderer.invoke("save-settings", s),
  getWindowSize: () => ipcRenderer.invoke("get-window-size"),
  saveWindowSize: (size) => ipcRenderer.invoke("save-window-size", size),
  getShortcutHint: () => ipcRenderer.invoke("get-shortcut-hint"),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  onNewRecord: (cb) => {
    const handler = (_e, ...args) => cb(...args);
    ipcRenderer.on("new-record", handler);
    return () => ipcRenderer.removeListener("new-record", handler);
  }
});