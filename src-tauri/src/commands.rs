use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::process::Command;
use std::path::PathBuf;
use std::env;
use std::fs;

// 导入Windows API（仅Windows平台）
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::POINT;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use clipboard_rs::{Clipboard, ClipboardContext};
use clipboard_rs::common::{RustImage, RustImageData};
use enigo::{Enigo, Key, KeyboardControllable};
use log::{error, info, warn};
use tauri::{Manager, State, AppHandle, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::clipboard_manager::ClipboardManager;
use crate::common::globals::{
    APP_HANDLE, LAST_HASH, SYSTEM_FONTS_CACHE, WINDOW_PIN_STATE, set_clipboard_ignore_for,
};
use crate::generators::html_generator::markdown_to_html;
use crate::common::models::ClipboardItem;
use crate::AppState;

// 引入你的其他依赖，例如 ClipboardManager, LAST_HASH 等
#[tauri::command]
pub fn get_clipboard_history(
    state: State<'_, Arc<AppState>>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Vec<ClipboardItem> {
    let history = state.history.lock().unwrap();
    let total = history.len();
    let offset = offset.unwrap_or(0);

    match limit {
        Some(0) | None if total > 0 => {
            // limit=0 或 limit=None（全部）时，使用迭代器避免 clone 整个 Vec
            history.iter().skip(offset).cloned().collect()
        }
        Some(0) | None => {
            // 空列表
            vec![]
        }
        Some(limit) => {
            // 指定 limit，最多为 500
            let limit = limit.min(500);
            history.iter().skip(offset).take(limit).cloned().collect()
        }
    }
}

#[tauri::command]
pub fn clear_history(state: State<'_, Arc<AppState>>) {
    state.history.lock().unwrap().clear();
}

#[tauri::command]
pub fn delete_clipboard_item(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let datastore = &state.datastore;

    // 从历史表删除（不影响收藏表）
    datastore.delete_item(&id)?;

    // 从内存中的历史记录移除
    let history_to_save: Vec<ClipboardItem>;
    {
        let mut history_lock = state.history.lock().unwrap();
        history_lock.retain(|item| item.id != id);
        history_to_save = history_lock.clone();
        info!("Deleted clipboard item with id: {} from history", id);
    }

    // 发送全量状态给前端
    let app_handle = state.app_handle.clone();
    let payload = serde_json::json!({
        "type": "state-changed",
        "items": history_to_save
    });
    if let Err(e) = app_handle.emit("clipboard-update", &payload) {
        error!("Event emit error: {:?}", e);
    }

    Ok(())
}

#[tauri::command]
pub fn delete_favorite_item(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<(), String> {
    let datastore = &state.datastore;

    // 从收藏表删除（不影响历史表）
    datastore.delete_favorite_item(&id)?;

    // 从内存中的收藏列表移除
    let mut favorites_lock = state.favorites.lock().unwrap();
    let initial_len = favorites_lock.len();
    favorites_lock.retain(|item| item.id != id);

    if favorites_lock.len() < initial_len {
        info!("Deleted favorite item with id: {}", id);
        Ok(())
    } else {
        info!("Favorite item {} not in memory, but deleted from database", id);
        Ok(())
    }
}

#[tauri::command]
pub fn toggle_favorite(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, String> {
    let datastore = &state.datastore;

    // 使用 datastore 切换收藏状态（在两个表之间复制/删除）
    let new_state = datastore.toggle_favorite(&id)?;

    // 更新内存中的历史记录状态
    {
        let mut history_lock = state.history.lock().unwrap();
        if let Some(item) = history_lock.iter_mut().find(|item| item.id == id) {
            item.is_favorite = new_state;
        }
    }

    // 更新内存中的收藏列表
    {
        let mut favorites_lock = state.favorites.lock().unwrap();
        if new_state {
            // 添加到收藏：从历史记录复制
            let history_lock = state.history.lock().unwrap();
            if let Some(item) = history_lock.iter().find(|item| item.id == id) {
                if !favorites_lock.iter().any(|f| f.id == id) {
                    favorites_lock.push(item.clone());
                }
            }
        } else {
            // 从收藏移除
            favorites_lock.retain(|item| item.id != id);
        }
    }

    // 发送全量状态给前端
    let history_to_save = state.history.lock().unwrap().clone();
    let app_handle = state.app_handle.clone();
    let payload = serde_json::json!({
        "type": "state-changed",
        "items": history_to_save
    });
    if let Err(e) = app_handle.emit("clipboard-update", &payload) {
        error!("Event emit error: {:?}", e);
    }

    info!("Toggled favorite for item {}: {}", id, new_state);
    Ok(new_state)
}

#[tauri::command]
pub fn get_favorite_items(
    state: State<'_, Arc<AppState>>,
) -> Vec<ClipboardItem> {
    state.favorites.lock().unwrap().clone()
}

#[tauri::command]
pub fn load_favorites_from_db(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ClipboardItem>, String> {
    let datastore = &state.datastore;
    let loaded_favorites = datastore.load_favorites()?;

    // 更新内存中的收藏列表
    let mut favorites_lock = state.favorites.lock().unwrap();
    *favorites_lock = loaded_favorites.clone();

    info!("Loaded {} favorites from database", loaded_favorites.len());
    Ok(loaded_favorites)
}

#[tauri::command]
pub async fn paste_to_active_window(
    _app_handle: AppHandle,
    _window: tauri::WebviewWindow,
    state: State<'_, Arc<AppState>>,
    content: String,
    format: String,
    _is_pinned: bool,
    // 可选参数：明确指定剪贴板内容类型，覆盖 format 字段
    // 用于前端已处理好格式转换的场景，如纯文本粘贴
    content_type: Option<String>,
) -> Result<(), String> {
    // 1. 计算 Hash
    let hash = ClipboardManager::generate_hash(content.as_bytes());
    {
        // 这里假设 LAST_HASH 是个全局 Mutex
        let mut last_hash_lock = LAST_HASH.lock().unwrap();
        *last_hash_lock = hash.clone();
    }

    // 2. 写入剪贴板 (在新线程执行)
    let format_clone = format.clone();

    // 对于图片格式，需要先读取图片数据（使用缓存的 DataStore）
    let image_data = if format == "image" {
        let datastore = &state.datastore;
        Some(datastore.load_image(&content)?)
    } else {
        None
    };

    // 对于 markdown 格式，需要将原始文本转换为 HTML
    let content_for_clipboard = if format == "markdown" {
        markdown_to_html(&content).unwrap_or(content.clone())
    } else {
        content.clone()
    };

    // 处理 docx 格式：如果 content_type 是 "docx" 且 format 是 "markdown"，使用 pandoc 转换
    if content_type.as_deref() == Some("docx") && format == "markdown" {
        // 使用 pandoc 转换 markdown 到 docx，支持模板路径
        // 模板路径可以通过 content_type 传递，格式为 "docx:template_path"
        let template_path = content_type.as_ref()
            .and_then(|ct| ct.strip_prefix("docx:"))
            .filter(|t| !t.is_empty());
        let docx_path = markdown_to_docx_with_pandoc(&content, template_path).await?;

        // 更新 hash
        let docx_bytes = read_file_to_bytes(&docx_path)?;
        let docx_hash = ClipboardManager::generate_hash(&docx_bytes);
        {
            let mut last_hash_lock = LAST_HASH.lock().unwrap();
            *last_hash_lock = docx_hash;
        }

        // 检查前台是否是 Word 或 WPS，如果是则使用 COM 插入
        if crate::generators::office_automation::is_com_automation_available() {
            match crate::generators::office_automation::insert_docx_into_office(&docx_path) {
                Ok(msg) => {
                    info!("Office 自动化结果: {}", msg);
                    // 如果成功插入到 Office，直接返回
                    if msg.contains("successfully") {
                        return Ok(());
                    }
                    // 否则使用剪贴板 fallback
                }
                Err(e) => {
                    error!("Office 自动化失败: {:?}", e);
                    // 继续执行剪贴板 fallback
                }
            }
        }

        // 使用剪贴板作为 fallback（将文件路径放入剪贴板）
        let docx_path_str = docx_path.to_string_lossy().to_string();
        let clipboard_handle = thread::spawn(move || -> Result<(), String> {
            let ctx = ClipboardContext::new().map_err(|e| {
                eprintln!("[ERROR] 剪贴板上下文创建失败: {}", e);
                e.to_string()
            })?;

            ctx.set_files(vec![docx_path_str])
                .map_err(|e| format!("设置剪贴板文件失败: {:?}", e))
        });

        // 等待剪贴板写入完成
        if let Err(e) = clipboard_handle
            .join()
            .map_err(|_| "剪贴板线程 Panic".to_string())?
        {
            return Err(format!("剪贴板操作失败: {}", e));
        }

        // 继续执行粘贴操作
        return execute_paste().await;
    }

    // 确定剪贴板内容类型（优先使用 content_type 参数，否则根据 format 判断）
    let clipboard_type = content_type.unwrap_or_else(|| {
        match format_clone.as_str() {
            "image" => "image".to_string(),
            "html" | "markdown" => "html".to_string(),
            "rtf" => "rtf".to_string(),
            _ => "text".to_string(),
        }
    });

    let clipboard_handle = thread::spawn(move || -> Result<(), String> {
        // 创建上下文
        let ctx = ClipboardContext::new().map_err(|e| {
            eprintln!("[ERROR] 剪贴板上下文创建失败: {}", e);
            e.to_string()
        })?;

        let res: Result<(), String> = match clipboard_type.as_str() {
            "image" => {
                // 从预先读取的数据加载图片
                if let Some(data) = image_data {
                    // 使用 RustImageData::from_bytes 加载图片
                    let img = RustImageData::from_bytes(&data)
                        .map_err(|e| format!("Image load error: {:?}", e))?;
                    ctx.set_image(img)
                        .map_err(|e| format!("Set image error: {:?}", e))?;
                    Ok(())
                } else {
                    Err("No image data".to_string())
                }
            }
            "html" => {
                ctx.set_html(content_for_clipboard)
                    .map_err(|e| format!("Set HTML error: {:?}", e))
            }
            "rtf" => {
                ctx.set_rich_text(content_for_clipboard)
                    .map_err(|e| format!("Set RTF error: {:?}", e))
            }
            _ => {
                // text 或 plain 都按纯文本处理
                ctx.set_text(content_for_clipboard)
                    .map_err(|e| format!("Set text error: {:?}", e))
            }
        };

        res
    });

    // 等待剪贴板写入完成
    if let Err(e) = clipboard_handle
        .join()
        .map_err(|_| "剪贴板线程 Panic".to_string())?
    {
        return Err(format!("剪贴板操作失败: {}", e));
    }

    // 执行粘贴操作
    execute_paste().await
}

/// 执行粘贴操作（模拟 Ctrl+V / Cmd+V）
async fn execute_paste() -> Result<(), String> {
    // 模拟组合键 (增强版)
    let paste_handle = thread::spawn(move || {
        let mut enigo = Enigo::new();

        // 再次短暂等待，确保 Enigo 初始化完成
        thread::sleep(Duration::from_millis(50));

        #[cfg(target_os = "macos")]
        {
            // 按下 Command
            enigo.key_down(Key::Meta);
            thread::sleep(Duration::from_millis(50)); // 给系统一点反应时间

            // 点击 V
            enigo.key_click(Key::Layout('v'));
            thread::sleep(Duration::from_millis(50));

            // 松开 Command
            enigo.key_up(Key::Meta);
        }

        #[cfg(not(target_os = "macos"))]
        {
            // 按下 Control
            enigo.key_down(Key::Control);
            thread::sleep(Duration::from_millis(50)); // Windows 可能需要更长的按键响应时间

            // 点击 V (使用 Raw keycode 0x56 = 'V' key，避免大小写问题)
            enigo.key_click(Key::Raw(0x56));
            thread::sleep(Duration::from_millis(50));

            // 松开 Control
            enigo.key_up(Key::Control);
        }
    });

    // 等待按键线程结束
    if let Err(_) = paste_handle.join() {
        eprintln!("[ERROR] 按键模拟线程崩溃 (Panic)");
        return Err("按键模拟失败".to_string());
    }

    // 粘贴完成后，设置剪贴板忽略时间（防止 Word/WPS 自动转换格式后触发新记录）
    // 忽略 1000ms，确保 Word 生成的 RTF 不会被误记录
    set_clipboard_ignore_for(1000);

    Ok(())
}

#[tauri::command]
pub async fn html_to_text(html: String) -> String {
    nanohtml2text::html2text(&html)
}

#[tauri::command]
pub async fn markdown_to_html_command(markdown: String) -> String {
    // 直接尝试解析 markdown，如果解析器生成有效 HTML 则返回
    // 否则返回 fallback
    let doc = crate::core::markdown_parser::parse(&markdown);
    let generator = crate::generators::html_generator::HtmlGenerator;
    let html = generator.generate(&doc);

    // 检查生成的 HTML 是否有效（包含实际的 HTML 标签）
    if html.contains('<') && html.contains('>') {
        html
    } else {
        // Fallback: 将原始内容用 <p> 包裹
        format!("<p>{}</p>", html_escape(&markdown))
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[tauri::command]
pub async fn update_global_last_hash(hash: String) -> Result<(), String> {
    // 更新全局的LAST_HASH变量
    let mut last_hash_lock = LAST_HASH.lock().unwrap();
    *last_hash_lock = hash;
    info!("Updated global last hash");
    Ok(())
}

#[tauri::command]
pub fn apply_no_activate_style() {
    #[cfg(target_os = "windows")]
    {
        // 从全局APP_HANDLE获取主窗口
        let app_handle_lock = APP_HANDLE.lock().unwrap();
        if let Some(app_handle) = &*app_handle_lock {
            if let Some(window) = app_handle.get_webview_window("main") {
                if let Ok(hwnd) = window.hwnd() {
                    let hwnd = HWND(hwnd.0 as isize as _);
                    unsafe {
                        // 获取当前样式
                        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                        // 追加 WS_EX_NOACTIVATE (不激活) 和 WS_EX_TOPMOST (置顶)
                        // 这样点击窗口内容时，焦点依然保留在之前的应用上
                        let new_style =
                            style | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOPMOST.0 as isize);
                        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
                        info!(
                            "Window style updated to: {:x}, WS_EX_NOACTIVATE: {:x}, WS_EX_TOPMOST: {:x}",
                            new_style, WS_EX_NOACTIVATE.0, WS_EX_TOPMOST.0
                        );
                    }
                }
            }
        }
    }
    // macOS 需要在创建窗口时设置 NSPanel 属性，Tauri 默认支持不好，可能需要 Objective-C 混编
    // 这里主要演示 Windows 方案
}

#[tauri::command]
pub async fn update_window_pin_state(is_pinned: bool) -> Result<(), String> {
    // 更新全局的WINDOW_PIN_STATE变量
    let mut pin_state_lock = WINDOW_PIN_STATE.lock().unwrap();
    *pin_state_lock = is_pinned;
    info!("Updated global window pin state to: {}", is_pinned);
    // 从全局变量获取app_handle
    Ok(())
}

#[tauri::command]
pub async fn copy_to_clipboard_no_history(content: String, format: String) -> Result<(), String> {
    // 计算内容的hash
    let hash = ClipboardManager::generate_hash(content.as_bytes());
    // 更新全局的LAST_HASH变量
    let mut last_hash_lock = LAST_HASH.lock().unwrap();
    *last_hash_lock = hash.clone();

    // 对于 markdown 格式，需要将原始文本转换为 HTML
    let content_for_clipboard = if format == "markdown" {
        markdown_to_html(&content).unwrap_or(content.clone())
    } else {
        content
    };

    // 直接复制内容到剪贴板
    let ctx = ClipboardContext::new()
        .map_err(|e| format!("Failed to init clipboard context: {:?}", e))?;

    // 根据格式复制内容
    match format.as_str() {
        "html" | "markdown" => {
            ctx.set_html(content_for_clipboard)
                .map_err(|e| format!("Failed to set clipboard html: {:?}", e))?;
        }
        _ => {
            ctx.set_text(content_for_clipboard)
                .map_err(|e| format!("Failed to set clipboard text: {:?}", e))?;
        }
    }

    // 复制完成后，设置剪贴板忽略时间（防止某些应用自动转换格式后触发新记录）
    set_clipboard_ignore_for(500);

    Ok(())
}

#[tauri::command]
pub async fn print_message(_message: String) -> Result<(), String> {
    // 静默处理，不输出日志
    Ok(())
}

/// 获取当前鼠标位置（屏幕坐标）
#[tauri::command]
pub async fn get_mouse_position() -> Result<(i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        unsafe {
            let mut point = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut point).is_ok() {
                Ok((point.x, point.y))
            } else {
                Err("无法获取鼠标位置".to_string())
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        // 非 Windows 平台返回一个默认值或错误
        Err("当前平台不支持获取鼠标位置".to_string())
    }
}

// --- 数据持久化命令 ---

/// 保存剪贴板历史到文件
#[tauri::command]
pub async fn save_clipboard_history(
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    // 获取历史数据（在锁外获取，避免长时间持有锁）
    let history_data = {
        let history_lock = state.history.lock().unwrap();
        history_lock.clone()
    };
    let history_len = history_data.len();
    let datastore = state.datastore.clone();

    // 将同步 I/O 操作放到 spawn_blocking 中执行
    tokio::task::spawn_blocking(move || {
        datastore.save_clipboard_history(&history_data)
            .map_err(|e| format!("Failed to save clipboard history: {}", e))?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    info!("Clipboard history saved on demand ({} items)", history_len);
    Ok(())
}

/// 从文件加载剪贴板历史
#[tauri::command]
pub async fn load_clipboard_history_command(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ClipboardItem>, String> {
    let datastore = state.datastore.clone();

    // 将同步 I/O 操作放到 spawn_blocking 中执行
    let loaded_history = tokio::task::spawn_blocking(move || {
        datastore.load_clipboard_history()
            .map_err(|e| format!("Failed to load clipboard history: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    let loaded_len = loaded_history.len();

    // 更新内存中的历史记录
    {
        let mut history_lock = state.history.lock().unwrap();
        *history_lock = loaded_history.clone();
    }

    info!("Clipboard history loaded on demand ({} items)", loaded_len);
    Ok(loaded_history)
}

/// 保存设置到文件
#[tauri::command]
pub async fn save_settings(
    state: State<'_, Arc<AppState>>,
    settings: serde_json::Value,
) -> Result<(), String> {
    let datastore = state.datastore.clone();

    // 将同步 I/O 操作放到 spawn_blocking 中执行
    tokio::task::spawn_blocking(move || {
        datastore.save_settings(&settings)
            .map_err(|e| format!("Failed to save settings: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    info!("Settings saved successfully");
    Ok(())
}

/// 从文件加载设置
#[tauri::command]
pub async fn load_settings_command(
    state: State<'_, Arc<AppState>>,
) -> Result<serde_json::Value, String> {
    let datastore = state.datastore.clone();

    // 将同步 I/O 操作放到 spawn_blocking 中执行
    let settings = tokio::task::spawn_blocking(move || {
        datastore.load_settings()
            .map_err(|e| format!("Failed to load settings: {}", e))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    info!("Settings loaded successfully");
    Ok(settings)
}

// --- 全局快捷键命令 ---

/// 内部辅助：在 app_handle 上注册单个全局快捷键，写入 SHORTCUT_ACTION_MAP。
/// 由 `register_global_shortcut` 命令和应用启动时的 setup() 共用。
pub fn register_shortcut_internal(
    app_handle: &AppHandle,
    shortcut: &str,
    action: &str,
) -> Result<(), String> {
    use crate::common::globals::SHORTCUT_ACTION_MAP;
    use tauri::Emitter;

    // 解析快捷键字符串
    let shortcut_parsed: Shortcut = shortcut.parse()
        .map_err(|e| format!("Failed to parse shortcut '{}': {:?}", shortcut, e))?;

    // 获取全局快捷键管理器
    let global_shortcut = app_handle.global_shortcut();

    // 检查快捷键是否已注册，如果是则先注销
    if global_shortcut.is_registered(shortcut_parsed) {
        global_shortcut.unregister(shortcut_parsed)
            .map_err(|e| format!("Failed to unregister existing shortcut: {:?}", e))?;
    }

    // 获取 app_handle 的克隆用于回调
    let app_handle_for_callback = app_handle.clone();
    let action_for_callback = action.to_string();

    // 注册新的快捷键，设置回调触发事件
    global_shortcut.on_shortcut(shortcut_parsed, move |_app, _shortcut, _event| {
        // 发送事件给前端
        let _ = app_handle_for_callback.emit(&format!("shortcut-{}", action_for_callback), ());
    })
    .map_err(|e| format!("Failed to register shortcut with callback: {:?}", e))?;

    // 存储快捷键到动作的映射
    {
        let mut map = SHORTCUT_ACTION_MAP.lock().unwrap();
        map.insert(shortcut.to_string(), action.to_string());
    }

    Ok(())
}

/// 注册全局快捷键
#[tauri::command]
pub async fn register_global_shortcut(
    app_handle: AppHandle,
    shortcut: String,
    action: String,
) -> Result<(), String> {
    register_shortcut_internal(&app_handle, &shortcut, &action)
}

/// 注销全局快捷键
#[tauri::command]
pub async fn unregister_global_shortcut(
    app_handle: AppHandle,
    shortcut: String,
) -> Result<(), String> {
    use crate::common::globals::SHORTCUT_ACTION_MAP;

    let shortcut_parsed: Shortcut = shortcut.parse()
        .map_err(|e| format!("Failed to parse shortcut '{}': {:?}", shortcut, e))?;

    let global_shortcut = app_handle.global_shortcut();

    if global_shortcut.is_registered(shortcut_parsed) {
        global_shortcut.unregister(shortcut_parsed)
            .map_err(|e| format!("Failed to unregister shortcut: {:?}", e))?;

        // 从映射表中移除
        let mut map = SHORTCUT_ACTION_MAP.lock().unwrap();
        map.remove(&shortcut);
    }

    Ok(())
}

// --- 文本扩展规则命令 ---

/// 加载文本扩展规则
#[tauri::command]
pub async fn load_text_expand_rules(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<crate::core::data_store::TextExpandRuleData>, String> {
    let datastore = state.datastore.clone();
    let rules = tokio::task::spawn_blocking(move || {
        datastore.load_text_expand_rules()
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;
    info!("Text expand rules loaded ({} rules)", rules.len());
    Ok(rules)
}

/// 保存文本扩展规则
#[tauri::command]
pub async fn save_text_expand_rules(
    state: State<'_, Arc<AppState>>,
    rules: Vec<crate::core::data_store::TextExpandRuleData>,
) -> Result<(), String> {
    let datastore = state.datastore.clone();
    let rules_clone = rules.clone();
    tokio::task::spawn_blocking(move || {
        datastore.save_text_expand_rules(&rules)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;
    info!("Text expand rules saved ({} rules)", rules_clone.len());
    Ok(())
}

/// 重新加载文本扩展规则
#[tauri::command]
pub async fn reload_text_expand_rules(
    app_handle: tauri::AppHandle,
    text_expander: State<'_, Arc<Mutex<crate::core::text_expand::TextExpander>>>,
) -> Result<(), String> {
    let expander = text_expander.lock().map_err(|e| e.to_string())?;
    expander.reload_rules(&app_handle);
    info!("Text expand rules reloaded");
    Ok(())
}

// --- 图片相关命令 ---

use std::sync::OnceLock;
use std::collections::HashMap;

// 图片缓存：relative_path -> base64 编码的图片数据
static IMAGE_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

fn get_image_cache() -> &'static Mutex<HashMap<String, String>> {
    IMAGE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 读取图片并返回 base64（供前端显示）
#[tauri::command]
pub async fn read_image_as_base64(
    state: State<'_, Arc<AppState>>,
    relative_path: String,
) -> Result<String, String> {
    // 先检查缓存
    {
        let cache = get_image_cache().lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&relative_path) {
            return Ok(cached.clone());
        }
    }

    // 缓存未命中，从磁盘加载
    let datastore = state.datastore.clone();
    let relative_path_for_load = relative_path.clone();
    let image_data = tokio::task::spawn_blocking(move || {
        datastore.load_image(&relative_path_for_load)
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;

    // 转换为 base64
    let base64_str = STANDARD.encode(&image_data);

    // 加入缓存
    {
        let mut cache = get_image_cache().lock().map_err(|e| e.to_string())?;
        cache.insert(relative_path, base64_str.clone());
    }

    Ok(base64_str)
}

/// 获取图片绝对路径（供前端显示）
#[tauri::command]
pub async fn get_image_path(
    state: State<'_, Arc<AppState>>,
    relative_path: String,
) -> Result<String, String> {
    let datastore = state.datastore.clone();
    let absolute_path = tokio::task::spawn_blocking(move || {
        Ok::<_, String>(datastore.get_image_absolute_path(&relative_path))
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))??;
    Ok(absolute_path.to_string_lossy().to_string())
}

// --- 自启动命令 ---

/// 设置开机自启动
#[tauri::command]
pub async fn set_autostart(
    app_handle: tauri::AppHandle,
    enable: bool,
) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let autolaunch = app_handle.autolaunch();

    if enable {
        autolaunch.enable()
            .map_err(|e| format!("Failed to enable autostart: {:?}", e))?;
        info!("Autostart enabled");
    } else {
        autolaunch.disable()
            .map_err(|e| format!("Failed to disable autostart: {:?}", e))?;
        info!("Autostart disabled");
    }

    Ok(())
}

/// 获取开机自启动状态
#[tauri::command]
pub async fn get_autostart_status(
    app_handle: tauri::AppHandle,
) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;

    let autolaunch = app_handle.autolaunch();
    let is_enabled = autolaunch.is_enabled()
        .map_err(|e| format!("Failed to get autostart status: {:?}", e))?;

    Ok(is_enabled)
}

// --- MCP 服务命令 ---

/// 获取 MCP 服务状态
#[tauri::command]
pub fn get_mcp_status() -> Result<serde_json::Value, String> {
    use crate::common::globals::MCP_SERVER_HANDLE;

    let handle = MCP_SERVER_HANDLE.lock().map_err(|e| e.to_string())?;
    let is_running = handle.is_some();

    Ok(serde_json::json!({
        "is_running": is_running
    }))
}

/// 启动 MCP 服务
#[tauri::command]
pub async fn start_mcp_service(
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    port: u16,
) -> Result<String, String> {
    use crate::common::globals::MCP_SERVER_HANDLE;
    use crate::mcp::start_mcp_server;

    // 检查是否已经在运行
    {
        let handle = MCP_SERVER_HANDLE.lock().map_err(|e| e.to_string())?;
        if handle.is_some() {
            return Err("MCP 服务已经在运行".to_string());
        }
    }

    // 启动服务
    let history_arc = state.history.clone();
    let handle = start_mcp_server(port, Some(Arc::new(app_handle)), history_arc)?;

    // 保存句柄
    {
        let mut mcp_handle = MCP_SERVER_HANDLE.lock().map_err(|e| e.to_string())?;
        *mcp_handle = Some(handle);
    }

    info!("MCP service started on port {}", port);
    Ok(format!("MCP 服务已启动，端口: {}", port))
}

/// 停止 MCP 服务
#[tauri::command]
pub fn stop_mcp_service() -> Result<(), String> {
    use crate::common::globals::MCP_SERVER_HANDLE;

    let mut handle = MCP_SERVER_HANDLE.lock().map_err(|e| e.to_string())?;

    if let Some(h) = handle.take() {
        h.cancel_token.cancel();
        info!("MCP service stopped");
        Ok(())
    } else {
        Err("MCP 服务未在运行".to_string())
    }
}

/// 重启 MCP 服务（用于更改端口后重启）
#[tauri::command]
pub async fn restart_mcp_service(
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    port: u16,
) -> Result<String, String> {
    // 先停止
    let _ = stop_mcp_service();

    // 等待一小段时间确保端口释放
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

    // 再启动
    start_mcp_service(app_handle, state, port).await
}

// --- Markdown to Docx via Pandoc ---

/// 获取缓存目录路径（用户目录下的 .snipjet/cache）
fn get_cache_dir() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir()
        .ok_or("无法获取用户主目录")?;
    let cache_dir = home_dir.join(".snipjet").join("cache");

    // 确保目录存在
    fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("创建缓存目录失败: {}", e))?;

    Ok(cache_dir)
}

/// 使用 Pandoc 将 Markdown 转换为 Docx
/// 优先从环境变量 PANDOC_PATH 读取 pandoc 路径
/// 支持自定义参考模板（template_path）
async fn markdown_to_docx_with_pandoc(
    markdown_content: &str,
    template_path: Option<&str>,
) -> Result<PathBuf, String> {
    // 获取 pandoc 路径（从环境变量或系统 PATH）
    let pandoc_path = env::var("PANDOC_PATH")
        .unwrap_or_else(|_| {
            if cfg!(windows) {
                "pandoc.exe".to_string()
            } else {
                "pandoc".to_string()
            }
        });

    // 获取缓存目录
    let cache_dir = get_cache_dir()?;

    // 生成临时文件名（使用内容哈希）
    let content_hash = ClipboardManager::generate_hash(markdown_content.as_bytes());
    let docx_path = cache_dir.join(format!("{}.docx", content_hash));
    let md_path = cache_dir.join(format!("{}.md", content_hash));

    // 写入 markdown 文件
    fs::write(&md_path, markdown_content)
        .map_err(|e| format!("写入临时 markdown 文件失败: {}", e))?;

    // 验证模板文件（如果提供）
    if let Some(template) = template_path {
        if !template.is_empty() {
            let template_path = std::path::Path::new(template);
            if !template_path.exists() {
                return Err(format!("模板文件不存在: {}", template));
            }
            // 检查文件扩展名
            if let Some(ext) = template_path.extension() {
                let ext = ext.to_string_lossy().to_lowercase();
                if ext != "docx" {
                    warn!("模板文件可能不是有效的 docx 格式: {}", template);
                }
            }
        }
    }

    // 构建 pandoc 命令
    let mut cmd = Command::new(&pandoc_path);
    cmd.arg(&md_path)
        .arg("-o")
        .arg(&docx_path)
        .arg("-f")
        .arg("markdown")
        .arg("-t")
        .arg("docx")
        .arg("--wrap=none");

    // 如果提供了模板路径，添加 --reference-doc 参数
    if let Some(template) = template_path {
        if !template.is_empty() && std::path::Path::new(template).exists() {
            info!("使用 Pandoc 参考模板: {}", template);
            // 使用引用确保路径中的空格被正确处理
            cmd.arg("--reference-doc").arg(std::ffi::OsStr::new(template));
        } else {
            warn!("模板路径无效或不存在: {:?}", template);
        }
    }

    info!("执行 Pandoc 命令，参数: {:?}", cmd.get_args().collect::<Vec<_>>());

    let output = cmd.output()
        .map_err(|e| format!("执行 pandoc 失败: {}。请确保 pandoc 已安装，或设置 PANDOC_PATH 环境变量", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        error!("Pandoc 转换失败:\nstderr: {}\nstdout: {}", stderr, stdout);
        return Err(format!("Pandoc 转换失败: {}", stderr));
    }

    // 删除临时 markdown 文件
    let _ = fs::remove_file(&md_path);

    Ok(docx_path)
}

/// 读取文件内容为字节
fn read_file_to_bytes(path: &PathBuf) -> Result<Vec<u8>, String> {
    fs::read(path)
        .map_err(|e| format!("读取文件失败: {}", e))
}

/// 复制 Markdown 为 Docx 格式到剪贴板
/// 支持自定义参考模板
#[tauri::command]
pub async fn copy_markdown_as_docx(
    content: String,
    template_path: Option<String>,
) -> Result<String, String> {
    // 1. 生成 docx 文件（使用自定义模板）
    let docx_path = markdown_to_docx_with_pandoc(&content, template_path.as_deref()).await?;

    // 2. 计算 Hash 并更新全局 LAST_HASH
    let docx_bytes = read_file_to_bytes(&docx_path)?;
    let hash = ClipboardManager::generate_hash(&docx_bytes);
    {
        let mut last_hash_lock = LAST_HASH.lock().unwrap();
        *last_hash_lock = hash.clone();
    }

    // 3. 将 docx 文件内容设置到剪贴板（使用 clipboard-rs 的文件设置功能）
    let ctx = ClipboardContext::new()
        .map_err(|e| format!("初始化剪贴板失败: {:?}", e))?;

    // 设置文件列表到剪贴板
    let file_path_str = docx_path.to_string_lossy().to_string();
    ctx.set_files(vec![file_path_str.clone()])
        .map_err(|e| format!("设置剪贴板文件失败: {:?}", e))?;

    // 设置剪贴板忽略时间
    set_clipboard_ignore_for(500);

    info!("Markdown 已转换为 Docx 并复制到剪贴板: {}", file_path_str);
    Ok(file_path_str)
}

/// 更新最大历史条目数设置
#[tauri::command]
pub fn update_max_history_items(
    state: State<'_, Arc<AppState>>,
    max_items: Option<usize>,
) -> Result<(), String> {
    let mut max_lock = state.max_history_items.lock().unwrap();
    *max_lock = max_items;
    info!("Max history items updated to: {:?}", max_items);
    Ok(())
}

/// 获取系统已安装的字体族列表
/// 优先使用 OS 原生 API（名称解码由系统完成，绝对正确），
/// 失败时回退到扫描字体目录并解析 name 表。
#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    // 进程内缓存：设置窗口每次打开都会调用，避免重复枚举（PowerShell 约 0.5s）
    if let Ok(guard) = SYSTEM_FONTS_CACHE.lock() {
        if let Some(cached) = guard.as_ref() {
            return cached.clone();
        }
    }

    let mut fonts: Vec<String> = Vec::new();

    #[cfg(target_os = "windows")]
    {
        match enumerate_fonts_windows() {
            Some(list) => fonts = list,
            None => {
                warn!("PowerShell 字体枚举失败，回退到目录扫描");
                let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".to_string());
                collect_fonts_from_dir(
                    &std::path::PathBuf::from(&windir).join("Fonts"),
                    &mut fonts,
                );
                // 用户字体目录
                if let Some(local_appdata) = dirs::data_local_dir() {
                    collect_fonts_from_dir(
                        &local_appdata.join("Microsoft/Windows/Fonts"),
                        &mut fonts,
                    );
                }
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        let candidates = [
            PathBuf::from("/System/Library/Fonts"),
            PathBuf::from("/Library/Fonts"),
            PathBuf::from("/System/Library/Fonts/Supplemental"),
        ];
        for dir in &candidates {
            collect_fonts_from_dir(dir, &mut fonts);
        }
        if let Some(home) = dirs::home_dir() {
            collect_fonts_from_dir(&home.join("Library/Fonts"), &mut fonts);
        }
    }

    #[cfg(target_os = "linux")]
    {
        match enumerate_fonts_fc_list() {
            Some(list) => fonts = list,
            None => {
                let candidates = [
                    PathBuf::from("/usr/share/fonts"),
                    PathBuf::from("/usr/local/share/fonts"),
                    PathBuf::from("/usr/share/X11/fonts"),
                ];
                for dir in &candidates {
                    collect_fonts_from_dir(dir, &mut fonts);
                }
                if let Some(home) = dirs::home_dir() {
                    collect_fonts_from_dir(&home.join(".fonts"), &mut fonts);
                    collect_fonts_from_dir(&home.join(".local/share/fonts"), &mut fonts);
                }
            }
        }
    }

    // 排序并去重
    fonts.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    fonts.dedup();

    info!("枚举系统字体完成，共 {} 个", fonts.len());

    // 写入进程内缓存
    if let Ok(mut guard) = SYSTEM_FONTS_CACHE.lock() {
        *guard = Some(fonts.clone());
    }

    fonts
}

/// Windows：通过 PowerShell 调用 GDI InstalledFontCollection 枚举字体族。
/// 名称由系统解码（正确处理 UTF-16 / 本地化名），无需解析字体二进制。
#[cfg(target_os = "windows")]
fn enumerate_fonts_windows() -> Option<Vec<String>> {
    use std::os::windows::process::CommandExt;

    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; \
Add-Type -AssemblyName System.Drawing; \
(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }";

    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8(out.stdout).ok()?;
    let fonts: Vec<String> = text
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    if fonts.is_empty() {
        None
    } else {
        Some(fonts)
    }
}

/// Linux：通过 fontconfig 枚举字体族
#[cfg(target_os = "linux")]
fn enumerate_fonts_fc_list() -> Option<Vec<String>> {
    let out = std::process::Command::new("fc-list")
        .arg(":")
        .arg("family")
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let fonts: Vec<String> = text
        .lines()
        .flat_map(|l| l.split(','))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if fonts.is_empty() {
        None
    } else {
        Some(fonts)
    }
}

fn collect_fonts_from_dir(dir: &std::path::Path, fonts: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_fonts_from_dir(&path, fonts);
            continue;
        }
        let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        let ext_lower = ext.to_lowercase();
        if ext_lower != "ttf" && ext_lower != "otf" && ext_lower != "ttc" {
            continue;
        }
        if let Some(family) = extract_font_family(&path) {
            if !fonts.contains(&family) {
                fonts.push(family);
            }
        }
    }
}

/// 从字体文件提取字体族名
/// 优先解析 TTF/OTF 的 name 表 (NameID=1)，无法解析时再使用文件名
fn extract_font_family(path: &std::path::Path) -> Option<String> {
    // 1) 尝试解析 name 表
    if let Ok(bytes) = std::fs::read(path) {
        if let Some(family) = parse_ttf_family_name(&bytes) {
            return Some(family);
        }
    }
    // 2) 回退：用文件名
    let stem = path.file_stem().and_then(|s| s.to_str())?;
    let family = stem.split('-').next().unwrap_or(stem).trim().to_string();
    if family.is_empty() {
        None
    } else {
        Some(family)
    }
}

/// 解析 TTF/OTF/TTC name 表，提取 NameID=1 (Font Family) 的字符串
/// 参考：https://docs.microsoft.com/typography/opentype/spec/name
fn parse_ttf_family_name(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 12 {
        return None;
    }
    // TTC 容器：'ttcf' 魔数 + version(4) + numFonts(4) + FontOffset[]，
    // 第一个子字体的偏移表在 bytes[12..16] 指向的位置。
    let base: usize = if &bytes[0..4] == b"ttcf" {
        if bytes.len() < 16 {
            return None;
        }
        let first_font = u32::from_be_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]) as usize;
        if first_font + 12 > bytes.len() {
            return None;
        }
        first_font
    } else {
        0
    };
    // 偏移表 (12 字节)：sfntVersion(4) + numTables(2) + searchRange 等(6)
    let num_tables = u16::from_be_bytes([bytes[base + 4], bytes[base + 5]]) as usize;
    if num_tables == 0 || num_tables > 512 {
        return None;
    }
    // 查找 'name' 表（表目录中的 offset 为相对文件开头的绝对偏移）
    let mut name_offset: Option<usize> = None;
    for i in 0..num_tables {
        let rec = base + 12 + i * 16;
        if rec + 16 > bytes.len() {
            return None;
        }
        let tag = &bytes[rec..rec + 4];
        if tag == b"name" {
            // tableRecord: tag(4), checkSum(4), offset(4), length(4)
            name_offset = Some(u32::from_be_bytes([
                bytes[rec + 8],
                bytes[rec + 9],
                bytes[rec + 10],
                bytes[rec + 11],
            ]) as usize);
            break;
        }
    }
    let name_off = name_offset?;
    if name_off + 6 > bytes.len() {
        return None;
    }

    // name 表头：format(2), count(2), stringOffset(2)
    let _format = u16::from_be_bytes([bytes[name_off], bytes[name_off + 1]]);
    let count = u16::from_be_bytes([bytes[name_off + 2], bytes[name_off + 3]]) as usize;
    let string_offset =
        u16::from_be_bytes([bytes[name_off + 4], bytes[name_off + 5]]) as usize;
    let storage_off = name_off + string_offset;

    // 收集候选字符串，元素为 (优先级, 文本)
    // 优先级：Windows+UTF16BE/GBK/Big5(本地语言) < Windows+UTF16BE(英文) < Windows+UCS-4 < Unicode < Macintosh
    let mut candidates: Vec<(u8, String)> = Vec::new();

    for i in 0..count {
        let rec = name_off + 6 + i * 12;
        if rec + 12 > bytes.len() {
            return None;
        }
        let platform_id = bytes[rec];
        let encoding_id = bytes[rec + 1];
        let language_id = u16::from_be_bytes([bytes[rec + 4], bytes[rec + 5]]);
        let name_id = u16::from_be_bytes([bytes[rec + 6], bytes[rec + 7]]);
        let length = u16::from_be_bytes([bytes[rec + 8], bytes[rec + 9]]) as usize;
        let str_off = u16::from_be_bytes([bytes[rec + 10], bytes[rec + 11]]) as usize;

        if name_id != 1 {
            continue;
        }
        // 只取 Windows / Unicode / Mac 平台的字符串
        if platform_id != 0 && platform_id != 1 && platform_id != 3 {
            continue;
        }

        let abs_off = storage_off + str_off;
        if abs_off + length > bytes.len() {
            continue;
        }
        let raw = &bytes[abs_off..abs_off + length];

        let decoded = decode_name_string(platform_id, encoding_id, raw);
        if let Some(text) = decoded {
            let trimmed = text.trim().to_string();
            if !trimmed.is_empty() && looks_like_font_name(&trimmed) {
                candidates.push((priority(platform_id, encoding_id, language_id), trimmed));
            }
        }
    }

    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by_key(|(p, _)| *p);
    let best = candidates.into_iter().next()?.1;
    Some(best)
}

/// 粗略判断字符串是否像正常的字体族名
/// - 不可有 U+FFFD 替换字符
/// - 排除掉纯控制字符 / 反向字节序造成的高位垃圾
fn looks_like_font_name(s: &str) -> bool {
    if s.is_empty() || s.len() > 64 {
        return false;
    }
    if s.contains('\u{FFFD}') {
        return false;
    }
    // 不允许超过 50% 的字符是 CJK 统一表意文字扩展之外的奇怪控制字符
    let bad = s
        .chars()
        .filter(|c| {
            let cp = *c as u32;
            cp < 0x20 && cp != 0x09 && cp != 0x0A
        })
        .count();
    bad == 0
}

/// 计算优先级：数值越小越优先
fn priority(platform_id: u8, encoding_id: u8, language_id: u16) -> u8 {
    match (platform_id, encoding_id) {
        (3, 1) => {
            // 中文系统首选中文条目
            if language_id == 0x0804 {
                0
            } else if language_id == 0x0404 {
                1
            } else if language_id == 0x0409 {
                2
            } else if language_id == 0 {
                3
            } else {
                4
            }
        }
        (3, 3) => {
            // GBK 编码的本地化条目
            if language_id == 0x0804 {
                5
            } else {
                6
            }
        }
        (3, 4) => 7, // Big5
        (3, 2) => 8, // ShiftJIS
        (3, 10) => 9,
        (3, _) => 10,
        (0, _) => 11,
        (1, _) => 12,
        _ => 99,
    }
}

/// 解码 name 表字符串
/// platformID=3 encodingID=0: Symbol (按字节单字节)
/// platformID=3 encodingID=1: Unicode BMP (UTF-16BE)
/// platformID=3 encodingID=2: ShiftJIS (Japanese)
/// platformID=3 encodingID=3: PRC (GB2312/GBK)
/// platformID=3 encodingID=4: Big5 (Traditional Chinese)
/// platformID=3 encodingID=5: Wansung (Korean)
/// platformID=3 encodingID=6: Johab
/// platformID=3 encodingID=10: UCS-4 (UTF-16BE 兼容，按双字节处理)
/// platformID=0: Unicode (UTF-16BE)
/// platformID=1 encodingID=0: MacRoman
fn decode_name_string(platform_id: u8, encoding_id: u8, raw: &[u8]) -> Option<String> {
    use encoding_rs::{UTF_16BE, UTF_16LE, MACINTOSH, SHIFT_JIS, GBK, BIG5, EUC_KR};

    match (platform_id, encoding_id) {
        (3, 0) => {
            let s: String = raw.iter().map(|b| *b as char).collect();
            Some(s)
        }
        (3, 1) | (3, 10) | (0, _) => {
            // 按 OTF 规范应使用 UTF-16BE，但实际数据可能是：
            // 1) 规范 BE（绝大多数字体）—— BE 解码直接正确
            // 2) LE 存储（部分工具）—— BE 解码会产生"ASCII<<8"错位字符
            // 先按 BE 解码，仅当出现字节交换签名时才尝试 LE 择优，
            // 避免把正常的日文/韩文/中文误切到 LE。
            let be = UTF_16BE.decode(raw).0.into_owned();
            if has_swap_signature(&be) {
                let le = UTF_16LE.decode(raw).0.into_owned();
                if text_quality(&le) > text_quality(&be) {
                    return Some(le);
                }
            }
            Some(be)
        }
        (3, 2) => Some(SHIFT_JIS.decode(raw).0.into_owned()),
        (3, 3) => Some(GBK.decode(raw).0.into_owned()),
        (3, 4) => Some(BIG5.decode(raw).0.into_owned()),
        (3, 5) => Some(EUC_KR.decode(raw).0.into_owned()),
        (1, 0) => Some(MACINTOSH.decode(raw).0.into_owned()),
        _ => None,
    }
}

/// 检查字符串是否带有字节序错位的典型签名：
/// - "ASCII<<8"字符（0x2000~0x9FFF 且低字节为 0，如 'E'=0x45 → U+4500）
/// - CJK 扩展 B/C/D/E/F/G 兼容区字符
/// - 替换字符 / C1 控制字符
/// 真实文字（中/日/韩/拉丁）几乎不会达到 ≥25% 的占比。
fn has_swap_signature(s: &str) -> bool {
    let total = s.chars().count();
    if total == 0 {
        return false;
    }
    let mut suspicious = 0usize;
    for c in s.chars() {
        let cp = c as u32;
        if (0x2000..=0x9FFF).contains(&cp) && (cp & 0xFF) == 0 {
            suspicious += 1;
        } else if (0x20000..=0x323AF).contains(&cp) || (0x2F800..=0x2FA1F).contains(&cp) {
            suspicious += 1;
        } else if cp == 0xFFFD || (0x80..=0x9F).contains(&cp) {
            suspicious += 1;
        }
    }
    suspicious * 4 >= total
}

/// 估算字符串的可读性分：越高越像正常文字
fn text_quality(s: &str) -> i32 {
    if s.is_empty() {
        return -1000;
    }
    let mut score: i32 = 0;
    for c in s.chars() {
        let cp = c as u32;
        if cp == 0xFFFD {
            score -= 50;
        } else if cp < 0x20 && cp != 0x09 && cp != 0x0A {
            score -= 20;
        } else if (0x2000..=0x7E00).contains(&cp) && (cp & 0xFF) == 0 {
            // 字节错位签名：ASCII 字符(0x20~0x7E)被字节交换后
            // 会落在 0x2000~0x7E00 且低字节恒为 0（如 'E'=0x45 → U+4500）。
            // 真实中文/韩文/假名的低字节几乎不会是 0。
            score -= 30;
        } else if (0x20..=0x7E).contains(&cp) {
            // ASCII 可打印：加分
            score += 4;
        } else if (0x4E00..=0x9FFF).contains(&cp)
            || (0x3400..=0x4DBF).contains(&cp)
            || (0xF900..=0xFAFF).contains(&cp)
        {
            // CJK 统一表意文字：加分
            score += 5;
        } else if (0x3040..=0x30FF).contains(&cp) {
            // 日文假名
            score += 3;
        } else if (0xAC00..=0xD7AF).contains(&cp) {
            // 韩文
            score += 3;
        } else if (0x20000..=0x2A6DF).contains(&cp)
            || (0x2A700..=0x2EBEF).contains(&cp)
            || (0x30000..=0x323AF).contains(&cp)
            || (0x2F800..=0x2FA1F).contains(&cp)
        {
            // CJK 扩展 B/C/D/E/F、G 及兼容扩展 —— 这些几乎都是字节错位产生的字符
            score -= 30;
        } else if cp > 0x10000 {
            score -= 5;
        } else if (0x80..=0x9F).contains(&cp) {
            score -= 10;
        } else if (0xA0..=0xFF).contains(&cp) {
            // Latin-1 补充区：常见重音字母
            score += 1;
        }
    }
    score
}

