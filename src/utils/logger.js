/**
 * 后端日志工具
 * 封装了对后端 print_message 命令的调用
 */

/**
 * 打印日志到后端
 * @param {string} message - 日志消息
 */
export async function log(message) {
  // 适配 Tauri v2 的路径
  const invoke = window.__TAURI__?.invoke || window.__TAURI__?.core?.invoke;

  if (invoke) {
    try {
      await invoke("print_message", {message});
    } catch (err) {
      console.error("后端日志调用崩溃:", err); // 这里打印具体的报错原因
      console.log(`[Fallback] ${message}`);
    }
  } else {
    console.log(`[No Tauri] ${message}`);
  }
}

/**
 * 打印调试日志
 * @param {string} message - 调试消息
 */
export async function debug(message) {
  await log(`[Debug] ${message}`);
}

/**
 * 打印错误日志
 * @param {string} message - 错误消息
 * @param {Error} [error] - 错误对象
 */
export async function error(message, error = null) {
  if (error) {
    await log(`[Error] ${message}: ${error}`);
  } else {
    await log(`[Error] ${message}`);
  }
}

/**
 * 打印事件日志
 * @param {string} message - 事件消息
 */
export async function event(message) {
  await log(`[Event] ${message}`);
}

/**
 * 打印致命错误日志
 * @param {string} message - 致命错误消息
 * @param {Error} [error] - 错误对象
 */
export async function fatal(message, error = null) {
  if (error) {
    await log(`[Fatal] ${message}: ${error}`);
  } else {
    await log(`[Fatal] ${message}`);
  }
}
