// renderer.js — 历史粘贴板 (Tauri v2)
(async function () {
  "use strict";

  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) {
    document.body.innerHTML = '<div style="padding:40px;text-align:center;color:red;font-size:18px">Tauri API 未加载</div>';
    return;
  }

  // ===== DOM refs =====
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

  // ===== State =====
  let recordMap = new Map();        // id → Record
  let orderedIds = [];              // ordered by pinned DESC, timestamp DESC
  let settings = { retention_days: 3, theme: "auto", auto_launch: false };
  let searchTimer = null;
  const SEARCH_DEBOUNCE = 250;
  let currentQuery = "";
  let renderRaf = null;

  // ===== Helpers =====
  const HTML_ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function escHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => HTML_ENTITIES[c]);
  }

  function formatTime(ts) {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    if (diff < 86400000) return Math.floor(diff / 3600000) + " 小时前";
    return new Date(ts).toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function sortIds() {
    orderedIds = [...recordMap.values()]
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned - a.pinned;
        return b.timestamp - a.timestamp;
      })
      .map(r => r.id);
  }

  // ===== Toast =====
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    setTimeout(() => toastEl.classList.remove("show"), 800);
  }

  // ===== Confirm Dialog (CSS-class based) =====
  function showConfirmDialog(message) {
    return new Promise((resolve) => {
      let ov = document.getElementById("confirmOverlay");
      if (!ov) {
        ov = document.createElement("div");
        ov.id = "confirmOverlay";
        ov.className = "confirm-overlay";
        ov.innerHTML = '<div id="confirmBox" class="confirm-box"><p id="confirmMsg" class="confirm-msg"></p><div class="confirm-btns"><button class="confirm-no" id="confirmNo">取消</button><button class="confirm-yes" id="confirmYes">删除</button></div></div>';
        document.body.appendChild(ov);
        document.getElementById("confirmYes").onclick = () => { ov.classList.remove("show"); resolve(true); };
        document.getElementById("confirmNo").onclick = () => { ov.classList.remove("show"); resolve(false); };
      }
      const box = document.getElementById("confirmBox");
      const isDark = document.body.classList.contains("dark");
      box.className = "confirm-box " + (isDark ? "dark" : "light");
      document.getElementById("confirmMsg").textContent = message;
      ov.classList.add("show");
    });
  }

  // ===== Theme =====
  function applyTheme() {
    let theme = settings.theme || "auto";
    if (theme === "auto") {
      const h = new Date().getHours();
      theme = (h >= 6 && h < 18) ? "light" : "dark";
    }
    document.body.classList.toggle("dark", theme === "dark");
  }

  // ===== Settings UI =====
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

  function renderAutoLaunchToggle() {
    autoLaunchToggle.className = "toggle" + (settings.auto_launch ? " on" : "");
  }

  function renderSettings() {
    retentionOpts.innerHTML = [0, 1, 3, 5].map(d =>
      '<button class="' + (settings.retention_days === d ? "active" : "") + '" data-days="' + d + '">' + (d === 0 ? "永不" : d + " 天") + '</button>'
    ).join("");
    renderThemeOpts();
    renderAutoLaunchToggle();
  }

  async function setRetention(days) {
    settings.retention_days = days;
    await invoke("save_settings", { settings: settings });
    renderSettings();
  }

  async function setTheme(theme) {
    settings.theme = theme;
    await invoke("save_settings", { settings: settings });
    applyTheme();
    renderSettings();
  }

  async function toggleAutoLaunch() {
    settings.auto_launch = !settings.auto_launch;
    await invoke("save_settings", { settings: settings });
    renderAutoLaunchToggle();
  }

  // ===== Highlighted text helper =====
  function highlightText(text, hl) {
    if (!hl || hl.length === 0) return escHtml(text);
    const before = escHtml(text.slice(0, hl.index));
    const match = escHtml(text.slice(hl.index, hl.index + hl.length));
    const after = escHtml(text.slice(hl.index + hl.length));
    return before + '<mark class="hl">' + match + '</mark>' + after;
  }

  // ===== Build card HTML =====
  function buildCardHTML(rec) {
    const isImage = rec.type === "image";
    const isText = rec.type === "text";
    let contentHTML = "";
    if (isText) {
      contentHTML = '<div class="text">' + highlightText(rec.preview || rec.content, rec.highlight) + '</div>';
    }
    if (isImage) {
      contentHTML = '<img class="img-thumb loading" data-src="' + escHtml(rec.content) + '" alt="图片"><span class="img-label">📷 图片</span>';
    }
    let metaHTML = '<div class="time">' + formatTime(rec.timestamp) + '</div>';
    if (rec.pinned) {
      metaHTML += '<span class="pin-badge">📌 置顶</span>';
    }
    return '<div class="card' + (rec.pinned ? " pinned" : "") + '" data-id="' + rec.id + '">' +
      '<div class="content">' + contentHTML + '</div>' +
      '<div class="meta">' + metaHTML + '</div>' +
      '<div class="actions">' +
        '<button class="pin-btn" data-action="toggle-pin">' + (rec.pinned ? "取消置顶" : "置顶") + '</button>' +
        '<button class="del-btn" data-action="delete">删除</button>' +
      '</div>' +
    '</div>';
  }

  // ===== Full render =====
  function fullRender() {
    sortIds();
    countEl.textContent = orderedIds.length;

    if (orderedIds.length === 0) {
      listEl.innerHTML = '<div class="empty">暂无记录，复制内容后将自动保存</div>';
      return;
    }

    listEl.innerHTML = orderedIds.map(id => buildCardHTML(recordMap.get(id))).join("");

    // Lazy-load image thumbnails
    listEl.querySelectorAll(".img-thumb.loading").forEach(img => {
      const path = img.dataset.src;
      if (path) {
        invoke("get_image_data", { path: path }).then(data => {
          if (data) { img.src = data; img.classList.remove("loading"); }
        });
      }
    });
  }

  function render() {
    // Debounce via rAF
    if (renderRaf) return;
    renderRaf = requestAnimationFrame(() => {
      renderRaf = null;
      fullRender();
    });
  }

  // ===== Incremental insert for new-record =====
  function insertCard(rec) {
    recordMap.set(rec.id, rec);
    sortIds();
    countEl.textContent = orderedIds.length;

    // Remove empty state if present
    const emptyEl = listEl.querySelector(".empty");
    if (emptyEl) emptyEl.remove();

    const cardHTML = buildCardHTML(rec);
    const temp = document.createElement("div");
    temp.innerHTML = cardHTML;
    const newCard = temp.firstChild;

    // Find insertion position (orderedIds already sorted)
    const insertIdx = orderedIds.indexOf(rec.id);
    if (insertIdx === 0) {
      listEl.insertBefore(newCard, listEl.firstChild);
      // Scroll to top to show new record
      listEl.scrollTop = 0;
    } else if (insertIdx > 0) {
      // Find the card that should come after in DOM
      const afterId = orderedIds[insertIdx - 1];
      const afterCard = listEl.querySelector('.card[data-id="' + afterId + '"]');
      if (afterCard && afterCard.nextSibling) {
        listEl.insertBefore(newCard, afterCard.nextSibling);
      } else {
        listEl.appendChild(newCard);
      }
    } else {
      listEl.appendChild(newCard);
    }

    // Lazy-load image thumbnail if needed
    if (rec.type === "image") {
      const img = newCard.querySelector(".img-thumb.loading");
      if (img) {
        invoke("get_image_data", { path: rec.content }).then(data => {
          if (data) { img.src = data; img.classList.remove("loading"); }
        });
      }
    }
  }

  // ===== Data loading =====
  async function loadRecords(query) {
    try {
      const result = await invoke(query ? "search_records" : "get_records", query ? { q: query } : {});
      recordMap.clear();
      for (const r of result) {
        recordMap.set(r.id, r);
      }
      sortIds();
    } catch (e) {
      console.error("load error:", e);
    }
  }

  // ===== Actions =====
  async function clickRecord(id) {
    const rec = recordMap.get(id);
    if (!rec) return;
    try {
      const ok = await invoke("paste_record", { id: id });
      showToast(ok ? "已粘贴到剪贴板" : "复制失败");
      if (ok) setTimeout(() => invoke("hide_window"), 600);
    } catch (e) {
      showToast("复制失败");
    }
  }

  async function delRecord(id) {
    await invoke("delete_record", { id: id });
    recordMap.delete(id);
    // Remove card from DOM directly
    const card = listEl.querySelector('.card[data-id="' + id + '"]');
    if (card) card.remove();
    sortIds();
    countEl.textContent = orderedIds.length;
    if (orderedIds.length === 0) {
      listEl.innerHTML = '<div class="empty">暂无记录，复制内容后将自动保存</div>';
    }
  }

  async function togglePin(id) {
    await invoke("toggle_pin", { id: id });
    const rec = recordMap.get(id);
    if (rec) rec.pinned = !rec.pinned;
    // Re-render to reorder
    sortIds();
    render();
  }

  async function deleteAllRecords() {
    if (recordMap.size === 0) { showToast("没有可删除的记录"); return; }
    const msg = "确定要删除全部" + recordMap.size + " 条历史记录吗？\n此操作不可撤销。";
    if (!await showConfirmDialog(msg)) return;
    await invoke("delete_all_records");
    recordMap.clear();
    orderedIds = [];
    render();
    showToast("已删除全部记录");
  }

  function previewImage(fp) {
    overlay.classList.add("show");
    overlayImg.style.display = "none";
    overlaySpinner.style.display = "block";
    overlayImg.src = "";
    invoke("get_image_data", { path: fp }).then(data => {
      if (data) {
        overlayImg.src = data;
        overlayImg.style.display = "block";
        overlaySpinner.style.display = "none";
      } else {
        overlaySpinner.style.display = "none";
        showToast("图片加载失败");
      }
    }).catch(() => {
      overlaySpinner.style.display = "none";
      showToast("图片加载失败");
    });
  }

  // ===== Event: list delegation =====
  listEl.addEventListener("click", (e) => {
    // Action buttons
    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn) {
      e.stopPropagation();
      const card = actionBtn.closest(".card");
      if (!card) return;
      const id = Number(card.dataset.id);
      if (isNaN(id)) return;
      const action = actionBtn.dataset.action;
      if (action === "delete") delRecord(id);
      else if (action === "toggle-pin") togglePin(id);
      return;
    }

    // Image thumbnail click
    if (e.target.closest(".img-thumb")) {
      const card = e.target.closest(".card");
      if (!card) return;
      const id = Number(card.dataset.id);
      const rec = recordMap.get(id);
      if (rec && rec.type === "image") previewImage(rec.content);
      return;
    }

    // Card body click → copy
    const card = e.target.closest(".card");
    if (card) {
      const id = Number(card.dataset.id);
      if (!isNaN(id)) clickRecord(id);
    }
  });

  // ===== Event: search =====
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      currentQuery = searchInput.value.trim();
      await loadRecords(currentQuery || null);
      render();
    }, SEARCH_DEBOUNCE);
  });

  // ===== Event: settings =====
  retentionOpts.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-days]");
    if (btn) setRetention(Number(btn.dataset.days));
  });

  themeOpts.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme]");
    if (btn) setTheme(btn.dataset.theme);
  });

  autoLaunchToggle.addEventListener("click", toggleAutoLaunch);

  $("#btnSettings").addEventListener("click", () => {
    settingsPanel.classList.toggle("show");
    if (settingsPanel.classList.contains("show")) renderSettings();
  });

  $("#btnHide").addEventListener("click", () => invoke("hide_window"));
  $("#btnClose").addEventListener("click", () => invoke("hide_window"));

  // Shortcut hint toggle
  const hintEl = $("#shortcutHint");
  if (hintEl) {
    hintEl.addEventListener("click", () => {
      if (hintEl.style.opacity === "0") { hintEl.style.opacity = "1"; hintEl.title = "点击隐藏"; }
      else { hintEl.style.opacity = "0"; hintEl.title = "点击显示"; }
    });
  }

  // Delete all button
  const btnDel = $("#btnDeleteAll");
  if (btnDel) btnDel.addEventListener("click", deleteAllRecords);

  // Overlay close
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.id === "overlayClose" || e.target.closest("#overlayClose")) {
      overlay.classList.remove("show");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("show")) overlay.classList.remove("show");
  });

  // Image copy/download button
  $("#overlayCopyBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const src = overlayImg.src;
    if (!src || !src.startsWith("data:")) return;
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

  // ===== Event: new clipboard record =====
  try {
    await window.__TAURI__.event.listen("new-record", (event) => {
      const rec = event.payload;
      if (rec && rec.id) {
        recordMap.set(rec.id, rec);
        // If searching, skip insert (search results are filtered)
        if (currentQuery) {
          // Only show if matches current query
          if (rec.type === "image" || (rec.content && rec.content.toLowerCase().includes(currentQuery.toLowerCase()))) {
            insertCard(rec);
          }
        } else {
          insertCard(rec);
        }
      }
    });
  } catch (e) {
    console.error("event listen error:", e);
  }

  // ===== Initial load =====
  try {
    const s = await invoke("get_settings");
    if (s) {
      settings = s;
      applyTheme();
    }
  } catch (e) { /* ignore */ }

  await loadRecords(null);
  render();
})();
