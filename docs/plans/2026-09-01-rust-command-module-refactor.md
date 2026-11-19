# Rust Command Module Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the Tauri command boundary and reusable services without changing any frontend command name, payload, window behavior, or network response shape.

**Architecture:** `lib.rs` remains the application composition root. `commands` contains thin Tauri adapters, `services` contains search URL and weather behavior, and `tasks` remains available for future long-running task state. Search WebView lifecycle code stays with the search command module because it directly owns Tauri windows and child WebViews.

**Tech Stack:** Rust 2021, Tauri 2, Tokio, Reqwest, Serde.

---

### Task 1: Extract application commands

**Files:** Create `src-tauri/src/commands/app.rs`; modify `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`.

Move executable-path, portable-mode, and update-backup cleanup commands into the application command adapter. Preserve command names and error strings.

### Task 2: Extract search services and commands

**Files:** Create `src-tauri/src/services/search.rs` and `src-tauri/src/commands/search.rs`; modify `src-tauri/src/services/mod.rs`, `src-tauri/src/commands/mod.rs`, and `src-tauri/src/lib.rs`.

Move URL validation/encoding into the search service. Move search window creation, tab lifecycle, zoom state, content script, and Tauri command handlers into the search command module. Preserve labels, events, toolbar height, and navigation behavior.

### Task 3: Extract weather service and command

**Files:** Create `src-tauri/src/services/weather.rs` and `src-tauri/src/commands/weather.rs`; modify module declarations and command registration.

Move response DTOs and HTTP fetching into the service. Keep the `weather_by_ip` command as a thin adapter and preserve its camelCase JSON response.

### Task 4: Verify compatibility

Run `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml`, `npm run build`, `npm run lint -- --quiet`, and the existing qPCR transform smoke check. Confirm all existing frontend command strings remain registered.
