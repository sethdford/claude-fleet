//! Fast full-text search for Claude Code sessions
//!
//! This crate provides Tantivy-based indexing and search functionality
//! exposed to Node.js via NAPI-RS bindings.

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tantivy::{
    collector::TopDocs,
    directory::MmapDirectory,
    doc,
    query::QueryParser,
    schema::{Schema, Value, STORED, TEXT},
    Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument,
};

mod tui;

/// Search result returned from queries
#[napi(object)]
pub struct SearchResult {
    pub session_id: String,
    pub score: f64,
    pub snippet: String,
    pub timestamp: i64,
    pub model: Option<String>,
}

/// Session metadata for indexing
#[napi(object)]
pub struct SessionMetadata {
    pub session_id: String,
    pub content: String,
    pub timestamp: i64,
    pub model: Option<String>,
    pub project_path: Option<String>,
}

/// Main search index for Claude Code sessions
#[napi]
pub struct SearchIndex {
    index: Index,
    reader: IndexReader,
    writer: Arc<RwLock<IndexWriter>>,
    schema: Schema,
}

#[napi]
impl SearchIndex {
    /// Create or open an index at the specified path
    #[napi(constructor)]
    pub fn new(index_path: String) -> Result<Self> {
        let path = PathBuf::from(&index_path);
        std::fs::create_dir_all(&path).map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to create index directory: {}", e))
        })?;

        // Define schema
        let mut schema_builder = Schema::builder();
        let _session_id = schema_builder.add_text_field("session_id", TEXT | STORED);
        let _content = schema_builder.add_text_field("content", TEXT | STORED);
        let _timestamp = schema_builder.add_i64_field("timestamp", tantivy::schema::INDEXED | STORED);
        let _model = schema_builder.add_text_field("model", TEXT | STORED);
        let _project_path = schema_builder.add_text_field("project_path", TEXT | STORED);
        let schema = schema_builder.build();

        // Open or create index
        let directory = MmapDirectory::open(&path).map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to open index directory: {}", e))
        })?;

        let index = Index::open_or_create(directory, schema.clone()).map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to open index: {}", e))
        })?;

        let writer = index.writer(50_000_000).map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to create writer: {}", e))
        })?;

        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::OnCommitWithDelay)
            .try_into()
            .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to create reader: {}", e)))?;

        Ok(Self {
            index,
            reader,
            writer: Arc::new(RwLock::new(writer)),
            schema,
        })
    }

    /// Index a session
    #[napi]
    pub fn index_session(&self, metadata: SessionMetadata) -> Result<()> {
        let session_id = self.schema.get_field("session_id").unwrap();
        let content = self.schema.get_field("content").unwrap();
        let timestamp = self.schema.get_field("timestamp").unwrap();
        let model = self.schema.get_field("model").unwrap();
        let project_path = self.schema.get_field("project_path").unwrap();

        let mut doc = TantivyDocument::default();
        doc.add_text(session_id, &metadata.session_id);
        doc.add_text(content, &metadata.content);
        doc.add_i64(timestamp, metadata.timestamp);
        if let Some(m) = &metadata.model {
            doc.add_text(model, m);
        }
        if let Some(p) = &metadata.project_path {
            doc.add_text(project_path, p);
        }

        let writer = self.writer.write().map_err(|_| {
            Error::new(Status::GenericFailure, "Failed to acquire writer lock")
        })?;

        writer.add_document(doc).map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to add document: {}", e))
        })?;

        Ok(())
    }

    /// Commit pending changes
    #[napi]
    pub fn commit(&self) -> Result<()> {
        let mut writer = self.writer.write().map_err(|_| {
            Error::new(Status::GenericFailure, "Failed to acquire writer lock")
        })?;

        writer.commit().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to commit: {}", e))
        })?;

        Ok(())
    }

    /// Search for sessions matching the query
    #[napi]
    pub fn search(&self, query: String, limit: Option<u32>) -> Result<Vec<SearchResult>> {
        let limit = limit.unwrap_or(20) as usize;

        let searcher = self.reader.searcher();
        let content_field = self.schema.get_field("content").unwrap();
        let session_id_field = self.schema.get_field("session_id").unwrap();
        let timestamp_field = self.schema.get_field("timestamp").unwrap();
        let model_field = self.schema.get_field("model").unwrap();

        let query_parser = QueryParser::for_index(&self.index, vec![content_field]);
        let parsed_query = query_parser.parse_query(&query).map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to parse query: {}", e))
        })?;

        let top_docs = searcher
            .search(&parsed_query, &TopDocs::with_limit(limit))
            .map_err(|e| Error::new(Status::GenericFailure, format!("Search failed: {}", e)))?;

        let mut results = Vec::new();
        for (score, doc_address) in top_docs {
            let retrieved_doc: TantivyDocument = searcher.doc(doc_address).map_err(|e| {
                Error::new(Status::GenericFailure, format!("Failed to retrieve doc: {}", e))
            })?;

            let session_id = retrieved_doc
                .get_first(session_id_field)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let snippet = retrieved_doc
                .get_first(content_field)
                .and_then(|v| v.as_str())
                .map(|s: &str| s.chars().take(200).collect::<String>())
                .unwrap_or_default();

            let timestamp = retrieved_doc
                .get_first(timestamp_field)
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let model = retrieved_doc
                .get_first(model_field)
                .and_then(|v| v.as_str())
                .map(|s: &str| s.to_string());

            results.push(SearchResult {
                session_id,
                score: score as f64,
                snippet,
                timestamp,
                model,
            });
        }

        Ok(results)
    }

    /// Delete a session from the index
    #[napi]
    pub fn delete_session(&self, session_id: String) -> Result<()> {
        let session_id_field = self.schema.get_field("session_id").unwrap();
        let term = tantivy::Term::from_field_text(session_id_field, &session_id);

        let writer = self.writer.write().map_err(|_| {
            Error::new(Status::GenericFailure, "Failed to acquire writer lock")
        })?;

        writer.delete_term(term);

        Ok(())
    }

    /// Reload the reader to see the latest committed changes
    #[napi]
    pub fn reload(&self) -> Result<()> {
        self.reader.reload().map_err(|e| {
            Error::new(Status::GenericFailure, format!("Failed to reload reader: {}", e))
        })
    }

    /// Get index statistics
    #[napi]
    pub fn stats(&self) -> Result<IndexStats> {
        let searcher = self.reader.searcher();
        let num_docs = searcher.num_docs();

        Ok(IndexStats {
            document_count: num_docs as i64,
        })
    }

    /// Launch the interactive TUI for searching
    #[napi]
    pub fn launch_tui(&self) -> Result<()> {
        tui::run_tui(&self.index, &self.reader, &self.schema)
            .map_err(|e| Error::new(Status::GenericFailure, format!("TUI error: {}", e)))
    }
}

