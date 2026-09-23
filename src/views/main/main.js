// 前端应用主入口

import {listen, invoke, getClipboardContent, searchClipboardHistory} from "../../services/tauri-api.js";
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
import { t, loadLocaleFromSettings, setLocale } from "../../utils/i18n.js";

// 确保函数被暴露到全局作用域
if (typeof window !== "undefined") {
  window.openReaderWindow = openReaderWindow;

  // 构建剪贴板项目（共享逻辑）
  function buildClipboardItems(decodedContent, format) {
    if (format === "html") {
      const plainText = html2text(decodedContent);
      const blobHTML = new Blob([decodedContent], { type: "text/html" });
      const blobText = new Blob([plainText], { type: "text/plain" });
      return [new ClipboardItem({ "text/html": blobHTML, "text/plain": blobText })];
    } else {
      const blobText = new Blob([decodedContent], { type: "text/plain" });
      return [new ClipboardItem({ "text/plain": blobText })];
    }
  }

  // 从元素读取元数据（不再依赖 data-content，统一走懒加载）
  function getItemMeta(element) {
    const format = element.getAttribute("data-format") || "plain";
    const id = element.getAttribute("data-id") || element.id.replace(/^item-/, "");
    return { id, format };
  }

  // 懒加载项的完整内容；返回 { id, format, content }
  async function fetchItemContent(element) {
    const meta = getItemMeta(element);
    const item = await getClipboardContent(meta.id);
    if (!item) return null;
    return {
      id: meta.id,
      format: item.format || meta.format,
      content: item.content || "",
      preview: item.preview || "",
    };
  }

  // 分发粘贴键盘事件（共享逻辑）
  function dispatchPasteEvent() {
    const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
    const pasteEvent = new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
    });
    const activeElement = document.activeElement;
    if (activeElement) {
      activeElement.dispatchEvent(pasteEvent);
      return true;
    }
    return false;
  }

  // 写入剪贴板（带降级逻辑）
  async function writeClipboardWithFallback(decodedContent, format) {
    const clipboardItems = buildClipboardItems(decodedContent, format);
    try {
      await navigator.clipboard.write(clipboardItems);
      return "clipboard-api";
    } catch (clipboardError) {
      await error("Clipboard API 失败，尝试后端:", clipboardError);
      if (invoke) {
        try {
          await invoke("copy_to_clipboard_no_history", {
            content: decodedContent,
            format: format,
          });
          return "backend";
        } catch (e) {
          await error("后端复制命令执行失败:", e);
          await navigator.clipboard.writeText(decodedContent);
          return "fallback";
        }
      } else {
        await navigator.clipboard.writeText(decodedContent);
        return "fallback";
      }
    }
  }

  // 构建 Pandoc contentType
  function buildPandocContentType(format) {
    if (format !== "markdown") return null;
    const settings = JSON.parse(localStorage.getItem('snipjet-settings') || '{}');
    if (!settings.paste?.use_pandoc_for_markdown) return null;
    const templatePath = settings.paste?.pandoc_template_path;
    if (templatePath && templatePath.trim()) {
      return `docx:${templatePath.trim()}`;
    }
    return "docx";
  }

  // 复制到剪贴板
window.copyToClipboard = async function (element) {
    try {
      const fetched = await fetchItemContent(element);
      if (fetched && fetched.content) {
        const writeResult = await writeClipboardWithFallback(fetched.content, fetched.format);
        await log(`内容已复制到剪贴板（${writeResult}）`);
      } else {
        await error("复制失败：未找到该剪贴板项的完整内容");
      }
    } catch (error) {
      await error("复制失败:", error);
    }
  };

  // 执行后端粘贴命令（内部使用）
  async function executePasteToActiveWindow(decodedContent, format) {
    if (!invoke) return;
    try {
      await log("调用后端粘贴命令...");
      const contentType = buildPandocContentType(format);
      await invoke("paste_to_active_window", {
        content: decodedContent,
        format: format,
        isPinned: pinState.isPinned,
        contentType: contentType,
      });
      await log("后端粘贴命令执行成功");
    } catch (tauriError) {
      await error("后端粘贴命令执行失败:", tauriError);
    }
  }

  // 模拟粘贴到当前窗口
