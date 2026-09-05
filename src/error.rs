use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub struct Error {
    pub message: String,
    pub code: String,
    pub exit_code: i32,
}

impl Error {
    pub fn new(message: impl Into<String>) -> Self {
        let message = message.into();
        Self {
            code: classify_code(&message).into(),
            message,
            exit_code: 1,
        }
    }

    pub fn with_code(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            exit_code: 1,
        }
    }

    pub fn exit_code(&self) -> i32 {
        self.exit_code
    }
}

fn classify_code(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    if lower.contains("not found") {
        "HARNESS_E_NOT_FOUND"
    } else if lower.contains("path escapes") || lower.contains("project-relative") {
        "HARNESS_E_PATH"
    } else if lower.contains("lock") || lower.contains("busy") {
        "HARNESS_E_LOCK"
    } else if lower.contains("requires") || lower.contains("invalid") || lower.contains("unknown") {
        "HARNESS_E_USAGE"
    } else {
        "HARNESS_E_OPERATION"
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for Error {}

impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Error::new(value.to_string())
    }
}

impl From<serde_json::Error> for Error {
    fn from(value: serde_json::Error) -> Self {
        Error::new(value.to_string())
    }
}

impl From<String> for Error {
    fn from(value: String) -> Self {
        Error::new(value)
    }
}

impl From<&str> for Error {
    fn from(value: &str) -> Self {
        Error::new(value)
    }
}
