#!/usr/bin/env python3
"""Find macOS build artifacts and write paths to GITHUB_OUTPUT."""
import os
import glob
import sys
import subprocess

# Debug: list the entire target directory tree (limited depth)
print("=== Full target tree (depth 4) ===")
try:
    result = subprocess.run(
        ["find", "src-tauri/target/aarch64-apple-darwin", "-maxdepth", "4", "-type", "f"],
        capture_output=True, text=True, timeout=30
    )
    print(result.stdout[:5000] if result.stdout else "(empty)")
    if result.stderr:
        print("STDERR:", result.stderr[:1000])
except Exception as e:
    print("find failed:", e)

# Also check without target-specific path
print("=== Check src-tauri/target (all) ===")
try:
    result = subprocess.run(
        ["find", "src-tauri/target", "-name", "*.dmg", "-o", "-name", "*.app.tar.gz", "-o", "-name", "*.app"],
        capture_output=True, text=True, timeout=30
    )
    print("Found:", result.stdout if result.stdout else "(nothing)")
except Exception as e:
    print("find failed:", e)

target_dir = "src-tauri/target/aarch64-apple-darwin/release"
bundle_dir = os.path.join(target_dir, "bundle")

# Find DMG - search broadly
dmg = ""
for pattern in [
    os.path.join(bundle_dir, "dmg", "*.dmg"),
    os.path.join(target_dir, "**", "*.dmg"),
]:
    for f in glob.glob(pattern, recursive=True):
        if os.path.isfile(f):
            dmg = f
            break
    if dmg:
        break

# Also try without target-specific dir
if not dmg:
    for f in glob.glob("src-tauri/target/**/bundle/dmg/*.dmg", recursive=True):
        if os.path.isfile(f):
            dmg = f
            break

# Find updater tarball
updater_tgz = ""
for pattern in [
    os.path.join(target_dir, "*.app.tar.gz"),
    os.path.join(target_dir, "**", "*.app.tar.gz"),
]:
    for f in glob.glob(pattern, recursive=True):
        if os.path.isfile(f):
            updater_tgz = f
            break
    if updater_tgz:
        break

# Also try without target-specific dir
if not updater_tgz:
    for f in glob.glob("src-tauri/target/**/*.app.tar.gz", recursive=True):
        if os.path.isfile(f):
            updater_tgz = f
            break

# Find signature
updater_sig = ""
if updater_tgz and os.path.isfile(updater_tgz + ".sig"):
    updater_sig = updater_tgz + ".sig"

# Write to GITHUB_OUTPUT
out = os.environ.get("GITHUB_OUTPUT", "/dev/null")
with open(out, "a") as fh:
    fh.write("dmg_path={}\n".format(dmg))
    fh.write("updater_tgz={}\n".format(updater_tgz))
    fh.write("updater_sig={}\n".format(updater_sig))

print("DMG:", dmg)
print("Updater TGZ:", updater_tgz)
print("Updater SIG:", updater_sig)

# Don't fail - let upload-artifact handle missing files with if-no-files-found: warn
# This way the release job can still proceed with Windows assets even if macOS artifacts are missing

