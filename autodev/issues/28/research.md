# Research: Rust Learning Lesson Series

**Issue:** #28  
**Date:** 2026-07-27  
**Artifact:** `autodev/issues/28/research.md`

---

## Problem Statement

The issue requests a series of hands-on Rust programming lessons, to be placed under `./samples/rust-learning/`. The lessons should:
- Be based on up-to-date Rust information and best practices
- Be hands-on (exercises, not just reading material)
- Follow a logical, progressive curriculum

There is no existing `samples/` directory in this repository, so it must be created along with the lesson structure.

---

## Relevant Existing Code

No existing Rust code or `samples/` directory exists in the repository. The implementation will create a new directory tree from scratch.

---

## External Research

### Rust Language Status (2025–2026)

- **Current edition:** Rust 2024 (stabilized in Rust 1.85, released February 2025). See [Rust 2024 Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2024/index.html).
- **Toolchain:** `rustup` is the standard installer/version manager. `cargo` is the build system and package manager.
- **Official learning resources:**
  - [The Rust Programming Language ("The Book")](https://doc.rust-lang.org/book/) — the canonical introductory text
  - [Rustlings](https://rustlings.cool/) — small hands-on exercises; GitHub: `rust-lang/rustlings`
  - [Rust by Example](https://doc.rust-lang.org/rust-by-example/) — runnable code examples
  - [Exercism Rust track](https://exercism.org/tracks/rust) — community exercises with mentorship

### Recommended Curriculum Structure

The following topic progression is widely endorsed in the Rust community and mirrors the structure of The Rust Book:

| Lesson | Topic | Key Concepts |
|--------|-------|-------------|
| 01 | Setup & Hello World | rustup, cargo new, `fn main`, `println!`, `cargo run` |
| 02 | Variables & Types | `let`, mutability, shadowing, scalar types, `const` |
| 03 | Control Flow | `if`/`else`, `loop`, `while`, `for`, ranges |
| 04 | Functions & Ownership | functions, stack vs heap, ownership rules, `Clone`/`Copy` |
| 05 | References & Borrowing | `&T`, `&mut T`, borrow checker rules, slices |
| 06 | Structs | `struct`, methods, `impl`, associated functions |
| 07 | Enums & Pattern Matching | `enum`, `match`, `if let`, `Option<T>` |
| 08 | Collections | `Vec<T>`, `String`, `HashMap<K,V>` |
| 09 | Error Handling | `Result<T,E>`, `?` operator, `unwrap`/`expect`, custom errors |
| 10 | Traits & Generics | `trait`, `impl Trait`, generic functions, `where` clauses |
| 11 | Closures & Iterators | closures, `Fn`/`FnMut`/`FnOnce`, `.map()`, `.filter()`, `.collect()` |
| 12 | Modules & Packages | `mod`, `use`, `pub`, crate structure, `Cargo.toml` dependencies |
| 13 | Lifetimes | lifetime annotations, `'a`, lifetime elision rules |
| 14 | Testing | `#[test]`, `assert!`, `assert_eq!`, `cargo test`, `#[should_panic]` |
| 15 | Async/Await (Bonus) | `async fn`, `.await`, `tokio` runtime, basic async patterns |

### Hands-On Exercise Structure

Each lesson should be a separate Cargo project (a binary or library crate) within the `samples/rust-learning/` directory. This allows learners to:
- Run `cargo run` (for binaries) or `cargo test` (for libraries) independently
- See immediate feedback without a monorepo setup
- Optionally use a Cargo workspace to manage all lessons together

**Workspace approach** (recommended):
```
samples/rust-learning/
├── Cargo.toml          # workspace root
├── lesson-01-setup/
│   ├── Cargo.toml
│   └── src/main.rs
├── lesson-02-variables/
│   ├── Cargo.toml
│   └── src/main.rs
...
```

The workspace `Cargo.toml` uses:
```toml
[workspace]
members = ["lesson-*"]
resolver = "2"   # required for edition 2021 feature resolution
```

### Good Exercise Design Principles

From [The Rustlings design](https://github.com/rust-lang/rustlings) and community practice:

1. **Compile-driven learning:** exercises with intentional compile errors that the learner must fix (`// TODO: fix me`)
2. **Progressive complexity:** each lesson builds on the previous; avoid introducing multiple new concepts simultaneously
3. **Runnable examples:** every lesson should produce visible output when run successfully
4. **Inline comments:** explain *why*, not just *what*
5. **Common pitfalls addressed explicitly:**
   - Attempting to use a value after it has been moved
   - Borrowing a value mutably while it is borrowed immutably
   - Off-by-one errors with `..` vs `..=` ranges
   - Confusion between `String` and `&str`
   - Forgetting to handle `Result` / `Option`

### Edition Notes

- **Current stable default:** Rust 2021 edition (stabilized November 2021 via [RFC 3085](https://rust-lang.github.io/rfcs/3085-edition-2021.html))
- **Rust 2024 edition** is in late-stage stabilization as of mid-2026; see the [Rust 2024 Edition Guide](https://doc.rust-lang.org/edition-guide/rust-2024/index.html) for status

Key 2021 edition improvements relevant to learners:
- Disjoint closure capture (closures capture fields, not whole structs)
- `IntoIterator` for arrays (`[T; N]` is directly iterable)
- Improved `use` resolver

Lessons should specify `edition = "2021"` in each `Cargo.toml` (the current widely-supported default), and optionally pin `rust-version = "1.70"` as a minimum supported Rust version (MSRV) to prevent version-mismatch confusion.

### External Sources & Citations

- Rust Book: https://doc.rust-lang.org/book/
- Rust 2024 Edition Guide: https://doc.rust-lang.org/edition-guide/rust-2024/
- Rust by Example: https://doc.rust-lang.org/rust-by-example/
- Rustlings source: https://github.com/rust-lang/rustlings
- Cargo book (workspace docs): https://doc.rust-lang.org/cargo/reference/workspaces.html
- Rust std library docs: https://doc.rust-lang.org/std/
- Tokio async runtime: https://tokio.rs/ (for lesson 15)
- Async closures RFC: https://rust-lang.github.io/rfcs/3668-async-closures.html

---

## Recommended Implementation Direction

### Structure

Create a Cargo workspace at `samples/rust-learning/Cargo.toml` with 14–15 lesson crates (lesson-01 through lesson-14, plus optional lesson-15-async). Each lesson is a binary crate with:
- `src/main.rs` demonstrating the concept with runnable, well-commented code
- Inline `// Exercise:` comments marking places for the learner to extend the code
- Unit tests (via `#[cfg(test)]`) included from lesson 06 onwards, with dedicated tests in lesson 14

### Lesson Content Summary

- **Lessons 01–03:** Entry-level; no prior Rust knowledge required. Focus on getting code running.
- **Lessons 04–07:** Core Rust differentiators (ownership, borrowing, structs, enums). These are the heart of the series.
- **Lessons 08–11:** Standard library and functional patterns.
- **Lessons 12–14:** Modular code organization, lifetimes, and test-driven development.
- **Lesson 15 (bonus):** Async/await with `tokio`; introduces an external dependency.

### Files to Create

```
samples/rust-learning/Cargo.toml            # workspace
samples/rust-learning/lesson-01-setup/Cargo.toml
samples/rust-learning/lesson-01-setup/src/main.rs
... (same pattern for each lesson)
samples/rust-learning/README.md             # overview of the series
```

---

## Risks

1. **Rust version drift:** Specific syntax or std APIs may change. Mitigate by pinning `edition = "2024"` and avoiding nightly-only features.
2. **Scope creep:** Async/await (lesson 15) requires `tokio` as an external dependency. If the goal is dependency-free, it should be skipped or marked optional.
3. **Workspace vs. standalone crates:** A workspace simplifies running all lessons together but requires learners to understand Cargo workspace semantics. The README should explain how to run individual lessons.
4. **Exercise difficulty calibration:** "Hands-on" lessons need a balance — too easy is not useful, too hard discourages beginners. The inline `// Exercise:` approach lets learners extend examples without being thrown in the deep end.

---

## Open Questions

1. **Target audience:** Beginner (no programming background), experienced programmer learning Rust, or intermediate Rustacean? This affects depth of ownership/lifetimes coverage.
2. **Async lesson inclusion:** Should lesson 15 (async/tokio) be included, given it adds an external dependency?
3. **Exercise format:** Should exercises be "fix the broken code" (Rustlings style) or "extend working examples"? Or both?
4. **README depth:** Should there be a top-level `samples/rust-learning/README.md` with an overview, plus per-lesson READMEs?
5. **Testing coverage:** Should the series include a dedicated lesson on integration tests (separate `tests/` directory) and doc-tests (`///` comments)?

---

## Conclusion

The implementation is well-scoped and feasible. A 14-lesson Cargo workspace under `samples/rust-learning/` covering setup through testing, with an optional async lesson, aligns with current Rust best practices and community-endorsed learning paths. The Design phase should decide the exact lesson list, exercise format, and whether async is included.
