// 前端应用主入口

import {listen, invoke, getClipboardContent, searchClipboardHistory} from "../../services/tauri-api.js";
import {openReaderWindow} from "../../services/window-service.js";
import {initGlobalShortcuts, handlePasteAftermath} from "../../services/shortcut-service.js";
import {
  updateStatus,
  loadRealData,
  listenToClipboardUpdate,
} from "../../services/clipboard-service.js";
import { getAnimationDurationMs, getRemoveAnimationDurationMs } from "../../services/theme-service.js";
import {html2text} from "../../utils/formatter.js";
import {initTitlebarButtons, pinState, filterState, syncFavoritesButtonLabel} from "./titlebar.js";
import {handleNavigation} from "./navigation.js";
import { renderEmptyState } from "../../components/empty-state/empty-state.js";
import { renderHistory } from "../../components/clipboard-history/clipboard-history.js";
import { clearImagePreviewSizeCache } from "../../components/clipboard-history/clipboard-item.js";
import {log, debug, error, event} from "../../utils/logger.js";
import { t, loadLocaleFromSettings, setLocale, applyI18n } from "../../utils/i18n.js";

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
    // 给被点中的卡片一个"我已经在动了"的脉冲；
    // 异常时由 finally 撤销，避免半透明 / 主色边框残留。
    let pasted = null;
    try {
      if (element) {
        pasted = element;
        pasted.classList.add("is-just-pasted");
      }

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
    } finally {
      // 给动效留足关键帧时长，再撤销 class 防止下次渲染残留
      if (pasted) {
        const animMs = getAnimationDurationMs();
        if (animMs > 0) {
          setTimeout(() => pasted.classList.remove("is-just-pasted"), animMs + 100);
        } else {
          pasted.classList.remove("is-just-pasted");
        }
      }
    }
  };

  // 粘贴为纯文本
  window.pasteAsPlainText = async function (element) {
    // 与 pasteToCurrentWindow 共用同一份"已粘贴"动效；同一时刻只触发一个动作，
    // 通过加 class 实现，最终由 finally 撤销，避免重复动画叠加。
    let pasted = null;
    try {
      if (element) {
        pasted = element;
        pasted.classList.add("is-just-pasted");
      }

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
    } finally {
      if (pasted) {
        const animMs = getAnimationDurationMs();
        if (animMs > 0) {
          setTimeout(() => pasted.classList.remove("is-just-pasted"), animMs + 100);
        } else {
          pasted.classList.remove("is-just-pasted");
        }
      }
    }
  };

  // 删除动效时长由设置决定；不再硬编码 480ms

/**
 * RAF-driven "卡片折叠"动效。CSS animation 在主窗口列表（flex column + gap）
 * 下同时插值 max-height / padding / border / margin，多组 layout 属性
 * 每帧 reflow 导致观感卡顿。改为 JS 直接驱动：
 * - 读卡片当前 offsetHeight（含 padding / border），写入 inline style.height
 * - 用 requestAnimationFrame 从 N → 0 步进，ease-out（先快后慢）
 * - 同步把 padding / margin-bottom 拉到 0，避免卡片坍塌后下方还留白
 * - 末帧：splice + 重渲染（统一由 finishRemove 处理）
 *
 * @param {HTMLElement} el - 目标卡片 DOM
 * @param {number} durationMs - 时长（毫秒）
 * @param {() => void} onDone - 动效结束回调（执行 splice + 重渲染）
 */
