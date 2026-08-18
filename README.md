# Pi Guardian

Pi Guardian is one Pi extension that owns the complete command-security boundary:

- native Seatbelt (macOS) and Bubblewrap (Linux) command sandboxing;
- checked-in project filesystem, network, and development-cache policy;
- `request_access` approval UI and in-process parent-session routing;
- sandboxed background jobs and exact-host network proxying;
- bounded denial diagnostics with no automatic command retry.

The TypeScript extension lives in [`extensions/sandbox`](extensions/sandbox). The Rust broker and its protocol and threat model live in [`sandbox-broker`](sandbox-broker).

## Checks

The development shell must provide Node.js, Cargo, and the existing dependency caches. Do not create alternate dependency or target directories.

```bash
npm run check --prefix extensions/sandbox
cargo test --manifest-path sandbox-broker/Cargo.toml
git diff --check
```

The platform release tests require their native sandbox backend; see [`sandbox-broker/README.md`](sandbox-broker/README.md).

## Packaging

`packages.<system>.guardian` is the complete Pi extension, with its broker path substituted at build time. `packages.<system>.sandbox-broker` exposes the broker separately.

A consuming Pi configuration should install `guardian` as one extension. Approval transport is internal and must not be loaded as a separate package: parent and child sessions share its in-process registry through the single extension module.

## Policy

Global machine policy is read from `~/.pi/agent/extensions/sandbox.json`. Trusted projects can check portable policy into `.pi/extensions/sandbox/sandbox.json`. The extension fails closed when an interactive parent is unavailable for approval.
