#!/usr/bin/env bash
# Stops the Hermes watch agent. Its state stays in HERMES_HOME (default ~/.hermes-kryptonx);
# delete that folder too to remove it completely.
set -euo pipefail
if docker info >/dev/null 2>&1; then docker rm -f kryptonx-hermes; else sg docker -c 'docker rm -f kryptonx-hermes'; fi
