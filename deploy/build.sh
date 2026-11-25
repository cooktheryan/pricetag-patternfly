#!/usr/bin/env bash
# Build the PriceTag UI image for the cluster (linux/amd64 by default).
set -euo pipefail

IMAGE=${IMAGE:-quay.io/redhat-et/patternfly:pricetag-ui}
PLATFORM=${PLATFORM:-linux/amd64}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

cd "$ROOT"
podman build --platform "$PLATFORM" -f "$ROOT/Containerfile" -t "$IMAGE" .
echo
echo "Built $IMAGE"
echo "Push with: podman push $IMAGE"
