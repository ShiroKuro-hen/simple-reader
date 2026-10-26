mod book_files;

use book_files::{books_in_args, OpenedBooks};
use tauri::{ipc::Response, State};

/// The paths of the books the system asked the app to open since the page last asked.
#[tauri::command]
fn take_opened_books(opened: State<OpenedBooks>) -> Vec<String> {
    opened.take()
}

/// A book's bytes. Only a path the system handed to the app can be read.
#[tauri::command]
fn read_opened_book(opened: State<OpenedBooks>, path: String) -> Result<Response, String> {
    if !opened.may_read(&path) {
        return Err("that file was not opened through the app".into());
    }
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let opened = OpenedBooks::default();
    opened.push(books_in_args(std::env::args())); // a double-click that started the app

    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // A double-click while the app is open starts a second process: it hands its arguments to this one and exits.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::Manager;
            app.state::<OpenedBooks>().push(books_in_args(args));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval("dispatchEvent(new Event('sr-opened'))");
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_opener::init())
        .manage(opened)
        .invoke_handler(tauri::generate_handler![take_opened_books, read_opened_book])
        .run(tauri::generate_context!())
        .expect("error while running simple-reader");
}
