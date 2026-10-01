fn main() {
    // Icon-only updates must rebuild the embedded window and tray resources.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
