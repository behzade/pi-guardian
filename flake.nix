{
  description = "Pi Guardian native sandbox, approval transport, and background-job extension";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs = { nixpkgs, ... }:
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
          };
        in
        {
          inherit guardian;
          default = guardian;
        }
      );
    };
}
