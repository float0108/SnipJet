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

// 导入窗口服务
import { createWindow } from "../../services/window-service.js";
// 导入日志工具
import { log, error } from "../../utils/logger.js";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';

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

  // 1. 固定按钮逻辑：仅改变 UI 状态和后端同步，不操作窗口置顶
  if (pinBtn) {
    pinBtn.classList.toggle("pinned", pinState.isPinned); // 同步初始 UI
    await syncPinState(pinState.isPinned);

    pinBtn.addEventListener("click", async () => {
      pinState.isPinned = !pinState.isPinned;
      pinBtn.classList.toggle("pinned", pinState.isPinned);
      await syncPinState(pinState.isPinned);
    });
  }

  // 2. 关闭按钮逻辑
  closeBtn?.addEventListener("click", async () => {
    try {
      await win.hide();
    } catch (err) {
      await error("窗口隐藏失败:", err);
    }
  });

  // 3. 设置按钮
  settingsBtn?.addEventListener("click", async () => {
    try {
      await openSettingsWindow();
    } catch (e) {
      await error(e);
    }
  });
}

/**
 * 打开设置窗口
 */
export async function openSettingsWindow() {
  try {
    // 假设 createWindow 是你全局定义的工具函数
    if (typeof createWindow === "function") {
      await createWindow("settings-window", {
        url: "/settings.html",
        title: "SnipJet 设置",
        width: 600,
        height: 500,
        center: true,
        decorations: false,
      });
    }
  } catch (err) {
    await error("创建设置窗口失败:", err);
  }
}

// 为了兼容性保留旧导出（指向 pinState 的当前值）
export const isPinned = pinState.isPinned;
