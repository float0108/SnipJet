use crate::core::ast::{Block, Document, Inline, ListItem, ListType};
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

    // 用于列表 - 使用栈来处理嵌套
    // 每个元素是 (list_type, items, pending_item)
    // pending_item 是 Option<(content, nested_lists)> 表示正在构建的item
    let mut list_stack: Vec<(ListType, Vec<ListItem>, Option<(Vec<Block>, Vec<Block>)>)> = vec![];

    // 用于引用块
    let mut in_block_quote = false;
    let mut block_quote_blocks: Vec<Block> = vec![];

    for event in parser {
        match event {
            Event::Start(tag) => match tag {
                Tag::Heading(level, _, _) => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
                    current_block = Some(Block::Heading {
                        level: level as u8,
                        content: vec![],
                    });
                }
                Tag::Paragraph => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
                    current_block = Some(Block::Paragraph(vec![]));
                }
                Tag::CodeBlock(kind) => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
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
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
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
                Tag::List(start_number) => {
                    // 处理可能存在的未完成段落
                    if !inlines.is_empty() {
                        let paragraph = Block::Paragraph(inlines.drain(..).collect());
                        // 如果有正在构建的item，添加到它的content
                        if let Some((_, _, ref mut pending)) = list_stack.last_mut() {
                            if let Some((ref mut content, _)) = pending {
                                content.push(paragraph);
                            }
                        } else if in_block_quote {
                            block_quote_blocks.push(paragraph);
                        } else {
                            document.blocks.push(paragraph);
                        }
                    }
                    current_block = None;

                    // start_number: Some(n) 表示有序列表，None 表示无序列表
                    let list_type = if start_number.is_some() {
                        ListType::Ordered
                    } else {
                        ListType::Unordered
                    };
                    // 创建新的列表，带有空的 pending_item
                    list_stack.push((list_type, vec![], None));
                }
                Tag::Item => {
                    // 如果有正在构建的 item，先保存它
                    if let Some((_, ref mut items, ref mut pending)) = list_stack.last_mut() {
                        if let Some((content, nested_lists)) = pending.take() {
                            items.push(ListItem { content, nested_lists });
                        }
                    }
                    // 设置新的 pending item，并开始收集内联内容
                    if let Some((_, _, ref mut pending)) = list_stack.last_mut() {
                        *pending = Some((vec![], vec![]));
                    }
                    // 开始一个隐含的段落来收集内联内容
                    current_block = Some(Block::Paragraph(vec![]));
                }
                Tag::BlockQuote => {
                    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
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
                            push_block(block, &mut document, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
                        }
                    }
                }
                Tag::Paragraph => {
                    if current_block.is_some() {
                        let block = Block::Paragraph(inlines.drain(..).collect());
                        push_block(block, &mut document, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
                        current_block = None;
                    }
                }
                Tag::CodeBlock(_) => {
                    if let Some((lang, code)) = code_block_buffer.take() {
                        let block = Block::CodeBlock {
                            language: lang,
                            code,
                        };
                        push_block(block, &mut document, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
                    }
                }
                Tag::Table(_) => {
                    if let Some((headers, rows)) = table_buffer.take() {
                        let block = Block::Table { headers, rows };
                        push_block(block, &mut document, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
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
                    // 结束当前列表
                    if let Some((list_type, mut items, pending)) = list_stack.pop() {
                        // 如果有 pending item，添加到 items
                        if let Some((content, nested_lists)) = pending {
                            items.push(ListItem { content, nested_lists });
                        }

                        let block = Block::List { items, list_type };

                        // 如果还有父列表，添加到父列表的 pending item 的 nested_lists
                        if let Some((_, _, ref mut parent_pending)) = list_stack.last_mut() {
                            if let Some((_, ref mut nested)) = parent_pending {
                                nested.push(block);
                            } else {
                                // 父列表没有 pending item，这不应该发生
                                // 但作为后备，直接添加到文档
                                if in_block_quote {
                                    block_quote_blocks.push(block);
                                } else {
                                    document.blocks.push(block);
                                }
                            }
                        } else {
                            // 没有父列表，添加到文档或引用块
                            if in_block_quote {
                                block_quote_blocks.push(block);
                            } else {
                                document.blocks.push(block);
                            }
                        }
                    }
                }
                Tag::Item => {
                    // Item 结束时，保存当前的内联内容到 pending item
                    if !inlines.is_empty() {
                        let paragraph = Block::Paragraph(inlines.drain(..).collect());
                        if let Some((_, _, ref mut pending)) = list_stack.last_mut() {
                            if let Some((ref mut content, _)) = pending {
                                content.push(paragraph);
                            }
                        }
                    }
                    current_block = None;
                }
                Tag::BlockQuote => {
                    // 检查是否有未完成的段落需要收集
                    if !inlines.is_empty() {
                        let paragraph = Block::Paragraph(inlines.drain(..).collect());
                        if in_block_quote {
                            block_quote_blocks.push(paragraph);
                        } else {
                            document.blocks.push(paragraph);
                        }
                    }
                    // 结束引用块
                    in_block_quote = false;
                    let quote = Block::BlockQuote(block_quote_blocks.drain(..).collect());
                    document.blocks.push(quote);
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
    finish_current_block(&mut document, &mut current_block, &mut inlines, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
    if let Some(block) = current_block {
        push_block(block, &mut document, &mut list_stack, &mut in_block_quote, &mut block_quote_blocks);
    }

    document
}

fn push_block(
    block: Block,
    document: &mut Document,
    list_stack: &mut Vec<(ListType, Vec<ListItem>, Option<(Vec<Block>, Vec<Block>)>)>,
    in_block_quote: &mut bool,
    block_quote_blocks: &mut Vec<Block>,
) {
    // 如果有正在构建的 item，添加到它的 content
    if let Some((_, _, ref mut pending)) = list_stack.last_mut() {
        if let Some((ref mut content, _)) = pending {
            content.push(block);
            return;
        }
    }

    // 否则添加到文档或引用块
    if *in_block_quote {
        block_quote_blocks.push(block);
    } else {
        document.blocks.push(block);
    }
}

fn finish_current_block(
    document: &mut Document,
    current_block: &mut Option<Block>,
    inlines: &mut Vec<Inline>,
    list_stack: &mut Vec<(ListType, Vec<ListItem>, Option<(Vec<Block>, Vec<Block>)>)>,
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

        push_block(block_to_push, document, list_stack, in_block_quote, block_quote_blocks);
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

#[cfg(test)]
mod tests {
    use super::*;
    use pulldown_cmark::{Options, Parser};

    #[test]
    fn test_nested_list_parsing() {
        let markdown = r#"1.  **自动获取**：下载器会从 ModelScope 服务器获取官方发布的、该文件对应的 SHA256 值。
2.  **自动计算**：下载完成后，系统会自动计算你本地文件的实际 SHA256 值。
3.  **自动比对**：它会将这两个值进行比对。
    *   **如果一致**：说明文件完好无损，校验通过。
    *   **如果不一致**：说明文件已损坏（如下载不完整），系统会自动删除这个坏文件并重新下载。
"#;

        println!("\n=== pulldown-cmark events ===");
        let mut options = Options::empty();
        options.insert(Options::ENABLE_TABLES);
        options.insert(Options::ENABLE_STRIKETHROUGH);
        options.insert(Options::ENABLE_TASKLISTS);

        let parser = Parser::new_ext(markdown, options);
        for (i, event) in parser.enumerate() {
            println!("{:3}: {:?}", i, event);
        }

        println!("\n=== Our parse result ===");
        let doc = parse(markdown);
        for (i, block) in doc.blocks.iter().enumerate() {
            println!("Block {}: {:?}", i, block);
        }

        // 验证解析结果
        assert_eq!(doc.blocks.len(), 1);
        if let Block::List { items, list_type } = &doc.blocks[0] {
            assert_eq!(*list_type, ListType::Ordered);
            assert_eq!(items.len(), 3);

            // 第1个item
            assert!(items[0].nested_lists.is_empty());

            // 第2个item
            assert!(items[1].nested_lists.is_empty());

            // 第3个item应该有嵌套的无序列表
            assert_eq!(items[2].nested_lists.len(), 1);
            if let Block::List { items: nested_items, list_type: nested_type } = &items[2].nested_lists[0] {
                assert_eq!(*nested_type, ListType::Unordered);
                assert_eq!(nested_items.len(), 2);
            } else {
                panic!("Expected nested list");
            }
        } else {
            panic!("Expected List block");
        }
    }
}