function animateCollapse(el, durationMs, onDone) {
  // 读出真实高度（含 padding / border），后续按比例收缩；先强制一次 layout 让高度稳定
  const startHeight = el.offsetHeight;
  const computed = getComputedStyle(el);
  // 元信息（item-time / item-meta）位于卡片下沿外侧，靠卡片下沿 margin-bottom 撑出位置；
  // 这里把 margin-bottom 与 padding 同步按比例收敛，避免坍塌后还留白
  const startPadTop = parseFloat(computed.paddingTop) || 0;
  const startPadBottom = parseFloat(computed.paddingBottom) || 0;
  const startMarginBottom = parseFloat(computed.marginBottom) || 0;

  // 列表是 flex column + gap：卡片高度归 0 后，上下两个 gap 依然占位；
  // 元素移除瞬间两个 gap 合并成一个，下方内容会突兀地跳高一个 gap——
  // 这正是"动画快结束卡一下"的观感来源之一。解法：把 margin-bottom
  // 动画到负的 gap 值，提前吃掉下方 gap，使移除前后占位无缝衔接。
  const gapPx = (() => {
    const parent = el.parentElement;
    if (!parent) return 0;
    const gap = parseFloat(getComputedStyle(parent).rowGap);
    return Number.isFinite(gap) ? gap : 0;
  })();
  const targetMarginBottom = -gapPx;

  const startTime = performance.now();

  // 锁住原始 height 为 auto，inline 写具体像素值后才能被 RAF 修改
  el.style.height = `${startHeight}px`;
  // padding / margin 一开始就锁定为原始像素（不动它们的具体来源）
  el.style.paddingTop = `${startPadTop}px`;
  el.style.paddingBottom = `${startPadBottom}px`;
  el.style.marginBottom = `${startMarginBottom}px`;
  // 只豁免 height/padding/margin 的 CSS 过渡；保留 class 里的 opacity 淡出
  el.style.transition = "opacity 0.1s linear";

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / durationMs);
    // ease-out cubic：1 - (1 - t)^3，先快后慢
    const eased = 1 - Math.pow(1 - t, 3);
    const progress = eased;

    // 末段：剩余 ≤ 0.5% 时提前收尾，避免持续接近 0 的微小步进。
    // 注意：这里绝不能清空 inline 样式"还原"卡片——元素马上就要被移除，
    // 还原会让折叠到 0 的卡片弹回原高度，下方列表先跳下去再跳回来。
    if (t >= 1 || progress >= 0.995) {
      onDone();
      return;
    }

    // 按"起始值 × (1 - eased)"同步收缩；保留两位小数避免浏览器对极小步进反应
    el.style.height = `${(startHeight * (1 - progress)).toFixed(2)}px`;
    el.style.paddingTop = `${(startPadTop * (1 - progress)).toFixed(2)}px`;
    el.style.paddingBottom = `${(startPadBottom * (1 - progress)).toFixed(2)}px`;
    el.style.marginBottom = `${(
      startMarginBottom + (targetMarginBottom - startMarginBottom) * progress
    ).toFixed(2)}px`;

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

  // 删除剪贴板项
  window.deleteClipboardItem = async function (id) {
    console.log("删除剪贴板项:", id, "当前视图:", filterState.showFavoritesOnly ? t('view.favorites') : t('view.history'));

    // 捕获动画开始时的视图状态：折叠动画约一两百毫秒，期间用户可能切换
    // 视图；数据删除与后端命令统一按开始时的视图执行，避免前后不一致。
    const fromFavoritesView = filterState.showFavoritesOnly;

    // 拿到 DOM：先把卡片用"即将被移除"的 class 套上，
    // 等动画结束再做真正的 splice + 重渲染；找不到元素（例如正在被外部全量替换）
    // 就直接走原路径。
    const el = document.getElementById(`item-${id}`);

    // 收尾：动画结束（或无动画）后执行。
    // 顺序很关键——先摘 DOM、再同步更新内存、按需重渲染、最后发后端命令，
    // 每一步之间不再有"卡片仍占位"的间隙。
    const finishRemove = async () => {
      // 1) 先把卡片从 DOM 摘除：后续的内存更新 / 后端 IPC 都可能跨帧，
      //    若等它们完成才重渲染，折叠到 0 的卡片会带着还原后的高度继续
      //    占位，下方列表上下跳动。元素即将丢弃，直接移除最干净。
      if (el && el.isConnected) {
        el.remove();
      }

      // 1.5) 若删除的是首卡（"最新条目"），新的首卡需要接管多行预览样式
      //（renderHistory 里只有 index 0 不带 is-row）。增量路径没有全量重
      // 渲染，这里手动补上，避免新首卡一直显示单行历史预览。
      const listContainer = document.getElementById("clipboard-history");
      const newFirstCard = listContainer?.querySelector(".clipboard-item");
      if (
        newFirstCard &&
        newFirstCard !== el &&
        !filterState.searchQuery.trim()
      ) {
        newFirstCard.classList.remove("is-row");
      }

      // 2) 同步更新内存数据（不涉及后端，纯数组操作）
      if (fromFavoritesView) {
        const favIndex = allFavorites.findIndex(item => item.id === id);
        if (favIndex !== -1) {
          allFavorites.splice(favIndex, 1);
        }
      }
      const historyIndex = allClipboardItems.findIndex(item => item.id === id);
      if (historyIndex !== -1) {
        allClipboardItems.splice(historyIndex, 1);
      }
      // 搜索命中集合同步剔除，保证后续检索结果一致
      if (searchMatchIds) {
        searchMatchIds.delete(id);
      }

      // 3) 仅在必要时全量重渲染（搜索态 / 当前列表已空需显示空状态）。
      //    普通删除走增量 DOM 移除即可：整表 innerHTML 重建 + 全量解析 +
      //    图片预览重载在长列表下开销很大，是删除卡顿的另一主要来源。
      const viewData = fromFavoritesView ? allFavorites : allClipboardItems;
      if (filterState.searchQuery.trim() || viewData.length === 0) {
        await applyFilters(
          document.getElementById("clipboard-history"),
          document.getElementById("status")
        );
      }

      // 4) 后端删除放最后，且不阻塞 UI：失败仅记录日志
      if (invoke) {
        const cmd = fromFavoritesView ? "delete_favorite_item" : "delete_clipboard_item";
        invoke(cmd, { id }).catch(err => {
          console.error(`后端删除命令失败（${cmd}）:`, err);
        });
      }
    };

    if (el) {
      el.classList.add("is-just-removed");
      // 删除比反馈型动效快一档：100ms（fast）/ 200ms（normal）/ 0（off）。
      // 用 RAF 直接驱动高度 + padding + margin-bottom 像素级插值，
      // 不再依赖 CSS keyframes（多组 layout 属性同步插值在 flex 列里会卡）。
      const animMs = getRemoveAnimationDurationMs();
      if (animMs > 0) {
        animateCollapse(el, animMs, () => finishRemove());
      } else {
        finishRemove();
      }
      return;
    }

    // 找不到元素：走原路径
    finishRemove();
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

          // 收藏切换动效：与粘贴动效颜色相反（标记语义 → 琥珀系）
          // 卡片先重启动画（先移除再回加），由设置决定撤销时长
          element.classList.remove("is-just-favorited");
          // 触发重排后再加，让浏览器认作新动画
          void element.offsetWidth;
          element.classList.add("is-just-favorited");
          const animMs = getAnimationDurationMs();
          if (animMs > 0) {
            setTimeout(() => element.classList.remove("is-just-favorited"), animMs + 100);
          } else {
            element.classList.remove("is-just-favorited");
          }

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

// 卡片内的点击/键盘行为统一用事件委托处理
// （原先写在 clipboard-item.js 生成的内联 onclick / onkeydown 里）
function bindClipboardItemActions(container) {
  if (!container) return;

  container.addEventListener("click", async (event) => {
    const item = event.target.closest(".clipboard-item");
    if (!item) return;

    const actionBtn = event.target.closest(".card-btn");
    // 未点中操作按钮时，整张卡片即"粘贴到当前窗口"
    if (!actionBtn) {
      await window.pasteToCurrentWindow(item);
      return;
    }

    if (actionBtn.classList.contains("btn-favorite")) {
      await window.toggleFavorite(item.dataset.id);
    } else if (actionBtn.classList.contains("btn-delete")) {
      await window.deleteClipboardItem(item.dataset.id);
    } else if (actionBtn.classList.contains("btn-edit")) {
      await window.openReaderWindow(item);
    } else if (actionBtn.classList.contains("btn-plain")) {
      await window.pasteAsPlainText(item);
    }
  });

  // 键盘可达：卡片本身获得焦点时，回车/空格等同点击
  container.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest(".clipboard-item");
    if (!item || event.target !== item) return;
    event.preventDefault();
    await window.pasteToCurrentWindow(item);
  });
}

