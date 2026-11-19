# Golden Gate Native Shell Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Mynx follow macOS 27 Golden Gate principles outside the existing sidebar, while preserving native Windows window behavior.

**Architecture:** Keep the product's existing React pages and sidebar. Replace the universal CSS glass treatment with a semantic control/navigation layer, add platform-aware window chrome, native application menus, and reusable accessibility behavior for dialogs and route changes.

**Tech Stack:** React 18, TypeScript, Tauri 2, CSS custom properties, native Tauri menus.

---

### Task 1: Platform-aware window shell

**Files:**
- Modify: `src/components/TitleBar.tsx`
- Modify: `src/styles/layout.css`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

1. Detect macOS using the existing OS plugin.
2. On macOS, restore native decorations and use Tauri's overlay title-bar style so traffic lights remain system-owned; render only the app toolbar content under the native frame.
3. Retain the existing custom controls on Windows where they fit the native Windows shell.
4. Add explicit accessible names and pressed state for every title-bar command.

### Task 2: Native command menus

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/i18n.tsx`

1. Add application, Edit, View, Window, and Help menu groups with standard edit/window commands.
2. Dispatch non-native commands to the webview as named events.
3. Listen for navigation/help/language commands in React and preserve platform-standard keyboard behavior.

### Task 3: Material and preference system

**Files:**
- Modify: `src/styles/golden-gate.css`
- Modify: `src/styles/global.css`
- Modify: `src/styles/themes.css`
- Create: `src/hooks/useAccessibilityPreferences.ts`

1. Restrict Liquid Glass to title bars, toolbars, popovers, modal chrome, and transient controls.
2. Return cards, forms, logs, tables, and scientific content to opaque semantic surfaces.
3. Add strong-contrast, reduced-transparency, reduced-motion, and forced-colors fallbacks.
4. Restore selection and copying for scientific output, logs, paths, and editable content.

### Task 4: Modal and navigation accessibility

**Files:**
- Modify: `src/components/Modal.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/ThemePicker.tsx`

1. Give dialogs semantic roles, labelled titles, focus entry, focus trapping, Escape handling, and focus restoration.
2. Make route changes update the document title and announce the new workspace context.
3. Add selected state semantics to the theme picker.

### Task 5: Verification

**Files:**
- Test: existing build and lint commands

1. Run TypeScript/Vite build and ESLint.
2. Run Rust tests on the local target.
3. Exercise keyboard focus, modal trapping, system contrast styles, and responsive content in the local browser.
4. Review the final diff to ensure the sidebar is unchanged.
