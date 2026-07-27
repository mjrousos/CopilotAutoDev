# Design: Rust Learning Lesson Series

**Issue:** #28  
**Date:** 2026-07-27  
**Artifact:** `autodev/issues/28/design.md`

---

## Overview

Implement a hands-on Rust learning curriculum as a Cargo workspace under `samples/rust-learning/`. The series targets experienced programmers new to Rust (not complete beginners), covering the language from setup through testing across 14 lessons. Each lesson is a self-contained binary crate with runnable examples and guided exercises.

---

## Proposed Architecture

### Directory Structure

```
samples/rust-learning/
├── Cargo.toml                          # workspace root
├── README.md                           # series overview & how-to-run guide
├── lesson-01-setup/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-02-variables/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-03-control-flow/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-04-ownership/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-05-borrowing/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-06-structs/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-07-enums/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-08-collections/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-09-error-handling/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-10-traits/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-11-closures-iterators/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
├── lesson-12-modules/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/
│       ├── main.rs
│       └── utils.rs         # demonstrates module splitting
├── lesson-13-lifetimes/
│   ├── Cargo.toml
│   ├── README.md
│   └── src/main.rs
└── lesson-14-testing/
    ├── Cargo.toml
    ├── README.md
    └── src/
        ├── main.rs
        ├── lib.rs           # library functions for testing
        └── tests/
            └── integration_test.rs
```

**Rationale for binary crates:** Binary crates allow `cargo run` which gives immediate, visible output — crucial for learner motivation. Lessons 06 onwards include `#[cfg(test)]` modules in `main.rs` or `lib.rs` so learners also use `cargo test`. Lesson 14 uses a library crate plus `tests/` directory to teach integration testing.

**No async lesson:** The async/tokio lesson (lesson 15) is excluded. It requires an external dependency and a runtime, which is a significant complexity jump unsuitable for an introductory series. Learners who complete the series will have the foundation to study async independently.

---

## Workspace Configuration

**`samples/rust-learning/Cargo.toml`:**
```toml
[workspace]
members = ["lesson-*"]
resolver = "2"
```

**Per-lesson `Cargo.toml` template:**
```toml
[package]
name = "lesson-NN-topic"
version = "0.1.0"
edition = "2021"
rust-version = "1.70"

[[bin]]
name = "lesson-NN-topic"
path = "src/main.rs"
```

`edition = "2021"` is the current stable, widely-supported default. `rust-version = "1.70"` (released April 2023) pins a reasonable MSRV that supports all features used.

---

## Lesson Specifications

### Lesson 01 — Setup & Hello World
- **Concepts:** `rustup`, `cargo new`, `fn main`, `println!`, string formatting with `{}`, `cargo run`
- **Exercise:** Modify the greeting to accept a name variable; print multiple lines using different format specifiers (`{:?}`, `{:#?}`)
- **Output:** "Hello, Rust!" plus learner customizations

### Lesson 02 — Variables & Types
- **Concepts:** `let`, mutability (`let mut`), shadowing, scalar types (integers, floats, bool, char), type inference, `const`, tuple and array basics
- **Exercise:** Declare variables of each scalar type; demonstrate shadowing to convert a string to a number; add a `const` for a mathematical constant
- **Pitfall addressed:** Reassigning an immutable binding vs. shadowing

### Lesson 03 — Control Flow
- **Concepts:** `if`/`else if`/`else` as expression, `loop` + `break` with value, `while`, `for` over ranges (`..` vs `..=`), `for` over arrays
- **Exercise:** Write a FizzBuzz using `for` and range; implement a number-guessing loop with `loop`/`break`
- **Pitfall addressed:** `..` vs `..=` inclusivity; `if` as expression (no ternary needed)

### Lesson 04 — Functions & Ownership
- **Concepts:** Function syntax, return types, expressions vs statements (no semicolon = return), ownership rules (one owner, drop on scope exit), `Clone`, `Copy` trait for primitives, move semantics with function arguments
- **Exercise:** Pass a `String` to a function and observe the move; clone it to retain ownership; contrast with a `Copy` integer
- **Pitfall addressed:** Using a value after it has been moved; confusion between expression and statement return

### Lesson 05 — References & Borrowing
- **Concepts:** Immutable references (`&T`), mutable references (`&mut T`), borrow checker rules (many immutable OR one mutable), dangling references, string slices (`&str`)
- **Exercise:** Refactor lesson 04 exercise to use references instead of ownership transfer; try creating a dangling reference (compile error) and understand the message
- **Pitfall addressed:** Mixing mutable and immutable borrows; `String` vs `&str`

### Lesson 06 — Structs
- **Concepts:** Struct definition and instantiation, field shorthand, struct update syntax (`..`), tuple structs, unit structs, `impl` blocks, methods (`&self`, `&mut self`), associated functions (`Self::new`)
- **Includes:** `#[cfg(test)]` module with basic `assert_eq!` tests
- **Exercise:** Model a `Rectangle` struct with `area()`, `perimeter()`, and `is_square()` methods; add a `new` constructor
- **Pitfall addressed:** `self` vs `&self` ownership in methods

