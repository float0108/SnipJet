//! MCP 服务器启动逻辑
//!
//! 提供 MCP 协议服务器的启动和管理

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use log::{error, info};
use rmcp::transport::sse_server::SseServer;
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use crate::common::models::ClipboardItem;
use super::service::ClipboardMcpService;

/// MCP 服务器句柄
pub struct McpServerHandle {
    pub addr: SocketAddr,
    pub cancel_token: CancellationToken,
    #[allow(dead_code)]
    pub thread_handle: Option<std::thread::JoinHandle<()>>,
}

// 实现 Send 以便在 Tauri 状态中使用
unsafe impl Send for McpServerHandle {}

/// 启动 MCP 服务器（在独立线程中运行）
///
/// # 参数
/// - `port`: 监听端口
/// - `app_handle`: 可选的 Tauri AppHandle
/// - `history`: 剪贴板历史的共享引用
pub fn start_mcp_server(
    port: u16,
    app_handle: Option<Arc<AppHandle>>,
    history: Arc<Mutex<Vec<ClipboardItem>>>,
) -> Result<McpServerHandle, String> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let cancel_token = CancellationToken::new();
    let cancel_token_clone = cancel_token.clone();

    let thread_handle = std::thread::spawn(move || {
        let rt = match tokio::runtime::Runtime::new() {
            Ok(rt) => rt,
            Err(e) => {
                error!("[MCP] Failed to create tokio runtime: {}", e);
                return;
            }
        };

        rt.block_on(async move {
            let server = match SseServer::serve_with_config(rmcp::transport::sse_server::SseServerConfig {
                bind: addr,
                sse_path: "/sse".to_string(),
                post_path: "/message".to_string(),
                ct: cancel_token_clone.child_token(),
            }).await {
                Ok(s) => s,
                Err(e) => {
                    error!("[MCP] Failed to start SSE server: {}", e);
                    return;
                }
            };

            info!("[MCP] Server started on port {}", addr.port());

            let history_clone = history.clone();
            let app_handle_clone = app_handle.clone();
            let _service_cancel_token = server.with_service(move || {
                let service = ClipboardMcpService::new(history_clone.clone());
                if let Some(ref handle) = app_handle_clone {
                    service.clone().with_app_handle(handle.clone())
                } else {
                    service
                }
            });

            // 等待取消信号
            cancel_token_clone.clone().cancelled().await;
        });
    });

    Ok(McpServerHandle {
        addr,
        cancel_token,
        thread_handle: Some(thread_handle),
    })
}
