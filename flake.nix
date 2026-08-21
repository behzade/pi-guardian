{
  description = "Pi Guardian native sandbox, approval transport, and background-job extension";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { nixpkgs, self, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          mcpCli = pkgs.callPackage ./nix/pi-mcp-cli.nix { };
          guardian = pkgs.callPackage ./nix/pi-sandbox-extension.nix {
            inherit mcpCli;
            nono = pkgs.nono;
            bubblewrap = if pkgs.stdenv.hostPlatform.isLinux then pkgs.bubblewrap else null;
          };
        in
        {
          inherit guardian;
          default = guardian;
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          mcpCli = pkgs.callPackage ./nix/pi-mcp-cli.nix { };
          piCodingAgent = pkgs.runCommand "pi-coding-agent-test-fixture" { } ''
            mkdir -p "$out"
          '';
          guardianWithPi = pkgs.callPackage ./nix/pi-sandbox-extension.nix {
            inherit mcpCli piCodingAgent;
            nono = pkgs.nono;
            bubblewrap = if pkgs.stdenv.hostPlatform.isLinux then pkgs.bubblewrap else null;
          };
        in
        {
          guardian = self.packages.${system}.guardian;
          guardian-peer-wiring = pkgs.runCommand "pi-guardian-peer-wiring-test" { } ''
            test "$(readlink ${guardianWithPi}/node_modules/@earendil-works/pi-coding-agent)" = ${piCodingAgent}
            touch "$out"
          '';
        }
      );
    };
}
