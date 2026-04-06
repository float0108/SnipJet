// handlers.js 的引用可以缓存，避免重复 import
let settingsModule = null;
async function getHandlers() {
  if (!settingsModule) settingsModule = await import("./handlers.js");
  return settingsModule;
}

let currentInput = null;

// 更新快捷键输入框
export function updateShortcutInputs() {
  import("./handlers.js").then(({settings}) => {
    console.log("更新快捷键输入框，当前设置:", settings.shortcuts);

    // 更新显示/隐藏界面快捷键
    const toggleInput = document.getElementById("toggle-interface");
    if (toggleInput) {
      toggleInput.value = settings.shortcuts?.toggle_interface || "";
    }

    // 更新功能粘贴快捷键
    const functionInput = document.getElementById("function-paste");
    if (functionInput) {
      functionInput.value = settings.shortcuts?.function_paste || "";
    }

    // 更新快捷粘贴快捷键模式
    const quickModeSelect = document.getElementById("quick-paste-mode");
    if (quickModeSelect) {
      quickModeSelect.value = settings.shortcuts?.quick_paste_mode || "ctrl";
    }
  });
}

// 初始化快捷键事件
export function initShortcuts() {
  const inputs = document.querySelectorAll(".shortcut-input");

  inputs.forEach((input) => {
    // 1. 点击进入录制模式
    input.addEventListener("click", function () {
      // 如果点击的是已经在录制的，不做处理
      if (currentInput === this) return;

      // 重置之前的输入框状态
      if (currentInput) currentInput.placeholder = "按下快捷键...";

      currentInput = this;
      this.value = ""; // 录制时清空当前值
      this.placeholder = "请录制组合键...";
      this.classList.add("recording"); // 建议增加 CSS 样式反馈
    });

    // 2. 失去焦点自动重置 (解决 Ghost Recording 问题)
    input.addEventListener("blur", function () {
      if (currentInput === this) {
        currentInput = null;
        // 如果没输入值，恢复原样
        import("./handlers.js").then(({settings}) => {
          // 将短横线格式的ID转换为下划线格式的key
          const key = this.id.replace(/-/g, "_");
          this.value = settings.shortcuts?.[key] || "";
          this.placeholder = "按下快捷键...";
          this.classList.remove("recording");
        });
      }
    });
  });

  document.addEventListener("keydown", async function (e) {
    if (!currentInput) return;

    // 屏蔽系统默认行为（如 F11 全屏, Ctrl+S 保存）
    e.preventDefault();

    // 处理取消录制
    if (e.key === "Escape") {
      currentInput.blur();
      return;
    }

    const modifiers = [];
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");
    if (e.metaKey) modifiers.push("Command"); // 兼容 Mac

    // 检查按键是否为功能键（非修饰键）
    const key = e.key;
    const isModifier = ["Control", "Alt", "Shift", "Meta"].includes(key);

    // 只有按下非修饰键时才触发保存
    if (!isModifier) {
      let keyName = key.toUpperCase();

      // 特殊键名美化
      if (key === " ") keyName = "Space";
      if (key === "Enter") keyName = "Enter";
      if (e.key === "Escape") keyName = "Esc";
      if (key === "Tab") keyName = "Tab";
      if (key.startsWith("Arrow")) keyName = key.replace("Arrow", "");

      const finalShortcut = [...modifiers, keyName].join("+");

      // 防重检查
      const {settings} = await getHandlers();

      // 确保 shortcuts 对象存在
      if (!settings.shortcuts) settings.shortcuts = {};

      let isDuplicate = false;
      for (const [func, shortcut] of Object.entries(settings.shortcuts)) {
        if (
          func !== currentInput.id.replace(/-/g, "_") &&
          shortcut === finalShortcut
        ) {
          isDuplicate = true;
          break;
        }
      }

      if (isDuplicate) {
        // 显示重复提示
        import("./ui.js").then(({showNotification}) => {
          showNotification("该快捷键已被占用");
        });
        currentInput.blur();
        return;
      }

      // 更新 UI
      const inputElement = currentInput;
      inputElement.value = finalShortcut;

      // 更新设置对象（只更新内存，不保存文件）
      const configKey = inputElement.id.replace(/-/g, "_");
      settings.shortcuts[configKey] = finalShortcut;

      console.log("快捷键已更新到内存:", configKey, "=", finalShortcut);

      // 录制完成，解除锁定
      inputElement.blur();
    }
  });

  // 快捷粘贴模式的变化监听
  const quickPasteSelect = document.getElementById("quick-paste-mode");
  quickPasteSelect?.addEventListener("change", async function () {
    const {settings} = await getHandlers();
    if (!settings.shortcuts) settings.shortcuts = {};
    settings.shortcuts.quick_paste_mode = this.value;
    console.log("快捷粘贴模式已更新到内存:", this.value);
  });
}

// 清空快捷键（只更新内存，不保存文件）
export async function clearShortcut(inputId) {
  const input = document.getElementById(inputId);
  input.value = "";

  // 更新设置对象
  try {
    const {settings} = await import("./handlers.js");
    // 将短横线格式的ID转换为下划线格式的key
    const key = inputId.replace(/-/g, "_");
    if (!settings.shortcuts) settings.shortcuts = {};
    settings.shortcuts[key] = "";
    console.log("快捷键已清空:", key);
  } catch (error) {
    console.error("清空快捷键时出错:", error);
  }
}
