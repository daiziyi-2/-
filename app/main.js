const { app, BrowserWindow, clipboard, globalShortcut, Tray, Menu, nativeImage, ipcMain, screen } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const store = require("./store");
const logger = require("./logger");

// ---- 状态 ----
let mainWindow = null;
let floatBtn = null;
let lastHash = "";
let resizeTimer = null;

// ---- 工具函数 ----
function hashStr(s) { return crypto.createHash("md5").update(s).digest("hex"); }

function applyAutoLaunch(settings) {
  try { app.setLoginItemSettings({ openAtLogin: !!settings.autoLaunch }); } catch {}
}

// ---- 剪贴板监听 ----
function checkClipboard() {
  try {
    const text = clipboard.readText();
    if (text && text.trim()) {
      const h = hashStr(text);
      if (h === lastHash) return;
      lastHash = h;
      store.addRecord({ id: Date.now(), type: "text", content: text, preview: text.substring(0, 200), timestamp: Date.now(), pinned: false });
      try { if (mainWindow) mainWindow.webContents.send("new-record"); } catch {}
      return;
    }
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const buf = image.toPNG();
      const h = hashStr(buf.toString("base64"));
      if (h === lastHash) return;
      lastHash = h;
      const filename = Date.now() + ".png";
      const filepath = path.join(store.IMAGES_DIR, filename);
      fs.writeFileSync(filepath, buf);
      store.addRecord({ id: Date.now(), type: "image", content: filepath, preview: "", timestamp: Date.now(), pinned: false });
      try { if (mainWindow) mainWindow.webContents.send("new-record"); } catch {}
    }
  } catch (e) { logger.log("checkClipboard: " + e.message); }
}

// ---- 清理旧记录 ----
function cleanOld() {
  try {
    const settings = store.getSettings();
    if (settings.retentionDays <= 0) return;
    const cutoff = Date.now() - settings.retentionDays * 86400000;
    const records = store.getRecords();
    records.filter(r => r.timestamp < cutoff && !r.pinned).forEach(r => {
      if (r.type === "image") {
        try { if (fs.existsSync(r.content)) fs.unlinkSync(r.content); } catch {}
      }
    });
    store.setRecords(records.filter(r => r.timestamp >= cutoff || r.pinned));
  } catch (e) { logger.log("cleanOld: " + e.message); }
}

// ---- 窗口管理 ----
function showWindow() {
  try {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) mainWindow.focus();
    else { mainWindow.show(); mainWindow.focus(); }
  } catch {}
}

function createWindow() {
  const settings = store.getSettings();
  const winOpts = {
    width: 420, height: 640, minWidth: 320, minHeight: 400,
    frame: false, show: false, skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false
    }
  };
  if (settings.windowSize) {
    winOpts.width = Math.max(320, Math.min(settings.windowSize.width || 420, 800));
    winOpts.height = Math.max(400, Math.min(settings.windowSize.height || 640, 1000));
  }
  mainWindow = new BrowserWindow(winOpts);
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => { mainWindow.show(); });
  mainWindow.on("close", (e) => { e.preventDefault(); mainWindow.hide(); });
  mainWindow.on("blur", () => {
    setTimeout(() => {
      try { if (mainWindow && !mainWindow.isFocused()) mainWindow.hide(); } catch {}
    }, 100);
  });
  mainWindow.on("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      try {
        if (mainWindow) {
          const b = mainWindow.getBounds();
          store.updateSettings({ windowSize: { width: b.width, height: b.height } });
        }
      } catch {}
    }, 500);
  });
}

function createFloatButton() {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  floatBtn = new BrowserWindow({
    width: 48, height: 48,
    x: width - 60, y: Math.round(height / 2 - 24),
    frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true,
    resizable: false, focusable: true,
    type: "toolbar",
    webPreferences: {
      preload: path.join(__dirname, "float-preload.js"),
      contextIsolation: true, nodeIntegration: false
    }
  });
  floatBtn.loadFile(path.join(__dirname, "float-btn.html"));
  floatBtn.setAlwaysOnTop(true, "screen-saver");
  floatBtn.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // 每30秒刷新置顶（而非5秒，降低开销）
  setInterval(() => {
    try { if (floatBtn && !floatBtn.isDestroyed()) floatBtn.setAlwaysOnTop(true, "screen-saver"); } catch {}
  }, 30000);
}

