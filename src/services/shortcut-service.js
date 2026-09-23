import { log, error as logError, debug } from "../utils/logger.js";
import { toggleWindowVisibility } from "./window-service.js";
import { getClipboardHistory, listen } from "./tauri-api.js";
import { pinState } from "../views/main/titlebar.js";
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { html2text } from "../utils/formatter.js";

// 防抖动计时器
let plainTextPasteDebounceTimer = null;
let toggleWindowDebounceTimer = null;
const DEBOUNCE_MS = 300; // 窗口显示/隐藏的防抖时间
const PLAIN_TEXT_DEBOUNCE_MS = 300; // 纯文本粘贴的防抖时间（300ms）

// 快捷粘贴快捷键的最近触发时间，避免快速重复触发
const quickPasteLastTrigger = new Map(); // index -> timestamp ms
const QUICK_PASTE_DEBOUNCE_MS = 300;

// 全局锁：保证同一时刻只有一个 paste_clipboard_item_at_index 在执行，
// 防止快速连按 Ctrl+1/Ctrl+2/... 时多个粘贴并发跑导致 enigo 模拟错位
// （症状：用户感觉只按出了单独的 v）。
let quickPasteInFlight = false;

// 当前已注册的 quick_paste 快捷键字符串集合（用于切换模式时清理）
let currentQuickPasteShortcuts = [];

// 默认设置（空值）
const DEFAULT_SETTINGS = {
  shortcuts: {
    toggle_interface: "",
    function_paste: "",
    quick_paste_mode: "ctrl", // ctrl | num | none
    rotating_paste: "",
  },
};

/**
 * 核心验证逻辑：确保设置格式正确
 *
 * 旧实现要求 toggle_interface 和 function_paste 都必须非空，否则直接
 * fallback 到空默认配置。这导致用户首次启动时即使磁盘上已有合法
 * 快捷键配置，只要其中一个字段为空（如默认未设置 function_paste），
 * 整套配置就被丢弃，启动后没有任何全局快捷键被注册，必须进入设置
 * 页保存一次才会生效。
 *
 * 现在改为：只要 settings 是合法对象、且包含 shortcuts 子对象就接受；
 * 缺失的具体快捷键字段交给调用方在注册时按需取 `|| ""`。
 */
function validateSettings(settings) {
  return !!(settings && typeof settings === "object" && settings.shortcuts);
}

/**
 * 尝试从不同来源读取文件内容
 */
