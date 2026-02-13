use std::sync::{Arc, LazyLock, Mutex};

use tauri::AppHandle;

// 全局变量，用于存储最后一次复制的内容hash，防止重复更新
pub static LAST_HASH: LazyLock<Arc<Mutex<String>>> = LazyLock::new(|| Arc::new(Mutex::new(String::new())));

// 全局变量，用于存储窗口的pin状态
pub static WINDOW_PIN_STATE: LazyLock<Arc<Mutex<bool>>> = LazyLock::new(|| Arc::new(Mutex::new(false))); // 默认非pin状态

// 全局变量，用于存储应用句柄
pub static APP_HANDLE: LazyLock<Arc<Mutex<Option<AppHandle>>>> = LazyLock::new(|| Arc::new(Mutex::new(None)));
