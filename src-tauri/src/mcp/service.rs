//! MCP 服务业务逻辑实现
//!
//! 实现 ClipboardMcpService 及其所有工具方法

use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use rmcp::{tool, ServerHandler};
use serde_json::json;
use tauri::{AppHandle, Emitter};

use crate::common::models::{ClipboardItem, ClipboardFormat};
use super::types::*;

/// 剪贴板 MCP 服务
#[derive(Debug, Clone)]
pub struct ClipboardMcpService {
    pub history: Arc<Mutex<Vec<ClipboardItem>>>,
    pub peer: Option<rmcp::Peer<rmcp::RoleServer>>,
    pub app_handle: Option<Arc<AppHandle>>,
}

impl ClipboardMcpService {
    pub fn new(history: Arc<Mutex<Vec<ClipboardItem>>>) -> Self {
        Self {
            history,
            peer: None,
            app_handle: None,
        }
    }

    pub fn with_app_handle(mut self, app_handle: Arc<AppHandle>) -> Self {
        self.app_handle = Some(app_handle);
        self
    }

    /// 通知前端数据已变更
    pub fn notify_data_changed(&self) {
        if let Some(ref app_handle) = self.app_handle {
            // 向所有窗口发送 clipboard-changed 事件
            let _ = app_handle.emit("clipboard-changed", ());
        }
    }

    /// 获取统计概览
    pub fn get_stats_summary(&self) -> String {
        let history = match self.history.lock() {
            Ok(h) => h,
            Err(_) => return "无法获取剪贴板历史".to_string(),
        };

        let total = history.len();
        let favorites = history.iter().filter(|i| i.is_favorite).count();

        let mut format_counts: HashMap<String, usize> = HashMap::new();
        for item in history.iter() {
            let format_name = match item.format {
                ClipboardFormat::Plain => "text",
                ClipboardFormat::Html => "html",
                ClipboardFormat::Markdown => "markdown",
                ClipboardFormat::Rtf => "rtf",
                ClipboardFormat::Image => "image",
                ClipboardFormat::Files => "files",
                ClipboardFormat::Custom(_) => "custom",
            };
            *format_counts.entry(format_name.to_string()).or_insert(0) += 1;
        }

        let mut result = format!("📋 剪贴板历史概览\n总条目: {} 个\n收藏: {} 个\n\n格式分布:\n", total, favorites);
        for (format, count) in format_counts {
            result.push_str(&format!("  - {}: {} 个\n", format, count));
        }
        result
    }
}

// ========== 工具实现 ==========

#[tool(tool_box)]
impl ClipboardMcpService {
    // ========== 查询工具 ==========

    #[tool(description = "列出剪贴板历史记录。支持排序、格式过滤、收藏过滤和分页。")]
    pub async fn list_history(&self, #[tool(aggr)] req: ListHistoryRequest) -> String {
        let history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        let limit = req.limit.unwrap_or(20).min(100);
        let offset = req.offset.unwrap_or(0);
        let favorites_only = req.favorites_only.unwrap_or(false);

        // 过滤
        let mut items: Vec<_> = history.iter()
            .filter(|item| {
                // 格式过滤
                if let Some(ref f) = req.format {
                    if f != "all" {
                        let target = match f.as_str() {
                            "text" => Some(ClipboardFormat::Plain),
                            "html" => Some(ClipboardFormat::Html),
                            "markdown" => Some(ClipboardFormat::Markdown),
                            "rtf" => Some(ClipboardFormat::Rtf),
                            "image" => Some(ClipboardFormat::Image),
                            "files" => Some(ClipboardFormat::Files),
                            _ => None,
                        };
                        if let Some(target) = target {
                            if item.format != target {
                                return false;
                            }
                        }
                    }
                }
                // 收藏过滤
                if favorites_only && !item.is_favorite {
                    return false;
                }
                true
            })
            .cloned()
            .collect();

        // 排序
        match req.sort_by.as_deref() {
            Some("time_asc") => items.sort_by(|a, b| a.timestamp.cmp(&b.timestamp)),
            Some("word_count_desc") => items.sort_by(|a, b| b.word_count.cmp(&a.word_count)),
            Some("word_count_asc") => items.sort_by(|a, b| a.word_count.cmp(&b.word_count)),
            _ => items.sort_by(|a, b| b.timestamp.cmp(&a.timestamp)), // 默认时间降序
        }

        // 分页
        let total = items.len();
        let items: Vec<serde_json::Value> = items
            .into_iter()
            .skip(offset)
            .take(limit)
            .map(|item| {
                let format = match item.format {
                    ClipboardFormat::Plain => "text",
                    ClipboardFormat::Html => "html",
                    ClipboardFormat::Markdown => "markdown",
                    ClipboardFormat::Rtf => "rtf",
                    ClipboardFormat::Image => "image",
                    ClipboardFormat::Files => "files",
                    ClipboardFormat::Custom(ref s) => s,
                };
                json!({
                    "id": item.id,
                    "format": format,
                    "content": item.content,
                    "preview": item.preview,
                    "timestamp": item.timestamp,
                    "word_count": item.word_count,
                    "is_favorite": item.is_favorite,
                    "metadata": item.metadata
                })
            })
            .collect();

        json!({
            "success": true,
            "total": total,
            "offset": offset,
            "limit": limit,
            "count": items.len(),
            "items": items
        }).to_string()
    }

