// Tauri API封装
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen as tauriListen } from '@tauri-apps/api/event';

/**
 * 调用Tauri命令
 * @param {string} command - 命令名称
 * @param {Object} [args] - 命令参数
 * @returns {Promise<any>} - 命令执行结果
 */
export async function invoke(command, args = {}) {
  try {
    return await tauriInvoke(command, args);
  } catch (error) {
    console.error("Tauri API调用失败:", error);
    throw error;
  }
}

/**
 * 获取剪贴板历史记录
 * @returns {Promise<Array>} - 剪贴板历史记录
 */
export async function getClipboardHistory() {
  try {
    console.log("[getClipboardHistory] 正在获取剪贴板历史...");
    const result = await tauriInvoke("get_clipboard_history");
    console.log("[getClipboardHistory] 获取成功，记录数:", result?.length || 0);
    if (result && result.length > 0) {
      console.log("[getClipboardHistory] 第一条记录示例:", {
        id: result[0].id,
        format: result[0].format,
        preview: result[0].preview?.substring(0, 50),
        is_favorite: result[0].is_favorite
      });
    }
    return result;
  } catch (error) {
    console.error("[getClipboardHistory] 获取剪贴板历史失败:", error);
    return [];
  }
}

/**
 * 测试Tauri API连接
 * @returns {Promise<boolean>} - API连接是否成功
 */
export async function testTauriConnection() {
  try {
    console.log("[testTauriConnection] 测试连接...");
    const result = await tauriInvoke("get_clipboard_history");
    console.log("[testTauriConnection] 连接成功，结果类型:", typeof result, Array.isArray(result) ? "是数组" : "不是数组");
    return Array.isArray(result);
  } catch (error) {
    console.error("[testTauriConnection] 连接测试失败:", error);
    return false;
  }
}

/**
 * 监听Tauri事件
 * @param {string} eventName - 事件名称
 * @param {Function} callback - 回调函数
 * @returns {Promise<Function>} - 取消监听的函数
 */
export async function listen(eventName, callback) {
  try {
    console.log("设置事件监听:", eventName);
    return await tauriListen(eventName, callback);
  } catch (error) {
    console.error("Tauri事件监听失败:", error);
    throw error;
  }
}

/**
 * 取消事件监听
 * @param {Function} unlistenFn - 取消监听的函数
 */
export async function unlisten(unlistenFn) {
  try {
    if (unlistenFn && typeof unlistenFn === "function") {
      await unlistenFn();
    }
  } catch (error) {
    console.error("取消事件监听失败:", error);
  }
}

// --- 数据持久化 API ---

/**
 * 保存剪贴板历史到文件
 * @returns {Promise<void>}
 */
export async function saveClipboardHistory() {
  try {
    await tauriInvoke("save_clipboard_history");
    console.log("剪贴板历史已保存到文件");
  } catch (error) {
    console.error("保存剪贴板历史失败:", error);
    throw error;
  }
}

/**
 * 从文件加载剪贴板历史
 * @returns {Promise<Array>} - 加载的剪贴板历史记录
 */
export async function loadClipboardHistoryFromFile() {
  try {
    const history = await tauriInvoke("load_clipboard_history_command");
    console.log("剪贴板历史已从文件加载:", history.length, "条记录");
    return history;
  } catch (error) {
    console.error("加载剪贴板历史失败:", error);
    return [];
  }
}

/**
 * 保存设置到文件
 * @param {Object} settings - 设置对象
 * @returns {Promise<void>}
 */
export async function saveSettings(settings) {
  try {
    await tauriInvoke("save_settings", { settings });
    console.log("设置已保存到文件");
  } catch (error) {
    console.error("保存设置失败:", error);
    throw error;
  }
}

/**
 * 从文件加载设置
 * @returns {Promise<Object>} - 加载的设置对象
 */
export async function loadSettingsFromFile() {
  try {
    const settings = await tauriInvoke("load_settings_command");
    console.log("设置已从文件加载");
    return settings;
  } catch (error) {
    console.error("加载设置失败:", error);
    return null;
  }
}
