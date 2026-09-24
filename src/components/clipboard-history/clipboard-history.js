// 剪贴板历史记录组件
import {parseClipboardItem} from "../../utils/content-parser.js";
import {renderClipboardItem, loadAllImagePreviews} from "./clipboard-item.js";
import { t } from "../../utils/i18n.js";

// 样式由页面统一引入（index.html 的 <link>，构建时并入主样式表），
// 组件内不再自行注入，避免同一份 CSS 被加载两次。

/**
 * 从列表中移除剪贴板项目（通过 DOM 操作）
 * @param {string} id - 项目 ID
 * @returns {boolean} - 是否移除成功
 */
export function removeClipboardItem(id) {
  const element = document.querySelector(`[data-id="${id}"]`);
  if (element) {
    element.remove();
    return true;
  }
  return false;
}

/**
 * 预置新剪贴板项目到列表开头（通过 DOM 操作）
 * @param {object} item - 剪贴板项目
 */
export function prependClipboardItem(item) {
  // DOM 操作模式需要外部调用 renderHistory，这里不做处理
  console.warn("prependClipboardItem: DOM 模式不支持增量添加，需调用 renderHistory");
}

/**
 * 渲染剪贴板历史记录
 * @param {Array} history - 历史记录数据
 * @param {HTMLElement} container - 容器元素
 * @param {HTMLElement} statusElement - 状态元素
 */
export function renderHistory(history, container, statusElement) {
  if (!container) {
    return;
  }

  if (history && history.length > 0) {
    const html = history
      .map((item, index) =>
        // 只有最新一条使用"最新条目预览行数"：列表顶部即默认粘贴目标
        renderClipboardItem(parseClipboardItem(item), { latest: index === 0 }),
      )
      .join("");

    container.innerHTML = html;

    // 异步加载图片预览
    loadAllImagePreviews();

    if (statusElement) {
      statusElement.textContent = "";
    }
  } else {
    container.innerHTML = "";
    if (statusElement) {
      statusElement.textContent = "";
    }
  }
}

/**
 * 创建模拟数据（用于测试）
 * @returns {Array} - 模拟历史记录
 */
export function createMockHistory() {
  const mockContent = t("item.mockContent");
  return [
    {
      id: "mock-1",
      timestamp: Date.now(),
      hash: "abc123",
      content: mockContent,
      preview: mockContent,
      format: "plain",
      word_count: 8,
    },
  ];
}