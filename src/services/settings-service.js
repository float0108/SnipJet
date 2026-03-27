// 设置服务
import * as fs from '@tauri-apps/plugin-fs';

// 加载设置文件
async function loadSettings() {
  try {
    // 检查设置文件是否存在
    if (await fs.exists("settings.json", { baseDir: fs.BaseDirectory.AppConfig })) {
      // 从应用配置目录加载设置文件
      const content = await fs.readTextFile("settings.json", {
        baseDir: fs.BaseDirectory.AppConfig,
      });
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("加载设置失败:", error);
  }

  // 尝试从前端目录加载 (非Tauri环境或文件不存在时)
  try {
    const response = await fetch("/config/settings.json");
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    // 忽略错误
  }

  // 返回默认设置
  return {
    shortcuts: {
      toggle_interface: "Ctrl+Shift+V",
      function_paste: "",
      quick_paste_mode: "ctrl",
    },
  };
}

export { loadSettings };
