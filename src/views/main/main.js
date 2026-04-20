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
import {initTitlebarButtons, pinState, filterState} from "./titlebar.js";
import {handleNavigation} from "./navigation.js";
import {
  renderEmptyState,
  ensureEmptyStateStyles,
} from "../../components/empty-state/empty-state.js";
import { renderHistory } from "../../components/clipboard-history/clipboard-history.js";
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
        const decodedContent = decodeURIComponent(content);

        // 准备剪贴板数据 - 同时提供 HTML 和纯文本格式
        let clipboardItems = [];

        if (format === "html") {
          // 如果是 HTML 格式，同时写入 HTML 和纯文本
          const plainText = html2text(decodedContent);
          const blobHTML = new Blob([decodedContent], { type: "text/html" });
          const blobText = new Blob([plainText], { type: "text/plain" });
          clipboardItems = [new ClipboardItem({
            "text/html": blobHTML,
            "text/plain": blobText
          })];
        } else {
          // 纯文本格式，只写入纯文本
          const blobText = new Blob([decodedContent], { type: "text/plain" });
          clipboardItems = [new ClipboardItem({ "text/plain": blobText })];
        }

        // 写入剪贴板
        try {
          await navigator.clipboard.write(clipboardItems);
          await log("内容已复制到剪贴板（多格式）");
        } catch (clipboardError) {
          await error("Clipboard API 失败，尝试后端:", clipboardError);

          // 降级到后端命令
          if (invoke) {
            try {
              await invoke("copy_to_clipboard_no_history", {
                content: decodedContent,
                format: format,
              });
              await log("内容已复制到剪贴板（后端）");
            } catch (e) {
              await error("后端调用失败:", e);
              await navigator.clipboard.writeText(decodedContent);
              await log("内容已复制到剪贴板（前端 fallback）");
            }
          } else {
            await navigator.clipboard.writeText(decodedContent);
            await log("内容已复制到剪贴板（前端 fallback）");
          }
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
        const decodedContent = decodeURIComponent(content);

        // 准备剪贴板数据 - 同时提供 HTML 和纯文本格式
        let clipboardItems = [];

        if (format === "html") {
          // 如果是 HTML 格式，同时写入 HTML 和纯文本
          const plainText = html2text(decodedContent);
          const blobHTML = new Blob([decodedContent], { type: "text/html" });
          const blobText = new Blob([plainText], { type: "text/plain" });
          clipboardItems = [new ClipboardItem({
            "text/html": blobHTML,
            "text/plain": blobText
          })];
        } else {
          // 纯文本格式，只写入纯文本
          const blobText = new Blob([decodedContent], { type: "text/plain" });
          clipboardItems = [new ClipboardItem({ "text/plain": blobText })];
        }

        // 写入剪贴板
        try {
          await navigator.clipboard.write(clipboardItems);
          await log("内容已复制到剪贴板（多格式），准备模拟粘贴");
        } catch (clipboardError) {
          await error("Clipboard API 失败，尝试后端:", clipboardError);

          // 降级到后端命令
          if (invoke) {
            try {
              await invoke("copy_to_clipboard_no_history", {
                content: decodedContent,
                format: format,
              });
              await log("内容已复制到剪贴板（后端），准备模拟粘贴");
            } catch (e) {
              await error("后端复制命令执行失败:", e);
              await navigator.clipboard.writeText(decodedContent);
              await log("内容已复制到剪贴板（前端 fallback），准备模拟粘贴");
            }
          } else {
            await navigator.clipboard.writeText(decodedContent);
            await log("内容已复制到剪贴板（前端 fallback），准备模拟粘贴");
          }
        }

        // 尝试使用后端的paste_to_active_window命令
        if (invoke) {
          try {
            await log("调用后端粘贴命令...");

            // 检查是否需要使用 Pandoc 粘贴 Markdown
            let contentType = null;
            if (format === "markdown") {
              const settings = JSON.parse(localStorage.getItem('snipjet-settings') || '{}');
              if (settings.paste?.use_pandoc_for_markdown) {
                // 构建 contentType，包含模板路径（如果有）
                const templatePath = settings.paste?.pandoc_template_path;
                if (templatePath && templatePath.trim()) {
                  contentType = `docx:${templatePath.trim()}`;
                  await log("使用 Pandoc (docx) 格式粘贴 Markdown，模板: " + templatePath);
                } else {
                  contentType = "docx";
                  await log("使用 Pandoc (docx) 格式粘贴 Markdown（无模板）");
                }
              }
            }

            await invoke("paste_to_active_window", {
              content: decodedContent,
              format: format,
              isPinned: pinState.isPinned,
              contentType: contentType,
            });
            await log("后端粘贴命令执行成功");
          } catch (tauriError) {
            await error("后端粘贴命令执行失败:", tauriError);
            // 后端命令失败，使用前端模拟作为 fallback
          }
        }

        // 前端模拟作为 fallback
        const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

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
              contentType: "plain", // 明确指定按纯文本处理
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

      // 从 allClipboardItems 数组中移除该项目
      const itemIndex = allClipboardItems.findIndex(item => item.id === id);
      if (itemIndex !== -1) {
        allClipboardItems.splice(itemIndex, 1);
        console.log("已从 allClipboardItems 中移除项目，剩余:", allClipboardItems.length);
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

  // 切换收藏状态
  window.toggleFavorite = async function (id) {
    console.log("[toggleFavorite] 切换收藏状态:", id);
    console.log("[toggleFavorite] 当前 allClipboardItems 数量:", allClipboardItems.length);

    try {
      if (invoke) {
        const newState = await invoke("toggle_favorite", { id });
        console.log("[toggleFavorite] 后端返回新状态:", newState);

        // 更新 allClipboardItems 中的对应项目
        const itemIndex = allClipboardItems.findIndex(item => item.id === id);
        if (itemIndex !== -1) {
          allClipboardItems[itemIndex].is_favorite = newState;
          console.log("[toggleFavorite] 已更新 allClipboardItems:", id, "索引:", itemIndex, "新状态:", newState);
          console.log("[toggleFavorite] 更新后的项目:", allClipboardItems[itemIndex]);
        } else {
          console.warn("[toggleFavorite] 未在 allClipboardItems 中找到项目:", id);
          console.log("[toggleFavorite] 所有项目 ID:", allClipboardItems.map(i => i.id));
        }

        // 立即保存数据到文件，确保收藏状态不会丢失
        try {
          await invoke("save_clipboard_history");
          console.log("[toggleFavorite] 已保存数据到文件");
        } catch (saveError) {
          console.error("[toggleFavorite] 保存数据失败:", saveError);
        }

        // 更新 UI
        const elementId = `item-${id}`;
        const element = document.getElementById(elementId);
        if (element) {
          // 更新收藏按钮状态
          const favoriteBtn = element.querySelector(".btn-favorite");
          if (favoriteBtn) {
            favoriteBtn.classList.toggle("active", newState);
            favoriteBtn.title = newState ? "取消收藏" : "收藏";
            // 更新图标
            favoriteBtn.innerHTML = newState
              ? `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`
              : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`;
          }

          // 更新卡片收藏状态
          element.classList.toggle("is-favorite", newState);

          // 如果在收藏模式下，且取消收藏，则重新应用筛选
          if (window.filterState && window.filterState.showFavoritesOnly && !newState) {
            console.log("[toggleFavorite] 在收藏模式下取消收藏，重新应用筛选");
            const container = document.getElementById("clipboard-history");
            const statusElement = document.getElementById("status");
            if (container) {
              applyFilters(container, statusElement);
            }
          }
        } else {
          console.warn("[toggleFavorite] 未找到 UI 元素:", elementId);
        }
      }
    } catch (error) {
      console.error("[toggleFavorite] 切换收藏状态失败:", error);
    }
  };
}

// 全局状态引用
window.filterState = filterState;

// 当前显示的所有剪贴板项（用于筛选）
let allClipboardItems = [];

// 获取当前筛选后的项目
function getFilteredItems() {
  // 确保 allClipboardItems 是数组
  if (!Array.isArray(allClipboardItems)) {
    return [];
  }

  let items = [...allClipboardItems];

  // 收藏筛选 - 使用布尔值转换确保兼容性
  if (filterState.showFavoritesOnly) {
    items = items.filter(item => item.is_favorite === true);
  }

  // 搜索筛选
  const searchQuery = filterState.searchQuery.toLowerCase().trim();
  if (searchQuery) {
    items = items.filter(item => {
      const content = (item.content || "").toLowerCase();
      const preview = (item.preview || "").toLowerCase();
      return content.includes(searchQuery) || preview.includes(searchQuery);
    });
  }

  return items;
}

// 应用筛选并重新渲染
async function applyFilters(container, statusElement) {
  if (!container) {
    return;
  }

  const filteredItems = getFilteredItems();

  if (filteredItems.length > 0) {
    // 使用原始的渲染函数渲染筛选后的项目
    renderHistory(filteredItems, container, statusElement);
  } else if (allClipboardItems.length === 0) {
    // 如果没有任何数据，显示默认空状态
    container.innerHTML = renderEmptyState("暂无剪贴板内容", "复制内容后将显示在这里");
  } else {
    // 有数据但筛选结果为空
    let emptyText = "没有找到匹配的内容";
    let emptyDescription = "";

    if (filterState.showFavoritesOnly && filterState.searchQuery) {
      emptyText = "未找到匹配的收藏内容";
    } else if (filterState.showFavoritesOnly) {
      emptyText = "暂无收藏内容";
      emptyDescription = "点击卡片上的爱心图标收藏内容";
    }

    console.log("[applyFilters] 有数据但筛选为空，显示:", emptyText);
    container.innerHTML = renderEmptyState(emptyText, emptyDescription);
  }
}

// 更新所有项目数据
function updateAllItems(history) {
  if (Array.isArray(history)) {
    allClipboardItems = history;
  } else {
    allClipboardItems = [];
  }
}

// 监听筛选状态变化
function initFilterListener(container, statusElement) {
  filterState.subscribe(() => {
    applyFilters(container, statusElement);
  });
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

  // 初始化主题
  try {
    const { initTheme } = await import("../../services/theme-service.js");
    await initTheme();
  } catch (e) {
    // 主题初始化失败静默处理
  }

  // 加载设置到 localStorage（供图片预览等功能使用）
  try {
    const settings = await invoke("load_settings_command");
    if (settings) {
      localStorage.setItem('snipjet-settings', JSON.stringify(settings));
    }
  } catch (e) {
    // 设置加载失败静默处理
  }

  // 确保加载空状态样式
  ensureEmptyStateStyles();

  // 初始不显示加载状态，直接显示空状态
  container.innerHTML = renderEmptyState();
  updateStatus(statusElement, "初始化中...");

  // 初始化筛选监听器
  initFilterListener(container, statusElement);

  // 初始加载历史记录
  await loadRealData(container, statusElement, (history) => {
    updateAllItems(history);
    applyFilters(container, statusElement);
  });

  // 初始化自定义标题栏按钮事件
  initTitlebarButtons();

  // 初始化全局快捷键监听
  await initGlobalShortcuts();

  // 监听剪贴板更新事件
  try {
    await listenToClipboardUpdate(container, statusElement, (newItem) => {
      // 添加到所有项目列表的开头
      allClipboardItems.unshift(newItem);
      // 应用筛选（如果当前显示的是收藏列表或搜索结果，可能需要决定是否显示新项目）
      const shouldShowNewItem =
        !filterState.showFavoritesOnly &&
        (!filterState.searchQuery ||
         newItem.content?.toLowerCase().includes(filterState.searchQuery.toLowerCase()) ||
         newItem.preview?.toLowerCase().includes(filterState.searchQuery.toLowerCase()));

      if (shouldShowNewItem) {
        // 如果新项目应该显示在当前视图中，则重新渲染
        applyFilters(container, statusElement);
      }
    });
  } catch (error) {
    console.error("事件监听失败:", error);
  }

  // 监听导航剪贴板事件
  try {
    await listen("navigate-clipboard", (event) => {
      if (event && event.payload) {
        handleNavigation(event.payload, container);
      }
    });
  } catch (error) {
    console.error("导航事件监听失败:", error);
  }

  // 监听设置变化事件，重新渲染列表
  try {
    await listen("settings-changed", async (event) => {
      // 重新应用界面设置
      try {
        const { applyInterfaceSettings } = await import("../../services/theme-service.js");
        applyInterfaceSettings(event.payload?.interface);
      } catch (e) {
        // 设置更新失败静默处理
      }
      // 重新应用筛选，这会重新渲染整个列表
      applyFilters(container, statusElement);
    });
  } catch (error) {
    console.error("设置变化事件监听失败:", error);
  }

  // 应用窗口不激活样式，防止抢夺焦点
  try {
    await invoke("apply_no_activate_style");
  } catch (error) {
    console.error("应用窗口不激活样式失败:", error);
  }
}

// 启动应用
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
