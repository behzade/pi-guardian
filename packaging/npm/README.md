# npm release packaging

Guardian publishes one TypeScript package plus fixed native packages. The source
package remains private to prevent publishing without its native dependencies;
`build-packages.mjs main` creates the publishable manifest.

Supported targets:

| Package | Native contents |
| --- | --- |
| `pi-extension-sandbox-darwin-arm64` | nono 0.61.1 |
| `pi-extension-sandbox-linux-x64` | nono 0.61.1, static non-setuid Bubblewrap 0.11.2 |

The build accepts only explicit absolute input paths. It checks executable
versions and architectures, rejects symlinks and Nix-store references, and
requires Linux Bubblewrap to have no dynamic-loader reference. It never searches
`PATH` for a runtime executable.

## Stage packages

```sh
node packaging/npm/build-packages.mjs main --out "$PWD/dist/npm"

node packaging/npm/build-packages.mjs native \
  --platform darwin --arch arm64 \
  --out "$PWD/dist/npm" \
  --nono /absolute/path/to/nono \
  --nono-license /absolute/path/to/nono-LICENSE

node packaging/npm/build-packages.mjs native \
  --platform linux --arch x64 \
  --out "$PWD/dist/npm" \
  --nono /absolute/path/to/nono \
  --nono-license /absolute/path/to/nono-LICENSE \
  --bwrap /absolute/path/to/static-bwrap \
  --bwrap-license /absolute/path/to/bubblewrap-COPYING
```

The nono inputs must come from the official v0.61.1 release artifacts pinned by
Guardian's nixpkgs revision. Bubblewrap must be built from the official v0.11.2
source archive with setuid and SELinux disabled and static linking enabled.
Review upstream security and release notes before changing either version.

Pack both native packages first and the main package last. Test installation with
`npm install --ignore-scripts` and publish initially with the `next` dist-tag.
Publishing is deliberately not automated: reserve all three npm names and review
the generated package manifests, checksums, licenses, and platform test results
before running `npm publish`.
