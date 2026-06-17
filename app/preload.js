const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getRecords: () => ipcRenderer.invoke("get-records"),
  getImageData: (fp) => ipcRenderer.invoke("get-image-data", fp),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  copyImage: (fp) => ipcRenderer.invoke("copy-image", fp),
  deleteRecord: (id) => ipcRenderer.invoke("delete-record", id),
  deleteAllRecords: () => ipcRenderer.invoke("delete-all-records"),
  togglePin: (id) => ipcRenderer.invoke("toggle-pin", id),
  getSettings: () => ipcRenderer.invoke("get-settings"),
  saveSettings: (s) => ipcRenderer.invoke("save-settings", s),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
  onNewRecord: (cb) => {
    ipcRenderer.on("new-record", cb);
    return () => ipcRenderer.removeListener("new-record", cb);
  }
});