// 设置服务

// 加载设置文件
async function loadSettings() {
  try {
    if (window.__TAURI__ && window.__TAURI__.fs) {
      const {readTextFile, exists, BaseDirectory} = window.__TAURI__.fs;

      // 检查设置文件是否存在
      if (await exists("settings.json", {baseDir: BaseDirectory.AppConfig})) {
        // 从应用配置目录加载设置文件
        const content = await readTextFile("settings.json", {
          baseDir: BaseDirectory.AppConfig,
        });
        return JSON.parse(content);
      }
    } else {
      // 在非Tauri环境中，尝试从前端目录加载
      const response = await fetch("/config/settings.json");
      if (response.ok) {
        return await response.json();
      }
    }
  } catch (error) {
    console.error("加载设置失败:", error);
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

export {
  loadSettings,
};