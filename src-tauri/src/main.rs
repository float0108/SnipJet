// 主入口点

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewWindow};

#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
};

// --- 1. 设置窗口样式：绝对不获取焦点 ---
#[tauri::command]
fn apply_no_activate_style(window: WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0 as isize as _);
            unsafe {
                // 获取当前样式
                let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                // 追加 WS_EX_NOACTIVATE (不激活) 和 WS_EX_TOPMOST (置顶)
                // 这样点击窗口内容时，焦点依然保留在之前的应用上
                SetWindowLongPtrW(
                    hwnd,
                    GWL_EXSTYLE,
                    style | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOPMOST.0 as isize),
                );
            }
        }
    }
    // macOS 需要在创建窗口时设置 NSPanel 属性，Tauri 默认支持不好，可能需要 Objective-C 混编
    // 这里主要演示 Windows 方案
}

fn main() {
    app_lib::run_with_setup(|app| {
        // 应用“不抢焦点”样式
        if let Some(window) = app.get_webview_window("main") {
            apply_no_activate_style(window);
        }

        Ok(())
    });
}
