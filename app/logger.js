// logger.js — 轻量日志
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const LOG_FILE = path.join(app.getPath("userData"), "crash.log");

function log(msg) {
  try {
    fs.appendFileSync(LOG_FILE, new Date().toISOString() + " " + msg + "\n");
  } catch {}
}

// 全局未捕获异常
process.on("uncaughtException", (e) => {
  log("CRASH: " + (e.stack || e.message));
});

module.exports = { log };