    #[tool(description = "搜索剪贴板历史。根据关键词搜索内容或预览文本。")]
    pub async fn search_history(&self, #[tool(aggr)] req: SearchHistoryRequest) -> String {
        let history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        let limit = req.limit.unwrap_or(20).min(100);
        let case_sensitive = req.case_sensitive.unwrap_or(false);
        let search_preview = req.search_preview.unwrap_or(false);

        let search_query = if case_sensitive {
            req.query.clone()
        } else {
            req.query.to_lowercase()
        };

        let items: Vec<serde_json::Value> = history.iter()
            .filter(|item| {
                let content = if search_preview {
                    &item.preview
                } else {
                    &item.content
                };

                let text = if case_sensitive {
                    content.clone()
                } else {
                    content.to_lowercase()
                };

                text.contains(&search_query)
            })
            .take(limit)
            .map(|item| {
                let format = match item.format {
                    ClipboardFormat::Plain => "text",
                    ClipboardFormat::Html => "html",
                    ClipboardFormat::Markdown => "markdown",
                    ClipboardFormat::Rtf => "rtf",
                    ClipboardFormat::Image => "image",
                    ClipboardFormat::Files => "files",
                    ClipboardFormat::Custom(ref s) => s,
                };
                json!({
                    "id": item.id,
                    "format": format,
                    "content": item.content,
                    "preview": item.preview,
                    "timestamp": item.timestamp,
                    "word_count": item.word_count,
                    "is_favorite": item.is_favorite,
                    "metadata": item.metadata
                })
            })
            .collect();

        json!({
            "success": true,
            "query": req.query,
            "count": items.len(),
            "items": items
        }).to_string()
    }

    #[tool(description = "根据 ID 获取单个剪贴板条目详情。")]
    pub async fn get_item(&self, #[tool(aggr)] req: GetItemRequest) -> String {
        let history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        match history.iter().find(|item| item.id == req.id) {
            Some(item) => {
                let format = match item.format {
                    ClipboardFormat::Plain => "text",
                    ClipboardFormat::Html => "html",
                    ClipboardFormat::Markdown => "markdown",
                    ClipboardFormat::Rtf => "rtf",
                    ClipboardFormat::Image => "image",
                    ClipboardFormat::Files => "files",
                    ClipboardFormat::Custom(ref s) => s,
                };
                json!({
                    "success": true,
                    "data": {
                        "id": item.id,
                        "format": format,
                        "content": item.content,
                        "preview": item.preview,
                        "timestamp": item.timestamp,
                        "word_count": item.word_count,
                        "is_favorite": item.is_favorite,
                        "metadata": item.metadata
                    }
                }).to_string()
            }
            None => json!({ "success": false, "message": "条目不存在" }).to_string(),
        }
    }

    #[tool(description = "获取所有收藏的剪贴板条目。")]
    pub async fn list_favorites(&self) -> String {
        let history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        let items: Vec<serde_json::Value> = history.iter()
            .filter(|item| item.is_favorite)
            .map(|item| {
                let format = match item.format {
                    ClipboardFormat::Plain => "text",
                    ClipboardFormat::Html => "html",
                    ClipboardFormat::Markdown => "markdown",
                    ClipboardFormat::Rtf => "rtf",
                    ClipboardFormat::Image => "image",
                    ClipboardFormat::Files => "files",
                    ClipboardFormat::Custom(ref s) => s,
                };
                json!({
                    "id": item.id,
                    "format": format,
                    "content": item.content,
                    "preview": item.preview,
                    "timestamp": item.timestamp,
                    "word_count": item.word_count,
                    "is_favorite": item.is_favorite,
                    "metadata": item.metadata
                })
            })
            .collect();

        json!({
            "success": true,
            "count": items.len(),
            "items": items
        }).to_string()
    }

