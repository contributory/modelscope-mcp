#!/usr/bin/env bash
set -euxo pipefail

GO_VERSION="$(curl -fsSL 'https://go.dev/VERSION?m=text' | sed -n '1p')"

curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-amd64.tar.gz" \
	| tar -C /usr/local -xz

mkdir -p /home/vscode/.go/{bin,src,pkg}
chown -R vscode:vscode /home/vscode/.go

# Keep Go available in SSH and non-login shells even if they reset PATH.
ln -sfn /usr/local/go/bin/go /usr/local/bin/go
ln -sfn /usr/local/go/bin/gofmt /usr/local/bin/gofmt

cat > /etc/profile.d/go.sh <<'EOF'
export GOROOT=/usr/local/go
export GOPATH="$HOME/.go"
export PATH="$GOROOT/bin:$GOPATH/bin:$PATH"
EOF
chmod 644 /etc/profile.d/go.sh
