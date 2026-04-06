#[derive(Debug, Clone)]
pub struct Document {
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone)]
pub enum Block {
    Heading { level: u8, content: Vec<Inline> },
    Paragraph(Vec<Inline>),
    CodeBlock { language: Option<String>, code: String },
    Table { headers: Vec<Inline>, rows: Vec<Vec<Inline>> },
    MathDisplay(String),
    List { items: Vec<Vec<Block>> },
    BlockQuote(Vec<Block>),
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
