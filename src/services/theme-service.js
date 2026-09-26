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
// 三种模式最终都会落到明确的 data-theme 上（system 解析为当前系统偏好），
// 这样 CSS 里只有 :root（浅色）与 [data-theme="dark"] 两份取值
export function applyTheme(mode) {
  const root = document.documentElement;
  currentThemeMode = mode || 'light';

  const resolved =
    currentThemeMode === 'system' ? getSystemTheme() : currentThemeMode;
  root.setAttribute('data-theme', resolved);

  // 主题换了，表面色随之改变，派生色要按新背景重新推导
  refreshDerivedColors();

  // 缓存模式供各窗口首帧同步应用（common/bootstrap.js）
  try {
    localStorage.setItem('snipjet.theme', currentThemeMode);
  } catch (e) {}

  console.log('主题已应用:', currentThemeMode, '->', resolved);
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

// 图片预览大小：百分比 0 ~ 100（0 表示不显示缩略图），步长 10
export const MIN_IMAGE_PREVIEW_SIZE = 0;
export const MAX_IMAGE_PREVIEW_SIZE = 100;
export const DEFAULT_IMAGE_PREVIEW_SIZE = 60;
// 旧版档位字符串到百分比的映射（历史设置迁移用）
const LEGACY_IMAGE_PREVIEW_SIZES = { large: 100, medium: 60, small: 30, none: 0 };

// 归一化图片预览大小：兼容旧档位字符串，超范围截断并对齐到 10
export function normalizeImagePreviewSize(value) {
  // 空值回落默认值（否则清空输入框会被当成 0 = 不显示）
  if (value === "" || value == null) return DEFAULT_IMAGE_PREVIEW_SIZE;
  if (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LEGACY_IMAGE_PREVIEW_SIZES, value)
  ) {
    return LEGACY_IMAGE_PREVIEW_SIZES[value];
  }
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_IMAGE_PREVIEW_SIZE;
  const clamped = Math.min(
    MAX_IMAGE_PREVIEW_SIZE,
    Math.max(MIN_IMAGE_PREVIEW_SIZE, size)
  );
  return Math.round(clamped / 10) * 10;
}

// 应用界面字体设置
// 按「主要字体 → 次要字体 → 系统默认栈」的顺序回退：浏览器逐字查找字形，
// 前面字体缺字形时自动使用后面的字体（次要字体为空表示不启用）。
// 两者都为空时还原回默认字体。
export function applyFontFamily(primary, secondary) {
  const root = document.documentElement;
  const families = [primary, secondary].filter((name) => name && name.length > 0);
  // 字体名加引号避免带空格的名称解析错误，末尾始终保留默认栈兜底
  const cssValue =
    families.length === 0
      ? DEFAULT_FONT
      : `${families.map((name) => `"${name}"`).join(', ')}, ${DEFAULT_FONT}`;
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
  // 文字/图标用的派生色要按新色相重新推导
  refreshDerivedColors();
  console.log('收藏主题色已应用:', hex);
}

// 主色实心块上的前景色候选：深色用与深色主题背景一致的墨蓝
const ON_COLOR_LIGHT = "#ffffff";
const ON_COLOR_DARK = "#0f172a";

