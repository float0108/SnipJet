// 全局变量
let isPinned = true; // 默认处于 Pin 状态
let appWindow = null;

// 导入窗口服务
import {createWindow} from "../../services/window-service.js";
// 导入日志工具
import {log, error} from "../../utils/logger.js";

/**
 * 获取 Tauri 窗口实例的快捷方法
 */
function getWin() {
  if (appWindow) return appWindow;
  appWindow =
    window.__TAURI__?.window?.getCurrentWindow?.() ||
    window.__TAURI__?.appWindow;
  return appWindow;
}

/**
 * 同步 Pin 状态到后端
 */
async function syncPinState(pinned) {
  const tauri = window.__TAURI__;
  const invoke = tauri?.core?.invoke || tauri?.invoke;
  if (invoke) {
    try {
      await invoke("update_window_pin_state", {isPinned: pinned});
    } catch (e) {
      await error("同步后端失败:", e);
    }
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
    pinBtn.classList.toggle("pinned", isPinned); // 同步初始 UI
    await syncPinState(isPinned);

    pinBtn.addEventListener("click", async () => {
      isPinned = !isPinned;
      pinBtn.classList.toggle("pinned", isPinned);
      await syncPinState(isPinned);
    });
  }

  // 2. 关闭按钮逻辑
  closeBtn?.addEventListener("click", async () => {
    if (!win) return;
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

export {isPinned, appWindow};
