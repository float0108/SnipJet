use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::common::models::ClipboardItem;
use crate::core::database::Database;

// 应用数据文件名称
const SETTINGS_FILE: &str = "settings.json";
const TEXT_EXPAND_FILE: &str = "text_expand.yaml";
const LEGACY_HISTORY_FILE: &str = "clipboard_history.json";

/// 文本扩展规则数据结构（用于文件存储）
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TextExpandRuleData {
    pub key: String,
    pub content: String,
    pub group: String,
    pub description: String,
    pub date: String,
}

/// 数据存储管理器
pub struct DataStore {
    app_data_dir: PathBuf,
    db: Database,
    last_saved_history: Arc<Mutex<Vec<ClipboardItem>>>,
}

impl DataStore {
    /// 创建新的数据存储管理器（通过 AppHandle）
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;

        Self::from_path(&app_data_dir)
    }

    /// 从路径创建数据存储管理器
    pub fn from_path(app_data_dir: &std::path::Path) -> Result<Self, String> {
        // 确保目录存在
        if !app_data_dir.exists() {
            fs::create_dir_all(app_data_dir)
                .map_err(|e| format!("Failed to create app data dir: {}", e))?;
        }

        // 初始化数据库
        let db = Database::new(&app_data_dir.to_path_buf())?;

        Ok(Self {
            app_data_dir: app_data_dir.to_path_buf(),
            db,
            last_saved_history: Arc::new(Mutex::new(Vec::new())),
        })
    }

    /// 获取设置文件路径
    fn get_settings_path(&self) -> PathBuf {
        self.app_data_dir.join(SETTINGS_FILE)
    }

    /// 获取文本扩展规则文件路径
    fn get_text_expand_path(&self) -> PathBuf {
        self.app_data_dir.join(TEXT_EXPAND_FILE)
    }

    /// 获取旧版 JSON 历史文件路径
    fn get_legacy_history_path(&self) -> PathBuf {
        self.app_data_dir.join(LEGACY_HISTORY_FILE)
    }

    /// 获取图片存储目录
    pub fn get_images_dir(&self) -> PathBuf {
        let dir = self.app_data_dir.join("assets").join("images");
        if !dir.exists() {
            fs::create_dir_all(&dir).ok();
        }
        dir
    }

    /// 保存图片文件，返回相对路径
    pub fn save_image(&self, hash: &str, image_data: &[u8]) -> Result<String, String> {
        let filename = format!("{}.png", hash);
        let filepath = self.get_images_dir().join(&filename);

        fs::write(&filepath, image_data)
            .map_err(|e| format!("Failed to save image: {}", e))?;

        // 返回相对路径
        Ok(format!("assets/images/{}", filename))
    }

    /// 读取图片文件
    pub fn load_image(&self, relative_path: &str) -> Result<Vec<u8>, String> {
        let filepath = self.app_data_dir.join(relative_path);
        fs::read(&filepath)
            .map_err(|e| format!("Failed to load image: {}", e))
    }

    /// 删除图片文件
    pub fn delete_image(&self, relative_path: &str) -> Result<(), String> {
        let filepath = self.app_data_dir.join(relative_path);
        if filepath.exists() {
            fs::remove_file(&filepath)
                .map_err(|e| format!("Failed to delete image: {}", e))?;
        }
        Ok(())
    }

    /// 获取图片绝对路径（供前端使用）
    pub fn get_image_absolute_path(&self, relative_path: &str) -> PathBuf {
        self.app_data_dir.join(relative_path)
    }

    /// 从旧版 JSON 文件迁移数据
    pub fn migrate_from_json(&self) -> Result<bool, String> {
        let legacy_path = self.get_legacy_history_path();

        if !legacy_path.exists() {
            info!("No legacy JSON file found, skipping migration");
            return Ok(false);
        }

        // 检查数据库是否已有数据
        if !self.db.is_history_empty()? {
            info!("Database already has data, skipping migration");
            return Ok(false);
        }

        info!("Migrating clipboard history from JSON to SQLite...");

        let content = fs::read_to_string(&legacy_path)
            .map_err(|e| format!("Failed to read legacy history file: {}", e))?;

        // 尝试解析历史记录
        let history: Vec<ClipboardItem> = match serde_json::from_str(&content) {
            Ok(items) => items,
            Err(e) => {
                error!("Failed to parse legacy history file: {}", e);
                // 尝试以 Value 格式解析（处理旧数据格式）
                let raw_value: Result<serde_json::Value, _> = serde_json::from_str(&content);
                match raw_value {
                    Ok(values) => {
                        if let Some(array) = values.as_array() {
                            let migrated: Vec<ClipboardItem> = array
                                .iter()
                                .filter_map(|v| self.parse_legacy_item(v))
                                .collect();
                            info!("Successfully migrated {} items from old data format", migrated.len());
                            migrated
                        } else {
                            warn!("Legacy history file is not a valid array");
                            return Ok(false);
                        }
                    }
                    Err(e2) => {
                        error!("Failed to parse legacy file even as raw JSON: {}", e2);
                        return Err(format!("Legacy file is corrupted"));
                    }
                }
            }
        };

        if history.is_empty() {
            info!("No items to migrate");
            return Ok(false);
        }

        // 保存到数据库
        self.db.save_clipboard_history(&history)?;

        // 备份旧文件
        let backup_path = legacy_path.with_extension("json.bak");
        if let Err(e) = fs::rename(&legacy_path, &backup_path) {
            warn!("Failed to rename legacy file to backup: {}", e);
        }

        info!("Migration completed: {} items migrated, backup saved to {:?}", history.len(), backup_path);
        Ok(true)
    }

    /// 解析旧版数据项
    fn parse_legacy_item(&self, v: &serde_json::Value) -> Option<ClipboardItem> {
        use crate::common::models::ClipboardFormat;

        let id = v.get("id")?.as_str()?.to_string();
        let content = v.get("content")?.as_str()?.to_string();
        let preview = v.get("preview")?.as_str()?.to_string();
        let timestamp = v.get("timestamp")?.as_i64()?;
        let word_count = v.get("word_count")?.as_u64()? as usize;

        let format_str = v.get("format")?.as_str()?;
        let format = match format_str {
            "html" => ClipboardFormat::Html,
            "markdown" => ClipboardFormat::Markdown,
            "rtf" => ClipboardFormat::Rtf,
            "image" => ClipboardFormat::Image,
            "files" => ClipboardFormat::Files,
            _ => ClipboardFormat::Plain,
        };

        let metadata = v.get("metadata")
            .and_then(|m| m.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| {
                        v.as_str().map(|s| (k.clone(), s.to_string()))
                    })
                    .collect()
            })
            .unwrap_or_default();

        let is_favorite = v.get("is_favorite")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        Some(ClipboardItem {
            id,
            format,
            content,
            preview,
            timestamp,
            word_count,
            metadata,
            is_favorite,
        })
    }

    /// 保存剪贴板历史到数据库
    pub fn save_clipboard_history(&self, history: &[ClipboardItem]) -> Result<(), String> {
        self.db.save_clipboard_history(history)?;

        // 更新最后保存的历史记录
        let mut last_saved = self.last_saved_history.lock().unwrap();
        *last_saved = history.to_vec();

        Ok(())
    }

    /// 从数据库加载剪贴板历史
    pub fn load_clipboard_history(&self) -> Result<Vec<ClipboardItem>, String> {
        let history = self.db.load_clipboard_history()?;

        // 更新最后保存的历史记录
        let mut last_saved = self.last_saved_history.lock().unwrap();
        *last_saved = history.clone();

        Ok(history)
    }

    /// 切换收藏状态（在两个表之间复制/删除）
    pub fn toggle_favorite(&self, id: &str) -> Result<bool, String> {
        self.db.toggle_favorite(id)
    }

    /// 从数据库加载所有收藏
    pub fn load_favorites(&self) -> Result<Vec<ClipboardItem>, String> {
        self.db.load_favorites()
    }

    /// 从历史表删除单个项目（不影响收藏表）
    pub fn delete_item(&self, id: &str) -> Result<(), String> {
        // 先获取条目信息，检查是否是图片类型
        if let Some(item) = self.db.get_item(id)? {
            // 如果是图片类型，删除图片文件
            if matches!(item.format, crate::common::models::ClipboardFormat::Image) {
                if let Err(e) = self.delete_image(&item.content) {
                    // 记录错误但继续删除数据库记录
                    log::warn!("Failed to delete image file: {}", e);
                }
            }
        }

        // 从历史表删除（不影响收藏表）
        self.db.delete_item(id)
    }

    /// 从收藏表删除单个项目（不影响历史表）
    pub fn delete_favorite_item(&self, id: &str) -> Result<(), String> {
        // 先获取收藏项信息，检查是否是图片类型
        if let Some(item) = self.db.get_favorite_item(id)? {
            // 如果是图片类型，需要特别处理（收藏和历史可能共享同一张图片）
            // 检查历史表中是否还有引用同一张图片的项
            if matches!(item.format, crate::common::models::ClipboardFormat::Image) {
                // 只有当历史表中也没有使用这张图片时，才删除图片文件
                let history = self.db.load_clipboard_history()?;
                let still_in_use = history.iter().any(|h| h.content == item.content);
                if !still_in_use {
                    if let Err(e) = self.delete_image(&item.content) {
                        log::warn!("Failed to delete image file: {}", e);
                    }
                }
            }
        }

        // 从收藏表删除
        self.db.delete_favorite_item(id)
    }

    /// 清空所有历史
    pub fn clear_history(&self) -> Result<(), String> {
        // 获取所有图片类型的条目，删除图片文件
        let history = self.db.load_clipboard_history()?;
        for item in history.iter() {
            if matches!(item.format, crate::common::models::ClipboardFormat::Image) {
                if let Err(e) = self.delete_image(&item.content) {
                    log::warn!("Failed to delete image file: {}", e);
                }
            }
        }

        // 清空数据库
        self.db.clear_history()
    }

    /// 按条数清理：仅保留最新 keep_count 条历史（收藏项始终保留）。
    /// 返回删除的非收藏条目数量。
    pub fn clean_history_by_count(&self, keep_count: usize) -> Result<usize, String> {
        let deleted_ids = self.db.delete_history_excess_by_count(keep_count)?;
        let deleted_count = deleted_ids.len();
        if deleted_count == 0 {
            return Ok(0);
        }

        // 对于被删除的项，如果它们是图片且收藏表中不再引用同一张图片，才删除图片文件
        // 这里采用保守策略：仅在被删除 id 列表里查找图片格式
        for id in &deleted_ids {
            if let Ok(Some(item)) = self.db.get_item(id) {
                if matches!(item.format, crate::common::models::ClipboardFormat::Image) {
                    // 检查收藏表中是否还有引用同一 content 的项
                    let favorites = self.db.load_favorites().unwrap_or_default();
                    let still_in_use = favorites.iter().any(|f| f.content == item.content);
                    if !still_in_use {
                        if let Err(e) = self.delete_image(&item.content) {
                            log::warn!("Failed to delete image file during count cleanup: {}", e);
                        }
                    }
                }
            }
        }
        Ok(deleted_count)
    }

    /// 按时间清理：删除早于 N 天前的条目（收藏项始终保留）。
    /// 返回删除的条目数量。
    pub fn clean_history_by_age_days(&self, days: i64) -> Result<usize, String> {
        // 计算 cutoff 时间戳（毫秒）
        let now_ms = chrono::Utc::now().timestamp_millis();
        let cutoff_ms = now_ms - days * 24 * 60 * 60 * 1000;

        let deleted_ids = self.db.delete_history_older_than(cutoff_ms)?;
        let deleted_count = deleted_ids.len();
        if deleted_count == 0 {
            return Ok(0);
        }

        for id in &deleted_ids {
            if let Ok(Some(item)) = self.db.get_item(id) {
                if matches!(item.format, crate::common::models::ClipboardFormat::Image) {
                    let favorites = self.db.load_favorites().unwrap_or_default();
                    let still_in_use = favorites.iter().any(|f| f.content == item.content);
                    if !still_in_use {
                        if let Err(e) = self.delete_image(&item.content) {
                            log::warn!("Failed to delete image file during age cleanup: {}", e);
                        }
                    }
                }
            }
        }
        Ok(deleted_count)
    }

    /// 保存设置到文件
    pub fn save_settings(&self, settings: &serde_json::Value) -> Result<(), String> {
        let path = self.get_settings_path();

        let json = serde_json::to_string_pretty(settings)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;

        let mut file = fs::File::create(&path)
            .map_err(|e| format!("Failed to create settings file: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write settings file: {}", e))?;

        info!("Settings saved to {:?}", path);
        Ok(())
    }

    /// 从文件加载设置
    /// 修复：原实现直接返回文件内容，缺失字段时前端会拿到 undefined。
    /// 改为与默认值深度合并，保证所有已知字段都有合理值。
    pub fn load_settings(&self) -> Result<serde_json::Value, String> {
        let path = self.get_settings_path();

        if !path.exists() {
            info!("No settings file found at {:?}, returning default settings", path);
            return Ok(Self::default_settings());
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read settings file: {}", e))?;

        let settings: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse settings file: {}", e))?;

        // 与默认值深度合并，缺失字段用默认值填充
        let defaults = Self::default_settings();
        let merged = merge_json_values(&defaults, &settings);

        info!("Settings loaded from {:?}", path);
        Ok(merged)
    }

    /// 保存文本扩展规则到文件
    pub fn save_text_expand_rules(&self, rules: &[TextExpandRuleData]) -> Result<(), String> {
        let path = self.get_text_expand_path();

        let config = serde_json::json!({
            "rules": rules
        });

        let yaml = serde_yaml::to_string(&config)
            .map_err(|e| format!("Failed to serialize text expand rules: {}", e))?;

        let mut file = fs::File::create(&path)
            .map_err(|e| format!("Failed to create text expand file: {}", e))?;
        file.write_all(yaml.as_bytes())
            .map_err(|e| format!("Failed to write text expand file: {}", e))?;

        info!("Text expand rules saved to {:?} ({} rules)", path, rules.len());
        Ok(())
    }

    /// 从文件加载文本扩展规则
    pub fn load_text_expand_rules(&self) -> Result<Vec<TextExpandRuleData>, String> {
        let path = self.get_text_expand_path();

        if !path.exists() {
            info!("No text expand file found at {:?}, using default rules", path);
            return Ok(Self::default_text_expand_rules());
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read text expand file: {}", e))?;

        let config: serde_yaml::Value = serde_yaml::from_str(&content)
            .map_err(|e| format!("Failed to parse text expand file: {}", e))?;

        let rules = config
            .get("rules")
            .and_then(|r| r.as_sequence())
            .map(|seq| {
                seq.iter()
                    .filter_map(|item| {
                        Some(TextExpandRuleData {
                            key: item.get("key")?.as_str().unwrap_or("").to_string(),
                            content: item.get("content")?.as_str().unwrap_or("").to_string(),
                            group: item.get("group")?.as_str().unwrap_or("default").to_string(),
                            description: item.get("description")?.as_str().unwrap_or("").to_string(),
                            date: item.get("date")?.as_str().unwrap_or("").to_string(),
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        info!("Text expand rules loaded from {:?} ({} rules)", path, rules.len());
        Ok(rules)
    }

    /// 检查历史是否有变更
    /// 修复：原实现仅比较 id 与长度，content / is_favorite / preview 等字段变化检测不到。
    /// 改为深度比较关键字段。
    pub fn has_history_changed(&self, current: &[ClipboardItem]) -> bool {
        let last_saved = self.last_saved_history.lock().unwrap();
        if last_saved.len() != current.len() {
            return true;
        }
        for (last, curr) in last_saved.iter().zip(current.iter()) {
            if last.id != curr.id
                || last.content != curr.content
                || last.preview != curr.preview
                || last.format != curr.format
                || last.timestamp != curr.timestamp
                || last.word_count != curr.word_count
                || last.is_favorite != curr.is_favorite
                || last.metadata != curr.metadata
            {
                return true;
            }
        }
        false
    }

    /// 重置 last_saved_history 缓存（清空历史后调用，避免下次保存时被误判为有变更）
    pub fn reset_last_saved_history(&self) {
        let mut guard = self.last_saved_history.lock().unwrap();
        guard.clear();
    }

    /// 默认设置
    fn default_settings() -> serde_json::Value {
        serde_json::json!({
            "shortcuts": {
                "toggle_interface": "Ctrl+Shift+V",
                "function_paste": "",
                "quick_paste_mode": "ctrl"
            },
            "general": {
                "max_history_items": 50,
                "auto_save_interval_mins": 5,
                "start_at_login": false,
                "show_in_dock": true
            },
            "ui": {
                "theme": "system",
                "font_size": 14,
                "window_opacity": 1.0
            },
            "mcp": {
                "enabled": false,
                "port": 3000
            }
        })
    }

    /// 默认文本扩展规则
    fn default_text_expand_rules() -> Vec<TextExpandRuleData> {
        vec![
            TextExpandRuleData {
                key: ":te".to_string(),
                content: "textexpand".to_string(),
                group: "default".to_string(),
                description: "示例扩展规则".to_string(),
                date: chrono::Local::now().format("%Y-%m-%d").to_string(),
            },
            TextExpandRuleData {
                key: ":hello".to_string(),
                content: "Hello, World!".to_string(),
                group: "greeting".to_string(),
                description: "问候语".to_string(),
                date: chrono::Local::now().format("%Y-%m-%d").to_string(),
            },
        ]
    }
}

/// 启动自动保存任务（已被实时保存替代，保留作为可选功能）
#[allow(dead_code)]
pub fn start_auto_save(
    datastore: Arc<DataStore>,
    history: Arc<Mutex<Vec<ClipboardItem>>>,
    interval_secs: u64,
) {
    thread::spawn(move || {
        info!("Auto-save task started (interval: {} seconds)", interval_secs);

        loop {
            thread::sleep(Duration::from_secs(interval_secs));

            let current_history = {
                let history_lock = history.lock().unwrap();
                history_lock.clone()
            };

            if datastore.has_history_changed(&current_history) {
                if let Err(e) = datastore.save_clipboard_history(&current_history) {
                    error!("Auto-save failed: {}", e);
                } else {
                    info!("Auto-save completed ({} items)", current_history.len());
                }
            }
        }
    });
}

/// 深度合并两个 serde_json::Value：defaults 提供骨架，override 提供覆盖值
/// 仅合并 Object 类型；非 Object 类型 override 优先。
fn merge_json_values(defaults: &serde_json::Value, override_val: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match (defaults, override_val) {
        (Value::Object(d_map), Value::Object(o_map)) => {
            let mut result = serde_json::Map::new();
            // 先遍历 defaults 的所有键（保证所有字段都存在）
            for (k, v) in d_map {
                if let Some(o_v) = o_map.get(k) {
                    result.insert(k.clone(), merge_json_values(v, o_v));
                } else {
                    result.insert(k.clone(), v.clone());
                }
            }
            // 再遍历 override 独有的键（用户新增的字段保留）
            for (k, v) in o_map {
                if !d_map.contains_key(k) {
                    result.insert(k.clone(), v.clone());
                }
            }
            Value::Object(result)
        }
        (_, override_val) => override_val.clone(),
    }
}

/// 保存所有数据（应用退出时调用）
pub fn save_all_data(
    datastore: &DataStore,
    history: Arc<Mutex<Vec<ClipboardItem>>>,
) -> Result<(), String> {
    // 保存历史记录
    let history_data = {
        let history_lock = history.lock().unwrap();
        history_lock.clone()
    };
    datastore.save_clipboard_history(&history_data)?;

    // 收藏数据在 toggle_favorite 时已经实时保存到数据库
    // 这里不需要额外保存

    info!("All data saved successfully");
    Ok(())
}

/// 加载所有数据（应用启动时调用）
pub fn load_all_data(
    datastore: &DataStore,
) -> Result<(Vec<ClipboardItem>, serde_json::Value, Vec<TextExpandRuleData>), String> {
    // 尝试从旧版 JSON 迁移
    if let Err(e) = datastore.migrate_from_json() {
        warn!("Migration check failed (non-fatal): {}", e);
    }

    let history = datastore.load_clipboard_history()?;
    let settings = datastore.load_settings()?;
    let text_expand_rules = datastore.load_text_expand_rules()?;

    info!("All data loaded successfully");
    Ok((history, settings, text_expand_rules))
}
