use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

// 导入Windows API（仅Windows平台）
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
};

use clipboard_rs::{Clipboard, ClipboardContext};
use enigo::{Enigo, Key, KeyboardControllable};
use log::{error, info};
use tauri::{Manager, State, WebviewWindow};

use crate::clipboard_manager::ClipboardManager;
use crate::common::globals::{APP_HANDLE, LAST_HASH, WINDOW_PIN_STATE};
use crate::common::models::ClipboardItem;

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
pub async fn paste_to_active_window(
    window: tauri::WebviewWindow,
    content: String,
    format: String,
    is_pinned: bool,
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
    let content_clone = content.clone();

    let clipboard_handle = thread::spawn(move || -> Result<(), String> {
        // 创建上下文
        let ctx = ClipboardContext::new().map_err(|e| {
            eprintln!("[ERROR] 剪贴板上下文创建失败: {}", e);
            e.to_string()
        })?;

        let res = match format_clone.as_str() {
            "html" => ctx.set_html(content_clone),
            "rtf" => ctx.set_rich_text(content_clone),
            _ => ctx.set_text(content_clone),
        };

        match res {
            Ok(_) => Ok(()),
            Err(e) => {
                eprintln!("[ERROR] 剪贴板写入失败: {}", e);
                Err(e.to_string())
            }
        }
    });

    // 等待剪贴板写入完成
    if let Err(e) = clipboard_handle
        .join()
        .map_err(|_| "剪贴板线程 Panic".to_string())?
    {
        return Err(format!("剪贴板操作失败: {}", e));
    }

    // 5. 模拟组合键 (增强版)
    println!("[DEBUG] 启动按键模拟线程 (Ctrl+V)...");
    let paste_handle = thread::spawn(move || {
        let mut enigo = Enigo::new();

        // 再次短暂等待，确保 Enigo 初始化完成
        thread::sleep(Duration::from_millis(50));

        #[cfg(target_os = "macos")]
        {
            println!("[DEBUG] 操作系统: macOS - 发送 CMD + V");
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
            println!("[DEBUG] 操作系统: Windows/Linux - 发送 Ctrl + V");
            // 按下 Control
            enigo.key_down(Key::Control);
            thread::sleep(Duration::from_millis(100)); // Windows 可能需要更长的按键响应时间

            // 点击 V
            // 如果 Layout('v') 不工作，有些环境可能需要 Key::Raw 或其他方式
            enigo.key_click(Key::Layout('v'));
            thread::sleep(Duration::from_millis(100));

            // 松开 Control
            enigo.key_up(Key::Control);
        }

        println!("[DEBUG] 按键序列发送完毕");
    });

    // 等待按键线程结束
    if let Err(_) = paste_handle.join() {
        eprintln!("[ERROR] 按键模拟线程崩溃 (Panic)");
        return Err("按键模拟失败".to_string());
    }

    println!("[DEBUG] 粘贴流程结束");
    println!("--------------------------------------------------");
    Ok(())
}

#[tauri::command]
pub async fn html_to_text(html: String) -> String {
    nanohtml2text::html2text(&html)
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
    let app_handle_lock = APP_HANDLE.lock().unwrap();
    if let Some(app_handle) = &*app_handle_lock {
        // 无论是否pin状态，都应用"不抢焦点"样式
        apply_no_activate_style();
        info!("No-activate style applied to window");
    }

    Ok(())
}

#[tauri::command]
pub async fn copy_to_clipboard_no_history(content: String, format: String) -> Result<(), String> {
    // 计算内容的hash
    let hash = ClipboardManager::generate_hash(content.as_bytes());
    // 更新全局的LAST_HASH变量
    let mut last_hash_lock = LAST_HASH.lock().unwrap();
    *last_hash_lock = hash.clone();

    // 直接复制内容到剪贴板
    let ctx = ClipboardContext::new()
        .map_err(|e| format!("Failed to init clipboard context: {:?}", e))?;

    // 根据格式复制内容
    match format.as_str() {
        "html" => {
            ctx.set_html(content)
                .map_err(|e| format!("Failed to set clipboard html: {:?}", e))?;
            info!("Copied HTML content to clipboard without history update");
        }
        _ => {
            ctx.set_text(content)
                .map_err(|e| format!("Failed to set clipboard text: {:?}", e))?;
            info!("Copied text content to clipboard without history update");
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn print_message(message: String) -> Result<(), String> {
    info!("Message from frontend: {}", message);
    println!("Frontend message: {}", message);
    Ok(())
}
