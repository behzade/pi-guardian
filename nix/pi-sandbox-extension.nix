{
  bubblewrap ? null,
  importNpmLock,
  lib,
  mcpCli,
  nodejs,
  nono,
  stdenvNoCC,
}:

let
  source = ../extensions/sandbox;
  nodeModules = importNpmLock.buildNodeModules {
    npmRoot = source;
    inherit nodejs;
  };
in
stdenvNoCC.mkDerivation {
  pname = "pi-sandbox-extension";
  version = "3.0.0";

  src = source;

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp background-jobs.ts sandbox-protocol.ts sandbox-policy.ts denial-summary.ts index.ts linux-deny-layer.ts native-background-jobs.ts network-policy.ts sandbox-config.ts development-caches.ts io-permissions.ts io-policy.ts native-sandbox-ops.ts nono-client.ts approval-transport.ts project-policy-store.ts project-policy.ts tool-schemas.ts package.json package-lock.json $out/
    cp -R ${nodeModules}/node_modules "$out/"
    substituteInPlace $out/index.ts \
      --replace-fail '@NONO@' '${nono}' \
      --replace-fail '@BWRAP@' '${if bubblewrap == null then "" else lib.getExe bubblewrap}'
    substituteInPlace $out/sandbox-config.ts \
      --replace-fail '@PI_MCP_CLI@' '${mcpCli}/bin/mcp-cli'
    runHook postInstall
  '';

  meta = {
    description = "Pi sandbox policy adapter backed by nono";
    license = lib.licenses.mit;
    platforms = lib.platforms.darwin ++ lib.platforms.linux;
  };
}
