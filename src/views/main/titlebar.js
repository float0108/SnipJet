// 创建可共享的 pin 状态管理器
export const pinState = {
  _isPinned: true,
  _listeners: [],

  get isPinned() {
    return this._isPinned;
  },

  set isPinned(value) {
    this._isPinned = value;
    this._listeners.forEach(fn => fn(value));
  },

  subscribe(fn) {
    this._listeners.push(fn);
    return () => {
      const index = this._listeners.indexOf(fn);
      if (index > -1) this._listeners.splice(index, 1);
    };
  }
};

// 创建筛选状态管理器
export const filterState = {
  _showFavoritesOnly: false,
  _searchQuery: "",
  _listeners: [],

  get showFavoritesOnly() {
    return this._showFavoritesOnly;
  },

  get searchQuery() {
    return this._searchQuery;
  },

  setShowFavoritesOnly(value) {
    this._showFavoritesOnly = value;
    this._notifyListeners();
  },

  setSearchQuery(value) {
    this._searchQuery = value;
    this._notifyListeners();
  },

  _notifyListeners() {
    this._listeners.forEach(fn => fn({
      showFavoritesOnly: this._showFavoritesOnly,
      searchQuery: this._searchQuery
    }));
  },

  subscribe(fn) {
    this._listeners.push(fn);
    return () => {
      const index = this._listeners.indexOf(fn);
      if (index > -1) this._listeners.splice(index, 1);
    };
  }
};

// 导入窗口服务
import { createWindow } from "../../services/window-service.js";
// 导入日志工具
import { log, error } from "../../utils/logger.js";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';

// 调试：确认模块加载
console.log("[titlebar.js] 模块加载, createWindow:", typeof createWindow);

/**
 * 获取 Tauri 窗口实例的快捷方法
 */
function getWin() {
  return getCurrentWebviewWindow();
}

/**
 * 同步 Pin 状态到后端
 */
async function syncPinState(pinned) {
  try {
    await invoke("update_window_pin_state", { isPinned: pinned });
  } catch (e) {
    await error("同步后端失败:", e);
  }
}

/**
 * 初始化标题栏按钮
 */
