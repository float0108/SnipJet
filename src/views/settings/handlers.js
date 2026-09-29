// 全局设置对象
import * as fs from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { applyTheme, applyThemeColors, getResolvedTheme, THEME_COLOR_DEFAULTS, applyFontFamily, applyFontSize, applyPreviewLines, applyZoomLevel, normalizeZoomLevel, normalizeImagePreviewSize, DEFAULT_IMAGE_PREVIEW_SIZE, loadSystemFonts, getSystemFonts, applyAnimationSpeed, normalizeAnimationSpeed, ANIMATION_SPEEDS } from '../../services/theme-service.js';
import { t, setLocale, applyI18n } from '../../utils/i18n.js';
import {
  DEFAULT_UPDATE_SOURCE,
  DEFAULT_UPDATE_REPOS,
  applyUpdateSettings,
  bindUpdaterEvents,
  refreshUpdaterTexts,
  resetUpdaterUI,
} from './updater.js';

export let settings = {};
// 原始设置备份（用于取消时恢复）
let originalSettings = {};
// 最近一次读取的自启动信息（用于语言切换时按新语言重写徽标与路径文案）
let autostartInfo = null;

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
      rotating_paste: "",
    },
    interface: {
      theme: "light",
      follow_system: false,
      language: "en",
      zoom_level: 1,
      font_family: "",
      font_family_secondary: "",
      font_size: 14,
      latest_preview_lines: 5,
      history_preview_lines: 1,
      preview_max_chars: 600,
      image_preview_size: DEFAULT_IMAGE_PREVIEW_SIZE,
      // 主题色按浅色 / 深色各存一套，空串表示跟随该主题的默认色
      favorite_color_light: "",
      favorite_color_dark: "",
      primary_color_light: "",
      primary_color_dark: "",
      search_scan_limit_kb: 1024,
      // 卡片动效档位："off" | "fast" | "normal"，默认 fast（240ms）
      animation_speed: "fast",
    },
    copy: {
      strip_formatting: false,
      auto_copy: true,
    },
    paste: {
      use_pandoc_for_markdown: false,
      pandoc_template_path: "",
    },
    software: {
      startup_launch: true,
      update_source: DEFAULT_UPDATE_SOURCE,
      // 留空表示使用官方仓库，仓库链接由占位符提示
      update_repo: "",
      update_download_dir: "",
    },
    history_cleanup: {
      count_enabled: true,
      count_threshold: 100,
      age_enabled: false,
      age_days: 30,
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
        // 兼容旧版 rotating_paste_shortcut
        if (
          settings.shortcuts.rotating_paste_shortcut &&
          !settings.shortcuts.rotating_paste
        ) {
          settings.shortcuts.rotating_paste = settings.shortcuts.rotating_paste_shortcut;
        }
        delete settings.shortcuts.rotating_paste_shortcut;
      }

      // 兼容旧版单一"预览行数"：迁移为最新条目的预览行数
      if (settings.interface?.preview_lines) {
        if (!settings.interface.latest_preview_lines) {
          settings.interface.latest_preview_lines =
            settings.interface.preview_lines;
        }
        delete settings.interface.preview_lines;
      }

      // 移除已下线的字段："划词复制"功能未实现、"失去焦点隐藏"已由置顶取代
      if (settings.copy) {
        delete settings.copy.copy_on_select;
      }
      if (settings.interface) {
        delete settings.interface.auto_hide;
      }

      // 图片预览大小由旧版档位字符串（large/medium/small/none）迁移为百分比
      if (settings.interface?.image_preview_size != null) {
        settings.interface.image_preview_size = normalizeImagePreviewSize(
          settings.interface.image_preview_size
        );
      }

      // 历史条目数上限已合并进「自动清理-按条数」：
      // 旧版 interface.max_history_items 迁移为 count_threshold，并移除旧字段
      if (settings.interface?.max_history_items != null) {
        if (!settings.history_cleanup) settings.history_cleanup = {};
        if (settings.history_cleanup.count_threshold == null) {
          settings.history_cleanup.count_threshold = settings.interface.max_history_items;
          settings.history_cleanup.count_enabled = true;
        }
        delete settings.interface.max_history_items;
      }

      // 主题色改为浅色 / 深色各存一套：
      // 旧版单一 primary_color / favorite_color 迁移为两套同值，并移除旧字段
      if (settings.interface) {
        const { primary_color, favorite_color } = settings.interface;
        if (primary_color != null) {
          if (settings.interface.primary_color_light == null) {
            settings.interface.primary_color_light = primary_color;
          }
          if (settings.interface.primary_color_dark == null) {
            settings.interface.primary_color_dark = primary_color;
          }
          delete settings.interface.primary_color;
        }
        if (favorite_color != null) {
          if (settings.interface.favorite_color_light == null) {
            settings.interface.favorite_color_light = favorite_color;
          }
          if (settings.interface.favorite_color_dark == null) {
            settings.interface.favorite_color_dark = favorite_color;
          }
          delete settings.interface.favorite_color;
        }
      }

      // 「跟随系统」从主题模式拆成独立开关：
      // 旧版 theme === 'system' 迁移为 follow_system = true，
      // theme 落到当前解析出的浅色 / 深色（仅作为关闭开关后的默认项）
      if (settings.interface) {
        if (settings.interface.follow_system == null) {
          settings.interface.follow_system = settings.interface.theme === "system";
        }
        if (
          settings.interface.theme !== "light" &&
          settings.interface.theme !== "dark"
        ) {
          settings.interface.theme = getResolvedTheme();
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
    // 自启动开关可能改写了系统注册项，重新读取回显
    await refreshAutostartStatus();

    // 检测 MCP 服务设置变化并更新
    await updateMcpService();

    // 调用后端命令保存设置（会触发后端调试输出）
    await invoke("save_settings", { settings: settings });

    // 同时保存到 localStorage 供前端快速访问
    localStorage.setItem('snipjet-settings', JSON.stringify(settings));

    // 应用界面设置
    applyTheme(effectiveThemeMode());
    // 主要/次要字体一起应用；两者都为空时回落到默认字体
    applyFontFamily(
      settings.interface?.font_family,
      settings.interface?.font_family_secondary
    );
    if (settings.interface?.font_size) {
      applyFontSize(settings.interface.font_size);
    }
    // 界面缩放始终应用，确保字段缺失时回落到 1（不缩放）
    applyZoomLevel(settings.interface?.zoom_level);
    // 预览行数：最新条目与历史条目分开应用
    applyPreviewLines({
      latest:
        settings.interface?.latest_preview_lines ??
        settings.interface?.preview_lines,
      history: settings.interface?.history_preview_lines,
    });
    // 主题色：按浅色 / 深色两套分别应用（主题已在上面 applyTheme 中落地）
    applyThemeColors(themeColorPayload());

    // 更新原始设置备份（保存成功后）
    originalSettings = JSON.parse(JSON.stringify(settings));

    // 发送事件通知主界面刷新
    await emit('settings-changed', settings);

    console.log("设置保存成功:", settings);

    // 显示保存成功通知
    import("./ui.js").then(({ showNotification }) => {
      showNotification(t("settings.toast.saved"));
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

  // 快捷粘贴修饰键模式变化 或 轮转粘贴快捷键变化：触发后端统一重新注册
  const oldMode = originalSettings.shortcuts?.quick_paste_mode || "ctrl";
  const newMode = settings.shortcuts?.quick_paste_mode || "ctrl";
  const oldRotating = originalSettings.shortcuts?.rotating_paste || "";
  const newRotating = settings.shortcuts?.rotating_paste || "";
  if (oldMode !== newMode || oldRotating !== newRotating) {
    try {
      const { setupQuickPasteShortcuts } = await import("../../services/shortcut-service.js");
      await setupQuickPasteShortcuts(newMode, newRotating);
      console.log(`快捷粘贴已更新: mode ${oldMode}->${newMode}, rotating '${oldRotating}'->'${newRotating}'`);
    } catch (e) {
      console.error("更新快捷粘贴失败:", e);
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

// 读取自启动注册信息并回显（是否启用 + 系统侧实际注册的路径）
async function refreshAutostartStatus() {
  try {
    autostartInfo = await invoke("get_autostart_info");
  } catch (e) {
    console.error("获取自启动状态失败:", e);
    autostartInfo = null;
  }
  renderAutostartStatus();
}

// 回显自启动状态徽标与注册路径（按当前语言）
function renderAutostartStatus() {
  const badge = document.getElementById("startup-status");
  const pathEl = document.getElementById("startup-path");
  const resetBtn = document.getElementById("startup-path-reset");
  if (!badge || !pathEl) return;

  const enabled = !!autostartInfo?.enabled;
  const registeredPath = autostartInfo?.registered_path || "";

  badge.textContent = enabled
    ? t("settings.general.startupEnabled")
    : t("settings.general.startupDisabled");
  badge.className = enabled
    ? "status-badge status-running"
    : "status-badge status-stopped";

  pathEl.textContent = registeredPath || t("settings.general.startupPathEmpty");
  // 已注册但路径与当前程序不一致：注册项指向旧位置，提示用户重新注册
  pathEl.classList.toggle(
    "stale",
    enabled && !!registeredPath && registeredPath !== autostartInfo?.current_path
  );

  if (resetBtn) resetBtn.disabled = !enabled;
}

// 更新常规设置
export function updateGeneralSettings() {
  // 更新开机启动
  const startupLaunch = document.getElementById("startup-launch");
  if (startupLaunch) {
    startupLaunch.checked = settings.software?.startup_launch ?? true;
  }

  // 读取系统侧的自启动注册信息（异步，不阻塞其它控件回显）
  refreshAutostartStatus();

  // 兼容旧版本：缺少 update_source 时按已填的仓库链接推断（gitee.com → gitee，否则 github）
  if (!settings.software?.update_source) {
    if (!settings.software) settings.software = {};
    const repo = settings.software?.update_repo || "";
    settings.software.update_source = /gitee\.com/i.test(repo)
      ? "gitee"
      : "github";
  }

  // 官方仓库链接存入设置无意义：统一清空，由占位符提示官方链接，留空即用它
  const storedRepo = (settings.software?.update_repo || "").trim();
  if (storedRepo && Object.values(DEFAULT_UPDATE_REPOS).includes(storedRepo)) {
    settings.software.update_repo = "";
  }

  // 回显软件更新区（安装类型检测与版本读取是异步的）
  applyUpdateSettings({
    source: settings.software?.update_source || DEFAULT_UPDATE_SOURCE,
    repo: settings.software?.update_repo || "",
    downloadDir: settings.software?.update_download_dir || "",
  }).catch((e) => console.error("初始化软件更新设置失败:", e));

  // 更新界面语言
  const language = document.getElementById("language");
  if (language) {
    language.value = settings.interface?.language ?? "en";
  }
}

// 更新存储设置
export function updateStorageSettings() {
  const cleanup = settings.history_cleanup || {};

  const countEnabled = document.getElementById("cleanup-count-enabled");
  const countThreshold = document.getElementById("cleanup-count-threshold");
  const ageEnabled = document.getElementById("cleanup-age-enabled");
  const ageDays = document.getElementById("cleanup-age-days");

  if (countEnabled) {
    countEnabled.checked = !!cleanup.count_enabled;
  }
  if (countThreshold) {
    countThreshold.value = cleanup.count_threshold ?? 500;
  }
  if (ageEnabled) {
    ageEnabled.checked = !!cleanup.age_enabled;
  }
  if (ageDays) {
    ageDays.value = cleanup.age_days ?? 30;
  }

  // 联动显示：根据开关状态显示/隐藏对应输入项
  updateCleanupVisibility();
}

// 根据开关状态显示/隐藏清理阈值输入框
function updateCleanupVisibility() {
  const countEnabled = document.getElementById("cleanup-count-enabled");
  const countItem = document.getElementById("cleanup-count-item");
  const ageEnabled = document.getElementById("cleanup-age-enabled");
  const ageItem = document.getElementById("cleanup-age-item");

  if (countItem && countEnabled) {
    countItem.style.display = countEnabled.checked ? "flex" : "none";
  }
  if (ageItem && ageEnabled) {
    ageItem.style.display = ageEnabled.checked ? "flex" : "none";
  }
}

// 更新高级设置
export async function updateAdvancedSettings() {
  // 更新搜索扫描上限（空值表示使用默认 1024 KB）
  const searchScanLimit = document.getElementById("search-scan-limit");
  if (searchScanLimit) {
    const value = settings.interface?.search_scan_limit_kb;
    searchScanLimit.value = value ? value : "";
  }

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
        mcpStatus.textContent = t("settings.advanced.mcpRunning");
        mcpStatus.className = "status-badge status-running";
      } else {
        mcpStatus.textContent = t("settings.advanced.mcpStopped");
        mcpStatus.className = "status-badge status-stopped";
      }
    } catch (e) {
      console.error("获取 MCP 状态失败:", e);
      mcpStatus.textContent = t("settings.advanced.mcpStopped");
      mcpStatus.className = "status-badge status-stopped";
    }
  }
}

// 更新剪贴板设置
export function updateClipboardSettings() {
  // 记录：自动监听
  const autoCopy = document.getElementById("auto-copy");
  if (autoCopy) {
    autoCopy.checked = settings.copy?.auto_copy ?? true;
  }

  // 粘贴格式：去除格式 / Pandoc
  const stripFormatting = document.getElementById("strip-formatting");
  if (stripFormatting) {
    stripFormatting.checked = settings.copy?.strip_formatting ?? false;
  }

  const usePandocForMarkdown = document.getElementById("use-pandoc-for-markdown");
  if (usePandocForMarkdown) {
    usePandocForMarkdown.checked = settings.paste?.use_pandoc_for_markdown ?? false;
  }

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

// 主题模式分段切换：高亮当前选中的模式
function syncThemeToggle() {
  const mode = settings.interface?.theme ?? "light";
  document.querySelectorAll("#theme .segmented-btn").forEach((btn) => {
    const active = btn.dataset.themeMode === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

// 实际生效的主题模式：开启「跟随系统」时交给系统，否则用浅色 / 深色选择
function effectiveThemeMode() {
  if (settings.interface?.follow_system) return "system";
  return settings.interface?.theme === "dark" ? "dark" : "light";
}

// 当前编辑哪一套主题色 = 主题模式里的浅色 / 深色选择
// （开启「跟随系统」时它不再决定实际主题，只决定编辑哪套颜色）
function themeColorScope() {
  return settings.interface?.theme === "dark" ? "dark" : "light";
}

// 主题色标签上的浅 / 深图标：标识当前编辑的是哪一套
const THEME_COLOR_ICONS = {
  light:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M6.34 17.66l-1.41 1.41"></path><path d="M19.07 4.93l-1.41 1.41"></path></svg>',
  dark:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
};

function syncThemeColorIcons() {
  const icon = THEME_COLOR_ICONS[themeColorScope()] || THEME_COLOR_ICONS.light;
  document.querySelectorAll(".theme-color-icon").forEach((el) => {
    el.innerHTML = icon;
  });
}

// 「跟随系统」开关回显；开启时在「主题模式」下方提示它只决定编辑哪套配色
function syncFollowSystem() {
  const enabled = !!settings.interface?.follow_system;
  const input = document.getElementById("follow-system");
  if (input) input.checked = enabled;
  const hint = document.getElementById("theme-mode-hint");
  if (hint) hint.style.display = enabled ? "" : "none";
}

// 主题色回显：两个控件回显当前编辑的一套，为空时用该主题的默认色
function syncThemeColors() {
  const scope = themeColorScope();
  const iface = settings.interface || {};
  const defaults = THEME_COLOR_DEFAULTS[scope] || THEME_COLOR_DEFAULTS.light;
  const primaryColor = document.getElementById("primary-color");
  if (primaryColor) {
    primaryColor.value = iface[`primary_color_${scope}`] || defaults.primary;
  }
  const favoriteColor = document.getElementById("favorite-color");
  if (favoriteColor) {
    favoriteColor.value = iface[`favorite_color_${scope}`] || defaults.favorite;
  }
}

// 把 settings.interface 里的两套主题色整理成 applyThemeColors 需要的入参
function themeColorPayload() {
  const iface = settings.interface || {};
  return {
    primary_color_light: iface.primary_color_light ?? "",
    primary_color_dark: iface.primary_color_dark ?? "",
    favorite_color_light: iface.favorite_color_light ?? "",
    favorite_color_dark: iface.favorite_color_dark ?? "",
  };
}

// 更新外观设置
export function updateAppearanceSettings() {
  // 主题模式（浅色 / 深色）高亮 + 「跟随系统」开关
  syncThemeToggle();
  syncFollowSystem();

  // 主题色：标签图标随浅/深选择切换，并回显当前一套的颜色
  syncThemeColorIcons();
  syncThemeColors();

  // 更新界面字体（先确保下拉框已加载系统字体）
  // populate 是幂等的，选项已存在时这里仍需同步选中态（取消修改后回显原字体）
  populateFontFamilyOptions();
  syncFontPickers();

  // 更新基础字号
  syncFontSize();

  // 更新界面缩放
  const zoomLevel = document.getElementById("zoom-level");
  if (zoomLevel) {
    zoomLevel.value = normalizeZoomLevel(settings.interface?.zoom_level);
  }

  // 更新预览行数（最新条目 / 历史条目）
  syncPreviewLines();

  // 更新预览字符上限
  syncPreviewMaxChars();

  // 更新卡片动效档位
  const animationSpeed = document.getElementById("animation-speed");
  if (animationSpeed) {
    animationSpeed.value = normalizeAnimationSpeed(
      settings.interface?.animation_speed
    );
  }

  // 更新图片预览大小
  syncImagePreviewSize();
}

// 绑定设置变化监听器（不再自动保存，只在内存中更新）
export function bindSettingsListeners() {
  // 给数值输入补上外侧上下箭头（需在绑定各 change 监听前完成，值不受影响）
  setupNumberSteppers();

  // 监听软件设置变化
  const startupLaunch = document.getElementById("startup-launch");
  if (startupLaunch) {
    startupLaunch.addEventListener("change", function () {
      if (!settings.software) settings.software = {};
      settings.software.startup_launch = this.checked;
    });
  }

  // 「重新注册」键：程序移动/重装后按当前路径重写系统自启动注册项
  const startupPathReset = document.getElementById("startup-path-reset");
  if (startupPathReset) {
    startupPathReset.addEventListener("click", async () => {
      startupPathReset.disabled = true;
      const { showNotification } = await import("./ui.js");
      try {
        await invoke("refresh_autostart");
        await refreshAutostartStatus();
        showNotification(t("settings.general.startupPathUpdated"));
      } catch (e) {
        console.error("重新注册自启动失败:", e);
        startupPathReset.disabled = false;
        showNotification(t("settings.general.startupPathFailed"));
      }
    });
  }

  // 软件更新：更新源 / 便携版下载目录 / 检查更新按钮
  bindUpdaterEvents({
    onSourceChange: (source, repo) => {
      if (!settings.software) settings.software = {};
      settings.software.update_source = source;
      settings.software.update_repo = repo;
      // 换源后上一次的检查结果已失效
      resetUpdaterUI();
    },
    onRepoChange: (repo) => {
      if (!settings.software) settings.software = {};
      settings.software.update_repo = repo;
      // 修改链接后上一次的检查结果已失效
      resetUpdaterUI();
    },
    onDownloadDirChange: (dir) => {
      if (!settings.software) settings.software = {};
      settings.software.update_download_dir = dir;
    },
  });

  // 监听历史清理设置变化
  const cleanupCountEnabled = document.getElementById("cleanup-count-enabled");
  if (cleanupCountEnabled) {
    cleanupCountEnabled.addEventListener("change", function () {
      if (!settings.history_cleanup) settings.history_cleanup = {};
      settings.history_cleanup.count_enabled = this.checked;
      updateCleanupVisibility();
    });
  }

  const cleanupCountThreshold = document.getElementById("cleanup-count-threshold");
  if (cleanupCountThreshold) {
    cleanupCountThreshold.addEventListener("change", function () {
      if (!settings.history_cleanup) settings.history_cleanup = {};
      const value = this.value.trim();
      settings.history_cleanup.count_threshold = value ? parseInt(value) : null;
    });
  }

  const cleanupAgeEnabled = document.getElementById("cleanup-age-enabled");
  if (cleanupAgeEnabled) {
    cleanupAgeEnabled.addEventListener("change", function () {
      if (!settings.history_cleanup) settings.history_cleanup = {};
      settings.history_cleanup.age_enabled = this.checked;
      updateCleanupVisibility();
    });
  }

  const cleanupAgeDays = document.getElementById("cleanup-age-days");
  if (cleanupAgeDays) {
    cleanupAgeDays.addEventListener("change", function () {
      if (!settings.history_cleanup) settings.history_cleanup = {};
      const value = this.value.trim();
      settings.history_cleanup.age_days = value ? parseInt(value) : null;
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

  // 主题模式（浅色 / 深色）：未开启「跟随系统」时立即切换主题；
  // 开启后它只用于选择编辑哪套主题色，不再改变实际主题
  const theme = document.getElementById("theme");
  if (theme) {
    theme.addEventListener("click", function (e) {
      const btn = e.target.closest(".segmented-btn");
      if (!btn) return;
      if (!settings.interface) settings.interface = {};
      settings.interface.theme =
        btn.dataset.themeMode === "dark" ? "dark" : "light";
      if (!settings.interface.follow_system) {
        applyTheme(settings.interface.theme);
        applyThemeColors(themeColorPayload());
      }
      syncThemeToggle();
      syncThemeColorIcons();
      syncThemeColors();
    });
  }

  // 跟随系统：开启后主题交给系统，浅色 / 深色选择只影响编辑哪套主题色
  const followSystem = document.getElementById("follow-system");
  if (followSystem) {
    followSystem.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.follow_system = this.checked;
      applyTheme(effectiveThemeMode());
      applyThemeColors(themeColorPayload());
      syncFollowSystem();
    });
  }

  // 卡片动效档位：立刻生效（可即时预览快/慢/关闭的差异）
  const animationSpeed = document.getElementById("animation-speed");
  if (animationSpeed) {
    animationSpeed.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      const value = normalizeAnimationSpeed(this.value);
      this.value = value;
      settings.interface.animation_speed = value;
      applyAnimationSpeed(value);
    });
  }

  const searchScanLimit = document.getElementById("search-scan-limit");
  if (searchScanLimit) {
    searchScanLimit.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      const value = this.value.trim();
      settings.interface.search_scan_limit_kb = value ? parseInt(value) : null;
    });
  }

  const language = document.getElementById("language");
  if (language) {
    language.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.language = this.value;
      setLocale(this.value);
      emit("language-changed", { locale: this.value });

      // 当前窗口立即切换语言：先刷新静态文案，再修正由脚本写入的动态文案
      applyI18n();
      // 顶部分区标题随激活分区变化，需按新语言重写
      import("./ui.js").then(({ updateSectionTitle }) => updateSectionTitle());
      // MCP 状态徽标文案按当前状态类名重写（避免被 applyI18n 复位成"未运行"）
      const mcpStatus = document.getElementById("mcp-status");
      if (mcpStatus) {
        mcpStatus.textContent = mcpStatus.classList.contains("status-running")
          ? t("settings.advanced.mcpRunning")
          : t("settings.advanced.mcpStopped");
      }
      // 自启动状态徽标与注册路径由脚本写入，需按新语言重写
      renderAutostartStatus();
      // 字体下拉的「系统默认 / 已不存在」等文案由脚本生成，需同步刷新其文案
      refreshFontPickerTexts();
      // 更新区的版本/安装类型/结果文案由脚本写入，需按新语言重写
      refreshUpdaterTexts();
    });
  }

  // 界面字体（主要 / 次要）：自定义下拉，每个选项按自身字体预览
  setupFontPickers();

  // 触发下拉框选项填充
  populateFontFamilyOptions();

  const fontSize = document.getElementById("font-size");
  if (fontSize) {
    // 实时预览：修改后立即应用（保存时再由事件广播到其它窗口）
    fontSize.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      const value = normalizeFontSize(this.value);
      settings.interface.font_size = value;
      applyFontSize(value);
      syncFontSize();
    });
  }

  // 基础字号重置键：恢复默认字号
  const fontSizeReset = document.getElementById("font-size-reset");
  if (fontSizeReset) {
    fontSizeReset.addEventListener("click", () => {
      if (!settings.interface) settings.interface = {};
      settings.interface.font_size = DEFAULT_FONT_SIZE;
      applyFontSize(DEFAULT_FONT_SIZE);
      syncFontSize();
    });
  }

  const zoomLevel = document.getElementById("zoom-level");
  if (zoomLevel) {
    // 实时预览：修改后立即对当前窗口应用缩放，保存时再由事件广播到其它窗口
    zoomLevel.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      const zoom = normalizeZoomLevel(this.value);
      settings.interface.zoom_level = zoom;
      // 回填归一化后的值（非法值回落 1、限制区间、保留两位小数）
      this.value = zoom;
      applyZoomLevel(zoom);
    });
  }

  // 预览行数：修改后归一化回填并记录（保存时统一应用）
  const latestPreviewLines = document.getElementById("latest-preview-lines");
  if (latestPreviewLines) {
    latestPreviewLines.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.latest_preview_lines = normalizePreviewLines(
        this.value,
        DEFAULT_LATEST_PREVIEW_LINES
      );
      syncPreviewLines();
    });
  }

  const historyPreviewLines = document.getElementById("history-preview-lines");
  if (historyPreviewLines) {
    historyPreviewLines.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.history_preview_lines = normalizePreviewLines(
        this.value,
        DEFAULT_HISTORY_PREVIEW_LINES
      );
      syncPreviewLines();
    });
  }

  // 预览字符上限 / 图片预览大小：修改后归一化回填并记录（保存时统一应用）
  const previewMaxChars = document.getElementById("preview-max-chars");
  if (previewMaxChars) {
    previewMaxChars.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.preview_max_chars = normalizePreviewMaxChars(this.value);
      syncPreviewMaxChars();
    });
  }

  const imagePreviewSize = document.getElementById("image-preview-size");
  if (imagePreviewSize) {
    imagePreviewSize.addEventListener("change", function () {
      if (!settings.interface) settings.interface = {};
      settings.interface.image_preview_size = normalizeImagePreviewSize(this.value);
      syncImagePreviewSize();
    });
  }

  // 主题色：写入「当前编辑的一套」，实时预览（实际生效的是当前主题那一套）
  const bindColorInput = (id, base) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener("input", function () {
      if (!settings.interface) settings.interface = {};
      const key = `${base}_${themeColorScope()}`;
      settings.interface[key] = this.value;
      applyThemeColors({ [key]: this.value });
    });
  };
  bindColorInput("primary-color", "primary_color");
  bindColorInput("favorite-color", "favorite_color");

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
  // 取消修改：清掉本次的更新检查结果
  resetUpdaterUI();
  // 还原主题与两套主题色（切换主题/颜色都会实时预览，取消时要恢复）
  applyTheme(effectiveThemeMode());
  applyThemeColors(themeColorPayload());
  // 更新UI
  updateGeneralSettings();
  updateAppearanceSettings();
  // 恢复缩放/字体/字号（都可能在实时预览时已被改动）
  applyZoomLevel(settings.interface?.zoom_level);
  applyFontFamily(
    settings.interface?.font_family,
    settings.interface?.font_family_secondary
  );
  applyFontSize(settings.interface?.font_size);
  updateClipboardSettings();
  updateStorageSettings();
  await updateAdvancedSettings();
  // 更新快捷键UI
  const { updateShortcutInputs } = await import("./shortcuts.js");
  updateShortcutInputs();
}

