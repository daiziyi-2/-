const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("floatApi", {
  onClick: () => ipcRenderer.send("float-btn-click")
});
