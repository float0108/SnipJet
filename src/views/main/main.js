// 前端应用主入口

import {listen, invoke} from "../../services/tauri-api.js";
import {openReaderWindow} from "../../services/window-service.js";
import {initGlobalShortcuts, handlePasteAftermath} from "../../services/shortcut-service.js";
import {
  updateStatus,
  loadRealData,
  listenToClipboardUpdate,
} from "../../services/clipboard-service.js";
import {html2text} from "../../utils/formatter.js";
import {initTitlebarButtons, pinState} from "./titlebar.js";
import {handleNavigation} from "./navigation.js";
import {
  renderEmptyState,
  ensureEmptyStateStyles,
} from "../../components/empty-state/empty-state.js";
import {log, debug, error, event} from "../../utils/logger.js";

// 确保函数被暴露到全局作用域
if (typeof window !== "undefined") {
  window.openReaderWindow = openReaderWindow;

  // 复制到剪贴板
  window.copyToClipboard = async function (element) {
    try {
      const content = element.getAttribute("data-content");
      const format = element.getAttribute("data-format");
      if (content) {
        if (invoke) {
          try {
            // 使用后端命令复制，避免触发历史更新
            await invoke("copy_to_clipboard_no_history", {
              content: decodeURIComponent(content),
              format: format,
            });
            await log("内容已复制到剪贴板（无历史更新）");
          } catch (e) {
            await error("后端调用失败:", e);
            // 后端API调用失败，使用前端fallback
            await navigator.clipboard.writeText(decodeURIComponent(content));
            await log("内容已复制到剪贴板（前端fallback）");
          }
        } else {
          // 后端API不可用，使用前端fallback
          await navigator.clipboard.writeText(decodeURIComponent(content));
          await log("内容已复制到剪贴板（前端fallback）");
        }
      }
    } catch (error) {
      await error("复制失败:", error);
    }
  };

  // 模拟粘贴到当前窗口
  window.pasteToCurrentWindow = async function (element) {
    try {
      const content = element.getAttribute("data-content");
      const format = element.getAttribute("data-format");
      if (content) {
        // 先复制到剪贴板，使用后端命令避免触发历史更新
        if (invoke) {
          try {
            await invoke("copy_to_clipboard_no_history", {
              content: decodeURIComponent(content),
              format: format,
            });
            await log("内容已复制到剪贴板（无历史更新），准备模拟粘贴");
          } catch (e) {
            await error("后端复制命令执行失败:", e);
            // 后端API不可用，使用前端fallback
            await navigator.clipboard.writeText(decodeURIComponent(content));
            await log("内容已复制到剪贴板（前端fallback），准备模拟粘贴");
          }

          // 尝试使用后端的paste_to_active_window命令
          try {
            await log("调用后端粘贴命令...");
            await invoke("paste_to_active_window", {
              content: decodeURIComponent(content),
              format: format,
              isPinned: pinState.isPinned, // 使用当前 pin 状态
            });
            await log("后端粘贴命令执行成功");
          } catch (tauriError) {
            await error("后端粘贴命令执行失败:", tauriError);
            // 后端命令失败，使用前端模拟作为 fallback
          }
        } else {
          // 后端API不可用，使用前端fallback
          await navigator.clipboard.writeText(decodeURIComponent(content));
          await log("内容已复制到剪贴板（前端fallback），准备模拟粘贴");
        }

        // 前端模拟作为 fallback
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const modifierKey = isMac ? "Meta" : "Control";

        // 创建键盘事件
        const pasteEvent = new KeyboardEvent("keydown", {
          key: "v",
          ctrlKey: !isMac,
          metaKey: isMac,
          bubbles: true,
          cancelable: true,
        });

        // 分发事件到当前活动元素
        const activeElement = document.activeElement;
        if (activeElement) {
          activeElement.dispatchEvent(pasteEvent);
          await log("模拟粘贴事件已发送");
        } else {
          await log("没有活动元素，无法发送粘贴事件");
        }

        // 粘贴后处理（隐藏窗口等）
        await handlePasteAftermath();
      }
    } catch (error) {
      await error("模拟粘贴失败:", error);
    }
  };

  // 粘贴为纯文本
  window.pasteAsPlainText = async function (element) {
    try {
      const content = element.getAttribute("data-content");
      const format = element.getAttribute("data-format");
      if (content) {
        // 获取纯文本内容（从后端html转text api获取，类似text-frame的方式）
        const encodedContent = decodeURIComponent(content);
        let plainText = encodedContent;

        // 如果是html格式，使用前端的html2text函数获取纯文本
        if (format === "html") {
          plainText = html2text(encodedContent);
        }
        console.log("纯文本内容:", plainText.substring(0, 50) + "...");

        // 先复制纯文本到剪贴板，使用后端命令避免触发历史更新
        if (invoke) {
          try {
            await invoke("copy_to_clipboard_no_history", {
              content: plainText,
              format: "plain",
            });
            console.log("纯文本已复制到剪贴板（无历史更新），准备模拟粘贴");
          } catch (e) {
            console.error("后端复制命令执行失败:", e);
            // 后端API不可用，使用前端fallback
            await navigator.clipboard.writeText(plainText);
            console.log("纯文本已复制到剪贴板（前端fallback），准备模拟粘贴");
          }

          // 尝试使用后端的paste_to_active_window命令
          try {
            console.log("调用后端粘贴命令...");
            await invoke("paste_to_active_window", {
              content: plainText,
              format: "plain",
              isPinned: pinState.isPinned, // 使用当前 pin 状态
            });
            console.log("后端粘贴命令执行成功");
          } catch (tauriError) {
            console.error("后端粘贴命令执行失败:", tauriError);
            // 后端命令失败，使用前端模拟作为 fallback
          }
        } else {
          // 后端API不可用，使用前端fallback
          await navigator.clipboard.writeText(plainText);
          console.log("纯文本已复制到剪贴板（前端fallback），准备模拟粘贴");
        }

        // 前端模拟作为 fallback
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
        const modifierKey = isMac ? "Meta" : "Control";

        // 创建键盘事件
        const pasteEvent = new KeyboardEvent("keydown", {
          key: "v",
          ctrlKey: !isMac,
          metaKey: isMac,
          bubbles: true,
          cancelable: true,
        });

        // 分发事件到当前活动元素
        const activeElement = document.activeElement;
        if (activeElement) {
          activeElement.dispatchEvent(pasteEvent);
          console.log("模拟粘贴纯文本事件已发送");
        } else {
          console.log("没有活动元素，无法发送粘贴事件");
        }

        // 粘贴后处理（隐藏窗口等）
        await handlePasteAftermath();
      }
    } catch (error) {
      console.error("粘贴纯文本失败:", error);
    }
  };

  // 删除剪贴板项
  window.deleteClipboardItem = async function (id) {
    console.log("删除剪贴板项:", id);
    try {
      // 调用后端删除命令
      if (invoke) {
        await invoke("delete_clipboard_item", {
          id: id,
        });
        console.log("后端删除命令执行成功");
      }

      // 从 UI 中移除该元素
      const elementId = `item-${id}`;
      const element = document.getElementById(elementId);
      if (element) {
        element.remove();
        console.log("元素已从 UI 中移除");
      }

      // 检查是否还有其他元素
      const remainingItems = document.querySelectorAll(".clipboard-item");
      if (remainingItems.length === 0) {
        // 如果没有剩余元素，显示空状态
        const container = document.getElementById("clipboard-history");
        if (container) {
          container.innerHTML = renderEmptyState();
        }
      }
    } catch (error) {
      console.error("删除剪贴板项失败:", error);
    }
  };
}

