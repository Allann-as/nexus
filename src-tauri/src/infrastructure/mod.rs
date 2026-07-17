//! Infrastructure: concrete adapters to the outside world (SQLite, the
//! filesystem, logging). Implements the ports the application layer declares.

pub mod db;
pub mod logging;
pub mod paths;
