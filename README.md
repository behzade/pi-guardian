# Guardian

Guardian is a Pi policy adapter backed by [nono](https://github.com/nolabs-ai/nono).
It keeps explicit project approvals and exact filesystem/network rights while
nono applies the OS sandbox:

- Linux: Landlock and nono's supervised network proxy;
- macOS: Seatbelt and nono's supervised network proxy.

The previous custom Bubblewrap/Seatbelt broker is no longer packaged or used.

## Policy

Machine policy is read from `~/.config/guardian/sandbox.json`. The Pi adapter
uses the legacy `~/.pi/agent/extensions/sandbox.json` only when the neutral path
is absent. Portable, user-approved project rights are stored in:

```text
.guardian/sandbox.json
```

The adapter reads the legacy `.pi/extensions/sandbox/sandbox.json` only when the
new policy is absent; the next approved update writes `.guardian/sandbox.json`.

Project rights retain the version 1 schema:

- exact file or tree `read`/`write` rights;
- exact `network_host` rights;
- `network_local`;
- managed development-cache environment mappings.

Commands receive one immutable policy snapshot. Policy changes never retry a
command automatically.

## Enforcement

Each foreground command and background job receives an ephemeral, strictly
generated nono profile extending nono's built-in `default` profile. Guardian
maps:

- read trees/files to nono read capabilities;
- write trees/files to nono read-write capabilities;
- exact hosts to nono proxy allow entries;
- Linux `network_local` to the localhost port range;
- macOS `network_local` to nono's port-zero support plus reviewed localhost
  Seatbelt rules.

The packaged extension uses the fixed nono executable supplied by Nix; it does
not search `PATH`.

## Checks

```bash
npm run check --prefix extensions/sandbox
git diff --check
```

nono is currently alpha upstream. The flake's nixpkgs revision fixes the nono
version used by Guardian; update it only after reviewing upstream security and
release notes.
