use crate::core::ast::{Block, Document, Inline};
use crate::core::generator::Generator;
use docx_rs::{AbstractNumbering, BreakType, Docx, IndentLevel, Level, LevelJc, LevelText, NumberFormat, Numbering, NumberingId, Paragraph, Run, RunFonts, Start, Style, StyleType, Table, TableCell, TableRow};
use std::io::Cursor;

pub struct DocxGenerator;

impl Generator for DocxGenerator {
    fn generate(&self, doc: &Document) -> Result<Vec<u8>, std::io::Error> {
        let mut docx = Docx::new();

        // 添加标题样式定义（包含大纲级别，这是Word目录识别的关键）
        docx = docx
            .add_style(Style::new("Heading1", StyleType::Paragraph).name("Heading 1").outline_lvl(0))
            .add_style(Style::new("Heading2", StyleType::Paragraph).name("Heading 2").outline_lvl(1))
            .add_style(Style::new("Heading3", StyleType::Paragraph).name("Heading 3").outline_lvl(2))
            .add_style(Style::new("Heading4", StyleType::Paragraph).name("Heading 4").outline_lvl(3))
            .add_style(Style::new("Heading5", StyleType::Paragraph).name("Heading 5").outline_lvl(4))
            .add_style(Style::new("Heading6", StyleType::Paragraph).name("Heading 6").outline_lvl(5));

        // 添加列表编号定义（项目符号列表）
        let abstract_numbering = AbstractNumbering::new(1)
            .add_level(
                Level::new(
                    0,
                    Start::new(1),
                    NumberFormat::new("bullet"),
                    LevelText::new("\u{2022}"),
                    LevelJc::new("left"),
                )
            );
        let numbering = Numbering::new(1, 1);
        docx = docx
            .add_abstract_numbering(abstract_numbering)
            .add_numbering(numbering);

        for block in &doc.blocks {
            docx = self.generate_block(docx, block);
        }

        let xml_docx = docx.build();
        let mut buf = Vec::new();
        xml_docx.pack(Cursor::new(&mut buf)).map_err(|e| {
            std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
        })?;
        Ok(buf)
    }
}

impl DocxGenerator {
    fn generate_block(&self, mut docx: Docx, block: &Block) -> Docx {
        match block {
            Block::Heading { level, content } => {
                let style_name = match level {
                    1 => "Heading1",
                    2 => "Heading2",
                    3 => "Heading3",
                    4 => "Heading4",
                    5 => "Heading5",
                    _ => "Heading6",
                };

                let mut p = Paragraph::new().style(style_name);

                for inline in content {
                    let run = self.generate_inline_run(inline);
                    p = p.add_run(run);
                }
                docx = docx.add_paragraph(p);
            }
            Block::Paragraph(content) => {
                let mut p = Paragraph::new();
                self.generate_inlines(&mut p, content);
                docx = docx.add_paragraph(p);
            }
            Block::CodeBlock { language: _, code } => {
                // 将代码按行分割，每行作为一个段落以保持换行格式
                let fonts = RunFonts::new().ascii("Courier New").hi_ansi("Courier New").east_asia("Courier New");
                for line in code.lines() {
                    let mut p = Paragraph::new();
                    let run = Run::new().add_text(line).fonts(fonts.clone());
                    p = p.add_run(run);
                    docx = docx.add_paragraph(p);
                }
                // 如果代码块为空，添加一个空段落
                if code.is_empty() {
                    let p = Paragraph::new();
                    docx = docx.add_paragraph(p);
                }
            }
            Block::Table { headers, rows } => {
                // 创建表头行
                let mut header_cells: Vec<TableCell> = vec![];
                for header in headers {
                    let mut p = Paragraph::new();
                    let header_vec = vec![header.clone()];
                    self.generate_inlines(&mut p, &header_vec);
                    let cell = TableCell::new().add_paragraph(p);
                    header_cells.push(cell);
                }
                let header_row = TableRow::new(header_cells);

                // 创建表内容行
                let mut table_rows: Vec<TableRow> = vec![];
                for row in rows {
                    let mut cells: Vec<TableCell> = vec![];
                    for cell_content in row {
                        let mut p = Paragraph::new();
                        let cell_vec = vec![cell_content.clone()];
                        self.generate_inlines(&mut p, &cell_vec);
                        let cell = TableCell::new().add_paragraph(p);
                        cells.push(cell);
                    }
                    table_rows.push(TableRow::new(cells));
                }

                // 组合表格：表头 + 内容行
                let mut all_rows = vec![header_row];
                all_rows.extend(table_rows);
                let table = Table::new(all_rows);

                docx = docx.add_table(table);
            }
            Block::MathDisplay(content) => {
                // Display math formula - 简化为纯文本显示，使用 Cambria Math 字体
                let mut p = Paragraph::new();
                let fonts = RunFonts::new()
                    .ascii("Cambria Math")
                    .hi_ansi("Cambria Math");

                p = p.add_run(
                    Run::new()
                        .add_text(&format!("[Formula: {}]", content))
                        .fonts(fonts)
                        .italic(),
                );

                docx = docx.add_paragraph(p);
            }
            Block::List { items } => {
                for item in items {
                    for sub_block in item {
                        match sub_block {
                            Block::Paragraph(content) => {
                                // 使用真正的Word列表格式（项目符号）
                                let mut p = Paragraph::new()
                                    .numbering(NumberingId::new(1), IndentLevel::new(0));
                                self.generate_inlines(&mut p, content);
                                docx = docx.add_paragraph(p);
                            }
                            _ => {
                                docx = self.generate_block(docx, sub_block);
                            }
                        }
                    }
                }
            }
            Block::BlockQuote(content) => {
                for sub_block in content {
                    match sub_block {
                        Block::Paragraph(content) => {
                            let mut p = Paragraph::new();
                            self.generate_inlines(&mut p, content);
                            docx = docx.add_paragraph(p);
                        }
                        _ => {
                            docx = self.generate_block(docx, sub_block);
                        }
                    }
                }
            }
        }
        docx
    }

