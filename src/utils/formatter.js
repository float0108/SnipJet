// 占位符哨兵：不用 \x00，DOMParser 会把它当非法字符丢弃，导致表格/换行失效
const PLACEHOLDER_PREFIX = 'SNIPJETMARK';
const PLACEHOLDER_SUFFIX = 'Z';

function generateMarker() {
  return PLACEHOLDER_PREFIX + Math.random().toString(36).slice(2) + PLACEHOLDER_SUFFIX;
}

// 只剥离「被解析成元素节点的」标签，保留正文里的字面尖括号（如 `a < b && c > d`）。
// DOMParser 顺带完成实体解码，返回的 textContent 已是解码结果，调用方不要再 decode。
function stripTags(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent || "";
  } catch (e) {
    // 极端畸形输入下解析失败时退回正则，至少不抛错
    return html.replace(/<[^>]+>/g, "");
  }
}

export function html2text(html) {
  if (!html) return "";

  const NEWLINE_MARKER = generateMarker();
  const TAB_MARKER = generateMarker();

  // 1. 移除无关标签和注释
  let cleaned = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // 2. 保护 <pre> 和 <code> 内容
  const preBlocks = [];
  const codeBlocks = [];

  cleaned = cleaned
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, content) => {
      preBlocks.push(stripTags(content));
      return `${PLACEHOLDER_PREFIX}PRE${preBlocks.length - 1}${PLACEHOLDER_SUFFIX}`;
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => {
      codeBlocks.push(stripTags(content));
      return `${PLACEHOLDER_PREFIX}CODE${codeBlocks.length - 1}${PLACEHOLDER_SUFFIX}`;
    });

  // 3. 表格处理
  cleaned = cleaned
    .replace(/<\/tr>/gi, NEWLINE_MARKER)
    .replace(/<\/td>|<\/th>/gi, TAB_MARKER);
  // 不压缩标签间空白：<span>foo</span> <span>bar</span> 的分隔空格是真实词间空格，
  // 删掉会粘成 foobar；排版空白由后面统一归一化

  // 4. 其他块级标签
  cleaned = cleaned
    .replace(/<br\s*\/?>/gi, NEWLINE_MARKER)
    .replace(/<\/div>/gi, NEWLINE_MARKER)
    .replace(/<\/p>/gi, NEWLINE_MARKER)
    .replace(/<\/li>/gi, NEWLINE_MARKER)
    .replace(/<\/h[1-6]>/gi, match => match + NEWLINE_MARKER);

  // 5. 列表项前缀
  cleaned = cleaned.replace(/<li[^>]*>/gi, "- ");

  // 移除所有 HTML 标签之前，先清理源码中的物理换行和回车
  // 这一步必须放在还原 pre/code 之前，因为它们内部的换行已经通过占位符保护了
  cleaned = cleaned.replace(/[\r\n]+/g, " ");

  // 6. 移除所有 HTML 标签
  //    交给 DOMParser 分词，只删被解析成元素节点的标签，正文里的尖括号不受影响
  //    （正则 /<[^>]+>/g 会把 `if (a < b && c > d)` 从 '<' 一路吃到 '>'）
  cleaned = stripTags(cleaned);

  // 7. 恢复 pre/code 块（内部换行保留为换行占位符）
  preBlocks.forEach((content, i) => {
    cleaned = cleaned.replace(
      `${PLACEHOLDER_PREFIX}PRE${i}${PLACEHOLDER_SUFFIX}`,
      content.replace(/\n/g, NEWLINE_MARKER)
    );
  });
  codeBlocks.forEach((content, i) => {
    cleaned = cleaned.replace(
      `${PLACEHOLDER_PREFIX}CODE${i}${PLACEHOLDER_SUFFIX}`,
      content.replace(/\n/g, NEWLINE_MARKER)
    );
  });

  // 8. 还原占位符为真实字符
  cleaned = cleaned
    .replace(new RegExp(NEWLINE_MARKER, "g"), "\n")
    .replace(new RegExp(TAB_MARKER, "g"), "\t");

  // 9. 逐行清理
  cleaned = cleaned
    .split("\n")
    .map(line => {
      // 1. 统一所有空白符（包含 &nbsp;）
      line = line.replace(/\u00A0/g, " ");

      // 2. 核心：处理制表符（单元格）周边的任何空白
      // \s 指所有空白，但因为我们已经 split('\n') 了，这里的 \s 实际上只剩空格和制表符
      // 下面的正则意思是：匹配制表符及其两边所有的纯空格并合并为制表符
      line = line.replace(/[ ]*\t[ ]*/g, "\t");

      // 3. 去行尾制表符：换行前的 </td> 会留下孤立 \t，复制出去是多余的制表位
      if (line.trim().length > 0) {
        line = line.replace(/^[ ]+|[ ]+$/g, ""); // 去首尾空格
        line = line.replace(/[ ]{2,}/g, " ");    // 合并中间多余空格
        line = line.replace(/\t+$/, "");        // 去行尾制表符
      } else {
        line = ""; // 纯空白行归一化
      }
      return line;
    })
    .join("\n");

  // 去除首尾空行
  return cleaned.trim();
}