// 全局状态引用
window.filterState = filterState;

// 给指定 id 的卡片加"已粘贴"动效（用于监听快捷键 / 轮转 / 序号触发）。
// 不受当前视图筛选影响——找不到就静默返回。
function flashClipboardItem(itemId) {
  if (!itemId) return;
  const el = document.getElementById(`item-${itemId}`);
  if (!el) return;
  el.classList.remove("is-just-pasted");
  void el.offsetWidth;
  el.classList.add("is-just-pasted");
  // 时长由设置决定（默认 fast 240ms），关闭则即时移除
  const animMs = getAnimationDurationMs();
  if (animMs > 0) {
    setTimeout(() => el.classList.remove("is-just-pasted"), animMs + 100);
  } else {
    el.classList.remove("is-just-pasted");
  }
}
window.flashClipboardItem = flashClipboardItem;

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
  // 尽早应用语言（同步读取 localStorage），让工具栏等静态文案首帧即为正确语言
  loadLocaleFromSettings();
  applyI18n();

  const container = document.getElementById("clipboard-history");
  const statusElement = document.getElementById("status");

  // 绑定卡片交互（事件委托）
  bindClipboardItemActions(container);

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
      // 设置里的语言可能比首帧读到的 localStorage 更新，需重新应用静态文案
      loadLocaleFromSettings();
      applyI18n();
    }
  } catch (e) {
    // 设置加载失败静默处理
  }

  // 初始不显示加载状态，直接显示空状态
  container.innerHTML = renderEmptyState();
  updateStatus(statusElement, t("status.initializing"));

  // 初始化筛选监听器
  initFilterListener(container, statusElement);

  // 回到顶部悬浮按钮：向下滚动一定距离后出现。
  // 注意：上面 init() 里的 container 变量指向 #clipboard-history（只负责渲染），
  // 真正产生滚动的是外层 .container 外壳，必须监听它。
  const backToTopBtn = document.getElementById("back-to-top");
  const scroller = document.querySelector(".container");
  if (backToTopBtn && scroller) {
    const SCROLL_THRESHOLD = 300;
    backToTopBtn.addEventListener("click", () => {
      scroller.scrollTo({ top: 0, behavior: "smooth" });
    });
    scroller.addEventListener("scroll", () => {
      backToTopBtn.classList.toggle("visible", scroller.scrollTop > SCROLL_THRESHOLD);
    });
  }

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
        const incoming = Array.isArray(payload.items) ? payload.items : [];

        // 后端删除 / 收藏切换后会回推全量状态，而这两类变更前端已增量
        // 更新过 DOM。若 id 序列与预览内容都与当前一致，说明只是"回声"，
        // 直接采纳数据并跳过全量重渲染——否则重建整表的开销正好落在
        // 删除动画尾帧上，是"快结束卡一下"的主要来源。
        // 预览上限调整会改写预览内容（id 不变），此时仍需重渲染。
        const isEcho =
          incoming.length === allClipboardItems.length &&
          incoming.every((it, i) => {
            const local = allClipboardItems[i];
            return (
              local && it.id === local.id && it.preview === local.preview
            );
          });
        allClipboardItems = incoming;
        console.log(
          "收到全量状态推送，items count:",
          incoming.length,
          "echo(跳过重渲染):",
          isEcho
        );
        if (!isEcho) {
          applyFilters(container, statusElement);
        }
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
          // 图片预览大小是模块级缓存：设置变化后失效，下一次渲染才会用新值
          clearImagePreviewSizeCache();
          console.log("[settings-changed] 主界面设置已应用:", interfacePayload);
        }
      } catch (e) {
        // 设置更新失败静默处理
      }

      // 更新后端的历史清理设置（「按条数」上限会实时裁剪历史）
      try {
        const cleanup = event.payload?.history_cleanup;
        await invoke("update_history_cleanup", { cleanup: cleanup || null });
        console.log("[settings-changed] 历史清理设置已更新:", cleanup);
      } catch (e) {
        console.error("[settings-changed] 更新历史清理设置失败:", e);
      }

      // 更新后端的预览字符上限（后端会顺带刷新存量预览并推送新列表）
      try {
        const maxChars = event.payload?.interface?.preview_max_chars;
        await invoke("update_preview_max_chars", { maxChars: maxChars || null });
        console.log("[settings-changed] 预览字符上限已更新:", maxChars);
      } catch (e) {
        console.error("[settings-changed] 更新预览字符上限失败:", e);
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
      setLocale(event.payload?.locale || "en");
      // 刷新工具栏等静态文案
      applyI18n();
      // 收藏按钮的文案随视图状态变化，需按当前状态重写
      syncFavoritesButtonLabel();
      applyFilters(container, statusElement);
      console.log("[language-changed] 语言已切换:", event.payload?.locale);
    });
  } catch (error) {
    console.error("语言变化事件监听失败:", error);
  }

  // 监听 shortcut-service 发出的闪卡事件（F2 / 轮转 / 序号快捷键）
  try {
    await listen("snipjet-flash-clipboard-card", (event) => {
      const id = event?.payload?.id;
      flashClipboardItem(id);
    });
  } catch (error) {
    console.error("闪卡事件监听失败:", error);
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
