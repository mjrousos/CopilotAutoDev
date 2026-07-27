# Security Review: Rust Learning Lesson Series

**Issue:** #28  
**Date:** 2026-07-27  
**Artifact:** `autodev/issues/28/security-review.md`  
**Reviewer:** AutoDev SecurityReview (attempt 1)  
**Correlation ID:** `ed0a2159-e94f-459a-a3ae-a7fb0948cdbe`

---

## 1. Scope

This review covers the design for a 14-lesson Rust learning curriculum to be created under `samples/rust-learning/` as a Cargo workspace. No network services, user authentication, data storage, or infrastructure components are involved. The deliverable is static educational source code intended to be cloned and run locally by learners.

---

## 2. Threat Model

### 2.1 Assets

| Asset | Value |
|-------|-------|
| Repository integrity | Preventing introduction of malicious or harmful code into the repo |
| Learner workstation security | Ensuring sample code does not harm learners who run it |
| Supply chain (dependencies) | Ensuring pulled crates are trustworthy and not compromised |
| Educational soundness | Code models correct security practices where relevant |

### 2.2 Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Repository → learner machine | Learner clones and runs `cargo run`/`cargo test` locally |
| Cargo registry (crates.io) → workspace | `rand = "0.8"` is the sole external dependency fetched at build time |
| Lesson source → learner's mental model | Educational code patterns are absorbed and replicated by learners |

### 2.3 Threat Actors

- **Supply-chain attacker:** Compromises a crate dependency to execute code on learner machines.
- **Contributor introducing malicious code:** Code review gates should prevent this; not in scope for this design review.
- **Careless pattern propagation:** Learners copy insecure patterns from lesson code into production software.

### 2.4 Threat Summary

| Threat | Likelihood | Impact | Severity |
|--------|-----------|--------|----------|
| Compromised `rand` crate via crates.io supply-chain attack | Low | High | Medium |
| Learners internalizing `unwrap`/`expect` as acceptable in production | Medium | Medium | Low–Medium |
| Stale MSRV (`1.70`) containing known compiler/std vulnerabilities | Very Low | Low | Low |
| Accidental system-wide side effects from lesson code | Very Low | Low | Informational |

---

## 3. Design Analysis

### 3.1 External Dependencies

The design introduces exactly one external crate: `rand = "0.8"` in lesson 12. This is a deliberate, named dependency widely used in the Rust ecosystem with a strong security track record. `rand 0.8.x` is maintained by the `rust-random` organization, has no history of supply-chain compromise, and the `0.8` semver pin prevents pulling in potentially breaking or malicious minor versions.

**Assessment:** Acceptable. The constraint to a single, well-known dependency is a good design decision.

**Minor concern:** The design pins `rand = "0.8"` without a `Cargo.lock` guidance note. For a learning workspace, committing `Cargo.lock` to the repository is best practice — it pins the exact version fetched and protects learners from dependency drift or a future compromised patch release of rand.

### 3.2 MSRV and Compiler Pinning

The design specifies `rust-version = "1.70"` (April 2023). Rust does release occasional security advisories for the compiler/standard library (though rare). Pinning to a three-year-old minimum could expose learners who use exactly that version to known issues. The workspace toolchain itself is determined by the learner's local `rustup` installation, not a `rust-toolchain.toml` file; learners on recent toolchains will not be affected.

**Assessment:** Low risk. A `rust-toolchain.toml` specifying a recent stable channel would be a stronger guarantee that learners use a non-vulnerable compiler, but it is not a blocking concern for this educational material.

### 3.3 Unsafe Code

The design makes no mention of `unsafe` blocks. The curriculum topics (ownership, borrowing, traits, closures, etc.) all operate in safe Rust. No lesson is expected to use `unsafe`.

**Assessment:** No concern.

### 3.4 Error Handling Patterns and Pedagogical Security

Lesson 09 explicitly teaches the danger of `unwrap`/`expect` and guides learners toward `Result`-based propagation. The design flags `unwrap`/`expect` as pitfalls and provides the correct idiom (`?` operator, `Box<dyn Error>`). However, earlier lessons (01–08) necessarily use `unwrap`/`expect` before the concept is formally introduced.

**Assessment:** Acceptable with a minor note. Source files in lessons 01–08 that use `unwrap`/`expect` should carry a `// NOTE: unwrap() is used here for simplicity; see lesson 09 for production-safe error handling` comment. The design already mandates `// PITFALL:` comments, so this is a natural extension.

### 3.5 No Network, No File System Writes, No Privilege Escalation

All lesson binaries produce output to stdout. No lesson:
- Opens network sockets
- Reads from or writes to arbitrary file paths
- Requests elevated permissions
- Executes shell commands or spawns child processes
- Uses `std::process::Command`

**Assessment:** No concern.

### 3.6 User-Supplied Input

Lesson 09's exercise involves "parsing a user-supplied string as an integer." The design's intent is that this input is hard-coded in `main()` (the lesson demonstrates the `Result` API, not stdin reading). If the implementation uses `std::io::stdin().read_line()`, that is benign for a local educational tool. No security concern arises from parsing a string to an integer in an offline binary.

**Assessment:** No concern.

### 3.7 `#[allow(...)]` and Lint Suppression

The design requires `cargo clippy -- -D warnings` to pass with zero diagnostics. This is a strong positive security signal: it means no lint suppression attributes should appear in the committed code, and the implementation will be held to idiomatic standards.

**Assessment:** Positive finding.

---

## 4. Findings

### F-1 — `Cargo.lock` not mentioned (Severity: Low)

**Finding:** The design does not specify whether `Cargo.lock` should be committed. For a Cargo workspace that acts as a learning reference, committing `Cargo.lock` protects against silent dependency drift and supply-chain substitution attacks against `rand`.

**Recommendation:** The implementation plan and workspace `README.md` should state that `Cargo.lock` is committed to the repository, and `.gitignore` must not exclude it.

---

### F-2 — `unwrap`/`expect` in pre-lesson-09 code without caveat comments (Severity: Low)

**Finding:** Lessons 01–08 will necessarily use `unwrap`/`expect` or similar convenience methods before formal error handling is taught. Without inline caveat comments, learners may internalize these as production-safe patterns.

**Recommendation:** Any use of `unwrap()`/`expect()` in lessons 01–08 should be accompanied by a comment such as:
```rust
// unwrap() is used here for brevity; see lesson 09 for production-safe error handling
```
The design's `// PITFALL:` convention can carry this note.

---

### F-3 — No toolchain version file (Severity: Informational)

**Finding:** Without a `rust-toolchain.toml`, learners on older Rust versions (e.g., exactly 1.70) may encounter compiler bugs or known CVEs that have since been fixed. The MSRV pin ensures the code *compiles*, but does not guide learners toward a secure compiler version.

**Recommendation (optional):** Consider adding a `samples/rust-learning/rust-toolchain.toml` specifying `channel = "stable"`. This is not blocking.

---

## 5. Summary

This is a static educational code project with a minimal attack surface. There are no network components, no authentication, no sensitive data, and only one well-known external dependency. All three findings are Low or Informational severity.

**No blocking security findings were identified.** The design is ready to proceed to human plan review and implementation.

---

```autodev-decision:v1
{
  "schemaVersion": 1,
  "state": "security-review",
  "nextState": "human-plan-review",
  "decisionRationale": "No blocking security findings; the design has minimal attack surface (static educational code, one well-known dependency, no network or privileged operations) and is ready for human review."
}
```
