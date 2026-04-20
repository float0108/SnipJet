// 文本格式化工具

/**
 * 将 HTML 转换为纯文本
 * @param {string} html - HTML 内容
 * @returns {string} - 纯文本内容
 */
export function html2text(html) {
  if (!html) return "";

  // 0. 首先移除可能存在的 CSS 样式、脚本和注释
  let cleanedHtml = html
    // 移除 <style>...</style> 及其内容（非贪婪匹配）
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // 移除 <script>...</script> 及其内容
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    // 移除 HTML 注释 <!--...-->
    .replace(/<!--[\s\S]*?-->/g, "")
    // 移除 @font-face 相关（如果还有残留的）
    .replace(/@font-face\s*\{[^}]*\}/gi, "")
    // 移除 @page 相关
    .replace(/@page\s*\{[^}]*\}/gi, "")
    // 移除 CSS 类定义（简单的花括号匹配）
    .replace(/[.#][^{]+\{[^}]*\}/g, "");

  // 1. 预处理：使用占位符标记块级元素边界，避免与 DOM 结构换行重复
  // 使用特殊字符 §¶ 作为换行标记（不太可能在正常文本中出现）
  const NEWLINE_MARKER = "\u00A7\u00B6";

  let processedHtml = cleanedHtml
    .replace(/<br\s*\/?>/gi, "\n") // <br> 直接换行
    // 块级元素结束标签替换为换行标记（后续统一处理）
    .replace(/<\/p>/gi, NEWLINE_MARKER)
    .replace(/<\/div>/gi, NEWLINE_MARKER)
    .replace(/<\/li>/gi, NEWLINE_MARKER)
    .replace(/<\/h[1-6]>/gi, NEWLINE_MARKER)
    // 表格相关
    .replace(/<\/tr>/gi, NEWLINE_MARKER)
    .replace(/<td[^>]*>/gi, "\t") // td 开始用制表符
    .replace(/<\/td>/gi, " "); // td 结束用空格

  // 2. 创建临时 DOM
  const temp = document.createElement("div");
  temp.innerHTML = processedHtml;

  // 3. 获取 textContent（自动解码 HTML 实体）
  let text = temp.textContent || "";

  // 4. 后处理：统一处理换行标记和清理空白
  text = text
    // 将所有换行标记替换为单个换行
    .replace(new RegExp(NEWLINE_MARKER, "g"), "\n")
    // 合并连续的 3 个及以上换行为 2 个（保留段落间隔）
    .replace(/\n{3,}/g, "\n\n")
    // 每行去除首尾空格
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    // 再次清理可能产生的多余换行
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
