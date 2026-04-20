// 全局设置对象
import * as fs from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { applyTheme, applyFontSize, applyPreviewLines } from '../../services/theme-service.js';

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
      font_size: 14,
      auto_hide: true,
      preview_lines: 5,
      image_preview_size: "medium",
      max_history_items: 100,
    },
    copy: {
      strip_formatting: false,
      auto_copy: true,
      copy_on_select: false,
    },
    paste: {
      use_pandoc_for_markdown: false,
      pandoc_template_path: "",
    },
    software: {
      startup_launch: true,
      check_updates: true,
    },
    mcp: {
      enabled: false,
      port: 3000,
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
      // 同时保存到 localStorage 供前端快速访问
      localStorage.setItem('snipjet-settings', JSON.stringify(settings));
    } else {
      console.log("设置文件不存在，使用默认设置");
      settings = getDefaultSettings();
    }

    // 同步系统自启动状态到设置
    await syncAutostartStatus();
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

// 同步系统自启动状态到设置
async function syncAutostartStatus() {
  try {
    const systemAutostartEnabled = await invoke("get_autostart_status");
    if (!settings.software) settings.software = {};

    // 如果系统状态与设置不一致，以系统状态为准
    if (settings.software.startup_launch !== systemAutostartEnabled) {
      console.log("同步自启动状态，系统状态:", systemAutostartEnabled);
      settings.software.startup_launch = systemAutostartEnabled;
    }
  } catch (e) {
    console.warn("获取系统自启动状态失败:", e);
  }
}