    #[tool(description = "获取剪贴板历史统计信息。")]
    pub async fn get_stats(&self) -> String {
        let history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        let total = history.len();
        let favorites = history.iter().filter(|i| i.is_favorite).count();

        let mut format_counts: HashMap<String, usize> = HashMap::new();
        for item in history.iter() {
            let format_name = match item.format {
                ClipboardFormat::Plain => "text",
                ClipboardFormat::Html => "html",
                ClipboardFormat::Markdown => "markdown",
                ClipboardFormat::Rtf => "rtf",
                ClipboardFormat::Image => "image",
                ClipboardFormat::Files => "files",
                ClipboardFormat::Custom(_) => "custom",
            };
            *format_counts.entry(format_name.to_string()).or_insert(0) += 1;
        }

        json!({
            "success": true,
            "total_items": total,
            "favorite_items": favorites,
            "formats": format_counts
        }).to_string()
    }

    // ========== 增删改工具 ==========

    #[tool(description = "添加新的剪贴板条目。返回新创建的条目信息。")]
    pub async fn add_item(&self, #[tool(aggr)] req: AddItemRequest) -> String {
        let mut history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        // 生成 hash 作为 ID
        let hash = crate::clipboard_manager::ClipboardManager::generate_hash(req.content.as_bytes());

        // 检查是否已存在
        if history.iter().any(|i| i.id == hash) {
            return json!({ "success": false, "message": "条目已存在" }).to_string();
        }

        // 解析格式并创建条目
        let format_str = req.format.unwrap_or_else(|| "text".to_string());
        let item = match format_str.as_str() {
            "html" => ClipboardItem::new_html(&req.content, &hash),
            "markdown" => ClipboardItem::new_markdown(&req.content, &hash),
            "rtf" => ClipboardItem::new_rtf(&req.content, &hash),
            _ => ClipboardItem::new_text(&req.content, &hash),
        };

        // 插入到最前面
        history.insert(0, item.clone());

        // 限制长度
        if history.len() > 50 {
            history.truncate(50);
        }

        self.notify_data_changed();

        let format = match item.format {
            ClipboardFormat::Plain => "text",
            ClipboardFormat::Html => "html",
            ClipboardFormat::Markdown => "markdown",
            ClipboardFormat::Rtf => "rtf",
            ClipboardFormat::Image => "image",
            ClipboardFormat::Files => "files",
            ClipboardFormat::Custom(ref s) => s,
        };

        json!({
            "success": true,
            "id": item.id,
            "message": "条目添加成功",
            "data": {
                "id": item.id,
                "format": format,
                "preview": item.preview
            }
        }).to_string()
    }

    #[tool(description = "更新剪贴板条目的内容或收藏状态。返回是否成功。")]
    pub async fn update_item(&self, #[tool(aggr)] req: UpdateItemRequest) -> String {
        let mut history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        match history.iter_mut().find(|item| item.id == req.id) {
            Some(item) => {
                // 更新内容
                if let Some(new_content) = req.content {
                    item.content = new_content;
                    item.word_count = item.content.chars().count();
                }

                // 更新收藏状态
                if let Some(fav) = req.is_favorite {
                    item.is_favorite = fav;
                }

                self.notify_data_changed();

                json!({
                    "success": true,
                    "message": "条目更新成功",
                    "id": item.id
                }).to_string()
            }
            None => json!({ "success": false, "message": "条目不存在" }).to_string(),
        }
    }

    #[tool(description = "删除单个剪贴板条目。返回是否成功。")]
    pub async fn delete_item(&self, #[tool(aggr)] req: DeleteItemRequest) -> String {
        let mut history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        let initial_len = history.len();
        history.retain(|item| item.id != req.id);

        if history.len() < initial_len {
            self.notify_data_changed();
            json!({ "success": true, "message": "条目删除成功", "id": req.id }).to_string()
        } else {
            json!({ "success": false, "message": "条目不存在" }).to_string()
        }
    }