// --- 基础字号 ---
// 取值范围与步长：最小 10、最大 20、可精确到 0.5（与 HTML 的 min/max/step 一致）
const MIN_FONT_SIZE = 10;
const MAX_FONT_SIZE = 20;
// 重置键的目标值（与 getDefaultSettings 保持一致）
const DEFAULT_FONT_SIZE = 14;

// 归一化字号：空值/非法输入回落默认值，超范围截断，并对齐到 0.5 步长
function normalizeFontSize(value) {
  // 输入框被清空时 Number("") 会得到 0，这里显式按默认值处理
  if (value === "" || value == null) return DEFAULT_FONT_SIZE;
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_FONT_SIZE;
  const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, size));
  return Math.round(clamped * 2) / 2;
}

// 回显基础字号：写入输入框，并在已是默认值时置灰重置键
function syncFontSize() {
  const input = document.getElementById("font-size");
  if (!input) return;
  const value = normalizeFontSize(settings.interface?.font_size);
  input.value = value;
  const reset = document.getElementById("font-size-reset");
  if (reset) reset.disabled = value === DEFAULT_FONT_SIZE;
}

// --- 预览行数（最新条目 / 历史条目）---
// 取值范围与默认值（与 HTML 的 min/max、getDefaultSettings 一致）
const MIN_PREVIEW_LINES = 1;
const MAX_PREVIEW_LINES = 10;
const DEFAULT_LATEST_PREVIEW_LINES = 5;
const DEFAULT_HISTORY_PREVIEW_LINES = 1;

