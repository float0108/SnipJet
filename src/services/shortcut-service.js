import { log, error as logError, debug } from "../utils/logger.js";
import { toggleWindowVisibility } from "./window-service.js";
import { getClipboardHistory } from "./tauri-api.js";
import { pinState } from "../views/main/titlebar.js";
import * as fs from '@tauri-apps/plugin-fs';
import * as globalShortcut from '@tauri-apps/plugin-global-shortcut';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';

// 防抖动计时器
let plainTextPasteDebounceTimer = null;
let toggleWindowDebounceTimer = null;
const DEBOUNCE_MS = 300; // 窗口显示/隐藏的防抖时间
const PLAIN_TEXT_DEBOUNCE_MS = 300; // 纯文本粘贴的防抖时间（300ms）

// 默认硬编码设置
const DEFAULT_SETTINGS = {
  shortcuts: {
    toggle_interface: "Win+V",
    function_paste: "F2",
    quick_paste_mode: "ctrl",
  },
};

/**
 * 核心验证逻辑：确保设置格式正确
 */
function validateSettings(settings) {
  return (
    settings?.shortcuts?.toggle_interface && settings?.shortcuts?.function_paste
  );
}

/**
 * 尝试从不同来源读取文件内容
 */
async function fetchRawSettings() {
  // 1. 尝试 Tauri 文件系统
  try {
    const filename = "settings.json";
    if (await fs.exists(filename, { baseDir: fs.BaseDirectory.AppConfig })) {
      return await fs.readTextFile(filename, { baseDir: fs.BaseDirectory.AppConfig });
    }
  } catch (e) {
    // Tauri 文件系统不可用，继续尝试其他方式
  }

  // 2. 尝试前端目录 (Web Fallback)
  const response = await fetch("/config/settings.json").catch(() => null);
  if (response?.ok) {
    return await response.text();
  }

  return null;
}

/**
 * 加载设置文件 - 优化后逻辑更扁平
 */
async function loadSettings() {
  try {
    const rawContent = await fetchRawSettings();
    if (rawContent) {
      const parsed = JSON.parse(rawContent);
      if (validateSettings(parsed)) {
        await debug("配置文件加载并验证成功");
        return parsed;
      }
      await logError("配置文件格式不完整，将使用部分或全部默认值");
    }
  } catch (err) {
    await logError("加载/解析设置失败:", err);
  }

  return DEFAULT_SETTINGS;
}

/**
 * 转换快捷键格式 (针对 Tauri GlobalShortcut)
 */
function convertShortcutFormat(shortcut) {
  if (!shortcut) return "";
  // 统一替换 Win 为 Super，并处理可能的空格或大小写不一
  return shortcut.trim().replace(/Win/i, "Super");
}

/**
 * HTML 转纯文本（使用后端 API）
 * @param {string} html - HTML 内容
 * @returns {string} - 纯文本内容
 */
async function html2text(html) {
  if (!html) return "";
  try {
    // 使用后端 API 转换 HTML 到纯文本
    const text = await invoke("html_to_text", { html });
    return text || "";
  } catch (e) {
    // 如果后端 API 失败，使用简单的正则移除标签和 CSS
    await debug("后端 html_to_text 失败，使用正则 fallback:");

    // 先移除 CSS、脚本和注释
    let cleaned = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/@font-face\s*\{[^}]*\}/gi, "")
      .replace(/@page\s*\{[^}]*\}/gi, "")
      .replace(/[.#][^{]+\{[^}]*\}/g, "");

    return cleaned
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/div>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")  // 移除所有 HTML 标签
      .replace(/&nbsp;/g, " ")   // 解码 &nbsp;
      .replace(/&lt;/g, "<")     // 解码 &lt;
      .replace(/&gt;/g, ">")     // 解码 &gt;
      .replace(/&amp;/g, "&")    // 解码 &amp;
      .replace(/&quot;/g, '"')   // 解码 &quot;
      .replace(/\n{3,}/g, "\n\n") // 清理多余换行
      .trim();
  }
}

/**
 * 统一的粘贴后处理：根据 pin 状态决定是否隐藏窗口
 */
async function handlePasteAftermath() {
  try {
    const appWindow = getCurrentWebviewWindow();

    // 如果窗口已经隐藏，不需要再处理
    const isVisible = await appWindow.isVisible();
    if (!isVisible) {
      return;
    }

    // 如果窗口未被 pin，隐藏窗口
    if (!pinState.isPinned) {
      await appWindow.hide();
      await debug("粘贴后自动隐藏窗口（窗口未 pin）");
    }
  } catch (e) {
    await logError("粘贴后处理失败:", e);
  }
}

/**
 * 处理纯文本粘贴逻辑
 */
