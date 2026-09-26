// handlers.js 的引用可以缓存，避免重复 import
import { t } from "../../utils/i18n.js";

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

    // 更新快捷粘贴修饰键（下拉框不含「无」项，「未设置」由重置键清除得到）
    const quickModeSelect = document.getElementById("quick-paste-mode");
    if (quickModeSelect) {
      const mode = settings.shortcuts?.quick_paste_mode || "ctrl";
      if (["ctrl", "num"].includes(mode)) {
        quickModeSelect.value = mode;
        quickModeSelect.classList.remove("is-unset");
      } else {
        // 「未设置」是禁用的首项，按下标选中以保证回显
        quickModeSelect.selectedIndex = 0;
        quickModeSelect.classList.add("is-unset");
      }
    }

    // 更新候选粘贴快捷键
    const rotatingInput = document.getElementById("rotating-paste");
    if (rotatingInput) {
      rotatingInput.value = settings.shortcuts?.rotating_paste || "";
    }

    // 回显重置键的可用状态
    syncShortcutResetButtons();
  });
}

// 回显重置键可用状态：值已为空（下拉框为无选中项）时置灰
function syncShortcutResetButtons() {
  document.querySelectorAll(".reset-btn[data-clear-for]").forEach((btn) => {
    const target = document.getElementById(btn.dataset.clearFor);
    if (target) btn.disabled = !target.value;
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
      if (currentInput) currentInput.placeholder = t("settings.shortcuts.placeholderIdle");

      currentInput = this;
      this.value = ""; // 录制时清空当前值
      this.placeholder = t("settings.shortcuts.placeholderRecording");
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
          this.placeholder = t("settings.shortcuts.placeholderIdle");
          this.classList.remove("recording");
          syncShortcutResetButtons();
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
          showNotification(t("settings.shortcuts.toastOccupied"));
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

  // 快捷粘贴修饰键的变化监听
  const quickPasteSelect = document.getElementById("quick-paste-mode");
  quickPasteSelect?.addEventListener("change", async function () {
    const {settings} = await getHandlers();
    if (!settings.shortcuts) settings.shortcuts = {};
    settings.shortcuts.quick_paste_mode = this.value;
    console.log("快捷粘贴模式已更新到内存:", this.value);
    this.classList.remove("is-unset");
    syncShortcutResetButtons();
  });

  // 重置键：data-clear-for 指向要清空的控件 id（快捷键输入框 / 快捷粘贴修饰键下拉框）
  document.querySelectorAll(".reset-btn[data-clear-for]").forEach((btn) => {
    btn.addEventListener("click", () => {
      clearShortcut(btn.dataset.clearFor);
    });
  });
}

// 重置快捷键（只更新内存，不保存文件）
// 下拉框（快捷粘贴修饰键）以 "none" 表示禁用
export async function clearShortcut(controlId) {
  const control = document.getElementById(controlId);
  if (!control) return;

  const isSelect = control.tagName === "SELECT";
  if (isSelect) {
    // 第 0 项是「未设置」回显项，选中它即显示为未设置
    control.selectedIndex = 0;
    control.classList.add("is-unset");
  } else {
    control.value = "";
  }

  // 更新设置对象
  try {
    const {settings} = await getHandlers();
    // 将短横线格式的ID转换为下划线格式的key
    const key = controlId.replace(/-/g, "_");
    if (!settings.shortcuts) settings.shortcuts = {};
    settings.shortcuts[key] = isSelect ? "none" : "";
    console.log("快捷键已重置:", key);
  } catch (error) {
    console.error("重置快捷键时出错:", error);
  }

  syncShortcutResetButtons();
}
