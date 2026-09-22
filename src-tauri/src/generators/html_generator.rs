use crate::core::ast::{Block, Document, Inline, ListType};

pub struct HtmlGenerator;

impl HtmlGenerator {
    pub fn generate(&self, doc: &Document) -> String {
        let mut html = String::new();
        let mut blocks_iter = doc.blocks.iter().peekable();

        while let Some(block) = blocks_iter.next() {
            // 合并相邻的同类型列表块
            if let Block::List { items, list_type } = block {
                let mut merged_items = items.clone();
                let current_type = *list_type;

                // 检查后续是否有相邻的同类型列表
                while let Some(&next_block) = blocks_iter.peek() {
                    if let Block::List { items: next_items, list_type: next_type } = next_block {
                        if *next_type == current_type {
                            merged_items.extend(next_items.clone());
                            blocks_iter.next(); // 消费这个相邻的列表
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }

                html.push_str(&self.generate_list(&merged_items, current_type));
            } else {
                html.push_str(&self.generate_block(block));
            }
        }
        html
    }

    fn generate_list(&self, items: &[crate::core::ast::ListItem], list_type: ListType) -> String {
        let tag = match list_type {
            ListType::Ordered => "ol",
            ListType::Unordered => "ul",
        };

        let mut html = format!("<{}>\n", tag);
        for item in items {
            html.push_str("<li>");
            // 先生成内容
            for sub_block in &item.content {
                match sub_block {
                    Block::Paragraph(content) => {
                        html.push_str(&self.generate_inlines(content));
                    }
                    _ => {
                        html.push_str(&self.generate_block(sub_block));
                    }
                }
            }
            // 然后生成嵌套列表
            for nested_list in &item.nested_lists {
                html.push_str(&self.generate_block(nested_list));
            }
            html.push_str("</li>\n");
        }
        html.push_str(&format!("</{}>\n", tag));
        html
    }

    fn generate_block(&self, block: &Block) -> String {
        match block {
            Block::Heading { level, content } => {
                let tag = format!("h{}", level);
                format!("<{}>{}</{}>\n", tag, self.generate_inlines(content), tag)
            }
            Block::Paragraph(content) => {
                format!("<p>{}</p>\n", self.generate_inlines(content))
            }
            Block::CodeBlock { language, code } => {
                let lang_attr = language
                    .as_ref()
                    .map(|l| format!(" class=\"language-{}\"", l))
                    .unwrap_or_default();
                format!("<pre><code{}>{}</code></pre>\n", lang_attr, html_escape(code))
            }
            Block::Table { headers, rows } => {
                let mut html = String::from("<table>\n<thead>\n<tr>\n");
                for header in headers {
                    html.push_str(&format!("<th>{}</th>\n", self.generate_inline(header)));
                }
                html.push_str("</tr>\n</thead>\n<tbody>\n");
                for row in rows {
                    html.push_str("<tr>\n");
                    for cell in row {
                        html.push_str(&format!("<td>{}</td>\n", self.generate_inline(cell)));
                    }
                    html.push_str("</tr>\n");
                }
                html.push_str("</tbody>\n</table>\n");
                html
            }
            Block::MathDisplay(content) => {
                format!("<p><code>[Formula: {}]</code></p>\n", html_escape(content))
            }
            Block::List { items, list_type } => {
                self.generate_list(items, *list_type)
            }
            Block::BlockQuote(content) => {
                let mut html = String::from("<blockquote>\n");
                for sub_block in content {
                    html.push_str(&self.generate_block(sub_block));
                }
                html.push_str("</blockquote>\n");
                html
            }
        }
    }

    fn generate_inlines(&self, inlines: &[Inline]) -> String {
        let mut result = String::new();
        for inline in inlines {
            result.push_str(&self.generate_inline(inline));
        }
        result
    }

    fn generate_inline(&self, inline: &Inline) -> String {
        match inline {
            Inline::Text(content) => html_escape(content),
            Inline::Bold(content) => format!("<strong>{}</strong>", self.generate_inlines(content)),
            Inline::Italic(content) => format!("<em>{}</em>", self.generate_inlines(content)),
            Inline::CodeSpan(content) => format!("<code>{}</code>", html_escape(content)),
            Inline::MathInline(content) => {
                format!("<code>[{}]</code>", html_escape(content))
            }
            Inline::Link { text, url } => {
                format!("<a href=\"{}\">{}</a>", html_escape(url), self.generate_inlines(text))
            }
        }
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 检测文本是否包含 Markdown 标记
pub fn has_markdown_syntax(text: &str) -> bool {
    use regex::Regex;

    // 行首的 Markdown 标记
    // 修复：移除过于宽松的 "|.+|" 模式（任何含 | 的文本都会误命中，例如日志、shell 输出）。
    // 表格行要求 |---|--- 这种分隔行才视为表格，避免误判。
    let patterns = [
        r"^#{1,6}\s",                  // 标题 # ## ### 等
        r"^[-*+]\s",                   // 无序列表 - * +
        r"^\d+\.\s",                   // 有序列表 1. 2. 等
        r"^>\s",                       // 引用块 >
        r"^```",                       // 代码块 ```
        r"`[^`\n]+`",                  // 行内代码 `code`
        r"\*\*[^*\n]+\*\*",            // 粗体 **text**
        r"__[^_\n]+__",                // 粗体 __text__
        r"!\[[^\n]*\]\([^\n]*\)",      // 图片 ![alt](url)
        r"\[[^\n]+\]\([^\n]*\)",       // 链接 [text](url)
        r"\|[\s\-:|]+\|",              // 表格分隔行 |---|---|
    ];

    // 预编译所有正则，避免循环内重复编译
    let compiled: Vec<Regex> = patterns
        .iter()
        .filter_map(|p| Regex::new(p).ok())
        .collect();

    // 斜体 *x* / _x_ 单独判定：要求左右边界是空白/标点/行首行尾，避免误命中乘号、变量名
    let italic_asterisk = Regex::new(r"(^|[\s\W])(\*[^*\s\n][^*\n]*[^*\s\n]\*)([\s\W]|$)").ok();
    let italic_underscore = Regex::new(r"(^|[\s\W])(_[^_\s\n][^_\n]*[^_\s\n]_)([\s\W]|$)").ok();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        for re in &compiled {
            if re.is_match(line) {
                return true;
            }
        }

        if let Some(re) = italic_asterisk.as_ref() {
            if re.is_match(line) {
                return true;
            }
        }
        if let Some(re) = italic_underscore.as_ref() {
            if re.is_match(line) {
                return true;
            }
        }
    }

    false
}

/// 将 Markdown 文本转换为 HTML（仅当包含 Markdown 标记时）
pub fn markdown_to_html(text: &str) -> Option<String> {
    if !has_markdown_syntax(text) {
        return None;
    }

    let doc = crate::core::markdown_parser::parse(text);
    let generator = HtmlGenerator;
    
    // 🔥 直接生成，不要包装任何文档结构
    let html = generator.generate(&doc);
    
    // 🔥 可选：添加一个隐藏的零宽空格或注释来“欺骗”Word
    // 但这通常不需要
    
    if html.contains('<') && html.contains('>') {
        Some(html)
    } else {
        None
    }
}
