use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use clipboard_rs::{Clipboard, ClipboardContext, ClipboardHandler};
use clipboard_rs::common::RustImage;
use log::{error, info, warn};
use tauri::{AppHandle, Emitter};
use xxhash_rust::xxh3;

use crate::common::globals::{LAST_HASH, should_ignore_clipboard};
use crate::common::models::ClipboardItem;
use crate::core::data_store::DataStore;
use crate::generators::html_generator::markdown_to_html;

// 图片处理常量
const MAX_IMAGE_SIZE_BYTES: usize = 5 * 1024 * 1024;  // 5MB

// 时间窗口：同一操作的多个格式在此时间内到达（毫秒）
const FORMAT_DEDUP_WINDOW_MS: u64 = 500;

pub struct ClipboardManager {
    pub ctx: ClipboardContext,
    pub app_handle: AppHandle,
    pub history: Arc<Mutex<Vec<ClipboardItem>>>,
    pub last_hash: String,
    pub last_event_time: Instant,
    pub last_event_has_html: bool,
}

impl ClipboardManager {
    pub fn new(app_handle: AppHandle, history: Arc<Mutex<Vec<ClipboardItem>>>) -> Self {
        let ctx = ClipboardContext::new().expect("Failed to init clipboard context");
        ClipboardManager {
            ctx,
            app_handle,
            history,
            last_hash: String::new(),
            last_event_time: Instant::now(),
            last_event_has_html: false,
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

        let now = Instant::now();
        let time_since_last = now.duration_since(self.last_event_time);
        let is_within_dedup_window = time_since_last < Duration::from_millis(FORMAT_DEDUP_WINDOW_MS);

        // --- 优先级 1: HTML ---
        if let Ok(html) = self.ctx.get_html() {
            if !html.trim().is_empty() {
                // 先修复未闭合的 HTML 标签，再计算 hash（确保 hash 和内容一致）
                let fixed_html = ClipboardItem::fix_unclosed_html_tags(&html);
                let hash = Self::generate_hash(fixed_html.as_bytes());
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
                    // 更新时间戳和 HTML 标志
                    self.last_event_time = now;
                    self.last_event_has_html = true;
                    // models.rs 会自动处理预览，去掉标签显示 "[HTML] xxx"
                    let item = ClipboardItem::new_html(&fixed_html, &hash);
                    self.process_new_item(item);
                    return;
                }
            }
        }

        // --- 优先级 2: RTF (富文本) ---
        // 如果在时间窗口内已有 HTML，跳过 RTF（避免重复）
        if is_within_dedup_window && self.last_event_has_html {
            info!("Skipping RTF within dedup window (HTML already processed)");
            return;
        }

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
                    // 更新时间戳，重置 HTML 标志
                    self.last_event_time = now;
                    self.last_event_has_html = false;
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
                    // 更新时间戳，重置 HTML 标志
                    self.last_event_time = now;
                    self.last_event_has_html = false;
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

                    // 更新时间戳，重置 HTML 标志
                    self.last_event_time = now;
                    self.last_event_has_html = false;

                    // 检测是否包含 Markdown 标记，如果有则标记为 markdown 格式
                    let item = if let Some(_html) = markdown_to_html(&text) {
                        info!("Detected Markdown syntax, storing as markdown");
                        ClipboardItem::new_markdown(&text, &hash)
                    } else {
                        ClipboardItem::new_text(&text, &hash)
                    };

                    self.process_new_item(item);
                    return;
                }
            }
        }

        // --- 优先级 5: 图片 (Image) --- (放在最后，因为 get_image() 可能比较耗时)
        if let Ok(img) = self.ctx.get_image() {
            // 获取原始尺寸
            let (width, height) = img.get_size();

            // 转换为 PNG 字节
            let buffer = match img.to_png() {
                Ok(data) => data,
                Err(e) => {
                    error!("Failed to encode image as PNG: {:?}", e);
                    return;
                }
            };

            // 获取字节数据
            let bytes = buffer.get_bytes();

            // 大小检查
            if bytes.len() > MAX_IMAGE_SIZE_BYTES {
                warn!("Image too large ({} bytes), skipping", bytes.len());
                return;
            }

            // 使用图片数据计算 hash
            let hash = Self::generate_hash(&bytes);

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

                // 更新时间戳，重置 HTML 标志
                self.last_event_time = now;
                self.last_event_has_html = false;

                // 保存图片文件
                match DataStore::new(&self.app_handle) {
                    Ok(data_store) => {
                        match data_store.save_image(&hash, &bytes) {
                            Ok(relative_path) => {
                                // 创建图片条目
                                let item = ClipboardItem::new_image(
                                    &relative_path,
                                    &hash,
                                    Some(width as usize),
                                    Some(height as usize),
                                    Some(bytes.len()),
                                );
                                self.process_new_item(item);
                            }
                            Err(e) => {
                                error!("Failed to save image file: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        error!("Failed to create DataStore: {}", e);
                    }
                }
                return; // 捕获到图片后，不再处理后续格式
            }
        }
    }
}
