// 显示通知
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { t } from "../../utils/i18n.js";

export function showNotification(message) {
  // 创建通知元素
  const notification = document.createElement("div");
  notification.className = "save-notification";
  notification.textContent = message;

  // 添加到页面
  document.body.appendChild(notification);

  // 2秒后移除
  setTimeout(() => {
    notification.remove();
  }, 2000);
}

// 关闭窗口
export async function closeWindow() {
  try {
    // 使用正确的 Tauri API 关闭窗口
    const appWindow = getCurrentWebviewWindow();
    await appWindow.close();
  } catch (error) {
    // 忽略错误，因为在沙箱环境中可能会受限
  }
}

// 确认保存并关闭
export async function confirmAndClose() {
  try {
    // 保存设置
    const { saveSettings } = await import("./handlers.js");
    await saveSettings();

    // 关闭窗口
    await closeWindow();
  } catch (error) {
    console.error("保存设置失败:", error);
  }
}

// 取消并关闭（恢复原始设置）
export async function cancelAndClose() {
  try {
    // 恢复原始设置
    const { restoreOriginalSettings } = await import("./handlers.js");
    await restoreOriginalSettings();

    // 关闭窗口
    await closeWindow();
  } catch (error) {
    console.error("取消操作失败:", error);
  }
}

// 侧边栏分区：分区标识 -> { 内容容器 id, 进入分区时刷新控件状态 }
// 标识取自 HTML 中 .sidebar-item 的 data-section（与界面语言无关，翻译后查表依然有效）
const SECTIONS = {
  general: {
    content: "general-content",
    reload: () =>
      import("./handlers.js").then(({ updateGeneralSettings }) =>
        updateGeneralSettings()
      ),
  },
  appearance: {
    content: "appearance-content",
    reload: () =>
      import("./handlers.js").then(({ updateAppearanceSettings }) =>
        updateAppearanceSettings()
      ),
  },
  shortcuts: {
    content: "shortcuts-content",
    reload: () =>
      import("./shortcuts.js").then(({ updateShortcutInputs }) =>
        updateShortcutInputs()
      ),
  },
  clipboard: {
    content: "clipboard-content",
    reload: () =>
      import("./handlers.js").then(({ updateClipboardSettings }) =>
        updateClipboardSettings()
      ),
  },
  history: {
    content: "history-content",
    reload: () =>
      import("./handlers.js").then(({ updateHistorySettings }) =>
        updateHistorySettings()
      ),
  },
  advanced: {
    content: "advanced-content",
    reload: () =>
      import("./handlers.js").then(({ updateAdvancedSettings }) =>
        updateAdvancedSettings()
      ),
  },
};

// 刷新顶部分区标题：标题文案按当前语言从 i18n 取，分区标识默认取当前激活项
export function updateSectionTitle(sectionKey) {
  const key =
    sectionKey ||
    document.querySelector(".sidebar-item.active")?.dataset.section ||
    "general";
  const title = document.querySelector(".section-title");
  if (title) {
    title.textContent = t(`settings.section.${key}`);
  }
}

// 设置侧边栏切换
export function setupSidebar() {
  // 侧边栏切换
  document.querySelectorAll(".sidebar-item").forEach((item) => {
    item.addEventListener("click", function () {
      // 用 data-section 标识查表（原先用中文标题查表，切换语言后会失效）
      const key = this.dataset.section;
      const section = SECTIONS[key];
      if (!section) return;

      // 移除所有活动状态
      document
        .querySelectorAll(".sidebar-item")
        .forEach((i) => {
          i.classList.remove("active");
          i.removeAttribute("aria-current");
        });
      // 添加当前活动状态
      this.classList.add("active");
      this.setAttribute("aria-current", "true");

      // 更新标题
      updateSectionTitle(key);

      // 隐藏所有内容，显示当前分区
      Object.values(SECTIONS).forEach(({ content }) => {
        document.getElementById(content).classList.remove("active");
      });
      document.getElementById(section.content).classList.add("active");

      // 刷新该分区的控件状态
      section.reload();
    });
  });
}

// 绑定关闭按钮事件
export function setupCloseButton() {
  // 为关闭按钮添加事件监听器
  const closeButton = document.getElementById("close-button");
  if (closeButton) {
    closeButton.addEventListener("click", async function () {
      // 关闭时不保存，直接关闭
      await closeWindow();
    });
  }
}

// 绑定确定/取消按钮事件
export function setupConfirmCancelButtons() {
  const confirmBtn = document.getElementById("confirm-btn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async function () {
      await confirmAndClose();
    });
  }

  const cancelBtn = document.getElementById("cancel-btn");
  if (cancelBtn) {
    cancelBtn.addEventListener("click", async function () {
      await cancelAndClose();
    });
  }
}

// 绑定ESC键事件
export function setupEscKey() {
  // 监听 ESC 键执行取消操作
  window.addEventListener("keydown", async function (event) {
    if (event.key === "Escape") {
      await cancelAndClose();
    }
  });
}
