import he from 'he';

function generateMarker() {
  return '\x00' + Math.random().toString(36).slice(2) + '\x00';
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
      preBlocks.push(he.decode(content.replace(/<[^>]+>/g, "")));
      return `\x00PRE${preBlocks.length - 1}\x00`;
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => {
      codeBlocks.push(he.decode(content.replace(/<[^>]+>/g, "")));
      return `\x00CODE${codeBlocks.length - 1}\x00`;
    });

  // 3. 表格处理
  cleaned = cleaned
    .replace(/<\/tr>/gi, NEWLINE_MARKER)
    .replace(/<\/td>|<\/th>/gi, TAB_MARKER)
    .replace(/>\s+</g, '><');

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

  // 6. 移除所有 HTML 标签（包括 <span> 等）
  cleaned = cleaned.replace(/<[^>]+>/g, "");

  // 7. 解码 HTML 实体（包括 &nbsp;）
  cleaned = he.decode(cleaned);

  // 8. 恢复 pre/code 块（内部换行保留为换行占位符）
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

  // 9. 还原占位符为真实字符
  cleaned = cleaned
    .replace(new RegExp(NEWLINE_MARKER, "g"), "\n")
    .replace(new RegExp(TAB_MARKER, "g"), "\t");

  // 10. 逐行清理
  cleaned = cleaned
    .split("\n")
    .map(line => {
      // 1. 统一所有空白符（包含 &nbsp;）
      line = line.replace(/\u00A0/g, " ");

      // 2. 核心：处理制表符（单元格）周边的任何空白
      // \s 指所有空白，但因为我们已经 split('\n') 了，这里的 \s 实际上只剩空格和制表符
      // 下面的正则意思是：匹配制表符及其两边所有的纯空格并合并为制表符
      line = line.replace(/[ ]*\t[ ]*/g, "\t");

      // 3. 只有当这一行不全是空白时，才执行 trim
      if (line.trim().length > 0) {
        line = line.replace(/^[ ]+|[ ]+$/g, ""); // 去首尾空格
        line = line.replace(/[ ]{2,}/g, " ");    // 合并中间多余空格
      } else {
        line = ""; // 纯空白行归一化
      }
      return line;
    })
    .join("\n");

  // 去除首尾空行
  return cleaned.trim();
}