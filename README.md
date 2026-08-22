# Guardian

Guardian is a Pi policy adapter backed by [nono](https://github.com/nolabs-ai/nono).
It keeps explicit project approvals and exact filesystem/network rights while
nono applies the OS sandbox:

- Linux: Landlock, nono's supervised network proxy, and a fixed Bubblewrap
  mount layer only for deny-over-allow rules Landlock cannot represent;
- macOS: Seatbelt and nono's supervised network proxy.

The previous custom broker and root filesystem scanner are no longer packaged
or used.

## Distribution

The flake package carries fixed Nix-store executables. npm releases use one
TypeScript package plus an exact-version native package for macOS ARM64 or Linux
x86-64; they have no install scripts and never resolve nono or Bubblewrap through
`PATH`. See [`packaging/npm`](packaging/npm/README.md) for the reviewed build and
release gate.

nono remains alpha upstream and its security policy does not recommend production
use before 1.0. Guardian npm releases must therefore use the `next` dist-tag while
that condition remains.

## Policy

Machine policy is read from `~/.config/guardian/sandbox.json`. The Pi adapter
uses the legacy `~/.pi/agent/extensions/sandbox.json` only when the neutral path
is absent. Portable, user-approved project rights are stored in:

```text
.guardian/sandbox.json
```

Rights approved only for one persisted Pi session are stored outside the
project and bound to both its session ID and exact session file:

```text
~/.config/guardian/session-rights/<session-id-hash>.json
```

They survive restart and resume, but are not inherited by new, forked, or
cloned sessions. Ephemeral Pi sessions keep session rights only in memory.
The user chooses session or project scope in the approval prompt. Absolute paths
outside the project and home directory are host-specific, so Guardian offers
only session scope for them; they are never written to checked-in project policy.

The adapter reads the legacy `.pi/extensions/sandbox/sandbox.json` only when the
new policy is absent; the next approved update writes `.guardian/sandbox.json`.

Project rights retain the version 1 schema:

- exact file or tree `read`/`write` rights;
- exact `network_host` rights;
- exact loopback `network_endpoint` host/port rights;
- managed development-cache environment mappings.

Each agent synchronizes the checked-in project policy and its bound session
policy before starting a command, then gives that command one immutable policy
snapshot. Policy changes never retry a command automatically. Guardian's
user-level `~/.config/guardian` control directory cannot be granted to
sandboxed commands; project-local `.guardian` remains the project policy root.

## Enforcement

Each foreground command and background job receives an ephemeral, strictly
generated nono profile extending nono's built-in `default` profile. Guardian
maps:

- read trees/files to nono read capabilities;
- write trees/files to nono read-write capabilities;
- exact hosts to nono proxy allow entries;
- each approved loopback `network_endpoint` to its exact nono `open_port` entry
  on Linux and macOS.

Linux Landlock is additive and cannot subtract `.env`, key, or control paths
from an allowed workspace. Guardian therefore expands only deny globs beneath
their static non-root directories and mounts existing denied paths inaccessible
or read-only before launching nono. It does not scan `/` or follow directory
symlinks. Nono still owns all grants and network enforcement.

The packaged extension uses fixed nono and Bubblewrap executables supplied by
Nix; it does not search `PATH` for either executable.

## Checks

```bash
npm run check --prefix extensions/sandbox
git diff --check
```

nono is currently alpha upstream. The flake's nixpkgs revision fixes the nono
version used by Guardian; update it only after reviewing upstream security and
release notes.
