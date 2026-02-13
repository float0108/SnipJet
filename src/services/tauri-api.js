// Tauri API封装

/**
 * 调用Tauri命令
 * @param {string} command - 命令名称
 * @param {Object} [args] - 命令参数
 * @returns {Promise<any>} - 命令执行结果
 */
export async function invoke(command, args = {}) {
  try {
    // 尝试不同的Tauri API调用方式
    if (typeof window.invoke === "function") {
      return await window.invoke(command, args);
    } else if (window.__TAURI__ && window.__TAURI__.invoke) {
      return await window.__TAURI__.invoke(command, args);
    } else if (window.tauri && window.tauri.invoke) {
      return await window.tauri.invoke(command, args);
    } else if (
      window.__TAURI__ &&
      window.__TAURI__.core &&
      window.__TAURI__.core.invoke
    ) {
      return await window.__TAURI__.core.invoke(command, args);
    } else {
      throw new Error("未找到Tauri invoke函数");
    }
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
    return await invoke("get_clipboard_history");
  } catch (error) {
    console.error("获取剪贴板历史失败:", error);
    // 返回空数组作为默认值
    return [];
  }
}

/**
 * 测试Tauri API连接
 * @returns {Promise<boolean>} - API连接是否成功
 */
export async function testTauriConnection() {
  try {
    // 直接尝试获取剪贴板历史记录来测试连接
    const result = await invoke("get_clipboard_history");
    return Array.isArray(result);
  } catch (error) {
    console.error("Tauri连接测试失败:", error);
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
    console.log("尝试设置事件监听:", eventName);
    console.log("可用的Tauri API:", {
      hasWindowInvoke: typeof window.invoke === "function",
      hasTAURI: !!window.__TAURI__,
      hasTAURIEvent: window.__TAURI__ && !!window.__TAURI__.event,
      hasTAURICore: window.__TAURI__ && !!window.__TAURI__.core,
      hasTAURICoreEvent:
        window.__TAURI__ &&
        window.__TAURI__.core &&
        !!window.__TAURI__.core.event,
      hasTauri: !!window.tauri,
      hasTauriEvent: window.tauri && !!window.tauri.event,
    });

    // 尝试不同的Tauri事件API调用方式
    if (
      window.__TAURI__ &&
      window.__TAURI__.event &&
      window.__TAURI__.event.listen
    ) {
      console.log("使用 window.__TAURI__.event.listen");
      return await window.__TAURI__.event.listen(eventName, callback);
    } else if (
      window.__TAURI__ &&
      window.__TAURI__.core &&
      window.__TAURI__.core.event &&
      window.__TAURI__.core.event.listen
    ) {
      console.log("使用 window.__TAURI__.core.event.listen");
      return await window.__TAURI__.core.event.listen(eventName, callback);
    } else if (
      window.tauri &&
      window.tauri.event &&
      window.tauri.event.listen
    ) {
      console.log("使用 window.tauri.event.listen");
      return await window.tauri.event.listen(eventName, callback);
    } else {
      throw new Error("未找到Tauri事件API");
    }
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
