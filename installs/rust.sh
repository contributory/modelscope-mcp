#!/usr/bin/env bash
set -euxo pipefail

curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
	| sh -s -- -y --no-modify-path --default-toolchain stable

chown -R vscode:vscode "$RUSTUP_HOME" "$CARGO_HOME"

# Expose Rust tools independently from shell startup-file behavior.
for tool in cargo rustc rustdoc rustfmt rustup clippy-driver cargo-clippy; do
	if [[ -e "$CARGO_HOME/bin/$tool" ]]; then
		ln -sfn "$CARGO_HOME/bin/$tool" "/usr/local/bin/$tool"
	fi
done

cat > /etc/profile.d/rust.sh <<'EOF'
export RUSTUP_HOME=/usr/local/rustup
export CARGO_HOME=/usr/local/cargo
export PATH="$CARGO_HOME/bin:$PATH"
EOF
chmod 644 /etc/profile.d/rust.sh
