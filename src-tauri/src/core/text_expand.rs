use enigo::{Enigo, Key as EnigoKey, KeyboardControllable};
use log::{error, info, warn};
use rdev::{listen, Event, EventType, Key as RdevKey};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

// 定义扩展规则结构体
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TextExpandRule {
    pub key: String,
    pub content: String,
    pub group: String,
    pub description: String,
    pub date: String,
}

pub struct TextExpander {
    // 使用 AtomicBool 来防止"听到自己说话"
    is_paused: Arc<AtomicBool>,
    // 存储扩展规则（共享可变）
    rules: Arc<Mutex<Vec<TextExpandRule>>>,
}

impl TextExpander {
    /// 创建新的文本扩展器
    pub fn new(app_handle: &tauri::AppHandle) -> Self {
        // 从用户数据目录加载规则
        let rules = Self::load_rules_from_user_data(app_handle);

        Self {
            is_paused: Arc::new(AtomicBool::new(false)),
            rules: Arc::new(Mutex::new(rules)),
        }
    }

    /// 从用户数据目录加载规则
    fn load_rules_from_user_data(app_handle: &tauri::AppHandle) -> Vec<TextExpandRule> {
        use crate::core::data_store::DataStore;

        match DataStore::new(app_handle) {
            Ok(data_store) => match data_store.load_text_expand_rules() {
                Ok(rules) => {
                    // 转换 TextExpandRuleData 为 TextExpandRule
                    let result: Vec<TextExpandRule> = rules
                        .into_iter()
                        .map(|r| TextExpandRule {
                            key: r.key,
                            content: r.content,
                            group: r.group,
                            description: r.description,
                            date: r.date,
                        })
                        .collect();
                    info!("Loaded {} text expand rules from user data", result.len());
                    return result;
                }
                Err(e) => {
                    warn!("Failed to load text expand rules from user data: {}", e);
                }
            },
            Err(e) => {
                warn!("Failed to create DataStore for loading text expand rules: {}", e);
            }
        }

        // 返回默认规则
        info!("Using default text expand rules");
        vec![TextExpandRule {
            key: ":te".to_string(),
            content: "textexpand".to_string(),
            group: "default".to_string(),
            description: "示例扩展规则".to_string(),
            date: chrono::Local::now().format("%Y-%m-%d").to_string(),
        }]
    }

    /// 重新加载规则（从用户数据目录）
    pub fn reload_rules(&self, app_handle: &tauri::AppHandle) {
        let new_rules = Self::load_rules_from_user_data(app_handle);
        let mut rules_lock = self.rules.lock().unwrap();
        *rules_lock = new_rules;
        info!("Text expand rules reloaded");
    }

    /// 获取当前规则
    pub fn get_rules(&self) -> Vec<TextExpandRule> {
        self.rules.lock().unwrap().clone()
    }

    /// 启动监听
    pub fn start(&self) {
        info!("Text expander started. Try typing any trigger from the rules...");

        let (tx, rx): (Sender<Event>, Receiver<Event>) = mpsc::channel();
        let is_paused_listener = self.is_paused.clone();

        // 1. 启动监听线程
        thread::spawn(move || {
            if let Err(error) = listen(move |event| {
                // 如果处于暂停状态（正在模拟输入），直接忽略事件
                if is_paused_listener.load(Ordering::Relaxed) {
                    return;
                }
                let _ = tx.send(event);
            }) {
                error!("Error: {:?}", error);
            }
        });

        // 2. 在新线程中运行处理循环，避免阻塞主线程
        let process_is_paused = self.is_paused.clone();
        let rules = self.rules.clone();
        thread::spawn(move || {
            process_events(rx, process_is_paused, rules);
        });
    }
}

fn process_events(rx: Receiver<Event>, is_paused: Arc<AtomicBool>, rules: Arc<Mutex<Vec<TextExpandRule>>>) {
    let mut buffer = String::new();
    let mut enigo = Enigo::new();

    for event in rx {
        match event.event_type {
            EventType::KeyPress(key) => {
                // --- 缓冲区维护 ---
                if let Some(s) = event.name {
                    // 忽略控制字符，只处理可见字符
                    // 统一转为小写，实现不区分大小写匹配 (可选)
                    if s.chars().count() == 1 {
                        buffer.push_str(&s.to_lowercase());
                    }
                } else if key == RdevKey::Backspace {
                    buffer.pop();
                }

                // --- 触发检测 ---
                // 获取当前规则的快照
                let current_rules = rules.lock().unwrap().clone();
                for rule in &current_rules {
                    let trigger = &rule.key;
                    if buffer.ends_with(trigger) {
                        info!("Trigger detected: {} -> {}", trigger, rule.content);

                        // 1. 暂停监听，防止死循环和 Buffer 污染
                        is_paused.store(true, Ordering::SeqCst);

                        // 2. 稍微等待，确保"最后一次按键"已被系统处理完毕
                        thread::sleep(Duration::from_millis(50));

                        // 3. 删除触发词 (统一使用 Enigo)
                        for _ in 0..trigger.len() {
                            enigo.key_click(EnigoKey::Backspace);
                            // 极短的延时，防止某些编辑器跟不上删除速度
                            thread::sleep(Duration::from_millis(10));
                        }

                        // 4. 输入替换文本
                        enigo.key_sequence(&rule.content);

                        // 5. 清理状态
                        buffer.clear();

                        // 恢复监听
                        is_paused.store(false, Ordering::SeqCst);
                        break; // 找到匹配的规则后，跳出循环
                    }
                }

                // 防止缓冲区过大
                if buffer.len() > 50 {
                    // 保留最后 20 个字符，丢弃旧的
                    buffer = buffer.split_off(buffer.len() - 20);
                }
            }
            _ => {}
        }
    }
}
