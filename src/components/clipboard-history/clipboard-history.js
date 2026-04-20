// 剪贴板历史记录组件
import {parseClipboardItem} from "../../utils/content-parser.js";
import {renderClipboardItem, loadAllImagePreviews} from "./clipboard-item.js";

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

  // 始终清空容器内容
  container.innerHTML = "";

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
    // 即使是空数组，也确保容器被清空
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
