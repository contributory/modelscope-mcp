#!/usr/bin/env bash
set -euxo pipefail

add-apt-repository ppa:deadsnakes/ppa -y
apt-get update

PYTHON_PACKAGE="$(
	apt-cache search '^python3\.[0-9]+$' \
		| awk '{print $1}' \
		| sort -Vr \
		| while read -r package; do
			candidate="$(apt-cache policy "$package" | awk '/Candidate:/ {print $2}')"
			if [[ "$candidate" != "(none)" ]] \
				&& ! grep -Eq '([0-9.~+:-])(a|b|rc)[0-9]' <<< "$candidate"; then
				printf '%s\n' "$package"
				break
			fi
		done
)"

test -n "$PYTHON_PACKAGE"
apt-get install -y --no-install-recommends \
	"$PYTHON_PACKAGE" \
	"${PYTHON_PACKAGE}-dev" \
	"${PYTHON_PACKAGE}-venv"
rm -rf /var/lib/apt/lists/*

curl -fsSL https://bootstrap.pypa.io/get-pip.py | "$PYTHON_PACKAGE" - --break-system-packages
"$PYTHON_PACKAGE" -m pip install \
	--no-cache-dir \
	--break-system-packages \
	-r /tmp/requirements.txt

rm -f /tmp/requirements.txt
ln -sfn "/usr/bin/$PYTHON_PACKAGE" /usr/local/bin/python
ln -sfn "/usr/bin/$PYTHON_PACKAGE" /usr/local/bin/python3
ln -sfn /usr/local/bin/pip /usr/local/bin/pip3
