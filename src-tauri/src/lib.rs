// 防止在 Release 模式下弹出控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// 导入标准库
use std::sync::{Arc, LazyLock, Mutex};
use std::thread;
use std::time::Duration;

// 导入Windows API（仅Windows平台）
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::HWND;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOPMOST,
};

// 导入enigo的KeyboardControllable trait
use enigo::KeyboardControllable;

use clipboard_rs::{
    Clipboard, ClipboardContext, ClipboardHandler, ClipboardWatcher, ClipboardWatcherContext,
};
use log::{error, info};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};

use tauri_plugin_fs;

// 引入模型
use crate::common::models::ClipboardItem;
use crate::core::text_expand::TextExpander;

mod common;
mod core;

// 全局变量，用于存储最后一次复制的内容hash，防止重复更新
static LAST_HASH: LazyLock<Arc<Mutex<String>>> =
    LazyLock::new(|| Arc::new(Mutex::new(String::new())));

// 全局变量，用于存储窗口的pin状态
static WINDOW_PIN_STATE: LazyLock<Arc<Mutex<bool>>> = LazyLock::new(|| Arc::new(Mutex::new(false))); // 默认非pin状态

// 全局变量，用于存储应用句柄
static APP_HANDLE: LazyLock<Arc<Mutex<Option<tauri::AppHandle>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(None)));

struct ClipboardManager {
    ctx: ClipboardContext,
    app_handle: AppHandle,
    history: Arc<Mutex<Vec<ClipboardItem>>>,
    last_hash: String,
}

impl ClipboardManager {
    pub fn new(app_handle: AppHandle, history: Arc<Mutex<Vec<ClipboardItem>>>) -> Self {
        let ctx = ClipboardContext::new().expect("Failed to init clipboard context");
        ClipboardManager {
            ctx,
            app_handle,
            history,
            last_hash: String::new(),
        }
    }

    // 生成哈希工具函数 (使用 XXH3 极速哈希)
    fn generate_hash(content: &[u8]) -> String {
        // 直接计算 64位哈希值
        let hash = xxhash_rust::xxh3::xxh3_64(content);

        // 格式化为 16 字符的十六进制字符串 (例如: "a1b2c3d4e5f60708")
        // :016x 表示：不足16位左侧补0，使用小写字母
        format!("{:016x}", hash)
    }

    // 处理并广播新条目
    fn process_new_item(&self, item: ClipboardItem) {
        let mut history_lock = self.history.lock().unwrap();

        // 1. 逻辑去重与置顶：如果 ID (Hash) 已存在，先移除旧的
        history_lock.retain(|i| i.id != item.id);

        // 2. 插入到最前面
        history_lock.insert(0, item.clone());

        // 3. 限制长度
        if history_lock.len() > 50 {
            history_lock.truncate(50);
        }

        // 4. 发送事件给前端
        info!(
            "New clipboard item detected: {:?} ({})",
            item.format, item.id
        );
        if let Err(e) = self.app_handle.emit("clipboard-update", &item) {
            error!("Event emit error: {:?}", e);
        }
    }
}

