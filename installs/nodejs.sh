#!/usr/bin/env bash
set -euxo pipefail

mkdir -p "$NVM_DIR"
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
nvm install node
nvm alias default node
ln -sfn "$NVM_DIR/versions/node/$(nvm version)" "$NVM_DIR/versions/node/current"

cat > /etc/profile.d/nvm.sh <<'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
EOF
chmod 644 /etc/profile.d/nvm.sh

cat >> /home/vscode/.bashrc <<'EOF'

# Load NVM for interactive SSH shells.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Keep the SSH prompt short by omitting the container hostname.
PS1="\[\e[1;32m\]\u\[\e[0m\]:\[\e[1;34m\]\w\[\e[0m\]\$ "
EOF

ln -sfn "$NVM_DIR/versions/node/current/bin/node" /usr/local/bin/node
ln -sfn "$NVM_DIR/versions/node/current/bin/npm" /usr/local/bin/npm
ln -sfn "$NVM_DIR/versions/node/current/bin/npx" /usr/local/bin/npx
chown -R vscode:vscode /home/vscode
