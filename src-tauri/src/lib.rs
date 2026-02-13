// 防止在 Release 模式下弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::thread;

use clipboard_rs::ClipboardWatcher;
use log::info;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

use tauri_plugin_fs;

use crate::clipboard_manager::ClipboardManager;
use crate::common::globals::APP_HANDLE;
use crate::common::models::ClipboardItem;
use crate::core::text_expand::TextExpander;

mod clipboard_manager;
mod commands;
mod common;
mod core;

// --- Main Entry ---

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    run_with_setup(|_| Ok(())).unwrap();
}

pub fn run_with_setup<F>(setup: F) -> Result<(), Box<dyn std::error::Error>>
where
    F: FnOnce(&mut tauri::App) -> Result<(), Box<dyn std::error::Error>> + Send + Sync + 'static,
{
    let history = Arc::new(Mutex::new(Vec::<ClipboardItem>::new()));
    let history_for_setup = history.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .manage(history)
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // 存储app_handle到全局变量
            {
                let mut app_handle_lock = APP_HANDLE.lock().unwrap();
                *app_handle_lock = Some(app_handle.clone());
                info!("App handle stored to global variable");
            }

            // 剪贴板监听独立线程
            thread::spawn(move || {
                let manager = ClipboardManager::new(app_handle, history_for_setup);

                // 注意：clipboard-rs 的 Watcher 需要在特定线程模型下运行
                // 这里的实现适用于大多数平台，但在某些严格 UI 线程要求的平台可能需要调整
                let mut watcher =
                    clipboard_rs::ClipboardWatcherContext::new().expect("Failed to init watcher");
                info!("Clipboard watcher started");

                let _watcher_shutdown = watcher.add_handler(manager).get_shutdown_channel();
                watcher.start_watch();
            });

            // 初始化并启动文本扩展
            let text_expander = TextExpander::new();
            // 启动文本扩展监听
            text_expander.start();

            // 创建托盘图标
            let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(
                    |tray: &tauri::tray::TrayIcon<tauri::Wry>, event| match event {
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } => {
                            // 左键点击：显示/聚焦窗口
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    },
                )
                .on_menu_event(|app: &tauri::AppHandle<tauri::Wry>, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // 执行外部传入的setup函数
            setup(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler!(
            commands::get_clipboard_history,
            commands::clear_history,
            commands::paste_to_active_window,
            commands::html_to_text,
            commands::copy_to_clipboard_no_history,
            commands::update_global_last_hash,
            commands::apply_no_activate_style,
            commands::update_window_pin_state,
            commands::print_message
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
