// 文本格式化工具
import he from 'he';

/**
 * 生成随机占位符，避免与文本内容冲突
 */
function generateMarker() {
  return `\x00${Math.random().toString(36).slice(2)}\x00`;
}

/**
 * 将 HTML 转换为纯文本
 * @param {string} html - HTML 内容
 * @returns {string} - 纯文本内容
 */
export function html2text(html) {
  if (!html) return "";

  // 生成唯一占位符
  const NEWLINE_MARKER = generateMarker();
  const TAB_MARKER = generateMarker();

  // 1. 首先移除 CSS、脚本，但保留 <pre> 和 <code> 内容稍后处理
  let cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // 2. 保护 <pre> 和 <code> 内容（暂时替换为占位符）
  const preBlocks = [];
  const codeBlocks = [];

  cleaned = cleaned
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (match, content) => {
      preBlocks.push(he.decode(content.replace(/<[^>]+>/g, "")));
      return `\x00PRE${preBlocks.length - 1}\x00`;
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (match, content) => {
      codeBlocks.push(he.decode(content.replace(/<[^>]+>/g, "")));
      return `\x00CODE${codeBlocks.length - 1}\x00`;
    });

  // 3. 处理表格：td/th 加制表符，tr 加换行
  cleaned = cleaned
    .replace(/<\/td>/gi, TAB_MARKER)
    .replace(/<\/th>/gi, TAB_MARKER)
    .replace(/<\/tr>/gi, NEWLINE_MARKER);

  // 4. 处理其他换行标签
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, NEWLINE_MARKER)
    .replace(/<\/div>/gi, NEWLINE_MARKER)
    .replace(/<\/p>/gi, NEWLINE_MARKER)
    .replace(/<\/li>/gi, NEWLINE_MARKER)
    .replace(/<\/h[1-6]>/gi, (match) => match + NEWLINE_MARKER);

  // 5. 处理列表项前缀（<li> 前加 "- "）
  cleaned = cleaned.replace(/<li[^>]*>/gi, "- ");

  // 6. 移除所有 HTML 标签
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // 7. 解码 HTML 实体
  cleaned = he.decode(cleaned);

  // 8. 清理原始 HTML 中的换行（标签间的格式化换行）
  // 这些换行不是内容，应该变成空格而不是分段
  // 只有我们明确添加的 NEWLINE_MARKER 才是真正的换行
  cleaned = cleaned.replace(/\n/g, " ");

  // 9. 合并每段内部的连续空格，过滤空段
  cleaned = cleaned
    .split(NEWLINE_MARKER)
    .map(segment => {
      // 恢复制表符
      let s = segment.replace(new RegExp(TAB_MARKER, "g"), "\t");
      // 合并连续空格（保留制表符）
      s = s.replace(/[ ]+/g, " ").trim();
      return s;
    })
    .filter(segment => segment.length > 0)
    .join(NEWLINE_MARKER);

  // 10. 恢复 <pre> 和 <code> 块
  preBlocks.forEach((content, i) => {
    cleaned = cleaned.replace(
      `\x00PRE${i}\x00`,
      content.replace(/\n/g, NEWLINE_MARKER)
    );
  });
  codeBlocks.forEach((content, i) => {
    cleaned = cleaned.replace(
      `\x00CODE${i}\x00`,
      content.replace(/\n/g, NEWLINE_MARKER)
    );
  });

  // 11. 还原换行标记并清理
  return cleaned
    .replace(new RegExp(NEWLINE_MARKER, "g"), "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