// ---- IPC 处理 ----
function setupIPC() {
  ipcMain.handle("get-records", () => {
    const records = store.getRecords();
    return records.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp);
  });

  ipcMain.handle("get-image-data", (_e, fp) => {
    try {
      const safe = store.safePath(fp);
      if (!safe || !fs.existsSync(safe)) return null;
      const ext = path.extname(safe).toLowerCase();
      const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp" };
      return "data:" + (mime[ext] || "image/png") + ";base64," + fs.readFileSync(safe).toString("base64");
    } catch { return null; }
  });

  ipcMain.handle("copy-text", (_e, text) => {
    try {
      if (typeof text !== "string" || text.length > 1024 * 1024) return false;
      clipboard.writeText(text);
      return true;
    } catch (e) { logger.log("copy-text fail: " + e.message); return false; }
  });

  ipcMain.handle("copy-image", (_e, fp) => {
    try {
      const safe = store.safePath(fp);
      if (!safe || !fs.existsSync(safe)) return false;
      clipboard.writeImage(nativeImage.createFromPath(safe));
      return true;
    } catch (e) { logger.log("copy-image fail: " + e.message); return false; }
  });

  ipcMain.handle("delete-record", (_e, id) => {
    const rec = store.removeRecord(id);
    if (rec && rec.type === "image") {
      try { if (fs.existsSync(rec.content)) fs.unlinkSync(rec.content); } catch {}
    }
  });

  ipcMain.handle("toggle-pin", (_e, id) => {
    const rec = store.getRecords().find(r => r.id === id);
    if (rec) store.updateRecord(id, { pinned: !rec.pinned });
  });

  ipcMain.handle("delete-all-records", () => {
    store.getRecords().forEach(r => {
      if (r.type === "image") try { if (fs.existsSync(r.content)) fs.unlinkSync(r.content); } catch {}
    });
    store.setRecords([]);
  });

  ipcMain.handle("get-settings", () => store.getSettings());
  ipcMain.handle("save-settings", (_e, s) => {
    if (typeof s !== "object") return;
    store.updateSettings(s);
    applyAutoLaunch(store.getSettings());
  });

  ipcMain.handle("hide-window", () => {
    try { if (mainWindow) mainWindow.hide(); } catch {}
  });

  ipcMain.handle("search-records", (_e, query) => {
    const records = store.getRecords();
    const q = (query || "").toLowerCase();
    if (!q) return records.map(r => ({ ...r, highlight: null }));
    return records
      .filter(r => r.type === "text" ? (r.content || "").toLowerCase().includes(q) : true)
      .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp)
      .map(r => {
        const idx = r.content ? r.content.toLowerCase().indexOf(q) : -1;
        return { ...r, highlight: idx >= 0 ? { index: idx, length: q.length } : null };
      });
  });

  ipcMain.handle("paste-to-clipboard", (_e, id) => {
    const records = store.getRecords();
    const rec = records.find(r => r.id === id);
    if (!rec) return false;
    try {
      if (rec.type === "text") clipboard.writeText(rec.content);
      else if (rec.type === "image") {
        const safe = store.safePath(rec.content);
        if (safe && fs.existsSync(safe)) clipboard.writeImage(nativeImage.createFromPath(safe));
      }
      return true;
    } catch (e) { logger.log("paste fail: " + e.message); return false; }
  });

  ipcMain.handle("get-shortcut-hint", () => "Alt+Shift+V");

  ipcMain.handle("get-window-size", () => {
    try { return store.getSettings().windowSize || null; } catch { return null; }
  });

  ipcMain.handle("save-window-size", (_e, size) => {
    if (size && typeof size.width === "number" && typeof size.height === "number")
      store.updateSettings({ windowSize: size });
  });
}

// ---- 启动 ----
app.whenReady().then(() => {
  const settings = store.getSettings();
  store.init();
  cleanOld();
  createWindow();
  setupIPC();
  applyAutoLaunch(settings);

  // 托盘
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "icon.png"));
  const tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip("历史粘贴板");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示 (Alt+Shift+V)", click: showWindow },
    { type: "separator" },
    { label: "关于 历史粘贴板 v1.1.0", enabled: false },
    { type: "separator" },
    { label: "退出", click: () => { globalShortcut.unregisterAll(); tray.destroy(); app.quit(); } }
  ]));
  tray.on("click", showWindow);

  // 浮动按钮
  createFloatButton();
  ipcMain.on("float-btn-click", () => showWindow());

  // 全局快捷键
  globalShortcut.register("Alt+Shift+V", showWindow);

  // 初始化哈希
  const img = clipboard.readImage();
  lastHash = img.isEmpty()
    ? (clipboard.readText() ? hashStr(clipboard.readText()) : "")
    : hashStr(img.toPNG().toString("base64"));

  // 定时任务
  setInterval(checkClipboard, 800);
  setInterval(cleanOld, 6 * 3600000);
});

app.on("window-all-closed", () => {});
app.on("before-quit", () => { globalShortcut.unregisterAll(); });
