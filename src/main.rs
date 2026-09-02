fn main() {
    if let Err(err) = harness::run() {
        eprintln!("{err}");
        std::process::exit(err.exit_code());
    }
}