    fn generate_inline_run(&self, inline: &Inline) -> Run {
        let mut run = Run::new();

        match inline {
            Inline::Text(text) => {
                run = run.add_text(text);
            }
            Inline::Bold(content) => {
                run = run.bold();
                let mut text = String::new();
                self.collect_inline_string(&mut text, content);
                run = run.add_text(&text);
            }
            Inline::Italic(content) => {
                run = run.italic();
                let mut text = String::new();
                self.collect_inline_string(&mut text, content);
                run = run.add_text(&text);
            }
            Inline::CodeSpan(content) => {
                run = run.add_text(content);
            }
            Inline::MathInline(content) => {
                // Inline math formula - format with Cambria Math font and italic
                let fonts = RunFonts::new()
                    .ascii("Cambria Math")
                    .hi_ansi("Cambria Math");
                run = run
                    .add_text(&format!("[{}]", content))
                    .fonts(fonts)
                    .italic();
            }
            Inline::Link { text, url } => {
                let mut link_text = String::new();
                self.collect_inline_string(&mut link_text, text);
                run = run.add_text(&format!("{} ({})", link_text, url));
            }
        }
        run
    }

    fn generate_inlines(&self, p: &mut Paragraph, inlines: &[Inline]) {
        for inline in inlines {
            match inline {
                Inline::Text(content) => {
                    // 处理文本中的换行符，将其转换为 Word 换行
                    let lines: Vec<&str> = content.split('\n').collect();
                    for (i, line) in lines.iter().enumerate() {
                        if i > 0 {
                            // 添加换行符
                            let run = Run::new().add_break(BreakType::TextWrapping);
                            *p = p.clone().add_run(run);
                        }
                        if !line.is_empty() {
                            let run = Run::new().add_text(*line);
                            *p = p.clone().add_run(run);
                        }
                    }
                }
                Inline::Bold(content) => {
                    let mut run = Run::new().bold();
                    run = self.collect_inline_text(run, content);
                    *p = p.clone().add_run(run);
                }
                Inline::Italic(content) => {
                    let mut run = Run::new().italic();
                    run = self.collect_inline_text(run, content);
                    *p = p.clone().add_run(run);
                }
                Inline::CodeSpan(content) => {
                    let run = Run::new().add_text(content);
                    *p = p.clone().add_run(run);
                }
                Inline::MathInline(content) => {
                    // Inline math formula - format with Cambria Math font
                    let fonts = RunFonts::new()
                        .ascii("Cambria Math")
                        .hi_ansi("Cambria Math");
                    let run = Run::new()
                        .add_text(&format!("[{}]", content))
                        .fonts(fonts)
                        .italic();
                    *p = p.clone().add_run(run);
                }
                Inline::Link { text, url } => {
                    let mut link_text = String::new();
                    self.collect_inline_string(&mut link_text, text);
                    let run = Run::new().add_text(&format!("{} ({})", link_text, url));
                    *p = p.clone().add_run(run);
                }
            }
        }
    }

    fn collect_inline_text(&self, mut run: Run, inlines: &[Inline]) -> Run {
        for inline in inlines {
            match inline {
                Inline::Text(content) => {
                    run = run.add_text(content);
                }
                Inline::Bold(content) => {
                    run = run.bold();
                    run = self.collect_inline_text(run, content);
                }
                Inline::Italic(content) => {
                    run = run.italic();
                    run = self.collect_inline_text(run, content);
                }
                Inline::CodeSpan(content) => {
                    run = run.add_text(content);
                }
                Inline::MathInline(content) => {
                    run = run
                        .add_text(&format!("[{}]", content))
                        .fonts(RunFonts::new().ascii("Cambria Math").hi_ansi("Cambria Math"))
                        .italic();
                }
                Inline::Link { text, url } => {
                    let mut link_text = String::new();
                    self.collect_inline_string(&mut link_text, text);
                    run = run.add_text(&format!("{} ({})", link_text, url));
                }
            }
        }
        run
    }

    fn collect_inline_string(&self, result: &mut String, inlines: &[Inline]) {
        for inline in inlines {
            match inline {
                Inline::Text(content) => result.push_str(content),
                Inline::CodeSpan(content) => result.push_str(content),
                Inline::MathInline(content) => result.push_str(&format!("[{}]", content)),
                Inline::Bold(content) => self.collect_inline_string(result, content),
                Inline::Italic(content) => self.collect_inline_string(result, content),
                Inline::Link { text, url: _ } => self.collect_inline_string(result, text),
            }
        }
    }
}
