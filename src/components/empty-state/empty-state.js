// 空状态组件

/**
 * 渲染空状态
 * @returns {string} 空状态的HTML字符串
 */
export function renderEmptyState() {
  return `
    <div class="empty-state">
      <div class="empty-icon">
        <div class="icon icon-empty" style="width: 48px; height: 48px; opacity: 0.5;"></div>
      </div>
      <div class="empty-text">暂无剪贴板内容</div>
      <div class="empty-description">复制内容后将显示在这里</div>
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
