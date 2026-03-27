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

  // 1. 预处理：将 HTML 中的换行标签显式替换为换行符 \n
  // 这是为了保证 <div>A</div><div>B</div> 变成 "A\nB" 而不是 "AB"
  let processedHtml = cleanedHtml
    .replace(/<br\s*\/?>/gi, "\n") // <br> 换行
    .replace(/<\/p>/gi, "\n") // 段落结束 换行
    .replace(/<\/div>/gi, "\n") // div结束 换行
    .replace(/<\/li>/gi, "\n") // 列表项结束 换行
    .replace(/<\/h[1-6]>/gi, "\n") // 标题结束 换行
    .replace(/<tr>/gi, "\n") // 表格行开始 换行
    .replace(/<\/tr>/gi, "\n") // 表格行结束 换行
    .replace(/<td>/gi, "\t") // 表格单元格开始 制表符
    .replace(/<\/td>/gi, " "); // 表格单元格结束 空格

  // 2. 创建临时 DOM
  const temp = document.createElement("div");
  temp.innerHTML = processedHtml;

  // 3. 获取 textContent
  // textContent 的特性是：
  // - 它会自动解码 HTML 实体 (如 &nbsp; 变成空格, &lt; 变成 <)
  // - 它会原样保留所有空格、制表符和我们刚才插入的 \n
  // - 它不会像 innerText 那样受 CSS 样式影响导致文本合并
  let text = temp.textContent || "";

  // 4. 后处理：清理多余的空白
  text = text
    // 将多个连续换行合并为最多两个
    .replace(/\n{3,}/g, "\n\n")
    // 将行首行尾的空格去除
    .split("\n")
    .map(line => line.trim())
    .join("\n")
    // 再次清理可能产生的多余换行
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
