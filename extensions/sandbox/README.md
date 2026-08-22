# Pi Guardian

Fail-closed native command sandbox and explicit access policy for the Pi coding agent.
Guardian uses nono for OS sandboxing and network enforcement. On Linux it adds a
fixed Bubblewrap mount layer for deny-over-allow filesystem rules.

> **Alpha:** nono's upstream security policy says its guarantees are not stable
> and production use is not recommended before its 1.0 security work. Review the
> Guardian and nono threat models before relying on this package.

## Install

```sh
pi install npm:pi-extension-sandbox@3.0.0
```

The npm release supports:

- macOS on Apple Silicon;
- Linux x86-64 with unprivileged user namespaces enabled.

Guardian installs no lifecycle scripts and never resolves nono or Bubblewrap
through `PATH`. The main package selects an exact-version native npm package and
fails closed when that package or executable is unavailable.

For Nix installations, use the repository's flake package instead. It keeps the
same policy adapter while substituting fixed Nix-store executables.

## Policy and checks

See the [repository README](https://github.com/behzade/pi-guardian#readme) for
policy paths, rights, enforcement details, and development checks.