### Lesson 07 — Enums & Pattern Matching
- **Concepts:** `enum` with data variants, `Option<T>` (no null), `match` with exhaustive arms, `if let`, `while let`, `matches!` macro
- **Exercise:** Implement a simple state machine using enum (e.g., traffic light or coin denominations); use `match` to compute values; handle `Option` without `unwrap`
- **Pitfall addressed:** Non-exhaustive `match` patterns; forgetting `None` arm

### Lesson 08 — Collections
- **Concepts:** `Vec<T>` (creation, push, index, slicing, iteration), `String` (UTF-8, concatenation, `.chars()`), `HashMap<K,V>` (entry API, iteration)
- **Exercise:** Build a word-frequency counter using `HashMap`; collect results back into a sorted `Vec`
- **Pitfall addressed:** `String` UTF-8 vs byte indexing; `HashMap` entry API vs repeated `get`/`insert`

### Lesson 09 — Error Handling
- **Concepts:** `panic!` vs recoverable errors, `Result<T, E>`, `?` operator for propagation, `unwrap`/`expect` (and when not to use them), `Box<dyn Error>` for simple error boxing, chaining results
- **Exercise:** Parse a user-supplied string as an integer; propagate the error up with `?`; provide a `main()` returning `Result<(), Box<dyn Error>>`
- **Pitfall addressed:** Using `unwrap` in production code; confusion between `?` and manual `match`

### Lesson 10 — Traits & Generics
- **Concepts:** `trait` definition, `impl Trait for Type`, default methods, trait bounds (`T: Display`), `where` clauses, generic functions and structs, `impl Trait` in parameters vs return position
- **Exercise:** Define a `Summary` trait with a `summarize()` method; implement it for two types; write a generic function that prints the summary of any `Summary` implementor
- **Pitfall addressed:** Trait objects (`dyn Trait`) vs generics (brief mention); orphan rule (cannot implement external traits on external types)

### Lesson 11 — Closures & Iterators
- **Concepts:** Closure syntax, capture modes (`Fn`, `FnMut`, `FnOnce`), `move` closures, iterator trait, `.map()`, `.filter()`, `.fold()`, `.collect()`, `.enumerate()`, `.zip()`, lazy evaluation, chaining
- **Exercise:** Rewrite the lesson 08 word-frequency counter using iterator chains; implement a custom iterator using `impl Iterator`
- **Pitfall addressed:** Closure capture vs move; iterator laziness (nothing runs until consumed)

### Lesson 12 — Modules & Packages
- **Concepts:** `mod`, `use`, `pub`, nested modules, `super`, `crate`, splitting into multiple files (`mod utils;` → `src/utils.rs`), external crates via `Cargo.toml`, re-exports with `pub use`
- **Files:** `src/main.rs` + `src/utils.rs`
- **Exercise:** Refactor a previous lesson's code into a module; add `rand` crate for a number-guessing game, demonstrating an external dependency
- **Note:** Adds `rand = "0.8"` as the sole external dependency in this lesson's `Cargo.toml`

### Lesson 13 — Lifetimes
- **Concepts:** Lifetime purpose (preventing dangling references), lifetime annotation syntax (`'a`), lifetime elision rules, lifetime annotations in function signatures and structs, `'static`
- **Exercise:** Write a function that returns the longer of two string slices; annotate the struct that holds a reference; understand elision by removing annotations and seeing what compiles
- **Pitfall addressed:** Thinking lifetimes allocate memory; confusion between `'static` and owned data

### Lesson 14 — Testing
- **Concepts:** `#[test]`, `assert!`, `assert_eq!`, `assert_ne!`, `#[should_panic]`, `#[ignore]`, `cargo test` filters, `#[cfg(test)]` modules for unit tests, `tests/` directory for integration tests, doc-tests (`///`)
- **Files:** `src/lib.rs` (pure functions to test), `src/main.rs` (calls lib), `tests/integration_test.rs` (integration tests)
- **Exercise:** Write unit tests for functions in `lib.rs`; write an integration test; add a doc-test to a function; run `cargo test -- --nocapture` to see output
- **Pitfall addressed:** Integration tests can only call `pub` functions; doc-tests must compile

---

## Key Interfaces & Data Contracts

### Workspace Build Contract
- Running `cargo build` from `samples/rust-learning/` must succeed with zero errors and zero warnings across all 14 lessons.
- Running `cargo test` must pass all tests.
- Running `cargo clippy` must produce no warnings (lessons model idiomatic Rust).

### Per-Lesson README Contract
Each `lesson-NN-topic/README.md` must contain:
1. **Concepts covered** (bullet list)
2. **How to run** (`cargo run` command)
3. **Exercises** (numbered list of tasks for the learner)
4. **Key takeaways** (one-paragraph summary)