// 归一化行数：空值/非法输入回落默认值，超范围截断并取整
function normalizePreviewLines(value, fallback) {
  if (value === "" || value == null) return fallback;
  const lines = Math.round(Number(value));
  if (!Number.isFinite(lines)) return fallback;
  return Math.min(MAX_PREVIEW_LINES, Math.max(MIN_PREVIEW_LINES, lines));
}

// 回显预览行数：写入输入框（历史遗留的单一 preview_lines 作为最新条目的兜底）
function syncPreviewLines() {
  const latest = document.getElementById("latest-preview-lines");
  if (latest) {
    latest.value = normalizePreviewLines(
      settings.interface?.latest_preview_lines ?? settings.interface?.preview_lines,
      DEFAULT_LATEST_PREVIEW_LINES
    );
  }
  const history = document.getElementById("history-preview-lines");
  if (history) {
    history.value = normalizePreviewLines(
      settings.interface?.history_preview_lines,
      DEFAULT_HISTORY_PREVIEW_LINES
    );
  }
}

// --- 预览字符上限 / 图片预览大小 ---
// 取值范围与步长（与 HTML 的 min/max/step、getDefaultSettings 一致）
const MIN_PREVIEW_MAX_CHARS = 100;
const MAX_PREVIEW_MAX_CHARS = 2000;
const DEFAULT_PREVIEW_MAX_CHARS = 600;

