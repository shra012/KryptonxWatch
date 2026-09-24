#!/usr/bin/env bash
# Run a command in the kryptonx/glm:dev container with the GPU, the repo at /workspace and
# /srv/kryptonx-data mounted. Runs as the calling user with group `workspace` so files
# written to /srv and the repo are not root-owned.
#
#   model/GLM-4.5-VL/env/glm/run.sh <name> python -u model/GLM-4.5-VL/src/glm_pilot.py --out model/GLM-4.5-VL/runs/glm45v/x
set -euo pipefail
name="$1"; shift
repo="$(cd "$(dirname "$0")/../../.." && pwd)"
gid="$(getent group workspace | cut -d: -f3)"
exec docker run --rm --name "$name" \
  --runtime=nvidia --gpus all --ipc=host --ulimit memlock=-1 --ulimit stack=67108864 \
  --user "$(id -u):${gid}" -e HOME=/tmp -e USER="$(id -un)" -e LOGNAME="$(id -un)" \
  -v /srv/kryptonx-data:/srv/kryptonx-data -v "${repo}":/workspace -w /workspace \
  kryptonx/glm:dev bash -c 'umask 002; exec "$@"' _ "$@"
