use crate::core::ast::Document;

pub trait Generator {
    /// 接收 AST，返回生成的二进制流（或文本流）
    fn generate(&self, doc: &Document) -> Result<Vec<u8>, std::io::Error>;
}
