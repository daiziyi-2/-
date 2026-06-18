// renderer.js — 渲染进程（事件委托 + 防抖 + 安全渲染）
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const searchInput = $("#searchInput");
  const countEl = $("#count");
  const listEl = $("#list");
  const settingsPanel = $("#settingsPanel");
  const retentionOpts = $("#retentionOpts");
  const themeOpts = $("#themeOpts");
  const overlay = $("#overlay");
  const overlayImg = $("#overlayImg");
  const overlaySpinner = $("#overlaySpinner");
  const autoLaunchToggle = $("#autoLaunchToggle");
  const toastEl = $("#toast");

  let records = [];
  let recordMap = new Map();
  let settings = { retentionDays: 3, theme: "auto", autoLaunch: false };
  let searchTimer = null;
  const SEARCH_DEBOUNCE = 150;

  function escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function formatTime(ts, now) {
    const diff = (now || Date.now()) - ts;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
    return new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 800);
  }

  function showConfirmDialog(message) {
    return new Promise((resolve) => {
      let ov = document.getElementById("confirmOverlay");
      const isDark = document.body.classList.contains("dark");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "confirmOverlay";
        ov.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:1000;";
        ov.innerHTML = '<div id="confirmBox"><p id="confirmMsg"></p><div style="display:flex;gap:8px;justify-content:flex-end;"><button id="confirmNo">取消</button><button id="confirmYes">删除</button></div></div>';
        document.body.appendChild(ov);
        document.getElementById("confirmYes").onclick = () => { ov.style.display = "none"; resolve(true); };
        document.getElementById("confirmNo").onclick = () => { ov.style.display = "none"; resolve(false); };
      }
      const box = document.getElementById("confirmBox");
      const noBtn = document.getElementById("confirmNo");
      if (isDark) {
        box.style.cssText = "background:#2c2c2e;padding:20px;border-radius:12px;max-width:300px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);color:#f5f5f7;";
        if (noBtn) noBtn.style.cssText = "padding:8px 16px;border:none;border-radius:6px;background:#3a3a3c;color:#f5f5f7;cursor:pointer;font-size:13px;";
      } else {
        box.style.cssText = "background:#fff;padding:20px;border-radius:12px;max-width:300px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.2);color:#333;";
        if (noBtn) noBtn.style.cssText = "padding:8px 16px;border:none;border-radius:6px;background:#f0f0f0;color:#333;cursor:pointer;font-size:13px;";
      }
      document.getElementById("confirmMsg").textContent = message;
      ov.style.display = "flex";
    });
  }

  function applyTheme() {
    let theme = settings.theme || "auto";
    if (theme === "auto") {
      const h = new Date().getHours();
      theme = (h >= 6 && h < 18) ? "light" : "dark";
    }
    document.body.classList.toggle("dark", theme === "dark");
  }

  function renderThemeOpts() {
    const themes = [
      { v: "auto", label: "自动" },
      { v: "light", label: "浅色" },
      { v: "dark", label: "暗色" }
    ];
    themeOpts.innerHTML = themes.map(t =>
      '<button class="' + (settings.theme === t.v ? "active" : "") + '" data-theme="' + t.v + '">' + t.label + '</button>'
    ).join("");
  }

  async function setTheme(v) {
    settings.theme = v;
    await window.api.saveSettings(settings);
    applyTheme();
    renderThemeOpts();
  }

  setInterval(() => { if (settings.theme === "auto") applyTheme(); }, 60000);

  function renderAutoLaunchToggle() {
    autoLaunchToggle.classList.toggle("active", !!settings.autoLaunch);
  }

  async function toggleAutoLaunch() {
    settings.autoLaunch = !settings.autoLaunch;
    await window.api.saveSettings(settings);
    renderAutoLaunchToggle();
  }

  async function load() {
    try {
      records = await window.api.getRecords();
      settings = await window.api.getSettings();
      recordMap = new Map(records.map(r => [r.id, r]));
      applyTheme();
      render();
    } catch (e) { console.error(e); }
  }

  function renderCardText(r, now, highlight) {
    let body = escHtml(r.preview || r.content || "");
    if (highlight && r.content) {
      const idx = r.content.toLowerCase().indexOf(highlight);
      if (idx >= 0) {
        const before = escHtml(r.content.substring(0, idx));
        const match = escHtml(r.content.substring(idx, idx + highlight.length));
        const after = escHtml(r.content.substring(idx + highlight.length));
        body = before + '<mark>' + match + '</mark>' + after;
      }
    }
    return body;
  }

  function renderCard(r, now, searchQuery) {
    const time = formatTime(r.timestamp, now);
    const pc = r.pinned ? " pinned" : "";

    let body;
    if (r.type === "image") {
      const src = r.content || "";
      body = '<div class="img-thumb loading" data-path="' + escHtml(src) + '"></div>';
    } else {
      body = renderCardText(r, now, searchQuery || null);
    }

    const pb = r.pinned ? '<span class="pin-badge">已置顶</span>' : "";
    const pinLabel = r.pinned ? "取消" : "置顶";

    return '<div class="card' + pc + '" data-id="' + r.id + '" data-type="' + r.type + '">' +
      '<div class="content">' + body + '</div>' +
      '<div class="meta"><span class="time">' + time + '</span>' + pb + '</div>' +
      '<div class="actions">' +
        '<button class="pin-btn" data-action="toggle-pin">' + pinLabel + '</button>' +
        '<button class="del-btn" data-action="delete">删除</button>' +
      '</div>' +
    '</div>';
  }

  function render() {
    const now = Date.now();
    const q = searchInput.value.toLowerCase().trim();

    let filtered = records;
    if (q) {
      filtered = records.filter(r => r.type === "text" ? (r.content || "").toLowerCase().includes(q) : true);
    }
    filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.timestamp - a.timestamp);

    countEl.textContent = filtered.length;

    const frag = document.createDocumentFragment();
    const wrapper = document.createElement("div");
    wrapper.className = "cards";
    wrapper.innerHTML = filtered.map(r => renderCard(r, now, q)).join("");
    frag.appendChild(wrapper);

    listEl.innerHTML = "";
    listEl.appendChild(frag);

    listEl.querySelectorAll(".img-thumb.loading").forEach(img => {
      const fp = img.dataset.path;
      window.api.getImageData(fp).then(data => {
        if (data) {
          img.style.backgroundImage = 'url(' + data + ')';
          img.classList.remove("loading");
        }
      });
    });
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(render, SEARCH_DEBOUNCE);
  });

  listEl.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;

    const id = Number(card.dataset.id);
    if (isNaN(id)) return;

    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === "delete") delRecord(id);
      else if (action === "toggle-pin") togglePin(id);
      return;
    }

    if (e.target.closest(".img-thumb")) {
      const rec = recordMap.get(id);
      if (rec && rec.type === "image") previewImage(rec.content);
      return;
    }

    clickRecord(id);
  });

  async function clickRecord(id) {
    try {
      const rec = recordMap.get(id);
      if (!rec) return;
      const ok = await window.api.pasteRecord(id);
      showToast(ok ? "已粘贴到剪贴板" : "复制失败");
      if (ok) setTimeout(() => window.api.hideWindow(), 600);
    } catch (e) { showToast("复制失败"); }
  }

  async function delRecord(id) {
    await window.api.deleteRecord(id);
    records = records.filter(r => r.id !== id);
    recordMap.delete(id);
    render();
  }

  async function togglePin(id) {
    await window.api.togglePin(id);
    const rec = recordMap.get(id);
    if (rec) rec.pinned = !rec.pinned;
    render();
  }

  async function deleteAllRecords() {
    if (records.length === 0) { showToast("没有可删除的记录"); return; }
    const msg = "确定要删除全部 " + records.length + " 条历史记录吗？\n此操作不可撤销。";
    if (!await showConfirmDialog(msg)) return;
    await window.api.deleteAllRecords();
    records = [];
    recordMap.clear();
    render();
    showToast("已删除全部记录");
  }

  function previewImage(fp) {
    overlay.classList.add("show");
    overlayImg.style.display = "none";
    overlaySpinner.style.display = "block";
    window.api.getImageData(fp).then(data => {
      if (data) {
        overlayImg.src = data;
        overlayImg.style.display = "block";
        overlaySpinner.style.display = "none";
      }
    });
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.id === "overlayClose" || e.target.closest("#overlayClose")) {
      overlay.classList.remove("show");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) overlay.classList.remove("show");
  });

  $("#overlayCopyBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const src = overlayImg.src;
    if (!src) return;
    const a = document.createElement("a");
    a.href = src;
    a.download = "clipboard-image.png";
    a.click();
    showToast("图片已下载");
  });

  $("#overlayCloseBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    overlay.classList.remove("show");
  });

  function renderSettings() {
    retentionOpts.innerHTML = [0, 1, 3, 5].map(d =>
      '<button class="' + (settings.retentionDays === d ? "active" : "") + '" data-days="' + d + '">' + (d === 0 ? "永不" : d + " 天") + '</button>'
    ).join("");
    renderThemeOpts();
    renderAutoLaunchToggle();
  }

  retentionOpts.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-days]");
    if (btn) setRetention(Number(btn.dataset.days));
  });

  themeOpts.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme]");
    if (btn) setTheme(btn.dataset.theme);
  });

  autoLaunchToggle.addEventListener("click", toggleAutoLaunch);

  async function setRetention(days) {
    settings.retentionDays = days;
    await window.api.saveSettings(settings);
    renderSettings();
  }

  $("#btnSettings").addEventListener("click", () => {
    settingsPanel.classList.toggle("show");
    if (settingsPanel.classList.contains("show")) renderSettings();
  });

  $("#btnHide").addEventListener("click", () => window.api.hideWindow());
  $("#btnClose").addEventListener("click", () => window.api.hideWindow());

  const hintEl = $("#shortcutHint");
  if (hintEl) {
    hintEl.addEventListener("click", () => {
      if (hintEl.style.opacity === "0") { hintEl.style.opacity = "1"; hintEl.title = "点击隐藏"; }
      else { hintEl.style.opacity = "0"; hintEl.title = "点击显示"; }
    });
  }

  const btnDel = $("#btnDeleteAll");
  if (btnDel) btnDel.addEventListener("click", deleteAllRecords);

  window.api.onNewRecord(() => load());

  load();
})();