use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

// 全局变量，用于存储最后一次复制的内容hash，防止重复更新
pub static LAST_HASH: LazyLock<Arc<Mutex<String>>> =
    LazyLock::new(|| Arc::new(Mutex::new(String::new())));

// 全局变量，用于存储窗口的pin状态
pub static WINDOW_PIN_STATE: LazyLock<Arc<Mutex<bool>>> =
    LazyLock::new(|| Arc::new(Mutex::new(true))); // 默认pin状态

// 全局变量，用于存储应用句柄
pub static APP_HANDLE: LazyLock<Arc<Mutex<Option<AppHandle>>>> =
    LazyLock::new(|| Arc::new(Mutex::new(None)));

// 全局变量，用于存储剪贴板忽略截止时间（粘贴操作后短暂禁用监听）
// 单位：毫秒时间戳
pub static CLIPBOARD_IGNORE_UNTIL: LazyLock<Arc<Mutex<u64>>> =
    LazyLock::new(|| Arc::new(Mutex::new(0)));

/// 设置剪贴板忽略截止时间（从现在起忽略指定毫秒）
pub fn set_clipboard_ignore_for(millis: u64) {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let ignore_until = now + millis;
    let mut lock = CLIPBOARD_IGNORE_UNTIL.lock().unwrap();
    *lock = ignore_until;
}

/// 检查当前是否应该忽略剪贴板变化
pub fn should_ignore_clipboard() -> bool {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let ignore_until = *CLIPBOARD_IGNORE_UNTIL.lock().unwrap();
    now < ignore_until
}