impl ClipboardHandler for ClipboardManager {
    fn on_clipboard_change(&mut self) {
        // --- 优先级 1: HTML ---
        if let Ok(html) = self.ctx.get_html() {
            if !html.trim().is_empty() {
                let hash = Self::generate_hash(html.as_bytes());
                let global_last_hash = LAST_HASH.lock().unwrap();
                if hash != self.last_hash && hash != *global_last_hash {
                    // 立即更新 last_hash，防止竞态条件
                    self.last_hash = hash.clone();
                    // models.rs 会自动处理预览，去掉标签显示 "[HTML] xxx"
                    let item = ClipboardItem::new_html(&html, &hash);
                    self.process_new_item(item);
                    return;
                }
            }
        }

        // --- 优先级 2: RTF (富文本) ---
        if let Ok(rtf) = self.ctx.get_rich_text() {
            if !rtf.trim().is_empty() {
                let hash = Self::generate_hash(rtf.as_bytes());
                let global_last_hash = LAST_HASH.lock().unwrap();
                if hash != self.last_hash && hash != *global_last_hash {
                    // 立即更新 last_hash，防止竞态条件
                    self.last_hash = hash.clone();
                    let item = ClipboardItem::new_rtf(&rtf, &hash);
                    self.process_new_item(item);
                    return;
                }
            }
        }

        // --- 优先级 3: 文件列表 (Files) ---
        if let Ok(files) = self.ctx.get_files() {
            if !files.is_empty() {
                // 对文件路径列表进行 Hash
                let joined_paths = files.join("|");
                let hash = Self::generate_hash(joined_paths.as_bytes());

                let global_last_hash = LAST_HASH.lock().unwrap();
                if hash != self.last_hash && hash != *global_last_hash {
                    // 立即更新 last_hash，防止竞态条件
                    self.last_hash = hash.clone();
                    let item = ClipboardItem::new_files(files, &hash);
                    self.process_new_item(item);
                    return;
                }
            }
        }

        // --- 优先级 4: 纯文本 (Plain Text) ---
        if let Ok(text) = self.ctx.get_text() {
            if !text.trim().is_empty() {
                let hash = Self::generate_hash(text.as_bytes());
                let global_last_hash = LAST_HASH.lock().unwrap();
                if hash != self.last_hash && hash != *global_last_hash {
                    // 立即更新 last_hash，防止竞态条件
                    self.last_hash = hash.clone();
                    let item = ClipboardItem::new_text(&text, &hash);
                    self.process_new_item(item);
                    return;
                }
            }
        }

        // --- 优先级 5: 图片 (Image) --- (放在最后，因为 get_image() 可能比较耗时)
        // 检测图片是否存在
        if self.ctx.get_image().is_ok() {
            let hash = Self::generate_hash(b"[image]");

            let global_last_hash = LAST_HASH.lock().unwrap();
            if hash != self.last_hash && hash != *global_last_hash {
                // 立即更新 last_hash，防止竞态条件
                self.last_hash = hash.clone();

                // 创建图片条目
                let item = ClipboardItem::new_image("[image]", &hash, None, None);
                self.process_new_item(item);
                return; // 捕获到图片后，不再处理后续格式
            }
        }
    }
}

// --- Tauri Commands ---

#[tauri::command]
fn get_clipboard_history(history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>) -> Vec<ClipboardItem> {
    history.lock().unwrap().clone()
}

#[tauri::command]
fn clear_history(history: State<'_, Arc<Mutex<Vec<ClipboardItem>>>>) {
    history.lock().unwrap().clear();
}

#[tauri::command]
async fn paste_to_active_window(
    window: tauri::WebviewWindow,
    content: String,
    format: String,  // 新增参数：必须知道格式才能正确写入剪贴板
    is_pinned: bool, // 新增参数：窗口是否处于pin状态
) -> Result<(), String> {
    // 2. 计算内容的hash并更新全局的LAST_HASH变量
    let hash = ClipboardManager::generate_hash(content.as_bytes());
    let mut last_hash_lock = LAST_HASH.lock().unwrap();
    *last_hash_lock = hash.clone();
    info!("Updated global last hash for paste operation");

    // 3. 将内容写入剪贴板 (在新线程中执行以防阻塞)
    let format_clone = format.clone();
    let content_clone = content.clone();

    let copy_handle = thread::spawn(move || {
        // 创建临时的 ClipboardContext
        let ctx = ClipboardContext::new().map_err(|e| e.to_string())?;

        match format_clone.as_str() {
            "html" => ctx.set_html(content_clone).map_err(|e| e.to_string()),
            "rtf" => ctx.set_rich_text(content_clone).map_err(|e| e.to_string()),
            // 如果是图片，你需要根据你的逻辑传递路径或Base64，这里暂按文本处理 fallback
            _ => ctx.set_text(content_clone).map_err(|e| e.to_string()),
        }
    });

    if let Err(e) = copy_handle.join().map_err(|_| "Thread panic".to_string())? {
        return Err(format!("Clipboard write failed: {}", e));
    }

    // 4. 隐藏窗口 (关键步骤)
    // 必须隐藏 Tauri 窗口，系统焦点才会交还给上一个应用程序 (如 VSCode, Word)
    // 使用 hide() 比 minimize() 体验更好
    // 但只有在非pin状态下才隐藏窗口
    if !is_pinned {
        if let Err(e) = window.hide() {
            return Err(format!("Failed to hide window: {}", e));
        }
    }

    // 5. 等待焦点切换 (必须有延时)
    // 150ms 是经验值，太短会导致按键发给 Tauri 窗口自己
    thread::sleep(Duration::from_millis(150));

    // 6. 模拟组合键 (Ctrl+V / Cmd+V)
    let mut enigo = enigo::Enigo::new();

    #[cfg(target_os = "macos")]
    {
        // macOS: Command + V
        enigo.key_down(enigo::Key::Meta);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Meta);
    }

    #[cfg(not(target_os = "macos"))]
    {
        // Windows/Linux: Control + V
        enigo.key_down(enigo::Key::Control);
        enigo.key_click(enigo::Key::Layout('v'));
        enigo.key_up(enigo::Key::Control);
    }

    Ok(())
}