export async function initTitlebarButtons() {
  const win = getWin();
  const pinBtn = document.getElementById("pin-btn");
  const closeBtn = document.getElementById("close-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const favoritesBtn = document.getElementById("favorites-btn");
  const searchBtn = document.getElementById("search-btn");
  const searchBox = document.getElementById("search-box");
  const searchInput = document.getElementById("search-input");
  const searchClose = document.getElementById("search-close");
  const expanderBtn = document.querySelector("button[title='文本扩展']");

  // 1. 固定按钮逻辑：仅改变 UI 状态和后端同步，不操作窗口置顶
  if (pinBtn) {
    console.log("[titlebar] 绑定固定按钮事件");
    pinBtn.classList.toggle("pinned", pinState.isPinned); // 同步初始 UI
    await syncPinState(pinState.isPinned);

    pinBtn.addEventListener("click", async () => {
      console.log("[titlebar] 固定按钮被点击, 当前状态:", pinState.isPinned);
      pinState.isPinned = !pinState.isPinned;
      pinBtn.classList.toggle("pinned", pinState.isPinned);
      await syncPinState(pinState.isPinned);
    });
  } else {
    console.warn("[titlebar] 未找到固定按钮 #pin-btn");
  }

  // 2. 关闭按钮逻辑
  if (closeBtn) {
    console.log("[titlebar] 绑定关闭按钮事件");
    closeBtn.addEventListener("click", async () => {
      console.log("[titlebar] 关闭按钮被点击");
      try {
        await win.hide();
        console.log("[titlebar] 窗口隐藏成功");
      } catch (err) {
        console.error("[titlebar] 窗口隐藏失败:", err);
        await error("窗口隐藏失败:", err);
      }
    });
  } else {
    console.warn("[titlebar] 未找到关闭按钮 #close-btn");
  }

  // 3. 设置按钮
  if (settingsBtn) {
    console.log("[titlebar] 绑定设置按钮事件");
    settingsBtn.addEventListener("click", async () => {
      console.log("[titlebar] 设置按钮被点击");
      try {
        await openSettingsWindow();
      } catch (e) {
        console.error("[titlebar] 打开设置窗口出错:", e);
        await error(e);
      }
    });
  } else {
    console.warn("[titlebar] 未找到设置按钮 #settings-btn");
  }

  // 4. 收藏按钮
  if (favoritesBtn) {
    console.log("[titlebar] 绑定收藏按钮事件");
    favoritesBtn.addEventListener("click", () => {
      console.log("[titlebar] 收藏按钮被点击, 当前状态:", filterState.showFavoritesOnly);
      const newState = !filterState.showFavoritesOnly;
      console.log("[titlebar] 切换到新状态:", newState);
      filterState.setShowFavoritesOnly(newState);
      favoritesBtn.classList.toggle("favorites-active", newState);
      favoritesBtn.title = newState ? "显示全部" : "查看收藏";
    });
  } else {
    console.warn("[titlebar] 未找到收藏按钮 #favorites-btn");
  }

  // 5. 文本扩展按钮
  if (expanderBtn) {
    console.log("[titlebar] 绑定文本扩展按钮事件");
    expanderBtn.addEventListener("click", async () => {
      console.log("[titlebar] 文本扩展按钮被点击");
      try {
        await openExpanderWindow();
      } catch (e) {
        console.error("[titlebar] 打开文本扩展窗口出错:", e);
        await error(e);
      }
    });
  } else {
    console.warn("[titlebar] 未找到文本扩展按钮");
  }

  // 6. 搜索按钮
  if (searchBtn && searchBox && searchInput) {
    console.log("[titlebar] 绑定搜索按钮事件");

    searchBtn.addEventListener("click", () => {
      console.log("[titlebar] 搜索按钮被点击");
      searchBox.classList.add("active");
      searchInput.focus();
    });

    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      filterState.setSearchQuery(query);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        closeSearch();
      }
    });

    const closeSearch = () => {
      searchBox.classList.remove("active");
      searchInput.value = "";
      filterState.setSearchQuery("");
    };

    if (searchClose) {
      searchClose.addEventListener("click", closeSearch);
    }
  } else {
    console.warn("[titlebar] 未找到搜索相关元素");
  }
}

/**
 * 打开设置窗口
 */
export async function openSettingsWindow() {
  console.log("[titlebar] 打开设置窗口被调用");
  try {
    console.log("[titlebar] createWindow 类型:", typeof createWindow);
    if (typeof createWindow === "function") {
      console.log("[titlebar] 开始创建设置窗口...");
      await createWindow("settings-window", {
        url: "./settings.html",
        title: "SnipJet 设置",
        width: 600,
        height: 500,
        center: true,
        decorations: false,
      });
      console.log("[titlebar] 设置窗口创建成功");
    } else {
      console.error("[titlebar] createWindow 不是函数!");
    }
  } catch (err) {
    console.error("[titlebar] 创建设置窗口失败:", err);
    await error("创建设置窗口失败:", err);
  }
}

/**
 * 打开文本扩展窗口
 */
export async function openExpanderWindow() {
  console.log("[titlebar] 打开文本扩展窗口被调用");
  try {
    console.log("[titlebar] createWindow 类型:", typeof createWindow);
    if (typeof createWindow === "function") {
      console.log("[titlebar] 开始创建文本扩展窗口...");
      await createWindow("expander-window", {
        url: "./expander.html",
        title: "SnipJet 文本扩展",
        width: 700,
        height: 500,
        center: true,
        decorations: false,
      });
      console.log("[titlebar] 文本扩展窗口创建成功");
    } else {
      console.error("[titlebar] createWindow 不是函数!");
    }
  } catch (err) {
    console.error("[titlebar] 创建文本扩展窗口失败:", err);
    await error("创建文本扩展窗口失败:", err);
  }
}

// 暴露到全局以便调试
if (typeof window !== "undefined") {
  window.openSettingsWindow = openSettingsWindow;
  window.openExpanderWindow = openExpanderWindow;
}

// 为了兼容性保留旧导出（指向 pinState 的当前值）
export const isPinned = pinState.isPinned;
