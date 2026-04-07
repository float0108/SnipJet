use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

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
use log::{error, info};
use tauri::{Manager, State, AppHandle};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::clipboard_manager::ClipboardManager;
use crate::common::globals::{APP_HANDLE, LAST_HASH, WINDOW_PIN_STATE, set_clipboard_ignore_for};
use crate::generators::html_generator::markdown_to_html;
use crate::common::models::ClipboardItem;
use crate::core::data_store::DataStore;

// 引入你的其他依赖，例如 ClipboardManager, LAST_HASH 等
#[tauri::command]
pub fn get_clipboard_history(
    history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>,
) -> Vec<ClipboardItem> {
    history.lock().unwrap().clone()
}

#[tauri::command]
pub fn clear_history(history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>) {
    history.lock().unwrap().clear();
}

#[tauri::command]
pub fn delete_clipboard_item(
    history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>,
    id: String,
) -> Result<(), String> {
    let mut history_lock = history.lock().unwrap();
    let initial_len = history_lock.len();

    // 从历史记录中移除指定ID的条目
    history_lock.retain(|item| item.id != id);

    if history_lock.len() < initial_len {
        info!("Deleted clipboard item with id: {}", id);
        Ok(())
    } else {
        error!("Failed to delete clipboard item: id not found - {}", id);
        Err(format!("Clipboard item not found: {}", id))
    }
}

#[tauri::command]
pub fn toggle_favorite(
    history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>,
    id: String,
) -> Result<bool, String> {
    let mut history_lock = history.lock().unwrap();

    // 查找并切换收藏状态
    if let Some(item) = history_lock.iter_mut().find(|item| item.id == id) {
        item.is_favorite = !item.is_favorite;
        let new_state = item.is_favorite;
        info!("Toggled favorite for item {}: {}", id, new_state);
        Ok(new_state)
    } else {
        error!("Failed to toggle favorite: id not found - {}", id);
        Err(format!("Clipboard item not found: {}", id))
    }
}

#[tauri::command]
pub fn get_favorite_items(
    history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>,
) -> Vec<ClipboardItem> {
    let history_lock = history.lock().unwrap();
    history_lock
        .iter()
        .filter(|item| item.is_favorite)
        .cloned()
        .collect()
}

