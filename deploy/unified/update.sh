#!/usr/bin/env bash
set -euo pipefail
YHT_PACKAGE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
exec python3 "$YHT_PACKAGE_DIR/update.py" "$@"