// 归一化字符上限：空值/非法输入回落默认值，超范围截断并对齐到 100
function normalizePreviewMaxChars(value) {
  if (value === "" || value == null) return DEFAULT_PREVIEW_MAX_CHARS;
  const chars = Number(value);
  if (!Number.isFinite(chars)) return DEFAULT_PREVIEW_MAX_CHARS;
  const clamped = Math.min(
    MAX_PREVIEW_MAX_CHARS,
    Math.max(MIN_PREVIEW_MAX_CHARS, chars)
  );
  return Math.round(clamped / 100) * 100;
}

function syncPreviewMaxChars() {
  const input = document.getElementById("preview-max-chars");
  if (input) {
    input.value = normalizePreviewMaxChars(settings.interface?.preview_max_chars);
  }
}

// 图片预览大小存百分比（0 表示不显示缩略图），归一化逻辑见 theme-service
function syncImagePreviewSize() {
  const input = document.getElementById("image-preview-size");
  if (input) {
    input.value = normalizeImagePreviewSize(settings.interface?.image_preview_size);
  }
}

// --- 数值输入的外侧上下箭头 ---
// 原生 spinner 的热区在输入框内部且很小，点起来费劲；这里关掉它（见 settings.css），
// 给每个数值输入补上输入框外侧的上下箭头，HTML 里只需要写 input。
const STEP_ICONS = {
  1: '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 15 12 9 18 15"></polyline></svg>',
  "-1": '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>',
};

