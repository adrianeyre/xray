# The sandbox image an agent runs inside.
#
# Four things Sandcastle needs and this file must keep: a non-root `agent` user
# (Claude Code refuses to run as root), `git` for the commits, `gh` for the
# issues, and `claude` on PATH. Two more are Xray's own: pnpm for the
# TypeScript workspace and the .NET SDK for the engine and the Fixtures.
#
# Node is pinned to the exact version the PRD pins (docs/product-requirements-document/xray.md §8).
# `engines` is a warning rather than a wall, so a sandbox on an older Node
# installs happily and then fails somewhere further in. If that pin moves,
# move this one with it.
FROM node:26.10.0-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  curl \
  jq \
  ca-certificates \
  libicu-dev \
  && rm -rf /var/lib/apt/lists/*

# GitHub CLI — the agent reads the issue it is working and comments on it.
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
  | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# pnpm, at the version the workspace pins. Node stopped shipping corepack as of
# 25, so pnpm is installed directly; `devEngines.packageManager` in package.json
# remains the source of truth and pnpm self-downloads that version if they drift.
RUN npm install -g pnpm@12.10.0

# .NET SDK — the engine sidecar (ADR 0001), `dotnet build` verification and the
# Fixtures all need it. The PRD requires 8+; 8.0 is the floor we test against.
ENV DOTNET_ROOT=/usr/share/dotnet \
  DOTNET_CLI_TELEMETRY_OPTOUT=1 \
  DOTNET_NOLOGO=1
RUN curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh \
  && bash /tmp/dotnet-install.sh --channel 8.0 --install-dir "$DOTNET_ROOT" \
  && ln -s "$DOTNET_ROOT/dotnet" /usr/local/bin/dotnet \
  && rm /tmp/dotnet-install.sh

# UID/GID alignment. `sandcastle docker build-image` defaults these to the host
# user's, so files the image writes and files the bind mount writes share an
# owner and no runtime chown is needed. A mismatch here is the cause of
# "permission denied" on a file the agent just created.
ARG AGENT_UID=1000
ARG AGENT_GID=1000

# Rename the base image's `node` user to `agent` and align its UID/GID.
RUN groupmod -o -g $AGENT_GID node \
  && usermod -o -u $AGENT_UID -g $AGENT_GID -d /home/agent -m -l agent node
USER ${AGENT_UID}:${AGENT_GID}

RUN curl -fsSL https://claude.ai/install.sh | bash
ENV PATH="/home/agent/.local/bin:/home/agent/.dotnet/tools:$PATH"

# Sandcastle bind-mounts the git worktree here and makes it the working
# directory at container start, so this has to be able to serve as the
# project root.
WORKDIR /home/agent/workspace

ENTRYPOINT ["sleep", "infinity"]
