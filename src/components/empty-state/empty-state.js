// 空状态组件

/**
 * 渲染空状态
 * @param {string} customText - 自定义空状态文本
 * @param {string} customDescription - 自定义空状态描述
 * @returns {string} 空状态的HTML字符串
 */
export function renderEmptyState(customText, customDescription) {
  const text = customText || "暂无剪贴板内容";
  const description = customDescription !== undefined
    ? customDescription
    : "复制内容后将显示在这里";

  return `
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.3;">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path>
          <rect x="9" y="3" width="6" height="4" rx="1"></rect>
        </svg>
      </div>
      <div class="empty-text">${text}</div>
      ${description ? `<div class="empty-description">${description}</div>` : ""}
    </div>
  `;
}

/**
 * 确保加载空状态样式
 */
export function ensureEmptyStateStyles() {
  if (
    !document.querySelector(
      'link[href="./components/empty-state/empty-state.css"]',
    )
  ) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "./components/empty-state/empty-state.css";
    document.head.appendChild(link);
  }
}
