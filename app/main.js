const { app, BrowserWindow, clipboard, globalShortcut, Tray, Menu, nativeImage, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");

// Crash logging
const LOG_FILE = path.join(app.getPath("userData"), "crash.log");
function crashLog(msg) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + " " + msg + "\n"); } catch {} }
process.on("uncaughtException", (e) => { crashLog("MAIN CRASH: " + (e.stack || e.message)); });

let mainWindow = null;
const DATA_DIR = path.join(app.getPath("userData"), "data");
const RECORDS_FILE = path.join(DATA_DIR, "records.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const IMAGES_DIR = path.join(DATA_DIR, "images");

function ensureDirs() {
  [DATA_DIR, IMAGES_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });
}

function loadRecords() {
  try { return JSON.parse(fs.readFileSync(RECORDS_FILE, "utf-8")); } catch { return []; }
}
function saveRecords(r) { fs.writeFileSync(RECORDS_FILE, JSON.stringify(r), "utf-8"); }

function loadSettings() {
  const defaults = { retentionDays: 3, autoLaunch: false, theme: "auto" };
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
    return Object.assign({}, defaults, raw);
  } catch { return Object.assign({}, defaults); }
}

function saveSettings(s) {
  const existing = loadSettings();
  const merged = Object.assign({}, existing, s);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(merged), "utf-8");
  return merged;
}

function applyAutoLaunch(settings) {
  try { app.setLoginItemSettings({ openAtLogin: !!settings.autoLaunch }); } catch {}
}

const crypto = require("crypto");
function hash(s) { return crypto.createHash("md5").update(s).digest("hex"); }
let lastHash = "";

function checkClipboard() {
  try {
    const image = clipboard.readImage();
    if (!image.isEmpty()) {
      const buf = image.toPNG();
      const h = hash(buf.toString("base64").slice(0, 1000));
      if (h === lastHash) return;
      lastHash = h;
      const filename = Date.now() + ".png";
      const filepath = path.join(IMAGES_DIR, filename);
      fs.writeFileSync(filepath, buf);
      const records = loadRecords();
      records.push({ id: Date.now(), type: "image", content: filepath, preview: "", timestamp: Date.now(), pinned: false });
      saveRecords(records);

      try { if (mainWindow) mainWindow.webContents.send("new-record"); } catch {}
      return;
    }
    const text = clipboard.readText();
    if (text && text.trim()) {
      const h = hash(text);
      if (h === lastHash) return;
      lastHash = h;
      const records = loadRecords();
      records.push({ id: Date.now(), type: "text", content: text, preview: text.substring(0, 100), timestamp: Date.now(), pinned: false });
      saveRecords(records);

      try { if (mainWindow) mainWindow.webContents.send("new-record"); } catch {}
    }
  } catch (e) { crashLog("checkClipboard error: " + e.message); }
}

function cleanOld() {
  try {
    const settings = loadSettings();
    const cutoff = Date.now() - settings.retentionDays * 86400000;
    let records = loadRecords();
    records.filter(r => r.timestamp < cutoff && !r.pinned).forEach(r => {
      if (r.type === "image") try { if (fs.existsSync(r.content)) fs.unlinkSync(r.content); } catch {}
    });
    records = records.filter(r => r.timestamp >= cutoff || r.pinned);
    saveRecords(records);
  } catch (e) { crashLog("cleanOld error: " + e.message); }
}

function showWindow() {
  try {
    if (mainWindow) {
      if (mainWindow.isVisible()) mainWindow.focus();
      else { mainWindow.show(); mainWindow.focus(); }
    }
  } catch (e) { crashLog("showWindow error: " + e.message); }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420, height: 640, minWidth: 320, minHeight: 400,
    frame: false, show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => { mainWindow.show(); });
  mainWindow.on("close", (e) => { e.preventDefault(); mainWindow.hide(); });
}

function setupIPC() {
  // Record CRUD
  ipcMain.handle("get-records", () => {
    const records = loadRecords();
    return records.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp);
  });

  ipcMain.handle("get-image-data", (_e, fp) => {
    try {
      if (fs.existsSync(fp)) {
        const ext = path.extname(fp).toLowerCase();
        const m = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".bmp": "image/bmp" };
        return "data:" + (m[ext] || "image/png") + ";base64," + fs.readFileSync(fp).toString("base64");
      }
    } catch {}
    return null;
  });

  ipcMain.handle("copy-text", (_e, text) => {
    try {
      clipboard.writeText(text);
      return true;
    } catch (e) { crashLog("copy-text FAIL: " + e.message); return false; }
  });

  ipcMain.handle("copy-image", (_e, fp) => {
    try {
      if (fs.existsSync(fp)) {
        clipboard.writeImage(nativeImage.createFromPath(fp));
      }
      return true;
    } catch (e) { crashLog("copy-image FAIL: " + e.message); return false; }
  });

  ipcMain.handle("delete-record", (_e, id) => {
    let records = loadRecords();
    const rec = records.find(r => r.id === id);
    if (rec && rec.type === "image") try { if (fs.existsSync(rec.content)) fs.unlinkSync(rec.content); } catch {}
    records = records.filter(r => r.id !== id);
    saveRecords(records);
  });

  ipcMain.handle("toggle-pin", (_e, id) => {
    let records = loadRecords();
    const rec = records.find(r => r.id === id);
    if (rec) { rec.pinned = !rec.pinned; saveRecords(records); }
  });

  ipcMain.handle("delete-all-records", () => {
    let records = loadRecords();
    records.forEach(r => {
      if (r.type === "image") try { if (fs.existsSync(r.content)) fs.unlinkSync(r.content); } catch {}
    });
    saveRecords([]);
  });

  ipcMain.handle("get-settings", () => loadSettings());
  ipcMain.handle("save-settings", (_e, s) => {
    const merged = saveSettings(s);
    applyAutoLaunch(merged);
  });
  ipcMain.handle("hide-window", () => { try { if (mainWindow) mainWindow.hide(); } catch {} });
}

app.whenReady().then(() => {
  const settings = loadSettings();
  ensureDirs();
  cleanOld();
  createWindow();
  setupIPC();
  applyAutoLaunch(settings);

  // Tray
  const trayIcon = nativeImage.createFromPath(path.join(__dirname, "..", "assets", "icon.png"));
  const tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));
  tray.setToolTip("历史粘贴板");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示", click: showWindow },
    { type: "separator" },
    { label: "退出", click: () => { globalShortcut.unregisterAll(); tray.destroy(); app.quit(); } }
  ]));
  tray.on("click", showWindow);

  globalShortcut.register("Alt+Shift+V", showWindow);

  const img = clipboard.readImage();
  lastHash = img.isEmpty() ? (clipboard.readText() ? hash(clipboard.readText()) : "") : hash(img.toPNG().toString("base64").slice(0, 1000));

  setInterval(checkClipboard, 500);
  setInterval(cleanOld, 6 * 3600000);
});

app.on("window-all-closed", () => {});
app.on("before-quit", () => { globalShortcut.unregisterAll(); });
