//! Terminal User Interface for session search
//!
//! Provides an interactive search experience using ratatui.

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{
    backend::CrosstermBackend,
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span, Text},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph, Wrap},
    Frame, Terminal,
};
use std::io;
use tantivy::{
    collector::TopDocs,
    query::QueryParser,
    schema::Schema,
    Index, IndexReader, TantivyDocument,
};

struct App {
    input: String,
    cursor_position: usize,
    results: Vec<SearchResultItem>,
    selected: usize,
    list_state: ListState,
    mode: Mode,
}

#[derive(PartialEq)]
enum Mode {
    Search,
    Browse,
}

struct SearchResultItem {
    session_id: String,
    snippet: String,
    score: f32,
    timestamp: i64,
}

impl App {
    fn new() -> Self {
        let mut list_state = ListState::default();
        list_state.select(Some(0));
        Self {
            input: String::new(),
            cursor_position: 0,
            results: Vec::new(),
            selected: 0,
            list_state,
            mode: Mode::Search,
        }
    }

    fn move_cursor_left(&mut self) {
        let cursor_moved_left = self.cursor_position.saturating_sub(1);
        self.cursor_position = self.clamp_cursor(cursor_moved_left);
    }

    fn move_cursor_right(&mut self) {
        let cursor_moved_right = self.cursor_position.saturating_add(1);
        self.cursor_position = self.clamp_cursor(cursor_moved_right);
    }

    fn enter_char(&mut self, new_char: char) {
        self.input.insert(self.cursor_position, new_char);
        self.move_cursor_right();
    }

    fn delete_char(&mut self) {
        if self.cursor_position > 0 {
            let current_index = self.cursor_position;
            let from_left_to_current_index = current_index - 1;
            self.input.remove(from_left_to_current_index);
            self.move_cursor_left();
        }
    }

    fn clamp_cursor(&self, new_cursor_pos: usize) -> usize {
        new_cursor_pos.clamp(0, self.input.len())
    }

    fn select_next(&mut self) {
        if !self.results.is_empty() {
            self.selected = (self.selected + 1) % self.results.len();
            self.list_state.select(Some(self.selected));
        }
    }

    fn select_previous(&mut self) {
        if !self.results.is_empty() {
            self.selected = if self.selected == 0 {
                self.results.len() - 1
            } else {
                self.selected - 1
            };
            self.list_state.select(Some(self.selected));
        }
    }
}

pub fn run_tui(index: &Index, reader: &IndexReader, schema: &Schema) -> Result<()> {
    // Setup terminal
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut app = App::new();
    let content_field = schema.get_field("content").unwrap();
    let session_id_field = schema.get_field("session_id").unwrap();
    let timestamp_field = schema.get_field("timestamp").unwrap();

    loop {
        terminal.draw(|f| ui(f, &app))?;

        if event::poll(std::time::Duration::from_millis(100))? {
            if let Event::Key(key) = event::read()? {
                if key.kind != KeyEventKind::Press {
                    continue;
                }

                match app.mode {
                    Mode::Search => match key.code {
                        KeyCode::Esc => break,
                        KeyCode::Enter => {
                            // Execute search
                            if !app.input.is_empty() {
                                let searcher = reader.searcher();
                                let query_parser = QueryParser::for_index(index, vec![content_field]);
                                if let Ok(query) = query_parser.parse_query(&app.input) {
                                    if let Ok(top_docs) = searcher.search(&query, &TopDocs::with_limit(50)) {
                                        app.results.clear();
                                        for (score, doc_address) in top_docs {
                                            if let Ok(doc) = searcher.doc::<TantivyDocument>(doc_address) {
                                                let session_id = doc
                                                    .get_first(session_id_field)
                                                    .and_then(|v| v.as_str())
                                                    .unwrap_or("")
                                                    .to_string();
                                                let snippet = doc
                                                    .get_first(content_field)
                                                    .and_then(|v| v.as_str())
                                                    .map(|s| s.chars().take(100).collect())
                                                    .unwrap_or_default();
                                                let timestamp = doc
                                                    .get_first(timestamp_field)
                                                    .and_then(|v| v.as_i64())
                                                    .unwrap_or(0);

                                                app.results.push(SearchResultItem {
                                                    session_id,
                                                    snippet,
                                                    score,
                                                    timestamp,
                                                });
                                            }
                                        }
                                        if !app.results.is_empty() {
                                            app.selected = 0;
                                            app.list_state.select(Some(0));
                                            app.mode = Mode::Browse;
                                        }
                                    }
                                }
                            }
                        }
                        KeyCode::Char(c) => app.enter_char(c),
                        KeyCode::Backspace => app.delete_char(),
                        KeyCode::Left => app.move_cursor_left(),
                        KeyCode::Right => app.move_cursor_right(),
                        KeyCode::Down if !app.results.is_empty() => {
                            app.mode = Mode::Browse;
                        }
                        _ => {}
                    },
                    Mode::Browse => match key.code {
                        KeyCode::Esc => app.mode = Mode::Search,
                        KeyCode::Char('q') => break,
                        KeyCode::Up | KeyCode::Char('k') => app.select_previous(),
                        KeyCode::Down | KeyCode::Char('j') => app.select_next(),
                        KeyCode::Enter => {
                            // Copy session ID to clipboard
                            if let Some(result) = app.results.get(app.selected) {
                                if let Ok(mut clipboard) = arboard::Clipboard::new() {
                                    let _ = clipboard.set_text(&result.session_id);
                                }
                            }
                        }
                        _ => {}
                    },
                }
            }
        }
    }

    // Restore terminal
    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    Ok(())
}

fn ui(f: &mut Frame, app: &App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .margin(1)
        .constraints([
            Constraint::Length(3),  // Search input
            Constraint::Min(10),    // Results
            Constraint::Length(3),  // Help
        ])
        .split(f.area());

    // Search input
    let input_style = if app.mode == Mode::Search {
        Style::default().fg(Color::Yellow)
    } else {
        Style::default()
    };

    let input = Paragraph::new(app.input.as_str())
        .style(input_style)
        .block(Block::default().borders(Borders::ALL).title("Search"));
    f.render_widget(input, chunks[0]);

    // Show cursor in search mode
    if app.mode == Mode::Search {
        f.set_cursor_position((chunks[0].x + app.cursor_position as u16 + 1, chunks[0].y + 1));
    }

    // Results list
    let items: Vec<ListItem> = app
        .results
        .iter()
        .map(|r| {
            let content = format!(
                "{} (score: {:.2})\n{}",
                r.session_id,
                r.score,
                r.snippet.chars().take(80).collect::<String>()
            );
            ListItem::new(Text::from(content))
        })
        .collect();

    let results = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(format!(
            "Results ({} found)",
            app.results.len()
        )))
        .highlight_style(
            Style::default()
                .bg(Color::DarkGray)
                .add_modifier(Modifier::BOLD),
        )
        .highlight_symbol("> ");

    f.render_stateful_widget(results, chunks[1], &mut app.list_state.clone());

    // Help text
    let help_text = match app.mode {
        Mode::Search => "Enter: Search | ↓: Browse results | Esc: Quit",
        Mode::Browse => "↑/↓: Navigate | Enter: Copy ID | Esc: Back to search | q: Quit",
    };
    let help = Paragraph::new(help_text)
        .style(Style::default().fg(Color::DarkGray))
        .block(Block::default().borders(Borders::ALL).title("Help"));
    f.render_widget(help, chunks[2]);
}
