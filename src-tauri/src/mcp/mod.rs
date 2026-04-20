//! MCP (Model Context Protocol) 服务模块
//!
//! 提供标准化的 MCP 接口，允许 AI 助手访问和管理剪贴板历史数据

mod server;
mod service;
mod types;

pub use server::{start_mcp_server, McpServerHandle};
pub use service::ClipboardMcpService;
pub use types::*;
