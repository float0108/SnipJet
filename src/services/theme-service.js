// 主题服务 - 管理应用主题设置
import * as fs from '@tauri-apps/plugin-fs';

// 默认主题设置
const defaultThemeSettings = {
  mode: "light",
  primary_color: "#3b82f6",
  background_color: "#ffffff",
  text_color: "#1e293b",
  font_size: "14",
};

// 加载主题设置
export async function loadThemeSettings() {
  try {
    if (await fs.exists("settings.json", { baseDir: fs.BaseDirectory.AppConfig })) {
      const content = await fs.readTextFile("settings.json", {
        baseDir: fs.BaseDirectory.AppConfig,
      });
      const settings = JSON.parse(content);
      return settings.theme || defaultThemeSettings;
    }
  } catch (error) {
    console.error("加载主题设置失败:", error);
  }
  return defaultThemeSettings;
}

// 应用主题到页面
export function applyTheme(themeSettings) {
  const root = document.documentElement;
  const settings = themeSettings || defaultThemeSettings;

  // 应用主题模式
  const mode = settings.mode || "light";
  if (mode === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }

  // 应用自定义颜色
  if (settings.primary_color) {
    root.style.setProperty("--primary-color", settings.primary_color);
  }

  if (settings.background_color) {
    root.style.setProperty("--bg-surface", settings.background_color);
    root.style.setProperty("--bg-body", settings.background_color);
  }

  if (settings.text_color) {
    root.style.setProperty("--text-primary", settings.text_color);
  }

  // 应用字体大小
  if (settings.font_size) {
    root.style.setProperty("font-size", settings.font_size + "px");
  }

  console.log("主题已应用:", settings);
}

// 初始化主题（加载并应用）
export async function initTheme() {
  const settings = await loadThemeSettings();
  applyTheme(settings);
  return settings;
}
