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
import { createWindow, setWindowFocusable } from "../../services/window-service.js";
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

  // 1. 固定按钮逻辑：pin 状态只控制"点击窗口外部是否自动关闭窗口"，
  //    **不**影响窗口置顶。窗口永远置顶（tauri.conf.json: alwaysOnTop: true）。
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
  //
  // 设计：完全清理搜索激活态，恢复窗口"不可激活"基线状态。
  // 关闭窗口是用户主动退出应用的语义——不应再让窗口处于"可激活+搜索激活"的残留态。
  // 下次唤起窗口时是干净的初始状态。
  if (closeBtn) {
    console.log("[titlebar] 绑定关闭按钮事件");
    closeBtn.addEventListener("click", async () => {
      console.log("[titlebar] 关闭按钮被点击");
      try {
        const searchBoxEl = document.getElementById("search-box");
        const searchInputEl = document.getElementById("search-input");

        // 完全清理搜索状态（包括 DOM 和 Win32）
        if (searchInputEl) {
          searchInputEl.blur();
          searchInputEl.value = "";
        }
        if (searchBoxEl) {
          searchBoxEl.classList.remove("active");
        }
        // 清除任何残留的恢复标记
        if (searchInputEl) {
          searchInputEl.dataset.preserveSearchActive = "";
        }
        // 同步后端恢复 WS_EX_NOACTIVATE（兜底，避免 setFocusable(true) 残留）
        try {
          await invoke("set_window_focusable_raw", { focusable: false });
        } catch (e) {
          await error("关闭时恢复不可激活失败:", e);
        }

        await win.hide();
        console.log("[titlebar] 窗口隐藏成功（搜索态已清理）");
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
      document.body.classList.toggle("favorites-view", newState);
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

    // 当前窗口是否持有系统焦点（可接收键盘输入）
    let windowFocused = await win.isFocused();
    // 搜索框是否处于激活（可输入）状态。
    // 单一真源：仅当此标志为 true 时才允许输入光标，其他路径都应将其置 false。
    let searchActive = false;

    /**
     * 直接通过 Win32 API 设置窗口是否可激活。
     * 这是唯一允许切换 WS_EX_NOACTIVATE 的入口，
     * 避免前端混用 Tauri 的 setFocusable 导致 tao/Win32 状态不一致。
     */
    const setWindowFocusableDirect = async (focusable) => {
      try {
        await invoke("set_window_focusable_raw", { focusable });
      } catch (e) {
        await error(`设置窗口焦点状态失败(focusable=${focusable}):`, e);
      }
    };

    /**
     * 把窗口恢复成"不可激活"（加回 WS_EX_NOACTIVATE），
     * 并强制清理残留的搜索激活态。这是修复的核心：每次离开搜索都
     * 立即、显式地恢复 Win32 标志位，避免全局快捷键被卡住。
     */
    const restoreNoActivate = async () => {
      searchActive = false;
      await setWindowFocusableDirect(false);
    };

    /**
     * 统一的"进入搜索激活态"路径：
     * 1. 把窗口设为可激活（移除 WS_EX_NOACTIVATE）
     * 2. 请求系统焦点
     * 3. 若窗口确实拿到了焦点，再让输入框获得 DOM 焦点（出现光标）
     * 4. 更新 searchActive 标志
     */
    const enterSearchActive = async () => {
      // 先退出任何残留的输入态
      if (document.activeElement === searchInput) {
        searchInput.blur();
      }
      await setWindowFocusableDirect(true);
      const focused = await focusWindowForInput();
      searchBox.classList.add("active");
      if (focused) {
        searchInput.focus();
        searchActive = true;
        windowFocused = true;
      } else {
        // 拿到焦点的请求失败——立刻把 WS_EX_NOACTIVATE 加回，
        // 避免窗口停留在"可激活"但实际没焦点的中间状态。
        await restoreNoActivate();
      }
      return searchActive;
    };

    /**
     * 统一的"退出搜索激活态"路径：清输入、清状态、立即恢复不可激活。
     * 不留任何 setFocusable 状态给后续路径。
     */
    const exitSearchActive = async () => {
      searchBox.classList.remove("active");
      if (document.activeElement === searchInput) {
        searchInput.blur();
      }
      searchInput.value = "";
      filterState.setSearchQuery("");
      await restoreNoActivate();
    };

    // 监听窗口焦点变化：
    // 窗口失焦时（典型场景：用户点击主窗口外部）：
    //   1) 立刻取消输入光标（避免误导用户）
    //   2) 立刻把窗口恢复为不可激活（关键修复，避免遗留 setFocusable(true) 状态）
    await win.onFocusChanged(({ payload: focused }) => {
      const prev = windowFocused;
      windowFocused = focused;

      if (!focused && searchActive) {
        // 关键：必须恢复 WS_EX_NOACTIVATE，
        // 否则后续 toggleWindowVisibility 的 show 可能卡住。
        // 用 fire-and-forget 异步执行，不阻塞焦点事件回调。
        restoreNoActivate().catch(async (e) => {
          await error("恢复不可激活状态失败:", e);
        });
        try { searchInput.blur(); } catch (e) { /* ignore */ }
      }

      // 窗口重新拿到焦点时，如果用户从外部切回，刷新 searchActive
      if (focused && !prev && searchBox.classList.contains("active") &&
          document.activeElement === searchInput) {
        searchActive = true;
      }
    });

    // 让窗口真正获得系统焦点。
    // 注意：直接信任 setFocus 调用成功，不再用同步的 isFocused() 做硬性判断。
    // 在 restore_search_active 事件触发时，show() 可能尚未完成焦点的实际转移，
    // 此时同步 isFocused() 极易假阴性，会让 enterSearchActive 误判失败并
    // 调用 restoreNoActivate 把 WS_EX_NOACTIVATE 加回——这正是上次 bug 的根因。
    const focusWindowForInput = async () => {
      try {
        await win.setFocus();
      } catch (e) {
        await error("窗口聚焦失败:", e);
      }
      // 短暂等待让 setFocus 异步生效
      await new Promise((r) => setTimeout(r, 50));
      return true;
    };

    searchBtn.addEventListener("click", async () => {
      console.log("[titlebar] 搜索按钮被点击");
      await enterSearchActive();
    });

    // 点击输入框：抢系统焦点 + 聚焦输入框。
    // 无条件调用 enterSearchActive——如果已经激活也只是 no-op；
    // 如果未激活（比如窗口刚被全局快捷键唤起但没焦点）则完整走一遍流程。
    searchInput.addEventListener("mousedown", async (e) => {
      e.preventDefault();
      await enterSearchActive();
    });

    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      filterState.setSearchQuery(query);
    });

    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        exitSearchActive();
      }
    });

    // 防御性兜底：input 因任何原因失焦时，也恢复不可激活。
    searchInput.addEventListener("blur", () => {
      if (searchActive) {
        restoreNoActivate().catch(async (e) => {
          await error("blur 时恢复不可激活失败:", e);
        });
      }
    });

    const closeSearch = () => exitSearchActive();

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
