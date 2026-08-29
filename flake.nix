{
  description = "LUMEN devShell with flake-utils";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            curl
            git
            just
            nodejs_24
            pkg-config
          ];

          shellHook = ''
            echo "Enter LUMEN devShell: ${system}"
          '';
        };

        formatter = pkgs.nixpkgs-fmt;
      }
    );
}