#[tauri::command]
async fn html_to_text(html: String) -> String {
    nanohtml2text::html2text(&html)
}

#[tauri::command]
async fn update_global_last_hash(hash: String) -> Result<(), String> {
    // 更新全局的LAST_HASH变量
    let mut last_hash_lock = LAST_HASH.lock().unwrap();
    *last_hash_lock = hash;
    info!("Updated global last hash");
    Ok(())
}

#[tauri::command]
fn apply_no_activate_style(window: tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            let hwnd = HWND(hwnd.0 as isize as _);
            unsafe {
                // 获取当前样式
                let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                // 追加 WS_EX_NOACTIVATE (不激活) 和 WS_EX_TOPMOST (置顶)
                // 这样点击窗口内容时，焦点依然保留在之前的应用上
                let new_style = style | (WS_EX_NOACTIVATE.0 as isize) | (WS_EX_TOPMOST.0 as isize);
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
                info!(
                    "Window style updated to: {:x}, WS_EX_NOACTIVATE: {:x}, WS_EX_TOPMOST: {:x}",
                    new_style, WS_EX_NOACTIVATE.0, WS_EX_TOPMOST.0
                );
            }
        }
    }
    // macOS 需要在创建窗口时设置 NSPanel 属性，Tauri 默认支持不好，可能需要 Objective-C 混编
    // 这里主要演示 Windows 方案
}

#[tauri::command]
async fn update_window_pin_state(is_pinned: bool) -> Result<(), String> {
    // 更新全局的WINDOW_PIN_STATE变量
    let mut pin_state_lock = WINDOW_PIN_STATE.lock().unwrap();
    *pin_state_lock = is_pinned;
    info!("Updated global window pin state to: {}", is_pinned);

    // 从全局变量获取app_handle
    let app_handle_lock = APP_HANDLE.lock().unwrap();
    if let Some(app_handle) = &*app_handle_lock {
        // 获取主窗口
        if let Some(window) = app_handle.get_webview_window("main") {
            // 无论是否pin状态，都应用"不抢焦点"样式
            apply_no_activate_style(window);
            info!("No-activate style applied to window");
        }
    }

    Ok(())
}

#[tauri::command]
async fn copy_to_clipboard_no_history(content: String, format: String) -> Result<(), String> {
    // 计算内容的hash
    let hash = ClipboardManager::generate_hash(content.as_bytes());
    // 更新全局的LAST_HASH变量
    let mut last_hash_lock = LAST_HASH.lock().unwrap();
    *last_hash_lock = hash.clone();
    info!("Updated global last hash for copy operation");

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
                let mut watcher = ClipboardWatcherContext::new().expect("Failed to init watcher");
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
        .invoke_handler(tauri::generate_handler![
            get_clipboard_history,
            clear_history,
            paste_to_active_window,
            html_to_text,
            copy_to_clipboard_no_history,
            update_global_last_hash,
            apply_no_activate_style,
            update_window_pin_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");

    Ok(())
}
