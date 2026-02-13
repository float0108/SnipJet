use anyhow::Result;
use clipboard_rs::{Clipboard, ClipboardContext};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct ClipboardItem {
    pub timestamp: String,
    pub hash: String,
    pub content: String,
    pub preview: String,
}

pub struct ClipboardMonitor {
    tx: mpsc::Sender<ClipboardItem>,
    rx: mpsc::Receiver<ClipboardItem>,
    is_running: AtomicBool,
}

impl ClipboardMonitor {
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel();
        Self {
            tx,
            rx,
            is_running: AtomicBool::new(false),
        }
    }

    pub fn start(&self) {
        if self.is_running.load(Ordering::Relaxed) {
            return;
        }

        self.is_running.store(true, Ordering::SeqCst);
        let tx = self.tx.clone();

        thread::spawn(move || {
            let mut last_hash = String::new();
            while tx.try_send(ClipboardItem {
                timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                hash: "init".to_string(),
                content: "initializing".to_string(),
                preview: "initializing".to_string(),
            }).is_ok() {
                if let Ok(ctx) = ClipboardContext::new() {
                    if let Ok(content) = ctx.get_text() {
                        if !content.trim().is_empty() {
                            let mut hasher = Sha256::new();
                            hasher.update(content.as_bytes());
                            let hash = hex::encode(&hasher.finalize()[..8]);

                            if hash != last_hash {
                                last_hash = hash.clone();

                                let preview: String = content
                                    .chars()
                                    .take(60)
                                    .map(|c| if c == '\n' || c == '\r' { ' ' } else { c })
                                    .collect();

                                let item = ClipboardItem {
                                    timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                                    hash,
                                    content: content.clone(),
                                    preview,
                                };

                                tx.send(item).ok();
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(500));
            }
        });
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
    }

    pub fn receive(&self) -> Option<ClipboardItem> {
        self.rx.try_recv().ok()
    }
}
