// 显示通知
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

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

// 设置侧边栏切换
export function setupSidebar() {
  // 侧边栏切换
  document.querySelectorAll(".sidebar-item").forEach((item) => {
    item.addEventListener("click", function () {
      // 移除所有活动状态
      document
        .querySelectorAll(".sidebar-item")
        .forEach((i) => i.classList.remove("active"));
      // 添加当前活动状态
      this.classList.add("active");

      // 切换内容
      const title = this.textContent;
      document.querySelector(".section-title").textContent = title;

      // 隐藏所有内容
      document.getElementById("software-content").style.display = "none";
      document.getElementById("shortcuts-content").style.display = "none";
      document.getElementById("paste-content").style.display = "none";
      document.getElementById("copy-content").style.display = "none";
      document.getElementById("interface-content").style.display = "none";

      // 显示对应内容
      if (title === "软件设置") {
        document.getElementById("software-content").style.display = "block";
        import("./handlers.js").then(({updateSoftwareSettings}) => {
          updateSoftwareSettings();
        });
      } else if (title === "快捷键设置") {
        document.getElementById("shortcuts-content").style.display = "block";
        import("./shortcuts.js").then(({updateShortcutInputs}) => {
          updateShortcutInputs();
        });
      } else if (title === "粘贴设置") {
        document.getElementById("paste-content").style.display = "block";
        import("./handlers.js").then(({updatePasteSettings}) => {
          updatePasteSettings();
        });
      } else if (title === "复制设置") {
        document.getElementById("copy-content").style.display = "block";
        import("./handlers.js").then(({updateCopySettings}) => {
          updateCopySettings();
        });
      } else if (title === "界面设置") {
        document.getElementById("interface-content").style.display = "block";
        import("./handlers.js").then(({updateInterfaceSettings}) => {
          updateInterfaceSettings();
        });
      }
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