#[tauri::command]
pub async fn paste_to_active_window(
    app_handle: AppHandle,
    _window: tauri::WebviewWindow,
    content: String,
    format: String,
    _is_pinned: bool,
) -> Result<(), String> {
    // 1. 计算 Hash
    let hash = ClipboardManager::generate_hash(content.as_bytes());
    {
        // 这里假设 LAST_HASH 是个全局 Mutex
        let mut last_hash_lock = LAST_HASH.lock().map_err(|e| e.to_string())?;
        *last_hash_lock = hash.clone();
    }

    // 2. 写入剪贴板 (在新线程执行)
    let format_clone = format.clone();

    // 对于图片格式，需要先读取图片数据
    let image_data = if format == "image" {
        let data_store = DataStore::new(&app_handle)?;
        Some(data_store.load_image(&content)?)
    } else {
        None
    };

    // 对于 markdown 格式，需要将原始文本转换为 HTML
    let content_for_clipboard = if format == "markdown" {
        markdown_to_html(&content).unwrap_or(content.clone())
    } else {
        content.clone()
    };

    let clipboard_handle = thread::spawn(move || -> Result<(), String> {
        // 创建上下文
        let ctx = ClipboardContext::new().map_err(|e| {
            eprintln!("[ERROR] 剪贴板上下文创建失败: {}", e);
            e.to_string()
        })?;

        let res: Result<(), String> = match format_clone.as_str() {
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
            "html" | "markdown" => {
                ctx.set_html(content_for_clipboard)
                    .map_err(|e| format!("Set HTML error: {:?}", e))
            }
            "rtf" => {
                ctx.set_rich_text(content_for_clipboard)
                    .map_err(|e| format!("Set RTF error: {:?}", e))
            }
            _ => {
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

    // 5. 模拟组合键 (增强版)
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
            info!("Copied HTML content to clipboard without history update");
        }
        _ => {
            ctx.set_text(content_for_clipboard)
                .map_err(|e| format!("Failed to set clipboard text: {:?}", e))?;
            info!("Copied text content to clipboard without history update");
        }
    }

    // 复制完成后，设置剪贴板忽略时间（防止某些应用自动转换格式后触发新记录）
    set_clipboard_ignore_for(500);

    Ok(())
}

#[tauri::command]
pub async fn print_message(message: String) -> Result<(), String> {
    println!("Frontend message: {}", message);
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
    app_handle: tauri::AppHandle,
    history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>,
) -> Result<(), String> {
    let data_store = DataStore::new(&app_handle)?;
    let history_data = {
        let history_lock = history.lock().unwrap();
        history_lock.clone()
    };
    data_store.save_clipboard_history(&history_data)?;
    info!("Clipboard history saved on demand ({} items)", history_data.len());
    Ok(())
}

/// 从文件加载剪贴板历史
#[tauri::command]
pub async fn load_clipboard_history_command(
    app_handle: tauri::AppHandle,
    history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>,
) -> Result<Vec<ClipboardItem>, String> {
    let data_store = DataStore::new(&app_handle)?;
    let loaded_history = data_store.load_clipboard_history()?;

    // 更新内存中的历史记录
    {
        let mut history_lock = history.lock().unwrap();
        *history_lock = loaded_history.clone();
    }

    info!("Clipboard history loaded on demand ({} items)", loaded_history.len());
    Ok(loaded_history)
}

/// 保存设置到文件
#[tauri::command]
pub async fn save_settings(
    app_handle: tauri::AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    let data_store = DataStore::new(&app_handle)?;
    data_store.save_settings(&settings)?;
    info!("Settings saved successfully");
    Ok(())
}

/// 从文件加载设置
#[tauri::command]
pub async fn load_settings_command(
    app_handle: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let data_store = DataStore::new(&app_handle)?;
    let settings = data_store.load_settings()?;
    info!("Settings loaded successfully");
    Ok(settings)
}

// --- 全局快捷键命令 ---

/// 注册全局快捷键
#[tauri::command]
pub async fn register_global_shortcut(
    app_handle: AppHandle,
    shortcut: String,
    action: String,
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
    let action_for_callback = action.clone();

    // 注册新的快捷键，设置回调触发事件
    global_shortcut.on_shortcut(shortcut_parsed, move |_app, _shortcut, _event| {
        // 发送事件给前端
        let _ = app_handle_for_callback.emit(&format!("shortcut-{}", action_for_callback), ());
    })
    .map_err(|e| format!("Failed to register shortcut with callback: {:?}", e))?;

    // 存储快捷键到动作的映射
    {
        let mut map = SHORTCUT_ACTION_MAP.lock().unwrap();
        map.insert(shortcut, action);
    }

    Ok(())
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
    app_handle: tauri::AppHandle,
) -> Result<Vec<crate::core::data_store::TextExpandRuleData>, String> {
    let data_store = DataStore::new(&app_handle)?;
    let rules = data_store.load_text_expand_rules()?;
    info!("Text expand rules loaded ({} rules)", rules.len());
    Ok(rules)
}

/// 保存文本扩展规则
#[tauri::command]
pub async fn save_text_expand_rules(
    app_handle: tauri::AppHandle,
    rules: Vec<crate::core::data_store::TextExpandRuleData>,
) -> Result<(), String> {
    let data_store = DataStore::new(&app_handle)?;
    data_store.save_text_expand_rules(&rules)?;
    info!("Text expand rules saved ({} rules)", rules.len());
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

/// 读取图片并返回 base64（供前端显示）
#[tauri::command]
pub async fn read_image_as_base64(
    app_handle: tauri::AppHandle,
    relative_path: String,
) -> Result<String, String> {
    let data_store = DataStore::new(&app_handle)?;
    let image_data = data_store.load_image(&relative_path)?;

    // 转换为 base64
    let base64_str = STANDARD.encode(&image_data);

    Ok(base64_str)
}

/// 获取图片绝对路径（供前端显示）
#[tauri::command]
pub async fn get_image_path(
    app_handle: tauri::AppHandle,
    relative_path: String,
) -> Result<String, String> {
    let data_store = DataStore::new(&app_handle)?;
    let absolute_path = data_store.get_image_absolute_path(&relative_path);
    Ok(absolute_path.to_string_lossy().to_string())
}
