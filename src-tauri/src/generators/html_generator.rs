use crate::core::ast::{Block, Document, Inline};

pub struct HtmlGenerator;

impl HtmlGenerator {
    pub fn generate(&self, doc: &Document) -> String {
        let mut html = String::new();
        let mut blocks_iter = doc.blocks.iter().peekable();

        while let Some(block) = blocks_iter.next() {
            // 合并相邻的列表块
            if let Block::List { items } = block {
                let mut merged_items = items.clone();

                // 检查后续是否有相邻的列表
                while let Some(&next_block) = blocks_iter.peek() {
                    if let Block::List { items: next_items } = next_block {
                        merged_items.extend(next_items.clone());
                        blocks_iter.next(); // 消费这个相邻的列表
                    } else {
                        break;
                    }
                }

                html.push_str(&self.generate_list(&merged_items));
            } else {
                html.push_str(&self.generate_block(block));
            }
        }
        html
    }

    fn generate_list(&self, items: &[Vec<Block>]) -> String {
        let mut html = String::from("<ul>\n");
        for item in items {
            html.push_str("<li>");
            for sub_block in item {
                match sub_block {
                    Block::Paragraph(content) => {
                        html.push_str(&self.generate_inlines(content));
                    }
                    _ => {
                        html.push_str(&self.generate_block(sub_block));
                    }
                }
            }
            html.push_str("</li>\n");
        }
        html.push_str("</ul>\n");
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
            Block::List { items } => {
                // 列表在 generate() 方法中合并处理，这里直接生成
                self.generate_list(items)
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
    let patterns = [
        r"^#{1,6}\s",           // 标题 # ## ### 等
        r"^[-*+]\s",            // 无序列表 - * +
        r"^\d+\.\s",            // 有序列表 1. 2. 等
        r"^>\s",                // 引用块 >
        r"^```",                // 代码块 ```
        r"`[^`]+`",             // 行内代码 `code`
        r"\*[^*]+\*",           // 斜体 *text*
        r"_[^_]+_",             // 斜体 _text_
        r"\*\*[^*]+\*\*",       // 粗体 **text**
        r"__[^_]+__",           // 粗体 __text__
        r"!\[.*?\]\(.*?\)",     // 图片 ![alt](url)
        r"\[.*?\]\(.*?\)",      // 链接 [text](url)
        r"\|.+\|",              // 表格 | col | col |
    ];

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        for pattern in &patterns {
            if let Ok(re) = Regex::new(pattern) {
                if re.is_match(line) {
                    return true;
                }
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
    let html = generator.generate(&doc);

    // 检查生成的 HTML 是否有效（不只是包装的纯文本）
    if html.contains('<') && html.contains('>') {
        Some(html)
    } else {
        None
    }
}
