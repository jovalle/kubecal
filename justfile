set shell := ["bash", "-euo", "pipefail", "-c"]

host := "127.0.0.1"
port := "5465"

default:
    @just --list

# Install npm dependencies and the pre-commit hook when missing or stale
deps:
    @if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then npm ci; fi
    @if [ ! -f .git/hooks/pre-commit ]; then pre-commit install; fi

# Start the Vite live-reload server and open it in a Chromium browser
dev: deps (_serve "")

# Cache remote images and use the local slide proxy (slide previews need internet)
local: deps
    #!/usr/bin/env bash
    set -euo pipefail
    for port in {{port}} 5466; do
      if nc -z {{host}} "$port" 2>/dev/null; then
        echo "Port $port is already in use. Stop the existing server before running just local." >&2
        exit 1
      fi
    done
    python3 scripts/offline.py
    node proxy/server.mjs &
    proxy=$!
    trap 'kill $proxy 2>/dev/null || true' EXIT INT TERM
    just _serve "--config vite.offline.config.mjs"

_serve config:
    #!/usr/bin/env bash
    set -euo pipefail
    url="http://{{host}}:{{port}}/"
    ./node_modules/.bin/vite {{config}} --host {{host}} --port {{port}} --strictPort &
    server=$!
    trap 'kill $server 2>/dev/null' EXIT INT TERM
    until curl -sf -o /dev/null "$url"; do
      kill -0 $server 2>/dev/null || exit 1
      sleep 0.2
    done
    opened=0
    for app in "Helium" "Brave Browser" "Microsoft Edge" "Google Chrome"; do
      if open -Ra "$app" 2>/dev/null; then
        open -a "$app" "$url" && opened=1 && break
      fi
    done
    [ $opened -eq 1 ] || echo "No Chromium browser found; open $url manually"
    wait $server

# Rewrite files with Prettier and Ruff
format: deps
    npx prettier --write --log-level warn .
    uvx ruff format scripts

# Check formatting and lint JavaScript and Python
lint: deps
    npx prettier --check --log-level warn .
    npx eslint .
    uvx ruff format --check scripts
    uvx ruff check scripts

# Run the unit tests
test:
    npm test --silent

# Run lint and tests (the pre-commit hook runs this)
check: lint test

# Copy the static site into dist/
build:
    npm run build --silent
