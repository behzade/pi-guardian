# Agent Instructions

Keep the guardian extension and native broker as one security boundary. Preserve fail-closed behavior, explicit approval, exact policy validation, and no automatic retry.

The project shell is already active. Do not run Nix commands unless the user asks for that exact check. Use Cargo directly and preserve the supplied shared `CARGO_TARGET_DIR`. Never create alternate dependency folders, Nix caches, or Rust target directories.

Run the narrowest relevant check first. For extension changes use `npm run check --prefix extensions/sandbox`. For broker changes use `cargo test --manifest-path sandbox-broker/Cargo.toml`. Always run `git diff --check`.
