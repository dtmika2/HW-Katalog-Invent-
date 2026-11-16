#!/usr/bin/env bash
# Quality gate: stops at the first failure.
set -e
npm run typecheck >/dev/null
npm test >/dev/null
npm run lint >/dev/null
npm run build >/dev/null
echo "GATE OK"
