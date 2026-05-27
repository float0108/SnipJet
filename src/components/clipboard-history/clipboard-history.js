// 剪贴板历史记录组件
import {parseClipboardItem} from "../../utils/content-parser.js";
import {renderClipboardItem, loadAllImagePreviews} from "./clipboard-item.js";
import {VirtualListManager} from "./virtual-list.js";
import {getClipboardHistory} from "../../services/tauri-api.js";

// 确保加载样式文件
if (
  !document.querySelector(
    'link[href="./components/clipboard-history/clipboard-item.css"]',
  )
) {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "./components/clipboard-history/clipboard-item.css";
  document.head.appendChild(link);
}

// Virtual list singleton instance
let virtualList = null;

/**
 * 初始化虚拟列表
 * @param {HTMLElement} container - 容器元素
 * @param {object} options - 配置选项
 * @returns {VirtualListManager}
 */
export function initVirtualList(container, options = {}) {
  if (virtualList) {
    virtualList.destroy();
  }

  virtualList = new VirtualListManager(container, {
    onLoadMore: async (offset) => {
      const items = await getClipboardHistory(20, offset);
      return {
        items,
        has_more: items.length === 20,
      };
    },
    onRenderItem: (item, index) => {
      const parsedItem = parseClipboardItem(item);
      return renderClipboardItem(parsedItem);
    },
    ...options,
  });

  return virtualList;
}

/**
 * 从列表中移除剪贴板项目
 * @param {string} id - 项目 ID
 * @returns {boolean} - 是否移除成功
 */
export function removeClipboardItem(id) {
  if (virtualList) {
    return virtualList.removeItem(id);
  }
  return false;
}

/**
 * 预置新剪贴板项目到列表开头
 * @param {object} item - 剪贴板项目
 */
export function prependClipboardItem(item) {
  if (virtualList) {
    virtualList.prependItem(item);
  }
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
    const htmlParts = history.map((item) => {
      // 解析剪贴板项目数据
      const parsedItem = parseClipboardItem(item);
      // 使用ClipboardItem.js中的renderClipboardItem函数渲染每个项目
      return renderClipboardItem(parsedItem);
    });

    container.innerHTML = htmlParts.join("");

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
  return [
    {
      id: "mock-1",
      timestamp: Date.now(),
      hash: "abc123",
      content: "暂时没有剪贴板内容...",
      preview: "暂时没有剪贴板内容...",
      format: "plain",
      word_count: 8,
    },
  ];
}