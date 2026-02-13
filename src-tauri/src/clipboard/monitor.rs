// 剪贴板监控逻辑

use crate::common::models::ClipboardItem;
use clipboard_rs::{Clipboard, ClipboardContext};
use hex;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// 启动剪贴板监控线程
///
/// # Arguments
/// * `history` - 共享的历史记录存储
/// * `app_handle` - Tauri应用句柄，用于发送事件
pub fn monitor_clipboard(history: Arc<Mutex<Vec<ClipboardItem>>>, app_handle: AppHandle) {
    println!("Clipboard monitor started");
    let mut last_hash = String::new();
    let mut initialization_attempts = 0;
    const MAX_INIT_ATTEMPTS: u8 = 5;
    let mut consecutive_errors = 0;
    const MAX_CONSECUTIVE_ERRORS: u8 = 10;

    // 添加启动延迟，让剪贴板有时间初始化
    thread::sleep(Duration::from_millis(1000));

    loop {
        match ClipboardContext::new() {
            Ok(ctx) => {
                match ctx.get_text() {
                    Ok(content) => {
                        // 重置错误计数
                        initialization_attempts = 0;
                        consecutive_errors = 0;

                        if !content.trim().is_empty() {
                            // 计算内容哈希
                            let mut hasher = Sha256::new();
                            hasher.update(content.as_bytes());
                            let hash = hex::encode(&hasher.finalize()[..8]);

                            // 仅当内容不同时添加
                            if hash != last_hash {
                                println!("New clipboard content detected: {:?}", content);
                                last_hash = hash.clone();

                                // 创建剪贴板项目
                                let item = ClipboardItem::new(&content, &hash);

                                // 更新历史记录
                                let mut history_lock = history.lock().unwrap();
                                history_lock.insert(0, item.clone());
                                println!("Added to history, current count: {}", history_lock.len());

                                // 保持最多50条记录
                                if history_lock.len() > 50 {
                                    history_lock.truncate(50);
                                }

                                // 发送事件到前端
                                println!("Attempting to emit clipboard-update event");
                                println!("Item to emit: {:?}", item);
                                match app_handle.emit("clipboard-update", &item) {
                                    Ok(_) => {
                                        println!("Successfully emitted clipboard-update event");
                                    }
                                    Err(e) => {
                                        println!("Failed to emit clipboard-update event: {:?}", e);
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        // 增加连续错误计数
                        consecutive_errors += 1;

                        // 初始化阶段错误处理
                        if initialization_attempts <= MAX_INIT_ATTEMPTS {
                            initialization_attempts += 1;
                            println!(
                                "Initialization error getting clipboard text (attempt {}): {:?}",
                                initialization_attempts, e
                            );
                            // 初始化阶段的错误，给予更多时间
                            thread::sleep(Duration::from_millis(1000));
                        } else if consecutive_errors <= MAX_CONSECUTIVE_ERRORS {
                            // 初始化完成后，暂时的剪贴板错误
                            println!(
                                "Temporary clipboard error ({} consecutive): {:?}",
                                consecutive_errors, e
                            );
                            // 给予一点额外时间恢复
                            thread::sleep(Duration::from_millis(300));
                        } else {
                            // 连续错误过多，可能是持久问题
                            println!("Persistent clipboard error, throttling checks: {:?}", e);
                            // 增加等待时间，减少错误日志刷屏
                            thread::sleep(Duration::from_millis(2000));
                        }
                    }
                }
            }
            Err(e) => {
                // 增加连续错误计数
                consecutive_errors += 1;

                if consecutive_errors <= MAX_CONSECUTIVE_ERRORS {
                    println!("Error creating clipboard context: {:?}", e);
                } else {
                    println!(
                        "Persistent clipboard context error, throttling checks: {:?}",
                        e
                    );
                    thread::sleep(Duration::from_millis(2000));
                }
            }
        }

        // 每500毫秒检查一次剪贴板
        thread::sleep(Duration::from_millis(500));
    }
}
