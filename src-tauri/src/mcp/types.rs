//! MCP 请求/响应类型定义
//!
//! 定义所有工具的请求结构体

use rmcp::schemars;
use serde::Deserialize;

// ========== 查询相关请求 ==========

/// 列出剪贴板历史请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ListHistoryRequest {
    #[schemars(description = "排序方式: time_desc(时间降序), time_asc(时间升序), word_count_desc(字数降序), word_count_asc(字数升序)，默认 time_desc")]
    pub sort_by: Option<String>,

    #[schemars(description = "格式过滤: all(全部), text(纯文本), html, markdown, rtf, image, files，默认 all")]
    pub format: Option<String>,

    #[schemars(description = "是否只显示收藏，默认 false")]
    pub favorites_only: Option<bool>,

    #[schemars(description = "返回条数限制，默认 20，最大 100")]
    pub limit: Option<usize>,

    #[schemars(description = "偏移量，用于分页，默认 0")]
    pub offset: Option<usize>,
}

/// 搜索剪贴板历史请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct SearchHistoryRequest {
    #[schemars(description = "搜索关键词（必填）")]
    pub query: String,

    #[schemars(description = "是否区分大小写，默认 false")]
    pub case_sensitive: Option<bool>,

    #[schemars(description = "返回条数限制，默认 20，最大 100")]
    pub limit: Option<usize>,

    #[schemars(description = "是否搜索预览文本（默认只搜索内容），默认 false")]
    pub search_preview: Option<bool>,
}

/// 获取单个条目请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct GetItemRequest {
    #[schemars(description = "条目 ID（必填）")]
    pub id: String,
}

// ========== 增删改相关请求 ==========

/// 添加剪贴板条目请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AddItemRequest {
    #[schemars(description = "条目内容（必填）")]
    pub content: String,

    #[schemars(description = "格式类型: text, html, markdown, rtf，默认 text")]
    pub format: Option<String>,
}

/// 更新剪贴板条目请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct UpdateItemRequest {
    #[schemars(description = "条目 ID（必填）")]
    pub id: String,

    #[schemars(description = "新内容")]
    pub content: Option<String>,

    #[schemars(description = "是否收藏")]
    pub is_favorite: Option<bool>,
}

/// 删除剪贴板条目请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteItemRequest {
    #[schemars(description = "条目 ID（必填）")]
    pub id: String,
}

/// 批量删除剪贴板条目请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct DeleteItemsRequest {
    #[schemars(description = "条目 ID 列表（必填）")]
    pub ids: Vec<String>,
}

/// 切换收藏状态请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ToggleFavoriteRequest {
    #[schemars(description = "条目 ID（必填）")]
    pub id: String,
}

/// 清空历史请求
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ClearHistoryRequest {
    #[schemars(description = "是否保留收藏条目，默认 false")]
    pub keep_favorites: Option<bool>,
}
