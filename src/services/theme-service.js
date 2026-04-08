// 主题服务 - 管理应用主题设置
import * as fs from '@tauri-apps/plugin-fs';

// 主题模式: light, dark, system
let currentThemeMode = 'light';

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
  console.log('字号已应用:', size);
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
