use crate::core::ast::{Block, Document, Inline};
use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag};

enum InlineFrame {
    Bold(Vec<Inline>),
    Italic(Vec<Inline>),
    Link { url: String, content: Vec<Inline> },
}

pub fn parse(markdown: &str) -> Document {
    // 启用所有常用扩展，包括表格
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);

    let parser = Parser::new_ext(markdown, options);

    let mut document = Document { blocks: vec![] };
    let mut current_block: Option<Block> = None;
    let mut inlines: Vec<Inline> = vec![];
    let mut inline_stack: Vec<InlineFrame> = vec![];

    // 用于收集代码块内容
    let mut code_block_buffer: Option<(Option<String>, String)> = None;
    // 用于收集表格 (headers: Vec<Inline>, rows: Vec<Vec<Inline>>)
    let mut table_buffer: Option<(Vec<Inline>, Vec<Vec<Inline>>)> = None;
    let mut current_row: Vec<Vec<Inline>> = vec![];
    let mut in_table_header = false;
    let mut in_table_cell = false;
    // 用于列表
    let mut list_stack: Vec<Vec<Vec<Block>>> = vec![];
    let mut current_item_blocks: Vec<Block> = vec![];
    let mut in_list_item = false;
    // 用于引用块
    let mut in_block_quote = false;
    let mut block_quote_blocks: Vec<Block> = vec![];

    for event in parser {
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading(level, _, _) => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    current_block = Some(Block::Heading {
                        level: level as u8,
                        content: vec![],
                    });
                }
                Tag::Paragraph => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    current_block = Some(Block::Paragraph(vec![]));
                }
                Tag::CodeBlock(kind) => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    let language = match kind {
                        CodeBlockKind::Fenced(lang) => {
                            if lang.is_empty() {
                                None
                            } else {
                                Some(lang.to_string())
                            }
                        }
                        CodeBlockKind::Indented => None,
                    };
                    code_block_buffer = Some((language, String::new()));
                }
                Tag::Table(_) => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    table_buffer = Some((vec![], vec![]));
                    current_row = vec![];
                    in_table_header = false;
                    in_table_cell = false;
                }
                Tag::TableHead => {
                    in_table_header = true;
                    current_row = vec![];
                }
                Tag::TableRow => {
                    current_row = vec![];
                }
                Tag::TableCell => {
                    in_table_cell = true;
                    inlines.clear();
                }
                Tag::List(_) => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    list_stack.push(vec![]);
                }
                Tag::Item => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    in_list_item = true;
                    current_item_blocks = vec![];
                }
                Tag::BlockQuote => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    in_block_quote = true;
                    block_quote_blocks = vec![];
                }
                Tag::Link(_link_type, dest_url, _title) => {
                    inline_stack.push(InlineFrame::Link {
                        url: dest_url.to_string(),
                        content: vec![],
                    });
                }
                Tag::Strong => {
                    inline_stack.push(InlineFrame::Bold(vec![]));
                }
                Tag::Emphasis => {
                    inline_stack.push(InlineFrame::Italic(vec![]));
                }
                _ => {}
            },
            Event::End(tag) => match tag {
                Tag::Heading(_, _, _) => {
                    if current_block.is_some() {
                        if let Some(Block::Heading { level, .. }) = current_block.take() {
                            let block = Block::Heading {
                                level,
                                content: inlines.drain(..).collect(),
                            };
                            push_block(block, &mut document, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                        }
                    }
                }
                Tag::Paragraph => {
                    if current_block.is_some() {
                        let block = Block::Paragraph(inlines.drain(..).collect());
                        push_block(block, &mut document, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                        current_block = None;
                    }
                }
                Tag::CodeBlock(_) => {
                    if let Some((lang, code)) = code_block_buffer.take() {
                        let block = Block::CodeBlock {
                            language: lang,
                            code,
                        };
                        push_block(block, &mut document, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    }
                }
                Tag::Table(_) => {
                    if let Some((headers, rows)) = table_buffer.take() {
                        let block = Block::Table { headers, rows };
                        push_block(block, &mut document, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
                    }
                }
                Tag::TableHead => {
                    in_table_header = false;
                    if let Some((ref mut headers, _)) = table_buffer {
                        *headers = current_row.drain(..).map(|cell| {
                            if cell.is_empty() {
                                Inline::Text(String::new())
                            } else {
                                Inline::Text(cell_to_string(&cell))
                            }
                        }).collect();
                    }
                }
                Tag::TableRow => {
                    if !in_table_header {
                        if let Some((_, ref mut rows)) = table_buffer {
                            let row_inlines: Vec<Inline> = current_row.drain(..).map(|cell| {
                                if cell.is_empty() {
                                    Inline::Text(String::new())
                                } else {
                                    Inline::Text(cell_to_string(&cell))
                                }
                            }).collect();
                            rows.push(row_inlines);
                        }
                    }
                }
                Tag::TableCell => {
                    in_table_cell = false;
                    current_row.push(inlines.drain(..).collect());
                }
                Tag::List(_) => {
                    if let Some(items) = list_stack.pop() {
                        let block = Block::List { items };
                        if in_block_quote {
                            block_quote_blocks.push(block);
                        } else {
                            document.blocks.push(block);
                        }
                    }
                }
                Tag::Item => {
                    // 检查是否有未完成的段落需要收集
                    if !inlines.is_empty() {
                        let paragraph = Block::Paragraph(inlines.drain(..).collect());
                        current_item_blocks.push(paragraph);
                    }
                    if let Some(ref mut items) = list_stack.last_mut() {
                        items.push(current_item_blocks.drain(..).collect());
                    }
                    in_list_item = false;
                }
                Tag::BlockQuote => {
                    // 检查是否有未完成的段落需要收集
                    if !inlines.is_empty() {
                        let paragraph = Block::Paragraph(inlines.drain(..).collect());
                        if in_list_item {
                            current_item_blocks.push(paragraph);
                        } else if in_block_quote {
                            block_quote_blocks.push(paragraph);
                        } else {
                            document.blocks.push(paragraph);
                        }
                    }
                    // 结束引用块
                    in_block_quote = false;
                    let quote = Block::BlockQuote(block_quote_blocks.drain(..).collect());
                    if in_list_item {
                        current_item_blocks.push(quote);
                    } else {
                        document.blocks.push(quote);
                    }
                }
                Tag::Link(_, _, _) => {
                    if let Some(InlineFrame::Link { url, content }) = inline_stack.pop() {
                        inlines.push(Inline::Link { text: content, url });
                    }
                }
                Tag::Strong => {
                    if let Some(InlineFrame::Bold(content)) = inline_stack.pop() {
                        inlines.push(Inline::Bold(content));
                    }
                }
                Tag::Emphasis => {
                    if let Some(InlineFrame::Italic(content)) = inline_stack.pop() {
                        inlines.push(Inline::Italic(content));
                    }
                }
                _ => {}
            },
            Event::Text(text) => {
                if let Some((_, ref mut code)) = code_block_buffer {
                    code.push_str(&text);
                } else if in_table_cell {
                    add_inline(&mut inline_stack, &mut inlines, Inline::Text(text.to_string()));
                } else {
                    add_inline(&mut inline_stack, &mut inlines, Inline::Text(text.to_string()));
                }
            }
            Event::Code(code) => {
                add_inline(&mut inline_stack, &mut inlines, Inline::CodeSpan(code.to_string()));
            }
            Event::Html(html) => {
                add_inline(&mut inline_stack, &mut inlines, Inline::Text(html.to_string()));
            }
            Event::SoftBreak => {
                // 软换行，在引用块和段落中保留为换行符
                add_inline(&mut inline_stack, &mut inlines, Inline::Text("\n".to_string()));
            }
            Event::HardBreak => {
                // 硬换行，保留为换行符
                add_inline(&mut inline_stack, &mut inlines, Inline::Text("\n".to_string()));
            }
            _ => {}
        }
    }

    // 处理剩余的块
    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
    if let Some(block) = current_block {
        push_block(block, &mut document, &mut current_item_blocks, &mut in_list_item, &mut in_block_quote, &mut block_quote_blocks);
    }

    document
}

fn push_block(
    block: Block,
    document: &mut Document,
    current_item_blocks: &mut Vec<Block>,
    in_list_item: &mut bool,
    in_block_quote: &mut bool,
    block_quote_blocks: &mut Vec<Block>,
) {
    if *in_list_item {
        current_item_blocks.push(block);
    } else if *in_block_quote {
        block_quote_blocks.push(block);
    } else {
        document.blocks.push(block);
    }
}

fn finish_current_block(
    document: &mut Document,
    current_block: &mut Option<Block>,
    inlines: &mut Vec<Inline>,
    _list_stack: &mut Vec<Vec<Vec<Block>>>,
    current_item_blocks: &mut Vec<Block>,
    in_list_item: &mut bool,
    in_block_quote: &mut bool,
    block_quote_blocks: &mut Vec<Block>,
) {
    if let Some(block) = current_block.take() {
        let block_to_push = match block {
            Block::Heading { level, content: _ } => {
                Block::Heading {
                    level,
                    content: inlines.drain(..).collect(),
                }
            }
            Block::Paragraph(_) => {
                Block::Paragraph(inlines.drain(..).collect())
            }
            _ => block,
        };

        push_block(block_to_push, document, current_item_blocks, in_list_item, in_block_quote, block_quote_blocks);
    }
}

fn add_inline(inline_stack: &mut Vec<InlineFrame>, inlines: &mut Vec<Inline>, inline: Inline) {
    if let Some(frame) = inline_stack.last_mut() {
        match frame {
            InlineFrame::Bold(content) => content.push(inline),
            InlineFrame::Italic(content) => content.push(inline),
            InlineFrame::Link { content, .. } => content.push(inline),
        }
    } else {
        inlines.push(inline);
    }
}

fn cell_to_string(cell: &[Inline]) -> String {
    let mut result = String::new();
    for inline in cell {
        match inline {
            Inline::Text(s) => result.push_str(s),
            Inline::CodeSpan(s) => result.push_str(s),
            Inline::MathInline(s) => result.push_str(&format!("${}$", s)),
            Inline::Bold(content) => result.push_str(&cell_to_string(content)),
            Inline::Italic(content) => result.push_str(&cell_to_string(content)),
            Inline::Link { text, .. } => result.push_str(&cell_to_string(text)),
        }
    }
    result
}
