use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use log::{error, info};
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::common::models::ClipboardItem;

// 应用数据文件名称
const CLIPBOARD_HISTORY_FILE: &str = "clipboard_history.json";
const SETTINGS_FILE: &str = "settings.json";
const TEXT_EXPAND_FILE: &str = "text_expand.yaml";

// 自动保存间隔（秒）
pub const AUTO_SAVE_INTERVAL_SECS: u64 = 60; // 1分钟

/// 应用数据存储结构
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct AppData {
    pub version: String,
    pub settings: serde_json::Value,
    pub text_expand_rules: Vec<TextExpandRuleData>,
}

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

        info!("Data store initialized at: {:?}", app_data_dir);

        Ok(Self {
            app_data_dir,
            last_saved_history: Arc::new(Mutex::new(Vec::new())),
        })
    }

    /// 获取剪贴板历史文件路径
    fn get_history_path(&self) -> PathBuf {
        self.app_data_dir.join(CLIPBOARD_HISTORY_FILE)
    }

    /// 获取设置文件路径
    fn get_settings_path(&self) -> PathBuf {
        self.app_data_dir.join(SETTINGS_FILE)
    }

    /// 获取文本扩展规则文件路径
    fn get_text_expand_path(&self) -> PathBuf {
        self.app_data_dir.join(TEXT_EXPAND_FILE)
    }

    /// 保存剪贴板历史到文件
    pub fn save_clipboard_history(&self, history: &[ClipboardItem]) -> Result<(), String> {
        let path = self.get_history_path();
        let json = serde_json::to_string_pretty(history)
            .map_err(|e| format!("Failed to serialize history: {}", e))?;

        let mut file = fs::File::create(&path)
            .map_err(|e| format!("Failed to create history file: {}", e))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Failed to write history file: {}", e))?;

        // 更新最后保存的历史记录
        let mut last_saved = self.last_saved_history.lock().unwrap();
        *last_saved = history.to_vec();

        info!("Clipboard history saved to {:?} ({} items)", path, history.len());
        Ok(())
    }

    /// 从文件加载剪贴板历史
    pub fn load_clipboard_history(&self) -> Result<Vec<ClipboardItem>, String> {
        let path = self.get_history_path();

        if !path.exists() {
            info!("No history file found at {:?}, returning empty history", path);
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read history file: {}", e))?;

        // 尝试解析历史记录，如果失败则尝试以兼容模式解析（处理旧数据格式）
        let history: Vec<ClipboardItem> = match serde_json::from_str(&content) {
            Ok(items) => items,
            Err(e) => {
                error!("Failed to parse history file with standard format: {}", e);
                // 尝试以 Value 格式解析，然后手动迁移旧数据
                let raw_value: Result<serde_json::Value, _> = serde_json::from_str(&content);
                match raw_value {
                    Ok(values) => {
                        if let Some(array) = values.as_array() {
                            let migrated: Vec<ClipboardItem> = array
                                .iter()
                                .filter_map(|v| {
                                    // 手动构建 ClipboardItem，处理缺失的字段
                                    let id = v.get("id")?.as_str()?.to_string();
                                    let content = v.get("content")?.as_str()?.to_string();
                                    let preview = v.get("preview")?.as_str()?.to_string();
                                    let timestamp = v.get("timestamp")?.as_i64()?;
                                    let word_count = v.get("word_count")?.as_u64()? as usize;

                                    // 解析 format 字段
                                    let format_str = v.get("format")?.as_str()?;
                                    let format = match format_str {
                                        "html" => crate::common::models::ClipboardFormat::Html,
                                        "rtf" => crate::common::models::ClipboardFormat::Rtf,
                                        "image" => crate::common::models::ClipboardFormat::Image,
                                        "files" => crate::common::models::ClipboardFormat::Files,
                                        _ => crate::common::models::ClipboardFormat::Plain,
                                    };

                                    // 解析 metadata（可选）
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

                                    // 解析 is_favorite（可选，默认为 false）
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
                                })
                                .collect();

                            info!("Successfully migrated {} items from old data format", migrated.len());
                            migrated
                        } else {
                            error!("History file is not a valid array");
                            Vec::new()
                        }
                    }
                    Err(e2) => {
                        error!("Failed to parse history file even as raw JSON: {}", e2);
                        return Err(format!("History file is corrupted: {} (raw parse: {})", e, e2));
                    }
                }
            }
        };

        // 更新最后保存的历史记录
        let mut last_saved = self.last_saved_history.lock().unwrap();
        *last_saved = history.clone();

        info!("Clipboard history loaded from {:?} ({} items)", path, history.len());
        Ok(history)
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

        // 尝试解析为 YAML
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
        // 比较每个项目的 ID 和 is_favorite 状态
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
        // 初始化数据存储
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

            // 获取当前历史记录
            let current_history = {
                let history_lock = history.lock().unwrap();
                history_lock.clone()
            };

            // 检查是否有变更，有则保存
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

    // 保存剪贴板历史
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

    let history = data_store.load_clipboard_history()?;
    let settings = data_store.load_settings()?;
    let text_expand_rules = data_store.load_text_expand_rules()?;

    info!("All data loaded successfully");
    Ok((history, settings, text_expand_rules))
}