### Per-Lesson Source Contract
Each `src/main.rs` must:
- Compile cleanly under `edition = "2021"`
- Produce non-trivial output demonstrating the lesson topic
- Include `// Exercise N: <task description>` comments marking extend points
- Include `// PITFALL: <description>` comments near common mistake patterns
- Include `#[cfg(test)]` module from lesson 06 onwards

---

## Step-by-Step Implementation Approach

1. **Create workspace root** — `samples/rust-learning/Cargo.toml` and `README.md`
2. **Implement lessons 01–05** (no `#[cfg(test)]`) — foundational Rust, pure binary crates
3. **Implement lessons 06–07** (add `#[cfg(test)]` modules) — structs and enums
4. **Implement lessons 08–11** — standard library and functional patterns
5. **Implement lesson 12** — modules with multi-file layout and `rand` dependency
6. **Implement lessons 13–14** — lifetimes and testing with `lib.rs` + integration test
7. **Verify** — `cargo build`, `cargo test`, `cargo clippy` all pass at workspace root

Each lesson follows the same creation checklist:
- Create `lesson-NN-topic/Cargo.toml` (correct name, edition, rust-version)
- Create `lesson-NN-topic/README.md` (concepts, run instructions, exercises, takeaways)
- Create `lesson-NN-topic/src/main.rs` (example code, exercise markers, pitfall comments)
- Run `cargo check -p lesson-NN-topic` to verify compilation

---

## Testing Strategy

| Test Type | Command | Expectation |
|-----------|---------|-------------|
| Workspace build | `cargo build` (workspace root) | Zero errors, zero warnings |
| Workspace tests | `cargo test` (workspace root) | All `#[test]` pass |
| Clippy lint | `cargo clippy -- -D warnings` | Zero diagnostics |
| Per-lesson run | `cargo run -p lesson-NN-topic` | Produces expected output |
| Lesson 14 integration | `cargo test -p lesson-14-testing` | Unit + integration + doc-tests pass |

No external test framework is needed; the standard `#[test]` infrastructure and `cargo test` are sufficient.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Rust version drift: syntax changes between 1.70 and current | Pin `rust-version = "1.70"`, use only stable, non-nightly features |
| `rand` in lesson 12 pulls a large dependency tree | Use `rand = "0.8"` (widely tested, well-known); make clear it is intentional |
| Workspace size: 14 crates, each with dependencies | With `rand` only in lesson 12 and no other external deps, compile time is short |
| Inconsistent quality across lessons | Enforce per-lesson checklist; all lessons must have README + exercises + pitfall comments |

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|-----------|
| Target audience | Experienced programmer new to Rust. Ownership/borrowing explained in depth; basic programming concepts not over-explained. |
| Async lesson | Excluded. Adds tokio dependency and conceptual complexity beyond the series scope. |
| Exercise format | "Extend working examples" (not broken code). Exercise markers (`// Exercise N:`) in source guide the learner without blocking compilation. |
| README depth | Top-level `README.md` for the series overview; per-lesson `README.md` for run instructions and exercises. No per-lesson README duplication of workspace README. |
| Integration tests | Covered in lesson 14 with a dedicated `tests/` directory. |

---

## Files To Create

| Path | Type |
|------|------|
| `samples/rust-learning/Cargo.toml` | Workspace manifest |
| `samples/rust-learning/README.md` | Series overview |
| `samples/rust-learning/lesson-0{1..9}-*/Cargo.toml` × 9 | Package manifests |
| `samples/rust-learning/lesson-{10..14}-*/Cargo.toml` × 5 | Package manifests |
| `samples/rust-learning/lesson-0{1..9}-*/README.md` × 9 | Lesson READMEs |
| `samples/rust-learning/lesson-{10..14}-*/README.md` × 5 | Lesson READMEs |
| `samples/rust-learning/lesson-0{1..5}-*/src/main.rs` × 5 | Lesson source |
| `samples/rust-learning/lesson-0{6..9}-*/src/main.rs` × 4 | Lesson source (with tests) |
| `samples/rust-learning/lesson-{10..13}-*/src/main.rs` × 4 | Lesson source |
| `samples/rust-learning/lesson-12-modules/src/utils.rs` | Module split demo |
| `samples/rust-learning/lesson-14-testing/src/lib.rs` | Library under test |
| `samples/rust-learning/lesson-14-testing/src/main.rs` | Binary entry point |
| `samples/rust-learning/lesson-14-testing/tests/integration_test.rs` | Integration tests |

Total: ~45 files, no generated content, no build scripts.

---

```autodev-decision:v1
{
  "schemaVersion": 1,
  "state": "design",
  "nextState": "security-review",
  "decisionRationale": "The design is complete and actionable with no missing information; security review is the appropriate next step before implementation."
}
```
