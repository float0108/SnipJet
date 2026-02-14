// 文本格式化工具

/**
 * 将 HTML 转换为纯文本
 * @param {string} html - HTML 内容
 * @returns {string} - 纯文本内容
 */
export function html2text(html) {
  if (!html) return "";

  // 1. 预处理：将 HTML 中的换行标签显式替换为换行符 \n
  // 这是为了保证 <div>A</div><div>B</div> 变成 "A\nB" 而不是 "AB"
  let processedHtml = html
    .replace(/<br\s*\/?>/gi, "\n") // <br> 换行
    .replace(/<\/p>/gi, "\n") // 段落结束 换行
    .replace(/<\/div>/gi, "\n") // div结束 换行
    .replace(/<\/li>/gi, "\n") // 列表项结束 换行
    .replace(/<\/h[1-6]>/gi, "\n"); // 标题结束 换行

  // 2. 创建临时 DOM
  const temp = document.createElement("div");
  temp.innerHTML = processedHtml;

  // 3. 获取 textContent
  // textContent 的特性是：
  // - 它会自动解码 HTML 实体 (如 &nbsp; 变成空格, &lt; 变成 <)
  // - 它会原样保留所有空格、制表符和我们刚才插入的 \n
  // - 它不会像 innerText 那样受 CSS 样式影响导致文本合并
  return temp.textContent.trim() || "";
}
