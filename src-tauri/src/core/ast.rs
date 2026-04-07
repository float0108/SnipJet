#[derive(Debug, Clone)]
pub struct Document {
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ListType {
    Ordered,  // 有序列表 (1. 2. 3.)
    Unordered, // 无序列表 (- * +)
}

#[derive(Debug, Clone)]
pub enum Block {
    Heading { level: u8, content: Vec<Inline> },
    Paragraph(Vec<Inline>),
    CodeBlock { language: Option<String>, code: String },
    Table { headers: Vec<Inline>, rows: Vec<Vec<Inline>> },
    MathDisplay(String),
    List { items: Vec<ListItem>, list_type: ListType },
    BlockQuote(Vec<Block>),
}

#[derive(Debug, Clone)]
pub struct ListItem {
    pub content: Vec<Block>,  // 列表项的内容
    pub nested_lists: Vec<Block>,  // 嵌套的子列表
}

#[derive(Debug, Clone)]
pub enum Inline {
    Text(String),
    Bold(Vec<Inline>),
    Italic(Vec<Inline>),
    CodeSpan(String),
    MathInline(String),
    Link { text: Vec<Inline>, url: String },
}
