// --- 工具函数：防止 XSS 攻击 ---
const escapeHtml = (str) => {
  if (str === null || str === undefined) return "";
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(str).replace(/[&<>'"]/g, (m) => map[m]);
};

// --- 图标资源 (保持不变，SVG 很通用) ---
const ICONS = {
  edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
  copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  delete: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>`,
  favorite: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
  favoriteFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>`,
};

/**
 * 渲染单个剪贴板项目 (适配紧凑型 UI)
 * @param {Object} item - 解析后的剪贴板项目
 * @returns {string} - 渲染后的HTML字符串
 */
export function renderClipboardItem(item) {
  if (!item) {
    console.warn("[renderClipboardItem] item 为空");
    return "";
  }

  const uniqueId =
    item.id ||
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `temp-${Math.random().toString(36).slice(2)}`);
  const elementId = `item-${uniqueId}`;

  // 时间格式化逻辑
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const now = new Date();
    // 如果是今天，只显示 HH:MM
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
    }
    // 否则显示 MM/DD HH:MM
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  };

  const safeData = {
    // encodedContent 已经是 URI 编码的，只包含安全字符，不需要 HTML 转义
    content: item.encodedContent,
    // format 是内部枚举值 (html/plain/rtf)，只包含字母，无需转义
    // 转义会破坏 === "html" 的判断
    format: item.format || "plain",
    timestamp: item.encodedTimestamp,
    preview: escapeHtml((item.preview || "").trim()),
    label: escapeHtml(item.formatLabel),
    wordCount: item.wordCount ? `${item.wordCount} 字` : "", // 有字数才显示
    displayTime: escapeHtml(formatTimestamp(item.timestamp)),
    isFavorite: item.isFavorite || false,
  };

  // 构建 HTML
  return `
    <div
      class="clipboard-item ${safeData.isFavorite ? 'is-favorite' : ''}"
      id="${elementId}"
      data-content="${safeData.content}"
      data-format="${safeData.format}"
      data-timestamp="${safeData.timestamp}"
      data-id="${uniqueId}"
      onclick="window.pasteToCurrentWindow(this)"
    >
      <div class="item-actions-overlay">
        <button class="card-btn btn-favorite ${safeData.isFavorite ? 'active' : ''}" title="${safeData.isFavorite ? '取消收藏' : '收藏'}" onclick="window.toggleFavorite('${uniqueId}'); event.stopPropagation();">
          ${safeData.isFavorite ? ICONS.favoriteFilled : ICONS.favorite}
        </button>
        <button class="card-btn" title="详情/编辑" onclick="window.openReaderWindow(this.closest('.clipboard-item')); event.stopPropagation();">
          ${ICONS.edit}
        </button>
        <button class="card-btn" title="粘贴为纯文本" onclick="window.pasteAsPlainText(this.closest('.clipboard-item')); event.stopPropagation();">
          ${ICONS.copy}
        </button>
        <button class="card-btn btn-delete" title="删除" onclick="window.deleteClipboardItem('${uniqueId}'); event.stopPropagation();">
          ${ICONS.delete}
        </button>
      </div>

      <div class="item-body">
        <div class="item-preview">${safeData.preview}</div>
      </div>

      <div class="item-meta-row">
        <span class="badge type-${safeData.format}">${safeData.label}</span>

        <div style="display: flex; gap: 8px; align-items: center;">
          ${safeData.wordCount ? `<span class="timestamp" style="opacity: 0.5;">${safeData.wordCount}</span>` : ""}
          <span class="timestamp">${safeData.displayTime}</span>
        </div>
      </div>
    </div>
  `;
}