let numberSteppersReady = false;

function setupNumberSteppers() {
  // 只初始化一次（同时避免重复注册委托监听）
  if (numberSteppersReady) return;
  numberSteppersReady = true;

  document.querySelectorAll(".number-input").forEach((input) => {
    // 输入框外包一层容器，右侧放上下箭头
    const field = document.createElement("div");
    field.className = "number-field";
    input.replaceWith(field);
    field.appendChild(input);

    const stepper = document.createElement("div");
    stepper.className = "number-stepper";
    [1, -1].forEach((step) => {
      const key = step === 1 ? "increase" : "decrease";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "step-btn";
      btn.dataset.step = String(step);
      // 文案交给 i18n：data-* 属性让 applyI18n（含语言切换）能重新写入
      btn.dataset.i18nAriaLabel = `settings.step.${key}`;
      btn.setAttribute("aria-label", t(`settings.step.${key}`));
      btn.innerHTML = STEP_ICONS[step];
      stepper.appendChild(btn);
    });
    field.appendChild(stepper);
  });

  // 箭头按步长增减，再派发 change 交给各控件自身的归一化逻辑收尾
  document.addEventListener("click", (event) => {
    const btn = event.target.closest(".step-btn");
    if (!btn) return;
    const input = btn.closest(".number-field")?.querySelector(".number-input");
    if (!input) return;

    const current = Number(input.value);
    if (!Number.isFinite(current)) {
      // 非法输入（如字母）：派发 change 让各控件按默认值归一化
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const step = Number(input.step) || 1;
    let next = current + step * Number(btn.dataset.step);
    if (input.min !== "") next = Math.max(next, Number(input.min));
    if (input.max !== "") next = Math.min(next, Number(input.max));
    // 规避浮点步长（如 0.01）累加产生的尾数误差
    input.value = Math.round(next * 100) / 100;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// --- 界面字体选择器（自定义下拉）---
// 原生 <select> 的弹层由系统绘制、不应用 CSS 字体，无法让每个选项按自身
// 字体预览；这里改用自定义列表，每个选项用对应字体渲染。
// 主要字体优先，主要字体缺字形时由次要字体兜底（次要字体为空表示不启用）。
// 两个选择器的 DOM id 由 prefix 推导（见 getFontPickerEls）。
const FONT_PICKERS = [
  {
    key: "font_family",
    prefix: "font-family",
    // 主要字体为空 = 系统默认
    emptyLabelKey: "settings.options.font.systemDefault",
    // 列表中是否提供空值项（次要字体用重置键清除，故不提供）
    allowEmpty: true,
  },
  {
    key: "font_family_secondary",
    prefix: "font-family-secondary",
    // 次要字体为空 = 未启用
    emptyLabelKey: "settings.options.font.none",
    allowEmpty: false,
  },
];

// 下拉构建是一次性的（避免重复枚举系统字体与重建 DOM 导致界面抖动）
let fontPickersPopulated = false;
// 键盘导航高亮的选项下标与当前打开的实例（-1 / null 表示无）
let fontPickerActiveIndex = -1;
let openFontPickerInstance = null;

function getFontPickerEls(picker) {
  const { prefix } = picker;
  return {
    root: document.getElementById(`${prefix}-picker`),
    trigger: document.getElementById(`${prefix}-trigger`),
    label: document.getElementById(`${prefix}-label`),
    menu: document.getElementById(`${prefix}-menu`),
    reset: document.getElementById(`${prefix}-reset`),
  };
}

function getFontPickerValue(picker) {
  return settings.interface?.[picker.key] ?? "";
}

// 主要/次要字体组合后立即生效
function applyInterfaceFont() {
  applyFontFamily(
    settings.interface?.font_family,
    settings.interface?.font_family_secondary
  );
}

// 同步选中态与触发按钮文案：触发按钮显示选中字体名并按其字体渲染
function syncFontPicker(picker) {
  const { label, menu, reset } = getFontPickerEls(picker);
  if (!label || !menu) return;

  const value = getFontPickerValue(picker);
  label.textContent = value || t(picker.emptyLabelKey);
  // 触发按钮跟随选中字体，未选时用回界面字体
  label.style.fontFamily = value ? `"${value}"` : "";
  // 重置键只在有选中值时可点
  if (reset) reset.disabled = !value;

  fontPickerActiveIndex = -1;
  Array.from(menu.children).forEach((option, index) => {
    const selected = option.dataset.value === value;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) fontPickerActiveIndex = index;
  });
}

function syncFontPickers() {
  FONT_PICKERS.forEach(syncFontPicker);
}

// 移动键盘高亮项（供方向键使用）
function setFontPickerActive(picker, index) {
  const { menu } = getFontPickerEls(picker);
  if (!menu || menu.children.length === 0) return;
  fontPickerActiveIndex = Math.max(0, Math.min(menu.children.length - 1, index));
  Array.from(menu.children).forEach((option, i) =>
    option.classList.toggle("active", i === fontPickerActiveIndex)
  );
  menu.children[fontPickerActiveIndex].scrollIntoView({ block: "nearest" });
}

function openFontPicker(picker) {
  const { root, trigger, menu } = getFontPickerEls(picker);
  if (!root || !trigger || !menu || menu.children.length === 0) return;
  syncFontPicker(picker);
  openFontPickerInstance = picker;
  root.classList.add("open");
  trigger.setAttribute("aria-expanded", "true");
  setFontPickerActive(picker, fontPickerActiveIndex >= 0 ? fontPickerActiveIndex : 0);
}

function closeFontPicker() {
  if (!openFontPickerInstance) return;
  const { root, trigger, menu } = getFontPickerEls(openFontPickerInstance);
  openFontPickerInstance = null;
  fontPickerActiveIndex = -1;
  if (!root || !trigger) return;
  root.classList.remove("open");
  trigger.setAttribute("aria-expanded", "false");
  if (menu) {
    Array.from(menu.children).forEach((o) => o.classList.remove("active"));
  }
}

// 选中字体：写入设置、立即生效并同步显示
function selectFontFamily(picker, value) {
  if (!settings.interface) settings.interface = {};
  settings.interface[picker.key] = value;
  applyInterfaceFont();
  syncFontPickers();
}

function setupFontPicker(picker) {
  const { root, trigger, menu, reset } = getFontPickerEls(picker);
  if (!root || !trigger || !menu || root.dataset.bound === "true") return;
  root.dataset.bound = "true";

  trigger.addEventListener("click", () => {
    const isOpen = root.classList.contains("open");
    closeFontPicker();
    if (!isOpen) openFontPicker(picker);
  });

  // 选项用事件委托，列表重建后无需重新绑定
  menu.addEventListener("click", (event) => {
    const option = event.target.closest(".font-picker-option");
    if (!option) return;
    selectFontFamily(picker, option.dataset.value ?? "");
    closeFontPicker();
    trigger.focus();
  });

  // 重置键：清除该选择器的字体（次要字体清空后即不启用）
  if (reset) {
    reset.addEventListener("click", () => {
      selectFontFamily(picker, "");
      closeFontPicker();
    });
  }

  // 键盘行为对齐原生下拉：上下移动、回车/空格选中、Esc 关闭
  trigger.addEventListener("keydown", (event) => {
    const isOpen = root.classList.contains("open");
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!isOpen) {
          openFontPicker(picker);
        } else {
          setFontPickerActive(
            picker,
            fontPickerActiveIndex + (event.key === "ArrowDown" ? 1 : -1)
          );
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (!isOpen) {
          openFontPicker(picker);
        } else {
          const option = menu.children[fontPickerActiveIndex];
          if (option) selectFontFamily(picker, option.dataset.value ?? "");
          closeFontPicker();
        }
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          closeFontPicker();
        }
        break;
      case "Tab":
        closeFontPicker();
        break;
    }
  });
}

function setupFontPickers() {
  FONT_PICKERS.forEach(setupFontPicker);

  // 点击任一选择器之外关闭当前展开的列表
  document.addEventListener("click", (event) => {
    if (!openFontPickerInstance) return;
    const { root } = getFontPickerEls(openFontPickerInstance);
    if (root && !root.contains(event.target)) closeFontPicker();
  });
}

// 语言切换后刷新由脚本生成的文案（空值项与「（已不存在）」）
function refreshFontPickerTexts() {
  FONT_PICKERS.forEach((picker) => {
    const { menu } = getFontPickerEls(picker);
    if (!menu) return;
    const emptyOption = menu.querySelector('.font-picker-option[data-value=""]');
    if (emptyOption) emptyOption.textContent = t(picker.emptyLabelKey);
    const missingOption = menu.querySelector('.font-picker-option[data-missing="true"]');
    if (missingOption) {
      missingOption.textContent = t("settings.options.font.missing").replace(
        "{name}",
        missingOption.dataset.value
      );
    }
  });
  syncFontPickers();
}

// 填充字体下拉：两个选择器共用同一份系统字体，每个选项按自身字体渲染
// 幂等：已填充过则跳过（避免重复触发后端枚举与 DOM 重建导致界面抖动）
async function populateFontFamilyOptions() {
  if (fontPickersPopulated) return;
  if (!FONT_PICKERS.some((picker) => getFontPickerEls(picker).menu)) return;
  fontPickersPopulated = true;

  // 异步加载系统字体（若尚未加载，并发调用共享同一个 Promise）
  let fonts = getSystemFonts();
  if (!fonts || fonts.length === 0) {
    fonts = await loadSystemFonts();
    if (!fonts || fonts.length === 0) {
      fontPickersPopulated = false;
      return;
    }
  }

  FONT_PICKERS.forEach((picker) => {
    const { menu } = getFontPickerEls(picker);
    if (!menu) return;

    const currentValue = getFontPickerValue(picker);
    // 当前值已不在系统字体列表中时也保留一项，避免被静默重置
    const names = picker.allowEmpty ? [""] : [];
    for (const name of fonts) {
      if (name) names.push(name);
    }
    if (currentValue && !fonts.includes(currentValue)) names.push(currentValue);

    const fragment = document.createDocumentFragment();
    for (const name of names) {
      const option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.className = "font-picker-option";
      option.dataset.value = name;
      if (!name) {
        option.textContent = t(picker.emptyLabelKey);
      } else if (!fonts.includes(name)) {
        option.textContent = t("settings.options.font.missing").replace("{name}", name);
        option.dataset.missing = "true";
        option.style.fontFamily = `"${name}"`;
      } else {
        option.textContent = name;
        option.style.fontFamily = `"${name}"`;
      }
      fragment.appendChild(option);
    }

    menu.innerHTML = "";
    menu.appendChild(fragment);
  });

  syncFontPickers();
}