// 保存设置（通过后端命令）
export async function saveSettings() {
  try {
    console.log("开始保存设置，调用后端命令...");

    // 检测快捷键变化并更新注册
    await updateShortcutRegistrations();

    // 检测自启动设置变化并更新
    await updateAutostartSetting();

    // 检测 MCP 服务设置变化并更新
    await updateMcpService();

    // 调用后端命令保存设置（会触发后端调试输出）
    await invoke("save_settings", { settings: settings });

    // 同时保存到 localStorage 供前端快速访问
    localStorage.setItem('snipjet-settings', JSON.stringify(settings));

    // 应用界面设置
    if (settings.interface?.theme) {
      applyTheme(settings.interface.theme);
    }
    if (settings.interface?.font_size) {
      applyFontSize(settings.interface.font_size);
    }
    if (settings.interface?.preview_lines) {
      applyPreviewLines(settings.interface.preview_lines);
    }

    // 更新原始设置备份（保存成功后）
    originalSettings = JSON.parse(JSON.stringify(settings));

    // 发送事件通知主界面刷新
    await emit('settings-changed', settings);

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
      // 同时保存到 localStorage
      localStorage.setItem('snipjet-settings', JSON.stringify(settings));
      // 发送事件通知主界面刷新
      await emit('settings-changed', settings);
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

// 更新自启动设置
async function updateAutostartSetting() {
  const oldEnabled = originalSettings.software?.startup_launch ?? true;
  const newEnabled = settings.software?.startup_launch ?? true;

  if (oldEnabled !== newEnabled) {
    try {
      await invoke("set_autostart", { enable: newEnabled });
      console.log("自启动设置已更新:", newEnabled);
    } catch (e) {
      console.error("更新自启动设置失败:", e);
    }
  }
}

// 更新 MCP 服务设置
async function updateMcpService() {
  const oldEnabled = originalSettings.mcp?.enabled ?? false;
  const newEnabled = settings.mcp?.enabled ?? false;
  const oldPort = originalSettings.mcp?.port ?? 3000;
  const newPort = settings.mcp?.port ?? 3000;

  // 如果启用状态或端口发生变化
  if (oldEnabled !== newEnabled || (newEnabled && oldPort !== newPort)) {
    try {
      if (newEnabled) {
        // 启用服务（如果端口变化需要重启）
        if (oldEnabled && oldPort !== newPort) {
          await invoke("restart_mcp_service", { port: newPort });
          console.log("MCP 服务已重启，新端口:", newPort);
        } else if (!oldEnabled) {
          await invoke("start_mcp_service", { port: newPort });
          console.log("MCP 服务已启动，端口:", newPort);
        }
      } else if (oldEnabled && !newEnabled) {
        // 禁用服务
        await invoke("stop_mcp_service");
        console.log("MCP 服务已停止");
      }
    } catch (e) {
      console.error("更新 MCP 服务失败:", e);
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

  // 更新 MCP 设置
  updateMcpSettings();
}

// 更新 MCP 设置
async function updateMcpSettings() {
  const mcpEnabled = document.getElementById("mcp-enabled");
  const mcpPort = document.getElementById("mcp-port");
  const mcpStatus = document.getElementById("mcp-status");

  if (mcpEnabled) {
    mcpEnabled.checked = settings.mcp?.enabled ?? false;
  }

  if (mcpPort) {
    mcpPort.value = settings.mcp?.port ?? 3000;
  }

  // 获取 MCP 服务状态
  if (mcpStatus) {
    try {
      const status = await invoke("get_mcp_status");
      console.log("MCP status:", status);
      if (status.is_running) {
        mcpStatus.textContent = "运行中";
        mcpStatus.className = "status-badge status-running";
      } else {
        mcpStatus.textContent = "未运行";
        mcpStatus.className = "status-badge status-stopped";
      }
    } catch (e) {
      console.error("获取 MCP 状态失败:", e);
      mcpStatus.textContent = "未运行";
      mcpStatus.className = "status-badge status-stopped";
    }
  }
}

// 更新粘贴设置
export function updatePasteSettings() {
  // 更新使用 Pandoc 粘贴 Markdown
  const usePandocForMarkdown = document.getElementById("use-pandoc-for-markdown");
  if (usePandocForMarkdown) {
    usePandocForMarkdown.checked = settings.paste?.use_pandoc_for_markdown ?? false;
  }

  // 更新 Pandoc 模板路径
  const pandocTemplatePath = document.getElementById("pandoc-template-path");
  if (pandocTemplatePath) {
    pandocTemplatePath.value = settings.paste?.pandoc_template_path ?? "";
  }

  // 根据是否启用 Pandoc 来显示/隐藏模板路径设置
  const pandocTemplateItem = document.getElementById("pandoc-template-item");
  if (pandocTemplateItem) {
    pandocTemplateItem.style.display = settings.paste?.use_pandoc_for_markdown ? "flex" : "none";
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

  // 更新基础字号
  const fontSize = document.getElementById("font-size");
  if (fontSize) {
    fontSize.value = settings.interface?.font_size ?? 14;
  }

  // 更新自动隐藏
  const autoHide = document.getElementById("auto-hide");
  if (autoHide) {
    autoHide.checked = settings.interface?.auto_hide ?? true;
  }

  // 更新预览行数
  const previewLines = document.getElementById("preview-lines");
  if (previewLines) {
    previewLines.value = settings.interface?.preview_lines ?? 5;
  }

  // 更新图片预览大小
  const imagePreviewSize = document.getElementById("image-preview-size");
  if (imagePreviewSize) {
    imagePreviewSize.value = settings.interface?.image_preview_size ?? "medium";
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

  // 监听粘贴设置变化
  const usePandocForMarkdown = document.getElementById("use-pandoc-for-markdown");
  if (usePandocForMarkdown) {
    usePandocForMarkdown.addEventListener("change", function () {
      if (!settings.paste) settings.paste = {};
      settings.paste.use_pandoc_for_markdown = this.checked;
      // 切换模板路径输入框的显示/隐藏
      const pandocTemplateItem = document.getElementById("pandoc-template-item");
      if (pandocTemplateItem) {
        pandocTemplateItem.style.display = this.checked ? "flex" : "none";
      }
    });
  }

  const pandocTemplatePath = document.getElementById("pandoc-template-path");
  if (pandocTemplatePath) {
    pandocTemplatePath.addEventListener("input", function () {
      if (!settings.paste) settings.paste = {};
      settings.paste.pandoc_template_path = this.value;
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

  const fontSize = document.getElementById("font-size");
  if (fontSize) {
    fontSize.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.font_size = parseInt(this.value);
    });
  }

  const previewLines = document.getElementById("preview-lines");
  if (previewLines) {
    previewLines.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.preview_lines = parseInt(this.value);
    });
  }

  const imagePreviewSize = document.getElementById("image-preview-size");
  if (imagePreviewSize) {
    imagePreviewSize.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.image_preview_size = this.value;
    });
  }

  // 监听 MCP 设置变化
  const mcpEnabled = document.getElementById("mcp-enabled");
  if (mcpEnabled) {
    mcpEnabled.addEventListener("change", function () {
      if (!settings.mcp) settings.mcp = {};
      settings.mcp.enabled = this.checked;
    });
  }

  const mcpPort = document.getElementById("mcp-port");
  if (mcpPort) {
    mcpPort.addEventListener("change", function () {
      if (!settings.mcp) settings.mcp = {};
      settings.mcp.port = parseInt(this.value);
    });
  }
}

// 恢复原始设置（取消操作）
export async function restoreOriginalSettings() {
  settings = JSON.parse(JSON.stringify(originalSettings));
  // 更新UI
  updateSoftwareSettings();
  updatePasteSettings();
  updateCopySettings();
  updateInterfaceSettings();
  // 更新快捷键UI
  const { updateShortcutInputs } = await import("./shortcuts.js");
  updateShortcutInputs();
}
