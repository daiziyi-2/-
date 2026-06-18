// store.js — 数据持久化层（内存缓存 + 磁盘同步）
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DATA_DIR = path.join(app.getPath("userData"), "data");
const RECORDS_FILE = path.join(DATA_DIR, "records.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const IMAGES_DIR = path.join(DATA_DIR, "images");

let _records = null;   // null = 未加载
let _settings = null;

function init() {
  [DATA_DIR, IMAGES_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function safePath(fp) {
  if (typeof fp !== "string") return null;
  const resolved = path.resolve(DATA_DIR, fp);
  return resolved.startsWith(DATA_DIR) ? resolved : null;
}

function getRecords() {
  if (!_records) {
    try { _records = JSON.parse(fs.readFileSync(RECORDS_FILE, "utf-8")); }
    catch { _records = []; }
  }
  return _records;
}

function setRecords(arr) {
  _records = arr;
  try { fs.writeFileSync(RECORDS_FILE, JSON.stringify(arr), "utf-8"); }
  catch {}
}

function addRecord(rec) {
  const records = getRecords();
  records.push(rec);
  setRecords(records);
}

function removeRecord(id) {
  let records = getRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx >= 0) {
    const [removed] = records.splice(idx, 1);
    setRecords(records);
    return removed;
  }
  return null;
}

function updateRecord(id, patch) {
  let records = getRecords();
  const rec = records.find(r => r.id === id);
  if (rec) {
    Object.assign(rec, patch);
    setRecords(records);
    return rec;
  }
  return null;
}

const DEFAULTS = { retentionDays: 3, autoLaunch: false, theme: "auto" };

function getSettings() {
  if (!_settings) {
    try {
      _settings = Object.assign({}, DEFAULTS, JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")));
    } catch {
      _settings = Object.assign({}, DEFAULTS);
    }
  }
  return Object.assign({}, _settings);
}

function updateSettings(patch) {
  _settings = Object.assign({}, getSettings(), patch);
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(_settings), "utf-8"); }
  catch {}
}

module.exports = { DATA_DIR, IMAGES_DIR, init, safePath, getRecords, setRecords, addRecord, removeRecord, updateRecord, getSettings, updateSettings };
