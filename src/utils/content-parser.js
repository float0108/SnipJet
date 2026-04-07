// 内容解析服务
// 用于处理不同类型剪贴板内容的解析和显示逻辑

/**
 * 获取内容格式的显示标签
 * @param {string} format - 内容格式
 * @returns {string} - 显示标签
 */
export function getFormatLabel(format) {
  // 后端返回 "text"，前端统一使用 "text"
  const labels = {
    text: "纯文本",      // 后端 ClipboardFormat::Plain 序列化为 "text"
    plain: "纯文本",     // 兼容旧数据
    html: "HTML",
    markdown: "MD",      // Markdown 富文本
    rtf: "富文本",
    image: "图片",
    files: "文件",
    custom: "自定义",
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

  // 后端返回的 format 可能是 "text" (Plain), "html", "rtf", "image", "files"
  const format = item.format || "text";

  const result = {
    id: item.id,
    format: format,
    content: item.content,
    preview: item.preview,
    timestamp: item.timestamp,
    wordCount: item.word_count || 0,
    formatLabel: getFormatLabel(format),
    encodedContent: encodeURIComponent(item.content || ""),
    encodedTimestamp: encodeURIComponent(item.timestamp || ""),
    isFavorite: item.is_favorite || false,
  };

  // 添加图片特定字段
  if (format === "image" && item.metadata) {
    result.imageWidth = item.metadata.width;
    result.imageHeight = item.metadata.height;
    result.imageFormat = item.metadata.image_format || "png";
    result.imageSize = item.metadata.size;
  }

  return result;
}


