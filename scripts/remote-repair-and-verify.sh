#!/usr/bin/env bash
set -euo pipefail

# Production-only operator workflow. It deliberately refuses a dirty checkout,
# non-generated deployment config, and any Worker URL other than the approved
# Practice Ready backend. Backups and local audit state stay ignored by Git.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
cd "${project_root}"

worker_name="practice-ready-backend"
production_url="https://practice-ready-backend.connect-fb5.workers.dev"
deploy_config="dist/server/wrangler.deploy.json"
backup_file="${BACKUP_FILE:-.wrangler/predeploy-backup.sql}"
audit_state="${AUDIT_STATE:-.wrangler/predeploy-audit}"

usage() {
  cat <<'EOF'
Usage: scripts/remote-repair-and-verify.sh

Required operator environment:
  SEED_TOKEN       Only needed when SEED_CATALOG=1.
  SEED_CATALOG=1   Seed the checked-in catalog after deployment.

The script builds no alternate Worker and never accepts a target URL override.
It exports a private D1 backup, rehearses checked-in migrations locally, applies
only those migrations remotely, deploys the generated Worker config, and runs
basic same-origin API/SSR checks against the approved production URL.
EOF
}

require_file() {
  [[ -f "$1" ]] || { echo "Missing required file: $1" >&2; exit 69; }
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 69; }
}

if [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

require_command git
require_command curl
node_bin="$(command -v node || command -v node.exe || true)"
[[ -n "${node_bin}" ]] || { echo "Missing required command: node" >&2; exit 69; }
wrangler=("${node_bin}" node_modules/wrangler/bin/wrangler.js)
require_file "package.json"
require_file "wrangler.json"
require_file "drizzle/meta/_journal.json"
require_file "node_modules/wrangler/bin/wrangler.js"
require_file "dist/server/wrangler.json"

echo "Remote target: ${worker_name} (${production_url})"
git -c core.autocrlf=true status --short --branch
git -c core.autocrlf=true diff --stat
git -c core.autocrlf=true diff --check
if [[ -n "$(git -c core.autocrlf=true status --short)" ]]; then
  echo "Refusing remote operations with a dirty checkout; commit or stash reviewed changes first." >&2
  exit 2
fi

"${node_bin}" scripts/prepare-deploy.mjs
require_file "${deploy_config}"
grep -q '"name": "practice-ready-backend"' "${deploy_config}" || {
  echo "Generated deployment config has the wrong Worker name." >&2
  exit 2
}
grep -q '"migrations_dir": "../../drizzle"' "${deploy_config}" || {
  echo "Generated deployment config does not resolve migrations from repository drizzle/." >&2
  exit 2
}

mkdir -p "$(dirname "${backup_file}")" "${audit_state}"
rm -f "${backup_file}"
rm -rf "${audit_state}"
mkdir -p "${audit_state}"

echo "Creating private remote D1 export..."
"${wrangler[@]}" d1 export DB --remote --config "${deploy_config}" --output "${backup_file}" >/dev/null
[[ -s "${backup_file}" ]] || { echo "D1 export was empty; refusing to continue." >&2; exit 2; }

echo "Rehearsing the exported schema/data against checked-in migrations..."
"${node_bin}" scripts/rehearse-d1-backup.mjs --backup "${backup_file}" --persist-to "${audit_state}"

echo "Checking the remote migration ledger..."
"${wrangler[@]}" d1 migrations list DB --remote --config "${deploy_config}"

echo "Applying only checked-in migrations..."
"${wrangler[@]}" d1 migrations apply DB --remote --config "${deploy_config}"
"${wrangler[@]}" d1 migrations list DB --remote --config "${deploy_config}"

echo "Deploying ${worker_name} from generated Worker artifacts..."
"${wrangler[@]}" deploy --config "${deploy_config}" >/dev/null

if [[ "${SEED_CATALOG:-0}" == "1" ]]; then
  [[ -n "${SEED_TOKEN:-}" ]] || { echo "SEED_CATALOG=1 requires SEED_TOKEN in the environment." >&2; exit 2; }
  echo "Seeding the checked-in catalog..."
  curl --fail --silent --show-error --output /dev/null \
    -X POST "${production_url}/api/seed" \
    -H "Authorization: Bearer ${SEED_TOKEN}"
fi

echo "Running approved production SSR/API smoke checks..."
home_file="$(mktemp)"
rooms_file="$(mktemp)"
trap 'rm -f "${home_file}" "${rooms_file}"' EXIT
curl --fail --silent --show-error "${production_url}/" -o "${home_file}"
grep -Eq "Welcome back|Loading Practice Ready" "${home_file}" || {
  echo "Production home did not contain the original Asmi account shell." >&2
  exit 1
}
curl --fail --silent --show-error "${production_url}/api/rooms" -o "${rooms_file}"
grep -q '"rooms"' "${rooms_file}" || { echo "Production rooms response was incomplete." >&2; exit 1; }
"${node_bin}" scripts/verify-production.mjs
echo "Approved production SSR/API smoke checks passed for ${production_url}."
