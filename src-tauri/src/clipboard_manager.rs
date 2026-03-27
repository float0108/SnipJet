use std::sync::{Arc, Mutex};

use clipboard_rs::{Clipboard, ClipboardContext, ClipboardHandler};
use log::{error, info};
use tauri::{AppHandle, Emitter};
use xxhash_rust::xxh3;

use crate::common::globals::{LAST_HASH, should_ignore_clipboard};
use crate::common::models::ClipboardItem;

pub struct ClipboardManager {
    pub ctx: ClipboardContext,
    pub app_handle: AppHandle,
    pub history: Arc<Mutex<Vec<ClipboardItem>>>,
    pub last_hash: String,
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
    pub fn generate_hash(content: &[u8]) -> String {
        // 直接计算 64位哈希值
        let hash = xxh3::xxh3_64(content);

        // 格式化为 16 字符的十六进制字符串 (例如: "a1b2c3d4e5f60708")
        // :016x 表示：不足16位左侧补0，使用小写字母
        format!("{:016x}", hash)
    }

    // 处理并广播新条目
    pub fn process_new_item(&self, item: ClipboardItem) {
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
        // 检查是否应该忽略剪贴板变化（粘贴操作后的短暂禁用）
        if should_ignore_clipboard() {
            return;
        }

        // --- 优先级 1: HTML ---
        if let Ok(html) = self.ctx.get_html() {
            if !html.trim().is_empty() {
                let hash = Self::generate_hash(html.as_bytes());
                // 只在需要时获取锁，并且尽快释放
                let is_new_hash = {
                    let global_last_hash = LAST_HASH.lock().unwrap();
                    hash != self.last_hash && hash != *global_last_hash
                };
                if is_new_hash {
                    // 立即更新 last_hash，防止竞态条件
                    self.last_hash = hash.clone();
                    // 更新全局 last_hash
                    {
                        let mut global_last_hash = LAST_HASH.lock().unwrap();
                        *global_last_hash = hash.clone();
                    }
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
                let is_new_hash = {
                    let global_last_hash = LAST_HASH.lock().unwrap();
                    hash != self.last_hash && hash != *global_last_hash
                };
                if is_new_hash {
                    // 立即更新 last_hash，防止竞态条件
                    self.last_hash = hash.clone();
                    // 更新全局 last_hash
                    {
                        let mut global_last_hash = LAST_HASH.lock().unwrap();
                        *global_last_hash = hash.clone();
                    }
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

                let is_new_hash = {
                    let global_last_hash = LAST_HASH.lock().unwrap();
                    hash != self.last_hash && hash != *global_last_hash
                };
                if is_new_hash {
                    // 立即更新 last_hash，防止竞态条件
                    self.last_hash = hash.clone();
                    // 更新全局 last_hash
                    {
                        let mut global_last_hash = LAST_HASH.lock().unwrap();
                        *global_last_hash = hash.clone();
                    }
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
                let is_new_hash = {
                    let global_last_hash = LAST_HASH.lock().unwrap();
                    hash != self.last_hash && hash != *global_last_hash
                };
                if is_new_hash {
                    // 立即更新 last_hash，防止竞态条件
                    self.last_hash = hash.clone();
                    // 更新全局 last_hash
                    {
                        let mut global_last_hash = LAST_HASH.lock().unwrap();
                        *global_last_hash = hash.clone();
                    }
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

            let is_new_hash = {
                let global_last_hash = LAST_HASH.lock().unwrap();
                hash != self.last_hash && hash != *global_last_hash
            };
            if is_new_hash {
                // 立即更新 last_hash，防止竞态条件
                self.last_hash = hash.clone();
                // 更新全局 last_hash
                {
                    let mut global_last_hash = LAST_HASH.lock().unwrap();
                    *global_last_hash = hash.clone();
                }

                // 创建图片条目
                let item = ClipboardItem::new_image("[image]", &hash, None, None);
                self.process_new_item(item);
                return; // 捕获到图片后，不再处理后续格式
            }
        }
    }
}