async function fetchRawSettings() {
  // 1. 尝试 Tauri 文件系统（通过 invoke 调用后端）
  try {
    const content = await invoke("load_settings_command");
    if (content) {
      return JSON.stringify(content);
    }
  } catch (e) {
    // Tauri 文件系统不可用，继续尝试其他方式
    await debug("后端加载设置失败，尝试其他方式: " + e);
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

    // 3. 转换为纯文本（如果是 HTML）- 使用与 listitem 点击相同的处理方式
    let plainText = content;
    if (format === "html") {
      plainText = html2text(content);
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
      // 传入 content_type: "plain" 明确告知后端按纯文本处理
      // 前端已完成 HTML 到纯文本的转换，后端只需设置剪贴板并模拟粘贴
      await invoke("paste_to_active_window", {
        content: plainText,
        format: "plain",
        isPinned: pinState.isPinned,
        contentType: "plain",
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
 * 按序号粘贴历史项（不改变历史排序）。
 *
 * 后端命令 `paste_clipboard_item_at_index` 会写入剪贴板、模拟 Ctrl+V，
 * 并设置较长的剪贴板忽略窗口以避免 watcher 重新入列。
 *
 * @param {number} index - 历史中的 0-based 序号（与 `getClipboardHistory` 顺序一致）。
 * @param {string} modifierKind - "ctrl" | "num" | "none"，仅用于日志。
 */
async function handleQuickPaste(index, modifierKind) {
  // 单个序号的防抖：避免按住 1 时多次触发
  const now = Date.now();
  const last = quickPasteLastTrigger.get(index) || 0;
  if (now - last < QUICK_PASTE_DEBOUNCE_MS) {
    return;
  }
  quickPasteLastTrigger.set(index, now);

  // 全局串行化：前一次粘贴（任意 index）尚未结束就忽略新触发，
  // 避免 enigo 在 OS 键盘状态上互相覆盖导致只按出单独的 v。
  if (quickPasteInFlight) {
    console.log(`[quick-paste] 跳过: 上一次粘贴尚未结束 index=${index}`);
    return;
  }

  quickPasteInFlight = true;
  console.log(`[quick-paste] 触发: index=${index}, modifier=${modifierKind}`);
  try {
    await debug(`快捷粘贴触发: index=${index}, modifier=${modifierKind}`);
    await invoke("paste_clipboard_item_at_index", {
      index,
      modifierKind,
    });
    // 粘贴后处理（隐藏窗口等）— 与现有 paste 行为保持一致
    await handlePasteAftermath();
  } catch (err) {
    console.error(`[quick-paste] 失败: index=${index}`, err);
    await logError(`快捷粘贴失败: index=${index}`, err);
  } finally {
    quickPasteInFlight = false;
  }
}

/**
 * 注销当前已注册的快捷粘贴快捷键（用于切换模式时清理）。
 *
 * 现在已改用后端 `setup_quick_paste_shortcuts` 统一注册，保留此函数
 * 仅用于兼容旧调用方（内部直接 invoke 后端的 unregister_all）。
 */
async function unregisterAllQuickPasteShortcuts() {
  try {
    await invoke("setup_quick_paste_shortcuts", {
      quickPasteMode: "none",
      rotatingShortcut: "",
    });
  } catch (e) {
    await debug(`注销快捷粘贴快捷键失败: ${e}`);
  }
  currentQuickPasteShortcuts = [];
}

// 缓存快速粘贴相关事件的 unlisten 函数，避免重复 listen
const quickPasteUnlisteners = new Map(); // eventName -> unlisten function
let quickPasteListenersInitialized = false;

/**
 * 注册快速粘贴相关事件监听器（仅在第一次执行时绑定，避免重复触发）。
 *
 * 之所以一次性绑定而不是每次 setupQuickPasteShortcuts 都重新绑定，是因为：
 * - 监听 quick_paste_{1..9} 不管模式如何都有效（mode 只影响后端注册哪些系统快捷键）；
 * - 重复 listen 会导致每次按键触发 N 次回调。
 */
async function ensureQuickPasteListeners() {
  if (quickPasteListenersInitialized) {
    return;
  }
  quickPasteListenersInitialized = true;

  for (let i = 1; i <= 9; i++) {
    const action = `quick_paste_${i}`;
    const eventName = `shortcut-${action}`;
    const index = i - 1;
    try {
      const unlisten = await listen(eventName, async () => {
        console.log(`[quick-paste] 收到事件: ${eventName}, index=${index}`);
        const mode = currentQuickPasteMode || "ctrl";
        const modifierKind = mode === "num" ? "num" : "ctrl";
        await handleQuickPaste(index, modifierKind);
      });
      quickPasteUnlisteners.set(eventName, unlisten);
    } catch (e) {
      await logError(`监听 ${action} 失败`, e);
    }
  }
  try {
    const unlisten = await listen("shortcut-rotating_paste", async () => {
      console.log("[rotating-paste] 收到事件");
      await handleRotatingPaste();
    });
    quickPasteUnlisteners.set("shortcut-rotating_paste", unlisten);
  } catch (e) {
    await logError(`监听 rotating_paste 失败`, e);
  }
}

// 当前生效的 quick_paste_mode（用于日志和 modifierKind 判断）
let currentQuickPasteMode = "ctrl";

/**
 * 处理轮转粘贴触发
 */
async function handleRotatingPaste() {
  // 同样加锁，避免与 handleQuickPaste 并发执行时 enigo 互相覆盖
  if (quickPasteInFlight) {
    console.log("[rotating-paste] 跳过: 上一次粘贴尚未结束");
    return;
  }
  quickPasteInFlight = true;
  try {
    await invoke("paste_clipboard_item_rotating");
    await handlePasteAftermath();
  } catch (err) {
    console.error("[rotating-paste] 失败:", err);
    await logError(`轮转粘贴失败`, err);
  } finally {
    quickPasteInFlight = false;
  }
}

/**
 * 根据当前 quick_paste_mode 重新注册所有快捷粘贴快捷键。
 *
 * 通过单一 invoke 调用后端 `setup_quick_paste_shortcuts` 完成：
 * - 注销所有旧的
 * - 按 mode 注册 Ctrl+1..9 或 Numpad1..9
 * - 注册 rotating_shortcut（若提供）
 */
async function setupQuickPasteShortcuts(mode, rotatingShortcut) {
  console.log(
    `[quick-paste] setupQuickPasteShortcuts: mode=${mode}, rotating=${rotatingShortcut}`
  );
  currentQuickPasteMode = mode || "ctrl";

  // 1. 确保前端监听器就位（仅首次真正绑定）
  await ensureQuickPasteListeners();

  // 2. 一次性让后端注册所有快捷键
  try {
    await invoke("setup_quick_paste_shortcuts", {
      quickPasteMode: mode || "ctrl",
      rotatingShortcut: rotatingShortcut || "",
    });
    console.log("[quick-paste] 后端注册完成");
  } catch (e) {
    console.error("[quick-paste] 后端注册失败:", e);
    await logError("注册快捷粘贴快捷键失败", e);
  }
}

/**
 * 初始化全局快捷键监听
 */
export async function initGlobalShortcuts() {
  try {
    // 1. 获取设置
    const settings = await loadSettings();
    const { toggle_interface, function_paste, quick_paste_mode, rotating_paste } = settings.shortcuts;

    // 2. 创建防抖计时器引用
    const plainTextTimerRef = { current: null, executing: false };
    const toggleWindowTimerRef = { current: null, executing: false };

    // 3. 定义快捷键动作映射（action 名称与后端一致）
    const actionMap = {
      "toggle_interface": createDebouncedAction(
        toggleWindowVisibility,
        DEBOUNCE_MS,
        toggleWindowTimerRef,
        "toggle_interface"
      ),
      "function_paste": createDebouncedAction(
        handlePlainTextPaste,
        PLAIN_TEXT_DEBOUNCE_MS,
        plainTextTimerRef,
        "function_paste"
      ),
    };

    // 4. 注册项配置化（action 名称与后端一致）
    const registrations = [
      { key: toggle_interface, action: "toggle_interface" },
      { key: function_paste, action: "function_paste" },
    ];

    // 5. 设置事件监听器（在注册快捷键之前）
    for (const item of registrations) {
      const actionFn = actionMap[item.action];
      if (!actionFn) {
        await logError(`未找到动作处理器: ${item.action}`);
        continue;
      }

      try {
        // 监听后端发送的快捷键事件（事件名格式: shortcut-{action}）
        await listen(`shortcut-${item.action}`, async () => {
          await actionFn();
        });
      } catch (e) {
        await logError(`设置事件监听失败 [${item.action}]`, e);
      }
    }

    // 6. 通过后端注册快捷键
    for (const item of registrations) {
      const finalKey = convertShortcutFormat(item.key);
      if (!finalKey) {
        continue;
      }

      try {
        // 通过 invoke 调用后端注册快捷键
        await invoke("register_global_shortcut", {
          shortcut: finalKey,
          action: item.action
        });
      } catch (e) {
        await logError(`注册快捷键失败 [${item.action}]: ${finalKey}`, e);
      }
    }

    // 7. 统一注册快捷粘贴（Ctrl+1..9 / Numpad1..9 + 轮转粘贴）
    await setupQuickPasteShortcuts(quick_paste_mode || "ctrl", rotating_paste || "");
  } catch (err) {
    await logError("全局快捷键初始化严重失败:", err);
  }
}

// 导出保留原样
export { loadSettings, convertShortcutFormat, handlePasteAftermath, setupQuickPasteShortcuts };