window.pasteToCurrentWindow = async function (element) {
    try {
      const fetched = await fetchItemContent(element);
      if (!fetched || !fetched.content) {
        await error("粘贴失败：未找到该剪贴板项的完整内容");
        return;
      }
      const { format, content } = fetched;

      // 写入剪贴板
      const writeResult = await writeClipboardWithFallback(content, format);
      await log(`内容已复制到剪贴板（${writeResult}），准备模拟粘贴`);

      // 后端粘贴
      await executePasteToActiveWindow(content, format);

      // 前端模拟作为 fallback
      if (dispatchPasteEvent()) {
        await log("模拟粘贴事件已发送");
      } else {
        await log("没有活动元素，无法发送粘贴事件");
      }

      // 粘贴后处理（隐藏窗口等）
      await handlePasteAftermath();
    } catch (error) {
      await error("模拟粘贴失败:", error);
    }
  };

  // 粘贴为纯文本
  window.pasteAsPlainText = async function (element) {
    try {
      const fetched = await fetchItemContent(element);
      if (!fetched || !fetched.content) {
        console.error("粘贴纯文本失败：未找到该剪贴板项的完整内容");
        return;
      }
      const { format, content } = fetched;

      const plainText = format === "html" ? html2text(content) : content;

      // 写入剪贴板
      const writeResult = await writeClipboardWithFallback(plainText, "plain");
      console.log(`纯文本已复制到剪贴板（${writeResult}），准备模拟粘贴`);

      // 调用后端paste命令
      if (invoke) {
        try {
          console.log("调用后端粘贴命令...");
          await invoke("paste_to_active_window", {
            content: plainText,
            format: "plain",
            isPinned: pinState.isPinned,
            contentType: "plain",
          });
          console.log("后端粘贴命令执行成功");
        } catch (tauriError) {
          console.error("后端粘贴命令执行失败:", tauriError);
        }
      }

      // 前端模拟作为 fallback
      if (dispatchPasteEvent()) {
        console.log("模拟粘贴纯文本事件已发送");
      } else {
        console.log("没有活动元素，无法发送粘贴事件");
      }

      // 粘贴后处理（隐藏窗口等）
      await handlePasteAftermath();
    } catch (error) {
      console.error("粘贴纯文本失败:", error);
    }
  };

  // 删除剪贴板项
  window.deleteClipboardItem = async function (id) {
    console.log("删除剪贴板项:", id, "当前视图:", filterState.showFavoritesOnly ? t('view.favorites') : t('view.history'));

    // 根据当前视图决定删除逻辑
    if (filterState.showFavoritesOnly) {
      // 在收藏视图中：彻底删除收藏项
      const itemIndex = allFavorites.findIndex(item => item.id === id);
      if (itemIndex !== -1) {
        allFavorites.splice(itemIndex, 1);
        console.log("已从 allFavorites 中移除项目，剩余:", allFavorites.length);
      }

      // 同时从历史记录中移除（如果存在）
      const historyIndex = allClipboardItems.findIndex(item => item.id === id);
      if (historyIndex !== -1) {
        allClipboardItems.splice(historyIndex, 1);
        console.log("已从 allClipboardItems 中移除项目");
      }

      // 调用后端删除命令（从收藏表删除）
      try {
        if (invoke) {
          await invoke("delete_favorite_item", { id });
          console.log("后端删除收藏项命令执行成功");
        }
      } catch (error) {
        console.error("后端删除收藏项命令失败（前端已删除）:", error);
      }
    } else {
      // 在历史视图中：从历史删除，但保留收藏
      const item = allClipboardItems.find(item => item.id === id);
      const isFavorite = item?.is_favorite || false;

      // 从历史记录中移除
      const itemIndex = allClipboardItems.findIndex(item => item.id === id);
      if (itemIndex !== -1) {
        allClipboardItems.splice(itemIndex, 1);
        console.log("已从 allClipboardItems 中移除项目，剩余:", allClipboardItems.length);
      }

      // 调用后端删除命令
      try {
        if (invoke) {
          await invoke("delete_clipboard_item", { id });
          console.log("后端删除历史项命令执行成功");
        }
      } catch (error) {
        console.error("后端删除历史项命令失败（前端已删除）:", error);
      }
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

          // 同步更新 allFavorites 数组
          if (newState) {
            // 添加收藏：复制到 allFavorites
            const existingIndex = allFavorites.findIndex(item => item.id === id);
            if (existingIndex === -1) {
              allFavorites.push({...allClipboardItems[itemIndex]});
              console.log("[toggleFavorite] 已添加到 allFavorites");
            }
          } else {
            // 取消收藏：从 allFavorites 移除
            const favIndex = allFavorites.findIndex(item => item.id === id);
            if (favIndex !== -1) {
              allFavorites.splice(favIndex, 1);
              console.log("[toggleFavorite] 已从 allFavorites 移除");
            }
          }
        } else {
          console.warn("[toggleFavorite] 未在 allClipboardItems 中找到项目:", id);
          console.log("[toggleFavorite] 所有项目 ID:", allClipboardItems.map(i => i.id));
        }

        // 收藏数据已实时保存到数据库，无需额外保存历史记录

        // 更新 UI
        const elementId = `item-${id}`;
        const element = document.getElementById(elementId);
        if (element) {
          // 更新收藏按钮状态
          const favoriteBtn = element.querySelector(".btn-favorite");
          if (favoriteBtn) {
            favoriteBtn.classList.toggle("active", newState);
            favoriteBtn.title = newState ? t('action.unfavorite') : t('action.favorite');
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
// 收藏项目数据（独立存储，与历史分开）
let allFavorites = [];

// 搜索命中的 id 集合（由后端全文检索返回）；null 表示当前没有生效的搜索条件
let searchMatchIds = null;
// 搜索防抖与竞态控制
let searchDebounceTimer = null;
let searchRequestSeq = 0;
const SEARCH_DEBOUNCE_MS = 150;

// 获取当前筛选后的项目。
// 正文已在后端剥离，本地无法做全文匹配，因此搜索命中的 id 集合由后端给出，
// 这里只负责按 id 过滤当前视图的数据。
function getFilteredItems() {
  const base = filterState.showFavoritesOnly ? allFavorites : allClipboardItems;
  if (!Array.isArray(base)) {
    return [];
  }

  const items = [...base];

  const searchQuery = filterState.searchQuery.trim();
  if (!searchQuery) {
    return items;
  }

  // 搜索尚无结果（首次检索或正在重新检索）时先不展示，避免闪现全部内容
  if (!searchMatchIds) {
    return [];
  }

  return items.filter(item => searchMatchIds.has(item.id));
}

// 统一渲染当前筛选结果
function renderFiltered(container, statusElement) {
  const filteredItems = getFilteredItems();

  if (filteredItems.length > 0) {
    renderHistory(filteredItems, container, statusElement);
    return;
  }

  if (filterState.showFavoritesOnly && allFavorites.length === 0) {
    container.innerHTML = renderEmptyState(t('empty.noFavorites'), t('empty.noFavoritesHint'));
    updateStatus(statusElement, "");
    return;
  }

  if (!filterState.showFavoritesOnly && allClipboardItems.length === 0) {
    container.innerHTML = renderEmptyState(t('empty.noHistory'), t('empty.noHistoryHint'));
    updateStatus(statusElement, "");
    return;
  }

  // 有数据但没有匹配项
  const emptyText = filterState.showFavoritesOnly ? t('empty.noFavoritesMatch') : t('empty.noHistoryMatch');
  console.log("[applyFilters] 有数据但筛选为空，显示:", emptyText);
  container.innerHTML = renderEmptyState(emptyText, "");
  updateStatus(statusElement, "");
}

// 防抖发起后端全文检索，避免每次按键都触发一次全量扫描
function scheduleSearch(container, statusElement, query) {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    runSearch(container, statusElement, query);
  }, SEARCH_DEBOUNCE_MS);
}

async function runSearch(container, statusElement, query) {
  const seq = ++searchRequestSeq;
  const ids = await searchClipboardHistory(query);

  // 丢弃过期结果（用户已继续输入新的关键词或已清空搜索）
  if (seq !== searchRequestSeq) {
    return;
  }

  searchMatchIds = new Set(ids);
  renderFiltered(container, statusElement);
}

// 应用筛选并重新渲染
async function applyFilters(container, statusElement) {
  if (!container) {
    return;
  }

  const query = filterState.searchQuery.trim();
  if (query) {
    // 有搜索条件：交给防抖 + 后端全文检索处理
    scheduleSearch(container, statusElement, query);
    return;
  }

  // 无搜索条件：取消在途的搜索并立即渲染完整列表
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  searchRequestSeq++; // 让在途搜索结果失效
  searchMatchIds = null;
  renderFiltered(container, statusElement);
}

// 更新历史项目数据
function updateAllItems(history) {
  if (Array.isArray(history)) {
    allClipboardItems = history;
  } else {
    allClipboardItems = [];
  }
}

// 更新收藏项目数据
function updateFavorites(favorites) {
  if (Array.isArray(favorites)) {
    allFavorites = favorites;
  } else {
    allFavorites = [];
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
    const { initTheme, loadSystemFonts } = await import("../../services/theme-service.js");
    await initTheme();
    // 启动时一次性枚举并缓存系统字体，供设置页面使用
    loadSystemFonts().catch(() => {});
  } catch (e) {
    // 主题初始化失败静默处理
  }

  // 加载设置到 localStorage（供图片预览等功能使用）
  try {
    const settings = await invoke("load_settings_command");
    if (settings) {
      localStorage.setItem('snipjet-settings', JSON.stringify(settings));
      // 加载语言设置
      loadLocaleFromSettings();
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

  // 加载收藏数据
  try {
    const favorites = await invoke("load_favorites_from_db");
    updateFavorites(favorites);
    console.log("[init] 已加载收藏数据:", favorites.length, "项");

    // 同步历史中的收藏状态
    const favoriteIds = new Set(favorites.map(f => f.id));
    allClipboardItems.forEach(item => {
      item.is_favorite = favoriteIds.has(item.id);
    });
    console.log("[init] 已同步历史中的收藏状态");
  } catch (e) {
    console.error("[init] 加载收藏数据失败:", e);
  }

  // 初始化自定义标题栏按钮事件
  initTitlebarButtons();

  // 初始化全局快捷键监听
  await initGlobalShortcuts();

  // 监听剪贴板更新事件（全量状态推送）
  try {
    const unlisten = await listen("clipboard-update", (event) => {
      if (!event || !event.payload) return;

      const payload = event.payload;

      if (payload.type === "state-changed") {
        // 全量替换
        allClipboardItems = payload.items;
        console.log("收到全量状态推送，items count:", allClipboardItems.length);
        applyFilters(container, statusElement);
      }
    });
    window.unlistenClipboardUpdate = unlisten;
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
      // 重新应用界面设置：优先使用 payload，缺失字段则从后端重新读取最新设置
      try {
        const { applyInterfaceSettings } = await import("../../services/theme-service.js");
        let interfacePayload = event.payload?.interface;
        if (!interfacePayload || interfacePayload.font_family == null) {
          const { loadSettingsFromFile } = await import("../../services/tauri-api.js");
          const fresh = await loadSettingsFromFile();
          interfacePayload = fresh?.interface;
        }
        if (interfacePayload) {
          applyInterfaceSettings(interfacePayload);
          console.log("[settings-changed] 主界面设置已应用:", interfacePayload);
        }
      } catch (e) {
        // 设置更新失败静默处理
      }

      // 更新后端的最大历史条目数设置
      try {
        const maxItems = event.payload?.interface?.max_history_items;
        await invoke("update_max_history_items", { maxItems: maxItems || null });
        console.log("[settings-changed] 最大历史条目数已更新:", maxItems);
      } catch (e) {
        console.error("[settings-changed] 更新最大历史条目数失败:", e);
      }

      // 更新后端的搜索扫描上限设置
      try {
        const limitKb = event.payload?.interface?.search_scan_limit_kb;
        await invoke("update_search_scan_limit_kb", { limitKb: limitKb || null });
        console.log("[settings-changed] 搜索扫描上限已更新:", limitKb);
      } catch (e) {
        console.error("[settings-changed] 更新搜索扫描上限失败:", e);
      }

      // 快捷粘贴修饰键模式变化：重新注册快捷键
      try {
        const newMode = event.payload?.shortcuts?.quick_paste_mode;
        const newRotating = event.payload?.shortcuts?.rotating_paste;
        if (newMode !== undefined || newRotating !== undefined) {
          const { setupQuickPasteShortcuts } = await import("../../services/shortcut-service.js");
          await setupQuickPasteShortcuts(
            newMode || "ctrl",
            newRotating || ""
          );
          console.log("[settings-changed] 快捷粘贴已更新:", { newMode, newRotating });
        }
      } catch (e) {
        console.error("[settings-changed] 更新快捷粘贴模式失败:", e);
      }

      // 重新应用筛选，这会重新渲染整个列表
      applyFilters(container, statusElement);
    });
  } catch (error) {
    console.error("设置变化事件监听失败:", error);
  }

  // 监听语言变化事件
  try {
    await listen("language-changed", async (event) => {
      setLocale(event.payload?.locale || "cn");
      applyFilters(container, statusElement);
      console.log("[language-changed] 语言已切换:", event.payload?.locale);
    });
  } catch (error) {
    console.error("语言变化事件监听失败:", error);
  }

  // 应用窗口不激活样式，防止抢夺焦点
  try {
    await invoke("apply_no_activate_style");
  } catch (error) {
    console.error("应用窗口不激活样式失败:", error);
  }

  // 主窗口重新可见时，重新加载并应用最新设置（防止设置窗口事件未触达主界面）
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      try {
        const { loadSettingsFromFile } = await import("../../services/tauri-api.js");
        const { applyInterfaceSettings } = await import("../../services/theme-service.js");
        const fresh = await loadSettingsFromFile();
        if (fresh?.interface) {
          applyInterfaceSettings(fresh.interface);
          console.log("[visibilitychange] 主界面设置已重新应用");
        }
      } catch (e) {
        console.error("[visibilitychange] 重新应用设置失败:", e);
      }
    }
  });
}

// 启动应用
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
