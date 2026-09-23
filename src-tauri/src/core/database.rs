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

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        // 启用外键约束
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };

        db.init_schema()?;

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
                word_count INTEGER NOT NULL DEFAULT 0
            );

            -- 收藏表（独立存储，与历史表完全分离）
            CREATE TABLE IF NOT EXISTS favorites (
                id TEXT PRIMARY KEY,
                format TEXT NOT NULL,
                content TEXT NOT NULL,
                preview TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                word_count INTEGER NOT NULL DEFAULT 0,
                favorited_at INTEGER NOT NULL
            );

            -- 历史元数据表
            CREATE TABLE IF NOT EXISTS clipboard_metadata (
                item_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (item_id, key),
                FOREIGN KEY (item_id) REFERENCES clipboard_items(id) ON DELETE CASCADE
            );

            -- 收藏元数据表
            CREATE TABLE IF NOT EXISTS favorites_metadata (
                item_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                PRIMARY KEY (item_id, key),
                FOREIGN KEY (item_id) REFERENCES favorites(id) ON DELETE CASCADE
            );

            -- 索引
            CREATE INDEX IF NOT EXISTS idx_clipboard_timestamp ON clipboard_items(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_favorites_favorited_at ON favorites(favorited_at DESC);
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
                "INSERT INTO clipboard_items (id, format, content, preview, timestamp, word_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    item.id,
                    format_str,
                    item.content,
                    item.preview,
                    item.timestamp,
                    item.word_count as i32
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
            "SELECT id, format, content, preview, timestamp, word_count
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
                is_favorite: false, // 历史表不再存储收藏状态，默认 false
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

    /// 获取单个项目
    pub fn get_item(&self, id: &str) -> Result<Option<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, format, content, preview, timestamp, word_count
             FROM clipboard_items WHERE id = ?1"
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let result = stmt.query_row([id], |row| {
            Ok(ClipboardItem {
                id: row.get(0)?,
                format: parse_format(&row.get::<_, String>(1)?),
                content: row.get(2)?,
                preview: row.get(3)?,
                timestamp: row.get(4)?,
                word_count: row.get::<_, i32>(5)? as usize,
                metadata: std::collections::HashMap::new(),
                is_favorite: false, // 历史表不再存储收藏状态，默认 false
            })
        });

        match result {
            Ok(mut item) => {
                item.metadata = self.load_metadata_internal(&conn, &item.id)?;
                Ok(Some(item))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get item: {}", e)),
        }
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

    /// 按条数清理：仅保留最新的 `keep_count` 条记录。
    /// 收藏表中的项目不会被删除（即使它们对应的历史项要被清理）。
    /// 返回被删除记录的 id 列表（用于上层清理对应的图片文件）。
    pub fn delete_history_excess_by_count(
        &self,
        keep_count: usize,
    ) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        // 收藏 id 集合（需要排除的历史 id）
        let favorite_ids: std::collections::HashSet<String> = {
            let mut stmt = conn
                .prepare("SELECT id FROM favorites")
                .map_err(|e| format!("Failed to prepare favorites query: {}", e))?;
            let rows = stmt
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| format!("Failed to query favorites: {}", e))?;
            let mut set = std::collections::HashSet::new();
            for id in rows {
                if let Ok(id) = id {
                    set.insert(id);
                }
            }
            set
        };

        // 取出全部历史 id，按 timestamp DESC 排序
        let mut stmt = conn
            .prepare("SELECT id, timestamp FROM clipboard_items ORDER BY timestamp DESC")
            .map_err(|e| format!("Failed to prepare history query: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })
            .map_err(|e| format!("Failed to query history: {}", e))?;

        let mut all: Vec<(String, i64)> = Vec::new();
        for r in rows {
            all.push(r.map_err(|e| format!("Failed to read history row: {}", e))?);
        }

        // 计算需要保留的非收藏条目数
        // 收藏项永远保留，其余按时间倒序保留最新 keep_count 条
        let non_favorite_count = all.iter().filter(|(id, _)| !favorite_ids.contains(id)).count();
        let to_delete_from_non_fav = non_favorite_count.saturating_sub(keep_count);

        if to_delete_from_non_fav == 0 {
            return Ok(Vec::new());
        }

        let mut deleted_ids: Vec<String> = Vec::with_capacity(to_delete_from_non_fav);
        let mut skipped = 0usize;
        for (id, _ts) in all.iter() {
            if favorite_ids.contains(id) {
                continue;
            }
            if skipped < to_delete_from_non_fav {
                deleted_ids.push(id.clone());
                skipped += 1;
            } else {
                break;
            }
        }

        // 批量执行删除
        if !deleted_ids.is_empty() {
            let placeholders = std::iter::repeat("?")
                .take(deleted_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "DELETE FROM clipboard_items WHERE id IN ({})",
                placeholders
            );
            let params: Vec<&dyn rusqlite::ToSql> =
                deleted_ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            conn.execute(&sql, params.as_slice())
                .map_err(|e| format!("Failed to delete excess history: {}", e))?;
            info!(
                "Deleted {} history items by count (keep={})",
                deleted_ids.len(),
                keep_count
            );
        }

        Ok(deleted_ids)
    }

    /// 按时间清理：删除 timestamp 早于 cutoff_ts 的历史记录。
    /// 收藏的项目不会被删除。
    /// 返回被删除的 id 列表。
    pub fn delete_history_older_than(
        &self,
        cutoff_ts: i64,
    ) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        // 先查询出将被删除的 id 列表（用于上层清理图片文件）
        let mut stmt = conn
            .prepare("SELECT id FROM clipboard_items WHERE timestamp < ?1")
            .map_err(|e| format!("Failed to prepare old history query: {}", e))?;
        let rows = stmt
            .query_map([cutoff_ts], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query old history: {}", e))?;
        let mut ids: Vec<String> = Vec::new();
        for r in rows {
            ids.push(r.map_err(|e| format!("Failed to read old history row: {}", e))?);
        }

        if ids.is_empty() {
            return Ok(Vec::new());
        }

        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM clipboard_items WHERE id IN ({})",
            placeholders
        );
        let params: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        conn.execute(&sql, params.as_slice())
            .map_err(|e| format!("Failed to delete old history: {}", e))?;
        info!(
            "Deleted {} history items older than timestamp {}",
            ids.len(),
            cutoff_ts
        );

        Ok(ids)
    }

    // ==================== 收藏表独立操作 ====================

    /// 检查项目是否已收藏
    pub fn is_favorite(&self, id: &str) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM favorites WHERE id = ?1",
            [id],
            |row| row.get(0)
        ).map_err(|e| format!("Failed to check favorite status: {}", e))?;

        Ok(count > 0)
    }

    /// 添加项目到收藏表（从历史表复制）
    pub fn add_to_favorites(&self, item: &ClipboardItem) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        let tx = conn.transaction()
            .map_err(|e| format!("Failed to begin transaction: {}", e))?;

        let format_str = format_to_string(&item.format);
        let favorited_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;

        // 插入到收藏表
        tx.execute(
            "INSERT OR REPLACE INTO favorites (id, format, content, preview, timestamp, word_count, favorited_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                item.id,
                format_str,
                item.content,
                item.preview,
                item.timestamp,
                item.word_count as i32,
                favorited_at
            ],
        ).map_err(|e| format!("Failed to add to favorites: {}", e))?;

        // 复制元数据
        for (key, value) in &item.metadata {
            tx.execute(
                "INSERT OR REPLACE INTO favorites_metadata (item_id, key, value) VALUES (?1, ?2, ?3)",
                params![item.id, key, value],
            ).map_err(|e| format!("Failed to insert favorite metadata: {}", e))?;
        }

        tx.commit().map_err(|e| format!("Failed to commit transaction: {}", e))?;

        info!("Added item {} to favorites", item.id);
        Ok(())
    }

    /// 从收藏表移除项目
    pub fn remove_from_favorites(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        conn.execute("DELETE FROM favorites WHERE id = ?1", [id])
            .map_err(|e| format!("Failed to remove from favorites: {}", e))?;

        info!("Removed item {} from favorites", id);
        Ok(())
    }

    /// 加载所有收藏
    pub fn load_favorites(&self) -> Result<Vec<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, format, content, preview, timestamp, word_count
             FROM favorites ORDER BY favorited_at DESC"
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
                is_favorite: true, // 从收藏表加载的项默认是收藏状态
            })
        }).map_err(|e| format!("Failed to query favorites: {}", e))?;

        let mut result: Vec<ClipboardItem> = items.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Failed to collect favorites: {}", e))?;

        // 加载每个收藏项的元数据
        for item in &mut result {
            item.metadata = self.load_favorite_metadata_internal(&conn, &item.id)?;
        }

        info!("Loaded {} favorites from database", result.len());
        Ok(result)
    }

    /// 从收藏表删除单个项目
    pub fn delete_favorite_item(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        conn.execute("DELETE FROM favorites WHERE id = ?1", [id])
            .map_err(|e| format!("Failed to delete favorite item: {}", e))?;

        info!("Deleted favorite item {}", id);
        Ok(())
    }

    /// 从收藏表获取单个项目
    pub fn get_favorite_item(&self, id: &str) -> Result<Option<ClipboardItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Failed to lock connection: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT id, format, content, preview, timestamp, word_count
             FROM favorites WHERE id = ?1"
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let result = stmt.query_row([id], |row| {
            Ok(ClipboardItem {
                id: row.get(0)?,
                format: parse_format(&row.get::<_, String>(1)?),
                content: row.get(2)?,
                preview: row.get(3)?,
                timestamp: row.get(4)?,
                word_count: row.get::<_, i32>(5)? as usize,
                metadata: std::collections::HashMap::new(),
                is_favorite: true,
            })
        });

        match result {
            Ok(mut item) => {
                item.metadata = self.load_favorite_metadata_internal(&conn, &item.id)?;
                Ok(Some(item))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get favorite item: {}", e)),
        }
    }

    /// 加载收藏项的元数据
    fn load_favorite_metadata_internal(&self, conn: &Connection, item_id: &str) -> Result<std::collections::HashMap<String, String>, String> {
        let mut stmt = conn.prepare(
            "SELECT key, value FROM favorites_metadata WHERE item_id = ?1"
        ).map_err(|e| format!("Failed to prepare metadata statement: {}", e))?;

        let pairs = stmt.query_map([item_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| format!("Failed to query favorite metadata: {}", e))?;

        let mut metadata = std::collections::HashMap::new();
        for pair in pairs {
            let (key, value) = pair.map_err(|e| format!("Failed to get metadata pair: {}", e))?;
            metadata.insert(key, value);
        }

        Ok(metadata)
    }

    /// 切换收藏状态（在两个表之间复制/删除）
    pub fn toggle_favorite(&self, id: &str) -> Result<bool, String> {
        let is_currently_favorite = self.is_favorite(id)?;

        if is_currently_favorite {
            // 取消收藏：从收藏表删除
            self.remove_from_favorites(id)?;
            Ok(false)
        } else {
            // 添加收藏：从历史表复制到收藏表
            if let Some(item) = self.get_item(id)? {
                self.add_to_favorites(&item)?;
                Ok(true)
            } else {
                Err(format!("Item {} not found in history", id))
            }
        }
    }
}

/// 将 ClipboardFormat 转换为字符串（已迁移到 ClipboardFormat::to_db_string）
#[allow(dead_code)]
fn format_to_string(format: &ClipboardFormat) -> String {
    format.to_db_string()
}

/// 将字符串解析为 ClipboardFormat（已迁移到 ClipboardFormat::from_db_string）
#[allow(dead_code)]
fn parse_format(s: &str) -> ClipboardFormat {
    ClipboardFormat::from_db_string(s)
}
