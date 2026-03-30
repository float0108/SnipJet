use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
// 引入 nanohtml2text
use nanohtml2text::html2text;

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub enum ClipboardFormat {
    #[serde(rename = "text")]
    Plain,
    #[serde(rename = "html")]
    Html,
    #[serde(rename = "rtf")]
    Rtf,
    #[serde(rename = "image")]
    Image,
    #[serde(rename = "files")]
    Files,
    #[serde(rename = "custom")]
    Custom(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClipboardItem {
    pub id: String,
    pub format: ClipboardFormat,
    pub content: String,
    pub preview: String,
    pub timestamp: i64,
    pub word_count: usize,
    pub metadata: HashMap<String, String>,
    #[serde(default)]
    pub is_favorite: bool,
}

impl ClipboardItem {
    // --- 核心构造逻辑 ---

    /// 通用基础构造器
    /// 修改：word_count 现在作为参数传入，避免在 base 内部重复计算或解析
    fn base(
        id: &str,
        format: ClipboardFormat,
        content: String,
        preview: String,
        word_count: usize,
    ) -> Self {
        Self {
            id: id.to_string(),
            format,
            content,
            preview,
            timestamp: Utc::now().timestamp_millis(),
            word_count,
            metadata: HashMap::new(),
            is_favorite: false,
        }
    }

    pub fn new_text(content: &str, hash: &str) -> Self {
        // 纯文本直接截取预览
        let preview = Self::make_text_preview(content);
        let word_count = content.chars().count();
        Self::base(
            hash,
            ClipboardFormat::Plain,
            content.to_string(),
            preview,
            word_count,
        )
    }

    pub fn new_html(content: &str, hash: &str) -> Self {
        // 1. 使用 nanohtml2text 获取纯文本
        // 这里的开销比手写解析稍大，但准确度高（处理了实体转义等）
        let plain_text = html2text(content);

        // 2. 基于纯文本生成预览
        let preview = Self::make_text_preview(&plain_text);

        // 3. 基于纯文本计算字数 (比统计 HTML 源码字符更准确)
        let word_count = plain_text.chars().count();

        Self::base(
            hash,
            ClipboardFormat::Html,
            content.to_string(),
            preview,
            word_count,
        )
    }

    pub fn new_rtf(content: &str, hash: &str) -> Self {
        let preview = Self::make_text_preview(content);
        let word_count = content.chars().count();
        Self::base(
            hash,
            ClipboardFormat::Rtf,
            content.to_string(),
            preview,
            word_count,
        )
    }

    pub fn new_image(
        base64: &str,
        hash: &str,
        width: Option<usize>,
        height: Option<usize>,
    ) -> Self {
        let mut item = Self::base(
            hash,
            ClipboardFormat::Image,
            base64.to_string(),
            "[图片]".to_string(),
            0, // 图片字数为 0
        );

        if let Some(w) = width {
            item.metadata.insert("width".to_string(), w.to_string());
        }
        if let Some(h) = height {
            item.metadata.insert("height".to_string(), h.to_string());
        }
        item
    }

    pub fn new_files(files: Vec<String>, hash: &str) -> Self {
        let count = files.len();
        let first_file = files.first().map(|s| s.as_str()).unwrap_or("未知文件");

        let preview = if count > 1 {
            format!("[文件] {} 等 {} 个文件", first_file, count)
        } else {
            format!("[文件] {}", first_file)
        };

        let content_json = serde_json::to_string(&files).unwrap_or_else(|_| "[]".to_string());

        let mut item = Self::base(hash, ClipboardFormat::Files, content_json, preview, 0);
        item.metadata
            .insert("file_count".to_string(), count.to_string());
        item
    }

    /// 生成文本预览
    /// 修改：现在假设传入的 text 已经是纯文本（HTML 已被转换）
    /// 只负责去除多余空白和截断
    fn make_text_preview(text: &str) -> String {
        const MAX_PREVIEW_CHARS: usize = 50;

        // 处理空白符 (将换行、制表符都视为空格)
        let words: Vec<&str> = text.split_whitespace().collect();

        if words.is_empty() {
            return "[空白]".to_string();
        }

        let mut preview = String::new();
        let mut current_len = 0;

        for word in words {
            let word_len = word.chars().count();

            // 如果单个单词直接超长 (非常罕见，但需处理)
            if current_len == 0 && word_len > MAX_PREVIEW_CHARS {
                let truncated: String = word.chars().take(MAX_PREVIEW_CHARS).collect();
                preview.push_str(&truncated);
                preview.push_str("...");
                break;
            }

            if current_len + word_len > MAX_PREVIEW_CHARS {
                // 空间不够了，截断并退出
                // 这里可以做的更细致：截断当前单词，或者直接省略
                preview.push_str("...");
                break;
            }

            if !preview.is_empty() {
                preview.push(' ');
                current_len += 1;
            }

            preview.push_str(word);
            current_len += word_len;
        }

        if preview.is_empty() {
            "[空白]".to_string()
        } else {
            preview
        }
    }
}
