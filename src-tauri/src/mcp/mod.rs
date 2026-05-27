//! MCP (Model Context Protocol) 服务模块
//!
//! 提供标准化的 MCP 接口，允许 AI 助手访问和管理剪贴板历史数据

mod server;
mod service;
mod types;

pub use server::{start_mcp_server, McpServerHandle};
// ClipboardMcpService 和 types 当前在 MCP 服务端内部使用，暂未对外暴露
// pub use service::ClipboardMcpService;
// pub use types::*;
