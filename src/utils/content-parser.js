// 内容解析服务
// 用于处理不同类型剪贴板内容的解析和显示逻辑

/**
 * 获取内容格式的显示标签
 * @param {string} format - 内容格式
 * @returns {string} - 显示标签
 */
export function getFormatLabel(format) {
  const labels = {
    plain: "纯文本",
    html: "HTML",
    rtf: "富文本",
    image: "图片",
    files: "文件",
  };
  return labels[format] || format;
}

/**
 * 解析剪贴板内容，生成解析后的字段
 * @param {Object} item - 剪贴板项目
 * @returns {Object} - 解析后的字段
 */
export function parseClipboardItem(item) {
  if (!item) return null;

  return {
    id: item.id,
    format: item.format || "plain",
    content: item.content,
    preview: item.preview,
    timestamp: item.timestamp,
    wordCount: item.word_count || 0,
    formatLabel: getFormatLabel(item.format || "plain"),
    encodedContent: encodeURIComponent(item.content),
    encodedTimestamp: encodeURIComponent(item.timestamp),
  };
}


