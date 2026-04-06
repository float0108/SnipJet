use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use log::info;
use rusqlite::{Connection, params};

use crate::common::models::{ClipboardFormat, ClipboardItem};

/// 数据库文件名
const DB_FILE: &str = "snipjet.db";

/// 数据库管理器
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    /// 创建新的数据库连接
    pub fn new(app_data_dir: &PathBuf) -> Result<Self, String> {
        let db_path = app_data_dir.join(DB_FILE);
        info!("Opening database at: {:?}", db_path);

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // 启用外键约束
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.init_schema()?;
        info!("Database initialized successfully");

        Ok(db)
    }

    /// 初始化数据库 schema
    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        conn.execute_batch(
            r#"
            -- 剪贴板历史表
            CREATE TABLE IF NOT EXISTS clipboard_items (
                id TEXT PRIMARY KEY,
                format TEXT NOT NULL,
                content TEXT NOT NULL,
                preview TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                word_count INTEGER NOT NULL DEFAULT 0,
                is_favorite INTEGER NOT NULL DEFAULT 0
            );

            -- 元数据表
            CREATE TABLE IF NOT EXISTS clipboard_metadata (
                item_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (item_id, key),
                FOREIGN KEY (item_id) REFERENCES clipboard_items(id) ON DELETE CASCADE
            );

            -- 索引
            CREATE INDEX IF NOT EXISTS idx_clipboard_timestamp ON clipboard_items(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_clipboard_favorite ON clipboard_items(is_favorite, timestamp DESC);
            "#
        ).map_err(|e| format!("Failed to initialize schema: {}", e))?;

        Ok(())
    }

    /// 检查剪贴板历史表是否为空
    pub fn is_history_empty(&self) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM clipboard_items",
            [],
            |row| row.get(0)
        ).map_err(|e| format!("Failed to count items: {}", e))?;

        Ok(count == 0)
    }

    /// 保存剪贴板历史（全量替换）
    pub fn save_clipboard_history(&self, history: &[ClipboardItem]) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        let tx = conn.transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        // 清空现有数据
        tx.execute("DELETE FROM clipboard_items", [])
            .map_err(|e| format!("Failed to clear clipboard_items: {}", e))?;

        // 插入所有项目
        for item in history {
            let format_str = format_to_string(&item.format);

            tx.execute(
                "INSERT INTO clipboard_items (id, format, content, preview, timestamp, word_count, is_favorite)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    item.id,
                    format_str,
                    item.content,
                    item.preview,
                    item.timestamp,
                    item.word_count as i32,
                    item.is_favorite as i32
                ],
            ).map_err(|e| format!("Failed to insert clipboard item: {}", e))?;

            // 插入元数据
            for (key, value) in &item.metadata {
                tx.execute(
                    "INSERT INTO clipboard_metadata (item_id, key, value) VALUES (?1, ?2, ?3)",
                    params![item.id, key, value],
                ).map_err(|e| format!("Failed to insert metadata: {}", e))?;
            }
        }

        tx.commit().map_err(|e| format!("Failed to commit transaction: {}", e))?;

        info!("Saved {} clipboard items to database", history.len());
        Ok(())
    }

    /// 加载剪贴板历史
    pub fn load_clipboard_history(&self) -> Result<Vec<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, format, content, preview, timestamp, word_count, is_favorite
             FROM clipboard_items ORDER BY timestamp DESC"
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let items = stmt.query_map([], |row| {
            Ok(ClipboardItem {
                id: row.get(0)?,
                format: parse_format(&row.get::<_, String>(1)?),
                content: row.get(2)?,
                preview: row.get(3)?,
                timestamp: row.get(4)?,
                word_count: row.get::<_, i32>(5)? as usize,
                metadata: std::collections::HashMap::new(),
                is_favorite: row.get::<_, i32>(6)? != 0,
            })
        }).map_err(|e| format!("Failed to query items: {}", e))?;

        let mut result: Vec<ClipboardItem> = items.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect items: {}", e))?;

        // 加载每个项目的元数据
        for item in &mut result {
            item.metadata = self.load_metadata_internal(&conn, &item.id)?;
        }

        info!("Loaded {} clipboard items from database", result.len());
        Ok(result)
    }

    /// 加载单个项目的元数据
    fn load_metadata_internal(&self, conn: &Connection, item_id: &str) -> Result<std::collections::HashMap<String, String>, String> {
        let mut stmt = conn.prepare(
            "SELECT key, value FROM clipboard_metadata WHERE item_id = ?1"
        ).map_err(|e| format!("Failed to prepare metadata statement: {}", e))?;

        let pairs = stmt.query_map([item_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| format!("Failed to query metadata: {}", e))?;

        let mut metadata = std::collections::HashMap::new();
        for pair in pairs {
            let (key, value) = pair.map_err(|e| format!("Failed to get metadata pair: {}", e))?;
            metadata.insert(key, value);
        }

        Ok(metadata)
    }

    /// 切换收藏状态
    pub fn toggle_favorite(&self, id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        // 获取当前状态
        let current: bool = conn.query_row(
            "SELECT is_favorite FROM clipboard_items WHERE id = ?1",
            [id],
            |row| Ok(row.get::<_, i32>(0)? != 0)
        ).map_err(|e| format!("Failed to get favorite status: {}", e))?;

        let new_status = !current;

        conn.execute(
            "UPDATE clipboard_items SET is_favorite = ?1 WHERE id = ?2",
            params![new_status as i32, id]
        ).map_err(|e| format!("Failed to update favorite status: {}", e))?;

        info!("Toggled favorite status for item {} to {}", id, new_status);
        Ok(new_status)
    }

    /// 删除单个项目
    pub fn delete_item(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        conn.execute("DELETE FROM clipboard_items WHERE id = ?1", [id])
            .map_err(|e| format!("Failed to delete item: {}", e))?;

        info!("Deleted clipboard item {}", id);
        Ok(())
    }

    /// 清空所有历史
    pub fn clear_history(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        conn.execute("DELETE FROM clipboard_items", [])
            .map_err(|e| format!("Failed to clear history: {}", e))?;

        info!("Cleared all clipboard history");
        Ok(())
    }
}

/// 将 ClipboardFormat 转换为字符串
fn format_to_string(format: &ClipboardFormat) -> String {
    match format {
        ClipboardFormat::Plain => "text".to_string(),
        ClipboardFormat::Html => "html".to_string(),
        ClipboardFormat::Markdown => "markdown".to_string(),
        ClipboardFormat::Rtf => "rtf".to_string(),
        ClipboardFormat::Image => "image".to_string(),
        ClipboardFormat::Files => "files".to_string(),
        ClipboardFormat::Custom(s) => format!("custom:{}", s),
    }
}

/// 将字符串解析为 ClipboardFormat
fn parse_format(s: &str) -> ClipboardFormat {
    match s {
        "text" => ClipboardFormat::Plain,
        "html" => ClipboardFormat::Html,
        "markdown" => ClipboardFormat::Markdown,
        "rtf" => ClipboardFormat::Rtf,
        "image" => ClipboardFormat::Image,
        "files" => ClipboardFormat::Files,
        s if s.starts_with("custom:") => {
            ClipboardFormat::Custom(s[7..].to_string())
        }
        _ => ClipboardFormat::Plain,
    }
}