// 禁用右键菜单
if (window.location.hostname !== "localhost") {
  // 仅在生产环境禁用，开发环境保留右键方便调试
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

/**
 * 初始化应用
 */
async function init() {
  const container = document.getElementById("clipboard-history");
  const statusElement = document.getElementById("status");

  console.log("获取DOM元素:", {
    container: !!container,
    statusElement: !!statusElement,
  });

  // 确保加载空状态样式
  ensureEmptyStateStyles();

  // 初始不显示加载状态，直接显示空状态
  container.innerHTML = renderEmptyState();
  updateStatus(statusElement, "初始化中...");

  // 初始加载历史记录
  console.log("开始加载初始数据");
  await loadRealData(container, statusElement);
  console.log("初始数据加载完成");

  // 初始化自定义标题栏按钮事件
  initTitlebarButtons();
  console.log("自定义标题栏按钮事件已初始化");

  // 初始化全局快捷键监听
  await initGlobalShortcuts();
  console.log("全局快捷键监听已初始化");

  // 监听剪贴板更新事件
  console.log("开始设置事件监听");
  try {
    await listenToClipboardUpdate(container, statusElement);
    console.log("剪贴板更新事件监听已启动");
  } catch (error) {
    console.error("事件监听失败:", error);
  }

  // 监听导航剪贴板事件
  try {
    await listen("navigate-clipboard", (event) => {
      console.log("收到导航剪贴板事件:", event);
      if (event && event.payload) {
        handleNavigation(event.payload, container);
      }
    });
    console.log("导航剪贴板事件监听已启动");
  } catch (error) {
    console.error("导航事件监听失败:", error);
  }

  console.log("SnipJet前端应用初始化完成");

  // 应用窗口不激活样式，防止抢夺焦点
  try {
    console.log("应用窗口不激活样式...");
    await invoke("apply_no_activate_style");
    console.log("窗口不激活样式应用成功");
  } catch (error) {
    console.error("应用窗口不激活样式失败:", error);
  }

  // 测试手动触发事件处理
  console.log("测试手动触发事件处理...");
  setTimeout(() => {
    console.log("测试完成，等待真实事件...");
  }, 2000);
}

// 启动应用
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
