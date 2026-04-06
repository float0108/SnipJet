// 全局设置对象
import * as fs from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

export let settings = {};
// 原始设置备份（用于取消时恢复）
let originalSettings = {};

// 转换快捷键格式（Win -> Super）
function convertShortcutFormat(shortcut) {
  if (!shortcut) return "";
  return shortcut.trim().replace(/Win/i, "Super");
}

// 默认设置
function getDefaultSettings() {
  return {
    shortcuts: {
      toggle_interface: "",
      function_paste: "",
      quick_paste_mode: "ctrl",
    },
    interface: {
      theme: "light",
      language: "cn",
      auto_hide: true,
      preview_size: "small",
      max_history_items: 100,
    },
    copy: {
      strip_formatting: false,
      auto_copy: true,
      copy_on_select: false,
    },
    software: {
      startup_launch: true,
      check_updates: true,
    },
  };
}

// 加载设置
export async function loadSettings() {
  try {
    console.log("尝试加载设置文件");

    // 检查设置文件是否存在
    if (await fs.exists("settings.json", { baseDir: fs.BaseDirectory.AppConfig })) {
      // 从应用配置目录加载设置文件
      const content = await fs.readTextFile("settings.json", {
        baseDir: fs.BaseDirectory.AppConfig,
      });
      settings = JSON.parse(content);

      // 清理旧的快捷键字段名（兼容旧版本）
      if (settings.shortcuts) {
        if (settings.shortcuts.toggle_interface_shortcut) {
          settings.shortcuts.toggle_interface = settings.shortcuts.toggle_interface_shortcut;
          delete settings.shortcuts.toggle_interface_shortcut;
        }
        if (settings.shortcuts.function_paste_shortcut) {
          settings.shortcuts.function_paste = settings.shortcuts.function_paste_shortcut;
          delete settings.shortcuts.function_paste_shortcut;
        }
        if (settings.shortcuts.quick_paste_shortcut) {
          settings.shortcuts.quick_paste_mode = settings.shortcuts.quick_paste_shortcut;
          delete settings.shortcuts.quick_paste_shortcut;
        }
      }

      console.log("设置加载成功:", settings);
    } else {
      console.log("设置文件不存在，使用默认设置");
      settings = getDefaultSettings();
    }
  } catch (error) {
    console.error("加载设置时出错:", error);
    // 尝试从前端目录加载 (非Tauri环境)
    try {
      const response = await fetch("/config/settings.json");
      if (response.ok) {
        settings = await response.json();
        console.log("设置加载成功 (非Tauri):", settings);
        // 备份原始设置
        originalSettings = JSON.parse(JSON.stringify(settings));
        return;
      }
    } catch (e) {
      // 忽略错误
    }
    settings = getDefaultSettings();
  }
  // 备份原始设置
  originalSettings = JSON.parse(JSON.stringify(settings));
}

// 保存设置（通过后端命令）
export async function saveSettings() {
  try {
    console.log("开始保存设置，调用后端命令...");

    // 检测快捷键变化并更新注册
    await updateShortcutRegistrations();

    // 调用后端命令保存设置（会触发后端调试输出）
    await invoke("save_settings", { settings: settings });

    // 更新原始设置备份（保存成功后）
    originalSettings = JSON.parse(JSON.stringify(settings));

    console.log("设置保存成功:", settings);

    // 显示保存成功通知
    import("./ui.js").then(({ showNotification }) => {
      showNotification("设置已保存");
    });
  } catch (error) {
    console.error("保存设置时出错:", error);
    // 如果后端命令失败，尝试使用fs插件直接保存
    try {
      await fs.writeTextFile("settings.json", JSON.stringify(settings, null, 2), {
        baseDir: fs.BaseDirectory.AppConfig,
      });
      console.log("设置通过fs插件保存成功:", settings);
      // 更新原始设置备份
      originalSettings = JSON.parse(JSON.stringify(settings));
    } catch (fsError) {
      console.error("fs保存也失败:", fsError);
    }
  }
}

// 更新快捷键注册
async function updateShortcutRegistrations() {
  const shortcutKeys = ["toggle_interface", "function_paste"];

  for (const key of shortcutKeys) {
    const oldShortcut = convertShortcutFormat(originalSettings.shortcuts?.[key] || "");
    const newShortcut = convertShortcutFormat(settings.shortcuts?.[key] || "");

    if (oldShortcut !== newShortcut) {
      // 取消注册旧的快捷键
      if (oldShortcut) {
        try {
          await invoke("unregister_global_shortcut", { shortcut: oldShortcut });
        } catch (e) {
          console.warn("取消注册快捷键失败:", e);
        }
      }

      // 注册新的快捷键
      if (newShortcut) {
        try {
          await invoke("register_global_shortcut", {
            shortcut: newShortcut,
            action: key
          });
        } catch (e) {
          console.error("注册快捷键失败:", e);
        }
      }
    }
  }
}

