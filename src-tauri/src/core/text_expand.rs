use enigo::{Enigo, Key as EnigoKey, KeyboardControllable};
use log::{error, info};
use rdev::{listen, Event, EventType, Key as RdevKey};
use serde::{Deserialize, Serialize};
use serde_yaml;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::Arc;
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

// 定义YAML文件结构
#[derive(Debug, Deserialize, Serialize)]
pub struct TextExpandConfig {
    pub rules: Vec<TextExpandRule>,
}

pub struct TextExpander {
    // 使用 AtomicBool 来防止“听到自己说话”
    is_paused: Arc<AtomicBool>,
    // 存储扩展规则
    rules: Vec<TextExpandRule>,
}

impl TextExpander {
    pub fn new() -> Self {
        let mut rules = Vec::new();

        // 尝试加载默认YAML文件
        if let Ok(loaded_rules) = Self::load_rules("text_expand.yaml") {
            rules = loaded_rules;
        } else {
            // 如果加载失败，使用默认规则
            info!("Failed to load text_expand.yaml, using default rules");
            rules.push(TextExpandRule {
                key: ":te".to_string(),
                content: "textexpand".to_string(),
                group: "default".to_string(),
                description: "示例扩展规则".to_string(),
                date: "2026-02-12".to_string(),
            });
        }

        Self {
            is_paused: Arc::new(AtomicBool::new(false)),
            rules,
        }
    }

    // 加载扩展规则
    fn load_rules<P: AsRef<Path>>(path: P) -> Result<Vec<TextExpandRule>, String> {
        let path = path.as_ref();
        info!("Loading text expand rules from {:?}", path);

        // 检查文件是否存在
        if !path.exists() {
            return Err(format!("File {:?} does not exist", path));
        }

        // 读取文件内容
        let mut file = match File::open(path) {
            Ok(file) => file,
            Err(e) => return Err(format!("Failed to open file: {:?}", e)),
        };

        let mut content = String::new();
        if let Err(e) = file.read_to_string(&mut content) {
            return Err(format!("Failed to read file: {:?}", e));
        }

        // 解析YAML文件
        let config: TextExpandConfig = match serde_yaml::from_str(&content) {
            Ok(config) => config,
            Err(e) => return Err(format!("Failed to parse YAML: {:?}", e)),
        };

        info!("Loaded {} text expand rules", config.rules.len());
        Ok(config.rules)
    }

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

fn process_events(rx: Receiver<Event>, is_paused: Arc<AtomicBool>, rules: Vec<TextExpandRule>) {
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
                for rule in &rules {
                    let trigger = &rule.key;
                    if buffer.ends_with(trigger) {
                        info!("Trigger detected: {} -> {}", trigger, rule.content);

                        // 1. 暂停监听，防止死循环和 Buffer 污染
                        is_paused.store(true, Ordering::SeqCst);

                        // 2. 稍微等待，确保“最后一次按键”已被系统处理完毕
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