// WCAG 相对亮度
function relativeLuminance(hex) {
  const channel = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 对比度
function contrastRatio(l1, l2) {
  const light = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return (light + 0.05) / (dark + 0.05);
}

// 由主色亮度推导前景色：取白与深色中对比度更高的一个，
// 保证用户把主题色调成浅色（如黄、青）时按钮文字依然可读
function pickOnPrimaryColor(hex) {
  const bg = relativeLuminance(hex);
  const white = contrastRatio(1, bg);
  const dark = contrastRatio(relativeLuminance(ON_COLOR_DARK), bg);
  return white >= dark ? ON_COLOR_LIGHT : ON_COLOR_DARK;
}

// 把两个 hex 按比例线性混合（t=0 取 hexA，t=1 取 hexB）
function mixHex(hexA, hexB, t) {
  const channel = (i, from, to) => {
    const v = parseInt(from.slice(i, i + 2), 16);
    const w = parseInt(to.slice(i, i + 2), 16);
    return Math.round(v + (w - v) * t)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1, hexA, hexB)}${channel(3, hexA, hexB)}${channel(5, hexA, hexB)}`;
}

// 推导「小尺寸文字/图标」用色：品牌色多偏亮，直接用作文字或图标时对比度不足
// （如 #eab308 白底仅 1.91:1），这里朝背景的反方向逐档混入黑/白，
// 取第一个达标的变体；最差也会混到纯黑/纯白，因此一定能收敛。
function pickReadableColor(hex, bgHex, minRatio = 4.5) {
  const isHex = (v) => /^#[0-9a-fA-F]{6}$/.test(v);
  if (!isHex(hex) || !isHex(bgHex)) return hex;

  const bg = relativeLuminance(bgHex);
  if (contrastRatio(relativeLuminance(hex), bg) >= minRatio) return hex;

  const towards = bg > 0.5 ? '#000000' : '#ffffff';
  for (let step = 1; step <= 20; step++) {
    const mixed = mixHex(hex, towards, step / 20);
    if (contrastRatio(relativeLuminance(mixed), bg) >= minRatio) return mixed;
  }
  return towards;
}

// 重新推导所有「品牌色 → 文字/图标色」的派生 token。
// 结果取决于当前主题的表面色（浅底要压暗、深底要提亮），
// 因此主题切换、以及用户改收藏色之后都要重新执行一次。
export function refreshDerivedColors() {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const surface = styles.getPropertyValue('--bg-surface').trim();
  const favorite = styles.getPropertyValue('--favorite-color').trim();
  root.style.setProperty('--favorite-text', pickReadableColor(favorite, surface));
  // 收藏色块上的前景色：随收藏色亮度变化重新选白/深
  root.style.setProperty('--on-favorite', pickOnPrimaryColor(favorite));
}

// 应用界面主题色（主色）
// 有效 hex 时覆盖 --primary-color、rgb 分量与推导出的前景色；
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
    root.style.setProperty('--on-primary', pickOnPrimaryColor(hex));
  } else {
    root.style.removeProperty('--primary-color');
    root.style.removeProperty('--primary-color-rgb');
    root.style.removeProperty('--on-primary');
  }
  console.log('界面主题色已应用:', hex || '跟随主题默认');
}

// 获取当前生效的界面主题色（设置页颜色控件回显用）：
// 未自定义时返回当前主题的默认主色
export function getEffectivePrimaryColor() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--primary-color')
    .trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#2563eb';
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

// 动效档位：每秒内的"动作结束感"。
// off    → 0ms（CSS animation 关闭，所有动效直接显示末态）
// fast   → 240ms（默认，比原 480ms 缩短一半）
// normal → 480ms（保留原节奏，给偏好"慢一点的反馈"的用户留档）
export const ANIMATION_SPEEDS = ["off", "fast", "normal"];
const ANIMATION_DURATIONS_MS = { off: 0, fast: 240, normal: 480 };
export const DEFAULT_ANIMATION_SPEED = "fast";

// 归一化动效档位：非法值回落默认 "fast"
export function normalizeAnimationSpeed(value) {
  return ANIMATION_SPEEDS.includes(value) ? value : DEFAULT_ANIMATION_SPEED;
}

// 删除动效节奏：基准时长去掉一些"padding"——按经验，比起反馈型动效更短
// 让用户眼里删除动效"几乎发生，但能看见"；fast 档最终落到 100ms 左右
function removeDurationMs(speed) {
  const ms = ANIMATION_DURATIONS_MS[speed] ?? 0;
  if (ms === 0) return 0;
  // 240 → 100；480 → 200。比简单除以 2 略短，避免 off 之外仍显拖沓
  return Math.round((ms * 5) / 12);
}

// 当前窗口下卡片动效的"主时长"（ms），主窗口下的所有动效节奏以它为准。
// 各调用方在挂 is-just-* 类前调它，以决定关键帧时长 + class 移除延迟。
export function getAnimationDurationMs() {
  const speed = normalizeAnimationSpeed(
    localStorage.getItem("snipjet.animation_speed")
  );
  return ANIMATION_DURATIONS_MS[speed];
}

// 删除路径专用的快节奏（基准时长的一半；off 仍返回 0）
export function getRemoveAnimationDurationMs() {
  const speed = normalizeAnimationSpeed(
    localStorage.getItem("snipjet.animation_speed")
  );
  return removeDurationMs(speed);
}

// 应用卡片动效档位：往 :root 写两个 CSS 时间 token + 一个属性。
//   --anim-duration-ms：粘贴 / 收藏等基准时长（CSS <time>）
//   --anim-duration-ms-remove：删除专用，为基准的一半
//   data-anim-disabled="true|false"：属性选择器驱动 CSS 短路动效
// 关闭时仍写入 0s，使 CSS animation declaration 不被解析丢弃；
// JS 走"无 setTimeout"分支保证 splice / class 移除立即执行。
export function applyAnimationSpeed(speed) {
  const norm = normalizeAnimationSpeed(speed);
  const root = document.documentElement;
  const ms = ANIMATION_DURATIONS_MS[norm];
  const removeMs = removeDurationMs(norm);
  // CSS 时间值必须有单位：写 "240ms" 而不是 240；off 也要写 "0s"
  root.style.setProperty("--anim-duration-ms", ms > 0 ? `${ms}ms` : "0s");
  root.style.setProperty(
    "--anim-duration-ms-remove",
    removeMs > 0 ? `${removeMs}ms` : "0s"
  );
  root.dataset.animDisabled = norm === "off" ? "true" : "false";
  try {
    localStorage.setItem("snipjet.animation_speed", norm);
  } catch (e) {}
  console.log("动效档位已应用:", norm, "基准:", ms, "ms", "删除:", removeMs, "ms");
}

// 应用所有界面设置
export function applyInterfaceSettings(interfaceSettings) {
  if (!interfaceSettings) return;

  if (interfaceSettings.theme) {
    applyTheme(interfaceSettings.theme);
  }
  // 缩放字段始终应用，确保字段缺失/清空时能回落到 1（不缩放）
  applyZoomLevel(interfaceSettings.zoom_level);
  // 字体字段始终应用，确保清空（主要字体回落系统默认、次要字体不启用）后能正确还原
  applyFontFamily(
    interfaceSettings.font_family,
    interfaceSettings.font_family_secondary
  );
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
  // 卡片动效档位：始终应用，缺失字段回落默认 fast
  applyAnimationSpeed(interfaceSettings.animation_speed);
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
  mediaQuery.addEventListener('change', () => {
    if (currentThemeMode === 'system') {
      // system 模式下把系统偏好解析成明确的 data-theme（顺带刷新派生色）
      applyTheme(currentThemeMode);
    }
  });

  return settings?.interface?.theme || 'light';
}

// 获取当前主题模式
export function getCurrentThemeMode() {
  return currentThemeMode;
}