// 更新软件设置
export function updateSoftwareSettings() {
  // 更新开机启动
  const startupLaunch = document.getElementById("startup-launch");
  if (startupLaunch) {
    startupLaunch.checked = settings.software?.startup_launch ?? true;
  }

  // 更新检查更新
  const checkUpdates = document.getElementById("check-updates");
  if (checkUpdates) {
    checkUpdates.checked = settings.software?.check_updates ?? true;
  }
}

// 更新复制设置
export function updateCopySettings() {
  // 更新去除格式
  const stripFormatting = document.getElementById("strip-formatting");
  if (stripFormatting) {
    stripFormatting.checked = settings.copy?.strip_formatting ?? false;
  }

  // 更新自动复制
  const autoCopy = document.getElementById("auto-copy");
  if (autoCopy) {
    autoCopy.checked = settings.copy?.auto_copy ?? true;
  }

  // 更新选择时复制
  const copyOnSelect = document.getElementById("copy-on-select");
  if (copyOnSelect) {
    copyOnSelect.checked = settings.copy?.copy_on_select ?? false;
  }
}

// 更新界面设置
export function updateInterfaceSettings() {
  // 更新主题
  const theme = document.getElementById("theme");
  if (theme) {
    theme.value = settings.interface?.theme ?? "light";
  }

  // 更新语言
  const language = document.getElementById("language");
  if (language) {
    language.value = settings.interface?.language ?? "cn";
  }

  // 更新自动隐藏
  const autoHide = document.getElementById("auto-hide");
  if (autoHide) {
    autoHide.checked = settings.interface?.auto_hide ?? true;
  }

  // 更新预览大小
  const previewSize = document.getElementById("preview-size");
  if (previewSize) {
    previewSize.value = settings.interface?.preview_size ?? "small";
  }

  // 更新最大历史记录数
  const maxHistoryItems = document.getElementById("max-history-items");
  if (maxHistoryItems) {
    maxHistoryItems.value = settings.interface?.max_history_items ?? 100;
  }
}

// 绑定设置变化监听器（不再自动保存，只在内存中更新）
export function bindSettingsListeners() {
  // 监听软件设置变化
  const startupLaunch = document.getElementById("startup-launch");
  if (startupLaunch) {
    startupLaunch.addEventListener("change", function () {
      if (!settings.software) settings.software = {};
      settings.software.startup_launch = this.checked;
    });
  }

  const checkUpdates = document.getElementById("check-updates");
  if (checkUpdates) {
    checkUpdates.addEventListener("change", function () {
      if (!settings.software) settings.software = {};
      settings.software.check_updates = this.checked;
    });
  }

  // 监听复制设置变化
  const stripFormatting = document.getElementById("strip-formatting");
  if (stripFormatting) {
    stripFormatting.addEventListener("change", function () {
      if (!settings.copy) settings.copy = {};
      settings.copy.strip_formatting = this.checked;
    });
  }

  const autoCopy = document.getElementById("auto-copy");
  if (autoCopy) {
    autoCopy.addEventListener("change", function () {
      if (!settings.copy) settings.copy = {};
      settings.copy.auto_copy = this.checked;
    });
  }

  const copyOnSelect = document.getElementById("copy-on-select");
  if (copyOnSelect) {
    copyOnSelect.addEventListener("change", function () {
      if (!settings.copy) settings.copy = {};
      settings.copy.copy_on_select = this.checked;
    });
  }

  // 监听界面设置变化
  const theme = document.getElementById("theme");
  if (theme) {
    theme.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.theme = this.value;
    });
  }

  const autoHideEl = document.getElementById("auto-hide");
  if (autoHideEl) {
    autoHideEl.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.auto_hide = this.checked;
    });
  }

  const maxHistoryItems = document.getElementById("max-history-items");
  if (maxHistoryItems) {
    maxHistoryItems.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.max_history_items = parseInt(this.value);
    });
  }

  const language = document.getElementById("language");
  if (language) {
    language.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.language = this.value;
    });
  }

  const previewSize = document.getElementById("preview-size");
  if (previewSize) {
    previewSize.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.preview_size = this.value;
    });
  }
}

// 恢复原始设置（取消操作）
export async function restoreOriginalSettings() {
  settings = JSON.parse(JSON.stringify(originalSettings));
  // 更新UI
  updateSoftwareSettings();
  updateCopySettings();
  updateInterfaceSettings();
  // 更新快捷键UI
  const { updateShortcutInputs } = await import("./shortcuts.js");
  updateShortcutInputs();
}