async function handlePlainTextPaste() {
  await log("快捷键触发：纯文本粘贴");

  try {
    // 1. 获取剪贴板历史
    const history = await getClipboardHistory();
    if (!history || history.length === 0) {
      await debug("剪贴板历史为空，无法执行纯文本粘贴");
      return;
    }

    // 2. 获取最新的项目（第一个）
    const latestItem = history[0];
    const content = latestItem.content;
    const format = latestItem.format || "plain";

    if (!content) {
      await debug("最新剪贴板项内容为空");
      return;
    }

    // 3. 转换为纯文本（如果是 HTML）
    let plainText = content;
    if (format === "html") {
      plainText = await html2text(content);
    }

    await debug(`准备粘贴纯文本: ${plainText.substring(0, 50)}...`);

    // 4. 复制纯文本到剪贴板（不触发历史更新）
    try {
      await invoke("copy_to_clipboard_no_history", {
        content: plainText,
        format: "plain",
      });
      await debug("纯文本已复制到剪贴板（无历史更新）");
    } catch (e) {
      await logError("后端复制命令执行失败:", e);
      // 前端 fallback
      await navigator.clipboard.writeText(plainText);
      await debug("纯文本已复制到剪贴板（前端 fallback）");
    }

    // 5. 执行粘贴到活动窗口
    try {
      await invoke("paste_to_active_window", {
        content: plainText,
        format: "plain",
        isPinned: pinState.isPinned,
      });
      await log("纯文本粘贴成功");
    } catch (e) {
      await logError("后端粘贴命令执行失败:", e);
      // 前端模拟粘贴 fallback
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const pasteEvent = new KeyboardEvent("keydown", {
        key: "v",
        ctrlKey: !isMac,
        metaKey: isMac,
        bubbles: true,
        cancelable: true,
      });
      const activeElement = document.activeElement;
      if (activeElement) {
        activeElement.dispatchEvent(pasteEvent);
      }
    }

    // 6. 粘贴后处理（隐藏窗口等）
    await handlePasteAftermath();

  } catch (err) {
    await logError("纯文本粘贴失败:", err);
  }
}

/**
 * 创建防抖动包装函数
 * @param {Function} fn - 需要防抖的函数
 * @param {number} delay - 延迟时间（毫秒）
 * @param {Object} timerRef - 计时器引用对象 { current: timer, executing: boolean }
 * @param {string} label - 快捷键标签（用于日志）
 * @returns {Function} - 防抖包装后的函数
 */
function createDebouncedAction(fn, delay, timerRef, label) {
  return async function(...args) {
    // 如果正在执行中或处于冷却期，忽略此次触发
    if (timerRef.executing || timerRef.current) {
      return;
    }

    // 标记为执行中
    timerRef.executing = true;

    try {
      await fn.apply(this, args);
    } finally {
      // 执行完成后，设置冷却期计时器
      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        timerRef.executing = false;
      }, delay);
    }
  };
}

/**
 * 初始化全局快捷键监听
 */
export async function initGlobalShortcuts() {
  try {
    // 1. 清理旧注册
    await globalShortcut.unregisterAll().catch((e) =>
      debug("注销旧快捷键失败(可能无旧注册): " + e)
    );

    // 2. 获取设置
    const settings = await loadSettings();
    const { toggle_interface, function_paste } = settings.shortcuts;

    // 3. 创建防抖计时器引用
    const plainTextTimerRef = { current: null, executing: false };
    const toggleWindowTimerRef = { current: null, executing: false };

    // 4. 注册项配置化（使用防抖动包装）
    const registrations = [
      {
        key: toggle_interface,
        action: createDebouncedAction(
          toggleWindowVisibility,
          DEBOUNCE_MS,
          toggleWindowTimerRef,
          "显示/隐藏"
        ),
        label: "显示/隐藏",
      },
      {
        key: function_paste,
        action: createDebouncedAction(
          handlePlainTextPaste,
          PLAIN_TEXT_DEBOUNCE_MS,
          plainTextTimerRef,
          "纯文本粘贴"
        ),
        label: "纯文本粘贴",
      },
    ];

    for (const item of registrations) {
      const finalKey = convertShortcutFormat(item.key);
      if (!finalKey) {
        await logError(`${item.label} 快捷键为空，跳过注册`);
        continue;
      }

      await globalShortcut.register(finalKey, async () => {
        await item.action();
      });
      await debug(`注册成功 [${item.label}]: ${finalKey}`);
    }
  } catch (err) {
    await logError("全局快捷键初始化严重失败:", err);
  }
}

// 导出保留原样
export { loadSettings, convertShortcutFormat, handlePasteAftermath };
