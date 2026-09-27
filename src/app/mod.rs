pub mod auth;
pub mod catalog;
pub mod dashboard;
pub mod durable;
pub mod index;
pub mod init;
pub mod link;
pub mod local;
pub mod mcp;
pub mod plan;
pub mod project_link;
pub mod query;
mod self_update;
pub mod status;
pub mod sync;

pub use self_update::{maybe_auto_update, perform_update, UpdateMode};