/// Index statistics
#[napi(object)]
pub struct IndexStats {
    pub document_count: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_index() -> (SearchIndex, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let index = SearchIndex::new(dir.path().to_str().unwrap().to_string()).unwrap();
        (index, dir)
    }

    fn make_session(id: &str, content: &str) -> SessionMetadata {
        SessionMetadata {
            session_id: id.to_string(),
            content: content.to_string(),
            timestamp: 1_700_000_000,
            model: Some("opus".to_string()),
            project_path: Some("/tmp/project".to_string()),
        }
    }

    #[test]
    fn test_index_and_search() {
        let (idx, _dir) = temp_index();
        idx.index_session(make_session("s1", "fixing authentication bug in login handler")).unwrap();
        idx.index_session(make_session("s2", "adding unit tests for database layer")).unwrap();
        idx.commit().unwrap();
        idx.reload().unwrap();

        let results = idx.search("authentication".to_string(), Some(10)).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session_id, "s1");
        assert!(results[0].score > 0.0);
    }

    #[test]
    fn test_empty_search() {
        let (idx, _dir) = temp_index();
        idx.commit().unwrap();
        idx.reload().unwrap();

        let results = idx.search("nonexistent".to_string(), None).unwrap();
        assert!(results.is_empty());
    }

    #[test]
    fn test_stats() {
        let (idx, _dir) = temp_index();
        idx.index_session(make_session("s1", "content one")).unwrap();
        idx.index_session(make_session("s2", "content two")).unwrap();
        idx.commit().unwrap();
        idx.reload().unwrap();

        let stats = idx.stats().unwrap();
        assert_eq!(stats.document_count, 2);
    }

    #[test]
    fn test_delete_session() {
        let (idx, _dir) = temp_index();
        idx.index_session(make_session("del1", "temporary session to delete")).unwrap();
        idx.commit().unwrap();
        idx.reload().unwrap();

        let before = idx.stats().unwrap();
        assert_eq!(before.document_count, 1);

        idx.delete_session("del1".to_string()).unwrap();
        idx.commit().unwrap();
        idx.reload().unwrap();

        let after = idx.stats().unwrap();
        assert_eq!(after.document_count, 0);
    }

    #[test]
    fn test_search_limit() {
        let (idx, _dir) = temp_index();
        for i in 0..10 {
            idx.index_session(make_session(
                &format!("s{}", i),
                &format!("rust programming session number {}", i),
            )).unwrap();
        }
        idx.commit().unwrap();
        idx.reload().unwrap();

        let results = idx.search("rust programming".to_string(), Some(3)).unwrap();
        assert_eq!(results.len(), 3);
    }
}
