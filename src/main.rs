fn main() {
    if let Err(err) = harness::run() {
        if std::env::var_os("HARNESS_JSON_ERRORS").is_some() {
            eprintln!(
                "{}",
                serde_json::json!({
                    "ok": false,
                    "code": err.code,
                    "message": err.message,
                    "exitCode": err.exit_code(),
                })
            );
        } else {
            eprintln!("{err}");
        }
        std::process::exit(err.exit_code());
    }
}
