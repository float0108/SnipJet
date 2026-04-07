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
  console.log("[renderHistory] 开始渲染, history:", history?.length, "container:", !!container);

  if (!container) {
    console.error("[renderHistory] 容器元素不存在");
    return;
  }

  // 始终清空容器内容
  container.innerHTML = "";

  if (history && history.length > 0) {
    console.log("[renderHistory] 处理", history.length, "个项目");
    console.log("[renderHistory] 第一个项目原始数据:", history[0]);

    const htmlParts = history.map((item, index) => {
      // 解析剪贴板项目数据
      const parsedItem = parseClipboardItem(item);
      if (index === 0) {
        console.log("[renderHistory] 第一个项目解析后:", parsedItem);
      }
      // 使用ClipboardItem.js中的renderClipboardItem函数渲染每个项目
      return renderClipboardItem(parsedItem);
    });

    console.log("[renderHistory] 生成的 HTML 片段数:", htmlParts.length);
    container.innerHTML = htmlParts.join("");

    // 异步加载图片预览
    loadAllImagePreviews();

    if (statusElement) {
      statusElement.textContent = "";
      console.log("[renderHistory] 渲染完成，共", history.length, "个项目");
    }
  } else {
    // 即使是空数组，也确保容器被清空
    console.log("[renderHistory] history 为空或长度为 0");
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
