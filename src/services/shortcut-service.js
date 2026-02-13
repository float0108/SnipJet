// 快捷键服务

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
      toggle_interface: "Win+V",
      function_paste: "",
      quick_paste_mode: "ctrl",
    },
  };
}

// 解析快捷键字符串为键组合对象
function parseShortcut(shortcut) {
  if (!shortcut) return null;

  const parts = shortcut.split("+");
  const key = parts.pop();

  return {
    ctrl: parts.includes("Ctrl"),
    alt: parts.includes("Alt"),
    shift: parts.includes("Shift"),
    meta: parts.includes("Command"),
    key: key.toLowerCase(),
  };
}

// 检查键盘事件是否匹配快捷键
function isShortcutMatch(event, shortcut) {
  if (!shortcut) return false;

  const parsedShortcut = parseShortcut(shortcut);
  if (!parsedShortcut) return false;

  return (
    event.ctrlKey === parsedShortcut.ctrl &&
    event.altKey === parsedShortcut.alt &&
    event.shiftKey === parsedShortcut.shift &&
    event.metaKey === parsedShortcut.meta &&
    event.key.toLowerCase() === parsedShortcut.key
  );
}

// 切换窗口可见性
async function toggleWindowVisibility() {
  try {
    // 调用后端 print_message 接口，打印快捷键触发信息
    if (window.__TAURI__ && window.__TAURI__.invoke) {
      await window.__TAURI__.invoke("print_message", {
        message: "快捷键触发：切换窗口可见性",
      });
      console.log("后端打印命令执行成功");
    }

    if (
      window.__TAURI__ &&
      window.__TAURI__.window &&
      window.__TAURI__.window.getCurrentWindow
    ) {
      const appWindow = window.__TAURI__.window.getCurrentWindow();

      // 检查窗口是否可见
      const isVisible = await appWindow.isVisible();

      if (isVisible) {
        await appWindow.hide();
        console.log("窗口已隐藏");
      } else {
        await appWindow.show();
        await appWindow.setFocus();
        console.log("窗口已显示并获得焦点");
      }
    }
  } catch (error) {
    console.error("切换窗口可见性失败:", error);
  }
}

// 初始化全局快捷键监听
async function initGlobalShortcuts() {
  try {
    const settings = await loadSettings();
    const toggleShortcut = settings.shortcuts?.toggle_interface || "Ctrl+Shift+V";

    console.log("初始化全局快捷键监听，切换界面快捷键:", toggleShortcut);

    // 监听全局键盘事件
    document.addEventListener("keydown", async function (event) {
      // 检查是否匹配切换界面快捷键
      if (isShortcutMatch(event, toggleShortcut)) {
        event.preventDefault();
        event.stopPropagation();

        console.log("触发切换界面快捷键");
        await toggleWindowVisibility();
      }
    });

    console.log("全局快捷键监听初始化完成");
  } catch (error) {
    console.error("初始化全局快捷键监听失败:", error);
  }
}

export {
  loadSettings,
  parseShortcut,
  isShortcutMatch,
  initGlobalShortcuts,
  toggleWindowVisibility,
};