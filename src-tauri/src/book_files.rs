//! Books the operating system asks the app to open (double-click, "Open with"), and what the page may read.

use std::{collections::HashSet, path::Path, sync::Mutex};

const EXTENSIONS: [&str; 4] = ["epub", "pdf", "cbz", "cbr"];

pub fn is_book(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXTENSIONS.iter().any(|book| e.eq_ignore_ascii_case(book)))
}

/// The books among the command-line arguments; the first argument is the program itself.
pub fn books_in_args(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter().skip(1).filter(|arg| is_book(arg)).collect()
}

/// Paths waiting for the page to collect them. The page may read only paths the system handed to the app,
/// so a script that got into the page cannot ask for any other file.
#[derive(Default)]
pub struct OpenedBooks {
    waiting: Mutex<Vec<String>>,
    allowed: Mutex<HashSet<String>>,
}

impl OpenedBooks {
    pub fn push(&self, paths: Vec<String>) {
        self.allowed.lock().unwrap().extend(paths.iter().cloned());
        self.waiting.lock().unwrap().extend(paths);
    }

    /// Hands over what is waiting; each path is delivered once.
    pub fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.waiting.lock().unwrap())
    }

    pub fn may_read(&self, path: &str) -> bool {
        self.allowed.lock().unwrap().contains(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn recognises_the_four_book_types_whatever_the_case() {
        for path in ["a.epub", "a.PDF", "C:\\Books\\Vol 1.CbZ", "/tmp/x.cbr"] {
            assert!(is_book(path), "{path}");
        }
    }

    #[test]
    fn rejects_everything_else() {
        for path in ["a.txt", "a.epub.exe", "epub", "a.", "C:\\Books\\", "--flag", ""] {
            assert!(!is_book(path), "{path}");
        }
    }

    #[test]
    fn skips_the_program_and_keeps_the_books_in_order() {
        let found = books_in_args(args(&["simple-reader.exe", "b.epub", "--x", "a.cbz", "notes.txt"]));
        assert_eq!(found, args(&["b.epub", "a.cbz"]));
    }

    #[test]
    fn a_program_path_that_looks_like_a_book_is_not_one() {
        assert!(books_in_args(args(&["weird.epub"])).is_empty());
    }

    #[test]
    fn delivers_each_path_once_but_keeps_it_readable() {
        let opened = OpenedBooks::default();
        opened.push(args(&["a.epub", "b.pdf"]));
        assert_eq!(opened.take(), args(&["a.epub", "b.pdf"]));
        assert!(opened.take().is_empty());
        assert!(opened.may_read("a.epub"));
    }

    #[test]
    fn refuses_paths_the_system_never_handed_over() {
        let opened = OpenedBooks::default();
        opened.push(args(&["a.epub"]));
        assert!(!opened.may_read("C:\\Users\\secret.epub"));
        assert!(!opened.may_read(""));
    }

    #[test]
    fn later_launches_add_to_what_is_waiting() {
        let opened = OpenedBooks::default();
        opened.push(args(&["a.epub"]));
        opened.push(args(&["b.cbz"]));
        assert_eq!(opened.take(), args(&["a.epub", "b.cbz"]));
    }
}
