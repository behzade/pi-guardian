{
  bubblewrap ? null,
  importNpmLock,
  lib,
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
    for sourceFile in *.ts; do
      case "$sourceFile" in
        *.test.ts | test-setup.ts) continue ;;
      esac
      cp "$sourceFile" "$out/"
    done
    cp package.json package-lock.json $out/
    cp -R ${nodeModules}/node_modules "$out/"
    chmod -R u+w "$out/node_modules"
    substituteInPlace $out/index.ts \
      --replace-fail '@NONO@' '${nono}' \
      --replace-fail '@BWRAP@' '${if bubblewrap == null then "" else lib.getExe bubblewrap}'
    runHook postInstall
  '';

  meta = {
    description = "Pi sandbox policy adapter backed by nono";
    license = lib.licenses.mit;
    platforms = lib.platforms.darwin ++ lib.platforms.linux;
  };
}
