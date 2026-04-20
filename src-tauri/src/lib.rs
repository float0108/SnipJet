// 防止在 Release 模式下弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::{Arc, Mutex};
use std::thread;

use clipboard_rs::ClipboardWatcher;
use log::{error, info};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

use tauri_plugin_fs;
use tauri_plugin_global_shortcut;
use tauri_plugin_autostart::MacosLauncher;

use crate::clipboard_manager::ClipboardManager;
use crate::common::globals::{APP_HANDLE, SHORTCUT_ACTION_MAP};
use crate::common::models::ClipboardItem;
use crate::core::data_store::{start_auto_save, load_all_data, save_all_data, AUTO_SAVE_INTERVAL_SECS};
use crate::core::mouse_listener::start_global_click_listener;
use crate::core::text_expand::TextExpander;
use crate::mcp::start_mcp_server;
use crate::common::globals::MCP_SERVER_HANDLE;
use tauri::{Emitter, Listener};

mod clipboard_manager;
mod commands;
mod common;
mod core;
mod generators;
mod mcp;

/// 加载 PNG 图标文件并转换为 Tauri Image
fn load_icon(path: &std::path::Path) -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
    let img = image::open(path)?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(tauri::image::Image::new_owned(rgba.into_raw(), width, height))
}

/// 嵌入的默认图标数据
const DEFAULT_ICON_BYTES: &[u8] = include_bytes!("../icons/32x32.png");

