/**
 * 前端日志工具
 *
 * dev 模式（`vite dev`）：所有日志通过 `print_message` 命令发到后端，
 * 由 `tauri-plugin-log` 统一写入控制台和日志文件，方便排查问题。
 *
 * build 模式（`vite build`）：跳过 IPC 调用，直接 `console.log` 即可，
 * 避免每次粘贴/快捷键触发都产生一次 IPC 开销。
 */
import { invoke } from '@tauri-apps/api/core';

const IS_DEV = import.meta.env?.DEV === true;

/**
 * 打印日志
 * @param {string} message - 日志消息
 */
export async function log(message) {
  if (IS_DEV) {
    try {
      await invoke("print_message", { message });
    } catch (err) {
      console.error("后端日志调用崩溃:", err);
      console.log(`[Fallback] ${message}`);
    }
  }
  // build 模式下不输出非错误日志到 console（避免刷屏）
}

/**
 * 打印调试日志
 * @param {string} message - 调试消息
 */
export async function debug(message) {
  if (IS_DEV) {
    await log(`[Debug] ${message}`);
  }
}

/**
 * 打印错误日志（dev/build 都保留，便于线上排错）
 * @param {string} message - 错误消息
 * @param {Error} [error] - 错误对象
 */
export async function error(message, err = null) {
  if (err) {
    console.error(`[Error] ${message}:`, err);
  } else {
    console.error(`[Error] ${message}`);
  }
}

/**
 * 打印事件日志
 * @param {string} message - 事件消息
 */
export async function event(message) {
  if (IS_DEV) {
    await log(`[Event] ${message}`);
  }
}

/**
 * 打印致命错误日志（dev/build 都保留）
 * @param {string} message - 致命错误消息
 * @param {Error} [error] - 错误对象
 */
export async function fatal(message, err = null) {
  if (err) {
    console.error(`[Fatal] ${message}:`, err);
  } else {
    console.error(`[Fatal] ${message}`);
  }
}
