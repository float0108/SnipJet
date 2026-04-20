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

// 自动保存间隔（秒）
pub const AUTO_SAVE_INTERVAL_SECS: u64 = 60; // 1分钟

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
    /// 创建新的数据存储管理器
    pub fn new(app_handle: &tauri::AppHandle) -> Result<Self, String> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get app data dir: {}", e))?;

        // 确保目录存在
        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir)
                .map_err(|e| format!("Failed to create app data dir: {}", e))?;
        }

        // 初始化数据库
        let db = Database::new(&app_data_dir)?;

        info!("Data store initialized at: {:?}", app_data_dir);

        Ok(Self {
            app_data_dir,
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

    /// 切换收藏状态
    pub fn toggle_favorite(&self, id: &str) -> Result<bool, String> {
        self.db.toggle_favorite(id)
    }

    /// 删除单个项目
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

        // 从数据库删除
        self.db.delete_item(id)
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

        info!("Settings loaded from {:?}", path);
        Ok(settings)
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
    pub fn has_history_changed(&self, current: &[ClipboardItem]) -> bool {
        let last_saved = self.last_saved_history.lock().unwrap();
        if last_saved.len() != current.len() {
            return true;
        }
        for (last, curr) in last_saved.iter().zip(current.iter()) {
            if last.id != curr.id || last.is_favorite != curr.is_favorite {
                return true;
            }
        }
        false
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

/// 启动自动保存任务
pub fn start_auto_save(
    app_handle: tauri::AppHandle,
    history: Arc<Mutex<Vec<ClipboardItem>>>,
    interval_secs: u64,
) {
    thread::spawn(move || {
        let data_store = match DataStore::new(&app_handle) {
            Ok(store) => store,
            Err(e) => {
                error!("Failed to initialize data store for auto-save: {}", e);
                return;
            }
        };

        info!("Auto-save task started (interval: {} seconds)", interval_secs);

        loop {
            thread::sleep(Duration::from_secs(interval_secs));

            let current_history = {
                let history_lock = history.lock().unwrap();
                history_lock.clone()
            };

            if data_store.has_history_changed(&current_history) {
                if let Err(e) = data_store.save_clipboard_history(&current_history) {
                    error!("Auto-save failed: {}", e);
                } else {
                    info!("Auto-save completed ({} items)", current_history.len());
                }
            }
        }
    });
}

/// 保存所有数据（应用退出时调用）
pub fn save_all_data(
    app_handle: &tauri::AppHandle,
    history: Arc<Mutex<Vec<ClipboardItem>>>,
) -> Result<(), String> {
    let data_store = DataStore::new(app_handle)?;

    let history_data = {
        let history_lock = history.lock().unwrap();
        history_lock.clone()
    };
    data_store.save_clipboard_history(&history_data)?;

    info!("All data saved successfully");
    Ok(())
}

/// 加载所有数据（应用启动时调用）
pub fn load_all_data(
    app_handle: &tauri::AppHandle,
) -> Result<(Vec<ClipboardItem>, serde_json::Value, Vec<TextExpandRuleData>), String> {
    let data_store = DataStore::new(app_handle)?;

    // 尝试从旧版 JSON 迁移
    if let Err(e) = data_store.migrate_from_json() {
        warn!("Migration check failed (non-fatal): {}", e);
    }

    let history = data_store.load_clipboard_history()?;
    let settings = data_store.load_settings()?;
    let text_expand_rules = data_store.load_text_expand_rules()?;

    info!("All data loaded successfully");
    Ok((history, settings, text_expand_rules))
}
