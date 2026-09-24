// 主题服务 - 管理应用主题设置
import * as fs from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';

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

// 收藏主题色默认值（琥珀黄）
const DEFAULT_FAVORITE_COLOR = "#eab308";

// 应用收藏主题色
// 同时写入 hex 与 rgb 分量两个变量，便于 CSS 中做透明度混合
export function applyFavoriteColor(color) {
  const root = document.documentElement;
  const hex = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : DEFAULT_FAVORITE_COLOR;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  root.style.setProperty('--favorite-color', hex);
  root.style.setProperty('--favorite-color-rgb', `${r}, ${g}, ${b}`);
  console.log('收藏主题色已应用:', hex);
}

// 应用界面主题色（主色）
// 有效 hex 时覆盖 --primary-color 与 rgb 分量；
// 空值/非法值时移除覆盖，回落到各主题在 CSS 中定义的默认主色
export function applyPrimaryColor(color) {
  const root = document.documentElement;
  const hex = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color.toLowerCase() : "";
  if (hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    root.style.setProperty('--primary-color', hex);
    root.style.setProperty('--primary-color-rgb', `${r}, ${g}, ${b}`);
  } else {
    root.style.removeProperty('--primary-color');
    root.style.removeProperty('--primary-color-rgb');
  }
  console.log('界面主题色已应用:', hex || '跟随主题默认');
}

// 获取当前生效的界面主题色（设置页颜色控件回显用）：
// 未自定义时返回当前主题的默认主色
export function getEffectivePrimaryColor() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--primary-color')
    .trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#3b82f6';
}

// 应用预览行数设置：最新条目与历史条目分开控制
export function applyPreviewLines({ latest, history } = {}) {
  const root = document.documentElement;
  root.style.setProperty('--latest-preview-lines', latest || 5);
  root.style.setProperty('--history-preview-lines', history || 1);
  console.log('预览行数已应用:', { latest, history });
}

// 界面缩放范围（Windows WebView2 的 ZoomFactor 支持 0.25 ~ 5）
const MIN_ZOOM_LEVEL = 0.5;
const MAX_ZOOM_LEVEL = 2;

// 归一化缩放系数：非法值回落到 1，限制在合理区间并保留两位小数
export function normalizeZoomLevel(zoomLevel) {
  const value = Number(zoomLevel);
  if (!Number.isFinite(value) || value <= 0) return 1;
  const clamped = Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, value));
  return Math.round(clamped * 100) / 100;
}

// 应用界面缩放：对当前窗口整体 UI 等比缩放（窗口物理尺寸不变）
// 使用 WebView 原生缩放，等价于浏览器 Ctrl+滚轮；系数写入 localStorage，
// 供各窗口首帧渲染前同步应用，避免加载后跳变
export function applyZoomLevel(zoomLevel) {
  const zoom = normalizeZoomLevel(zoomLevel);
  try {
    localStorage.setItem('snipjet.zoom_level', String(zoom));
  } catch (e) {}
  try {
    getCurrentWebview().setZoom(zoom).catch(() => {});
  } catch (e) {
    // 非 Tauri 环境（如浏览器预览）下忽略
  }
  console.log('界面缩放已应用:', zoom);
}

// 应用所有界面设置
export function applyInterfaceSettings(interfaceSettings) {
  if (!interfaceSettings) return;

  if (interfaceSettings.theme) {
    applyTheme(interfaceSettings.theme);
  }
  // 缩放字段始终应用，确保字段缺失/清空时能回落到 1（不缩放）
  applyZoomLevel(interfaceSettings.zoom_level);
  // 字体字段始终应用，确保切回默认（空串）时能正确还原
  applyFontFamily(interfaceSettings.font_family);
  if (interfaceSettings.font_size) {
    applyFontSize(interfaceSettings.font_size);
  }
  // 预览行数：latest 兜底旧版单一 preview_lines，避免升级后设置被重置
  applyPreviewLines({
    latest:
      interfaceSettings.latest_preview_lines ?? interfaceSettings.preview_lines,
    history: interfaceSettings.history_preview_lines,
  });
  // 收藏主题色始终应用，确保字段缺失/清空时能回落到默认色
  applyFavoriteColor(interfaceSettings.favorite_color);
  // 界面主题色始终应用，确保字段缺失/清空时能回落到主题默认色
  applyPrimaryColor(interfaceSettings.primary_color);
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
    applyPreviewLines({ latest: 5, history: 1 });
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
