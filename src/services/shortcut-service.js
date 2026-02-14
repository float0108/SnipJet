import {log, error as logError, debug} from "../utils/logger.js";
import {toggleWindowVisibility} from "./window-service.js";

// 默认硬编码设置
const DEFAULT_SETTINGS = {
  shortcuts: {
    toggle_interface: "Win+V",
    function_paste: "Ctrl+Shift+V",
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
  if (window.__TAURI__?.fs) {
    const {readTextFile, exists, BaseDirectory} = window.__TAURI__.fs;
    const filename = "settings.json";
    if (await exists(filename, {baseDir: BaseDirectory.AppConfig})) {
      return await readTextFile(filename, {baseDir: BaseDirectory.AppConfig});
    }
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
 * 处理纯文本粘贴逻辑
 */
async function handlePlainTextPaste() {
  await log("快捷键触发：纯文本粘贴");
  // 逻辑实现...
}

/**
 * 初始化全局快捷键监听
 */
export async function initGlobalShortcuts() {
  const shortcutApi = window.__TAURI__?.globalShortcut;
  if (!shortcutApi) {
    await logError("Tauri globalShortcut API 不可用，请检查 permissions");
    return;
  }

  try {
    const {register, unregisterAll} = shortcutApi;

    // 1. 清理旧注册 (确保权限已开启)
    await unregisterAll().catch((e) =>
      debug("注销旧快捷键失败(可能无旧注册): " + e),
    );

    // 2. 获取设置
    const settings = await loadSettings();
    const {toggle_interface, function_paste} = settings.shortcuts;

    // 3. 注册项配置化 (避免重复代码)
    const registrations = [
      {
        key: toggle_interface,
        action: toggleWindowVisibility,
        label: "显示/隐藏",
      },
      {
        key: function_paste,
        action: handlePlainTextPaste,
        label: "纯文本粘贴",
      },
    ];

    for (const item of registrations) {
      const finalKey = convertShortcutFormat(item.key);
      if (!finalKey) {
        await logError(`${item.label} 快捷键为空，跳过注册`);
        continue;
      }

      await register(finalKey, async () => {
        await debug(`触发 [${item.label}] 快捷键: ${finalKey}`);
        await item.action();
      });
      await debug(`注册成功 [${item.label}]: ${finalKey}`);
    }
  } catch (err) {
    await logError("全局快捷键初始化严重失败:", err);
  }
}

// 导出保留原样
export {loadSettings, convertShortcutFormat};