/// 加载默认图标（从嵌入数据）
fn load_default_icon() -> Result<tauri::image::Image<'static>, Box<dyn std::error::Error>> {
    let img = image::load_from_memory(DEFAULT_ICON_BYTES)?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(tauri::image::Image::new_owned(rgba.into_raw(), width, height))
}

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
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--hidden"])))
        .manage(history.clone())
        .setup(move |app| {
            let app_handle = app.handle().clone();

            // 存储app_handle到全局变量
            {
                let mut app_handle_lock = APP_HANDLE.lock().unwrap();
                *app_handle_lock = Some(app_handle.clone());
                info!("App handle stored to global variable");
            }

            // 启动全局鼠标监听器，用于检测点击外部窗口
            start_global_click_listener(app_handle.clone());
            info!("Global click listener started");

            // 加载持久化数据
            match load_all_data(&app_handle) {
                Ok((loaded_history, loaded_settings, _text_expand_rules)) => {
                    info!("Loaded {} history items from storage", loaded_history.len());
                    // 将加载的数据存入history
                    {
                        let mut history_lock = history_for_setup.lock().unwrap();
                        *history_lock = loaded_history;
                    }

                    // 根据设置启用/禁用自启动
                    let startup_launch = loaded_settings.get("software")
                        .and_then(|s| s.get("startup_launch"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);

                    use tauri_plugin_autostart::ManagerExt;
                    let autolaunch = app_handle.autolaunch();

                    if startup_launch {
                        if let Err(e) = autolaunch.enable() {
                            error!("Failed to enable autostart on startup: {:?}", e);
                        } else {
                            info!("Autostart enabled on startup (setting: {})", startup_launch);
                        }
                    } else {
                        if let Err(e) = autolaunch.disable() {
                            error!("Failed to disable autostart on startup: {:?}", e);
                        } else {
                            info!("Autostart disabled on startup (setting: {})", startup_launch);
                        }
                    }
                }
                Err(e) => {
                    error!("Failed to load data: {}, starting with empty history", e);
                }
            };

            // 确保主窗口始终置顶
            if let Some(window) = app_handle.get_webview_window("main") {
                if let Err(e) = window.set_always_on_top(true) {
                    error!("Failed to set main window always on top: {:?}", e);
                } else {
                    info!("Main window always on top set to true");
                }
            }

            // 启动自动保存任务
            start_auto_save(app_handle.clone(), history_for_setup.clone(), AUTO_SAVE_INTERVAL_SECS);
            info!("Auto-save task started with {} second interval", AUTO_SAVE_INTERVAL_SECS);

            // 设置全局快捷键事件监听（必须在剪贴板线程之前设置，避免app_handle被移动）
            let app_handle_for_shortcut = app_handle.clone();
            app_handle.listen("global-shortcut", move |event: tauri::Event| {
                // 解析事件payload获取快捷键字符串
                let payload: String = event.payload().to_string();
                let shortcut_str = payload.trim_matches('"');

                // 查找对应的动作
                let action = {
                    let map = SHORTCUT_ACTION_MAP.lock().unwrap();
                    map.get(shortcut_str).cloned()
                };

                if let Some(action_name) = action {
                    let _ = app_handle_for_shortcut.emit(&format!("shortcut-{}", action_name), ());
                }
            });
            info!("Global shortcut event listener registered");

            // 剪贴板监听独立线程
            let history_for_clipboard = history_for_setup.clone();
            let history_for_tray = history_for_setup.clone();
            let app_handle_for_clipboard = app_handle.clone();
            thread::spawn(move || {
                let manager = ClipboardManager::new(app_handle_for_clipboard, history_for_clipboard);

                // 注意：clipboard-rs 的 Watcher 需要在特定线程模型下运行
                // 这里的实现适用于大多数平台，但在某些严格 UI 线程要求的平台可能需要调整
                let mut watcher =
                    clipboard_rs::ClipboardWatcherContext::new().expect("Failed to init watcher");
                info!("Clipboard watcher started");

                let _watcher_shutdown = watcher.add_handler(manager).get_shutdown_channel();
                watcher.start_watch();
            });

            // 初始化并启动文本扩展
            let text_expander = TextExpander::new(&app_handle);
            // 启动文本扩展监听
            text_expander.start();
            // 将 TextExpander 存入 Tauri 状态管理
            app.manage(Arc::new(Mutex::new(text_expander)));

            // 从设置中读取 MCP 配置并启动服务
            {
                let settings = load_all_data(&app_handle)
                    .map(|(_, settings, _)| settings)
                    .unwrap_or_else(|_| serde_json::json!({}));

                let mcp_enabled = settings.get("mcp")
                    .and_then(|m| m.get("enabled"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let mcp_port = settings.get("mcp")
                    .and_then(|m| m.get("port"))
                    .and_then(|v| v.as_u64())
                    .unwrap_or(3000) as u16;

                if mcp_enabled {
                    let history_for_mcp = history_for_setup.clone();
                    let app_handle_for_mcp = app_handle.clone();
                    match start_mcp_server(mcp_port, Some(Arc::new(app_handle_for_mcp)), history_for_mcp) {
                        Ok(handle) => {
                            info!("MCP server started successfully on port {}", mcp_port);
                            let mut mcp_handle = MCP_SERVER_HANDLE.lock().unwrap();
                            *mcp_handle = Some(handle);
                        }
                        Err(e) => {
                            error!("Failed to start MCP server: {}", e);
                        }
                    }
                } else {
                    info!("MCP server not started (disabled in settings)");
                }
            }

            // 创建托盘图标 - 使用 32x32 图标以确保在 Windows 上显示清晰
            let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;

            // 加载 32x32 图标用于托盘（优先使用嵌入的图标）
            let tray_icon = match load_default_icon() {
                Ok(icon) => icon,
                Err(e) => {
                    log::warn!("Failed to load embedded icon: {}", e);
                    // 尝试从资源目录加载
                    match app.path().resolve("icons/32x32.png", tauri::path::BaseDirectory::Resource) {
                        Ok(path) => match load_icon(&path) {
                            Ok(icon) => icon,
                            Err(e) => {
                                log::error!("Failed to load icon from path: {}", e);
                                tauri::image::Image::new_owned(vec![0, 0, 0, 0], 1, 1)
                            }
                        },
                        Err(e) => {
                            log::error!("Failed to resolve icon path: {}", e);
                            tauri::image::Image::new_owned(vec![0, 0, 0, 0], 1, 1)
                        }
                    }
                }
            };

            let _tray = TrayIconBuilder::new()
                .icon(tray_icon)
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
                .on_menu_event(move |app: &tauri::AppHandle<tauri::Wry>, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            // 保存数据后再退出
                            if let Err(e) = save_all_data(app, history_for_tray.clone()) {
                                error!("Failed to save data on exit: {}", e);
                            }
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
            commands::delete_clipboard_item,
            commands::toggle_favorite,
            commands::get_favorite_items,
            commands::paste_to_active_window,
            commands::html_to_text,
            commands::markdown_to_html_command,
            commands::copy_to_clipboard_no_history,
            commands::update_global_last_hash,
            commands::apply_no_activate_style,
            commands::update_window_pin_state,
            commands::print_message,
            commands::get_mouse_position,
            commands::save_clipboard_history,
            commands::load_clipboard_history_command,
            commands::save_settings,
            commands::load_settings_command,
            commands::register_global_shortcut,
            commands::unregister_global_shortcut,
            commands::load_text_expand_rules,
            commands::save_text_expand_rules,
            commands::reload_text_expand_rules,
            commands::read_image_as_base64,
            commands::get_image_path,
            commands::set_autostart,
            commands::get_autostart_status,
            commands::get_mcp_status,
            commands::start_mcp_service,
            commands::stop_mcp_service,
            commands::restart_mcp_service,
            commands::copy_markdown_as_docx
        ))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
