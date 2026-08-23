FROM mcr.microsoft.com/devcontainers/base:ubuntu

ENV DEBIAN_FRONTEND=noninteractive

COPY requirements.txt /tmp/requirements.txt
COPY installs/ /tmp/installs/

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    software-properties-common \
    nginx \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN passwd -d vscode

ENV NVM_DIR=/home/vscode/.nvm \
    GOPATH=/home/vscode/.go \
    GOROOT=/usr/local/go \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:/usr/local/go/bin:/home/vscode/.go/bin:/usr/local/bin:/home/vscode/.nvm/versions/node/current/bin:$PATH

RUN bash /tmp/installs/golang.sh
RUN bash /tmp/installs/rust.sh
RUN bash /tmp/installs/python.sh
RUN bash /tmp/installs/nodejs.sh \
    && rm -rf /tmp/installs

RUN curl -fsSL -o /usr/local/bin/websocat https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl \
    && chmod a+x /usr/local/bin/websocat

RUN mkdir -p /var/run/sshd \
    && printf '%s\n' \
    'PasswordAuthentication yes' \
    'PermitEmptyPasswords yes' \
    > /etc/ssh/sshd_config.d/99-websocket.conf

COPY nginx.conf /etc/nginx/sites-available/default

USER vscode

EXPOSE 7860

COPY mcpserver.py /opt/aicode/mcpserver.py

CMD sudo service ssh start && sudo service nginx start && \
    PORT=8000 python3 /opt/aicode/mcpserver.py & \
    websocat -b --exit-on-eof ws-l:127.0.0.1:8001 tcp:127.0.0.1:22