    #[tool(description = "批量删除剪贴板条目。返回删除的数量。")]
    pub async fn delete_items(&self, #[tool(aggr)] req: DeleteItemsRequest) -> String {
        let mut history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        let initial_len = history.len();
        history.retain(|item| !req.ids.contains(&item.id));
        let deleted_count = initial_len - history.len();

        if deleted_count > 0 {
            self.notify_data_changed();
        }

        json!({
            "success": true,
            "deleted_count": deleted_count,
            "message": format!("已删除 {} 个条目", deleted_count)
        }).to_string()
    }

    #[tool(description = "切换剪贴板条目的收藏状态。返回新的收藏状态。")]
    pub async fn toggle_favorite(&self, #[tool(aggr)] req: ToggleFavoriteRequest) -> String {
        let mut history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        match history.iter_mut().find(|item| item.id == req.id) {
            Some(item) => {
                item.is_favorite = !item.is_favorite;
                let new_status = item.is_favorite;

                self.notify_data_changed();

                json!({
                    "success": true,
                    "id": req.id,
                    "is_favorite": new_status,
                    "message": if new_status { "已添加到收藏" } else { "已取消收藏" }
                }).to_string()
            }
            None => json!({ "success": false, "message": "条目不存在" }).to_string(),
        }
    }

    #[tool(description = "清空剪贴板历史。可选择保留收藏条目。返回删除的数量。")]
    pub async fn clear_history(&self, #[tool(aggr)] req: ClearHistoryRequest) -> String {
        let mut history = match self.history.lock() {
            Ok(h) => h,
            Err(e) => return json!({ "success": false, "error": e.to_string() }).to_string(),
        };

        let initial_len = history.len();

        if req.keep_favorites.unwrap_or(false) {
            history.retain(|item| item.is_favorite);
        } else {
            history.clear();
        }

        let deleted_count = initial_len - history.len();

        if deleted_count > 0 {
            self.notify_data_changed();
        }

        json!({
            "success": true,
            "deleted_count": deleted_count,
            "message": format!("已清空 {} 个条目", deleted_count)
        }).to_string()
    }
}

// ========== ServerHandler 实现 ==========

#[tool(tool_box)]
impl ServerHandler for ClipboardMcpService {
    fn get_info(&self) -> rmcp::model::ServerInfo {
        use rmcp::model::ServerCapabilities;
        rmcp::model::ServerInfo {
            instructions: Some("SnipJet 剪贴板管理器 MCP 服务。提供剪贴板历史的查询、搜索、增删改功能。\n\n主要工具:\n- list_history: 列出历史记录（支持排序、过滤、分页）\n- search_history: 搜索历史记录\n- get_item: 获取单个条目\n- list_favorites: 获取收藏列表\n- get_stats: 获取统计信息\n- add_item: 添加新条目\n- update_item: 更新条目\n- delete_item: 删除单个条目\n- delete_items: 批量删除条目\n- toggle_favorite: 切换收藏状态\n- clear_history: 清空历史".into()),
            capabilities: ServerCapabilities::builder()
                .enable_resources()
                .enable_tools()
                .build(),
            ..Default::default()
        }
    }

    fn get_peer(&self) -> Option<rmcp::Peer<rmcp::RoleServer>> {
        self.peer.clone()
    }

    fn set_peer(&mut self, peer: rmcp::Peer<rmcp::RoleServer>) {
        self.peer = Some(peer);
    }

    /// 列出所有可用资源
    async fn list_resources(
        &self,
        _pagination: rmcp::model::PaginatedRequestParam,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ListResourcesResult, rmcp::model::ErrorData> {
        use rmcp::model::{Annotated, ListResourcesResult, RawResource};

        Ok(ListResourcesResult {
            resources: vec![
                Annotated::new(RawResource::new("snipjet://stats/summary", "剪贴板统计概览"), None),
            ],
            next_cursor: None,
        })
    }

    /// 读取指定资源
    async fn read_resource(
        &self,
        request: rmcp::model::ReadResourceRequestParam,
        _context: rmcp::service::RequestContext<rmcp::RoleServer>,
    ) -> Result<rmcp::model::ReadResourceResult, rmcp::model::ErrorData> {
        use rmcp::model::{ErrorData, ReadResourceResult, ResourceContents};

        let content = match request.uri.as_str() {
            "snipjet://stats/summary" => self.get_stats_summary(),
            _ => return Err(ErrorData::resource_not_found(
                format!("Resource not found: {}", request.uri),
                None,
            )),
        };

        Ok(ReadResourceResult {
            contents: vec![ResourceContents::text(content, request.uri)],
        })
    }
}
