// 主题服务 - 管理应用主题设置
import * as fs from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

// 主题模式: light, dark, system
let currentThemeMode = 'light';

// 系统默认字体族（无枚举结果时兜底）
const DEFAULT_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

// 系统已安装字体缓存（启动时一次性加载）
let systemFontsCache = [];
// 进行中的加载 Promise（防止并发调用重复触发后端枚举）
let systemFontsLoading = null;

// 获取系统主题偏好
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// 应用主题到页面
export function applyTheme(mode) {
  const root = document.documentElement;
  currentThemeMode = mode || 'light';

  // 移除所有主题属性
  root.removeAttribute('data-theme');

  if (currentThemeMode === 'dark') {
    root.setAttribute('data-theme', 'dark');
  } else if (currentThemeMode === 'light') {
    root.setAttribute('data-theme', 'light');
  }
  // system 模式不设置 data-theme，让 CSS 媒体查询自动处理

  console.log('主题已应用:', currentThemeMode);
}

// 应用字号设置
export function applyFontSize(fontSize) {
  const root = document.documentElement;
  const size = fontSize || 14;
  root.style.setProperty('--font-size-base', `${size}px`);
  try {
    localStorage.setItem('snipjet.font_size', String(size));
  } catch (e) {}
  console.log('字号已应用:', size);
}

// 应用界面字体设置
// 接受 undefined / 空串时还原回默认字体
export function applyFontFamily(fontFamily) {
  const root = document.documentElement;
  const family = fontFamily && fontFamily.length > 0 ? fontFamily : DEFAULT_FONT;
  // 加引号避免带空格的字体名解析错误
  const cssValue = family.includes(',') || family.includes('"') || family.includes("'")
    ? family
    : `"${family}", ${DEFAULT_FONT}`;
  root.style.setProperty('--font-family', cssValue);
  // 同时设置 document.body 的字体，使字体立即生效
  document.body.style.fontFamily = cssValue;
  // 同步写入 localStorage，供其它窗口（如设置窗口）在首帧渲染前读取，
  // 避免新窗口先按默认字体渲染再切换导致的抖动
  try {
    localStorage.setItem('snipjet.font_family', cssValue);
  } catch (e) {}
  console.log('界面字体已应用:', cssValue);
}

// 从后端读取系统字体（结果进程内缓存，并发调用共享同一个 Promise）
export async function loadSystemFonts() {
  if (systemFontsCache.length > 0) {
    return systemFontsCache;
  }
  if (systemFontsLoading) {
    return systemFontsLoading;
  }
  systemFontsLoading = (async () => {
    try {
      const fonts = await invoke('list_system_fonts');
      if (Array.isArray(fonts) && fonts.length > 0) {
        systemFontsCache = fonts;
        console.log(`系统字体已读取，共 ${fonts.length} 个`);
      }
    } catch (e) {
      console.warn('读取系统字体失败:', e);
      systemFontsCache = [];
    } finally {
      systemFontsLoading = null;
    }
    return systemFontsCache;
  })();
  return systemFontsLoading;
}

// 获取缓存的系统字体列表（前端选择控件使用）
export function getSystemFonts() {
  return systemFontsCache;
}

// 应用预览行数设置
export function applyPreviewLines(lines) {
  const root = document.documentElement;
  const previewLines = lines || 5;
  root.style.setProperty('--preview-lines', previewLines);
  console.log('预览行数已应用:', previewLines);
}

// 应用所有界面设置
export function applyInterfaceSettings(interfaceSettings) {
  if (!interfaceSettings) return;

  if (interfaceSettings.theme) {
    applyTheme(interfaceSettings.theme);
  }
  // 字体字段始终应用，确保切回默认（空串）时能正确还原
  applyFontFamily(interfaceSettings.font_family);
  if (interfaceSettings.font_size) {
    applyFontSize(interfaceSettings.font_size);
  }
  if (interfaceSettings.preview_lines) {
    applyPreviewLines(interfaceSettings.preview_lines);
  }
}

// 从设置文件加载完整设置
async function loadSettings() {
  try {
    if (await fs.exists('settings.json', { baseDir: fs.BaseDirectory.AppConfig })) {
      const content = await fs.readTextFile('settings.json', {
        baseDir: fs.BaseDirectory.AppConfig,
      });
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('加载设置失败:', error);
  }
  return null;
}

// 初始化主题和界面设置（加载并应用）
export async function initTheme() {
  const settings = await loadSettings();

  if (settings?.interface) {
    applyInterfaceSettings(settings.interface);
  } else {
    // 应用默认值
    applyTheme('light');
    applyFontSize(14);
    applyPreviewLines(5);
  }

  // 监听系统主题变化（仅在 system 模式下生效）
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    if (currentThemeMode === 'system') {
      // system 模式下，移除 data-theme 让媒体查询自动处理
      document.documentElement.removeAttribute('data-theme');
    }
  });

  return settings?.interface?.theme || 'light';
}

// 获取当前主题模式
export function getCurrentThemeMode() {
  return currentThemeMode;
}
