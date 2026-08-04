#!/usr/bin/env bash
set -Eeuo pipefail

readonly SERVICE_NAME="kiddo-programmer"
readonly MIN_NODE_MAJOR=20
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly TEMPLATE="$SCRIPT_DIR/packaging/kiddo-programmer.service.template"
readonly CONFIG_FILE="/etc/kiddo-programmer.env"
readonly SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"

fail() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

say() {
  printf '%s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "$2"
}

validate_path() {
  case "$2" in
    *[[:space:]]*|*'%'*|*'"'*) fail "$1 contains a character that the service installer cannot safely use." ;;
  esac
}

first_ip() {
  hostname -I 2>/dev/null | awk '{ print $1 }'
}

check_prerequisites() {
  require_command node "Node.js 20 or newer is required. See SETUP.md."
  require_command git "Git is required. Install it with: sudo apt install git"
  require_command codex "Codex CLI is required. Install it with: npm install --global @openai/codex"

  local node_major
  node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
  [[ "$node_major" =~ ^[0-9]+$ ]] || fail "Could not determine the Node.js version."
  (( node_major >= MIN_NODE_MAJOR )) || fail "Node.js 20 or newer is required; found $(node --version)."

  [[ -f "$SCRIPT_DIR/server.mjs" ]] || fail "Run this installer from a complete Kiddo Programmer checkout."
  [[ -f "$TEMPLATE" ]] || fail "The system service template is missing."

  if ! codex login status >/dev/null 2>&1; then
    fail "Codex is not signed in. Run 'codex login --device-auth' and then run this installer again."
  fi
}

print_check() {
  check_prerequisites
  local pi_ip
  pi_ip="$(first_ip || true)"
  say "Kiddo Programmer prerequisites look good."
  say "Node:  $(node --version) ($(command -v node))"
  say "Codex: $(codex --version 2>/dev/null | head -n 1) ($(command -v codex))"
  if [[ -n "$pi_ip" ]]; then
    say "Expected iPad address: http://$pi_ip:${PORT:-3000}"
  fi
}

render_service() {
  local rendered
  rendered="$(<"$TEMPLATE")"
  rendered="${rendered//@KIDDO_USER@/$install_user}"
  rendered="${rendered//@KIDDO_GROUP@/$install_group}"
  rendered="${rendered//@KIDDO_ROOT@/$SCRIPT_DIR}"
  rendered="${rendered//@KIDDO_CONFIG@/$CONFIG_FILE}"
  rendered="${rendered//@KIDDO_HOME@/$install_home}"
  rendered="${rendered//@KIDDO_BIN_PATH@/$bin_path}"
  rendered="${rendered//@KIDDO_CODEX_BIN@/$codex_bin}"
  rendered="${rendered//@KIDDO_NODE_BIN@/$node_bin}"
  rendered="${rendered//@KIDDO_PROJECTS_DIR@/$projects_dir}"
  rendered="${rendered//@KIDDO_CODEX_HOME@/$codex_home}"
  printf '%s\n' "$rendered"
}

write_default_config() {
  local temporary_config="$1"
  {
    printf '# Kiddo Programmer settings. Run sudo systemctl restart %s after editing.\n' "$SERVICE_NAME"
    printf 'PORT=3000\n'
    printf 'HOST=0.0.0.0\n'
    printf 'KIDDO_PROJECTS_DIR="%s"\n' "$projects_dir"
    printf 'CODEX_WORKER_MODEL=gpt-5.6-sol\n'
    printf 'CODEX_SUPERVISOR_MODEL=gpt-5.6-sol\n'
    printf 'CODEX_TIMEOUT_MS=240000\n'
    printf 'SUPERVISOR_TIMEOUT_MS=120000\n'
    printf 'MAX_SUPERVISOR_ROUNDS=6\n'
  } > "$temporary_config"
}

install_service() {
  (( EUID != 0 )) || fail "Run this installer as your normal Pi user, not with sudo. It will request sudo only when needed."
  require_command sudo "sudo is required to install the system service."
  require_command systemctl "This installer requires a Raspberry Pi OS or Debian system that uses systemd."
  check_prerequisites

  install_user="$(id -un)"
  install_group="$(id -gn)"
  install_home="${HOME:?HOME is not set}"
  node_bin="$(command -v node)"
  codex_bin="$(command -v codex)"
  codex_home="${CODEX_HOME:-$install_home/.codex}"
  projects_dir="${KIDDO_PROJECTS_DIR:-$install_home/kiddo_projects}"
  bin_path="$(dirname "$codex_bin"):$(dirname "$node_bin"):/usr/local/bin:/usr/bin:/bin"

  validate_path "The installation directory" "$SCRIPT_DIR"
  validate_path "The home directory" "$install_home"
  validate_path "The projects directory" "$projects_dir"
  validate_path "The Codex directory" "$codex_home"
  validate_path "The Node.js executable path" "$node_bin"
  validate_path "The Codex executable path" "$codex_bin"

  mkdir -p -- "$projects_dir"
  [[ -w "$projects_dir" ]] || fail "The projects directory is not writable: $projects_dir"
  [[ -r "$codex_home" ]] || fail "The Codex login directory is missing: $codex_home"

  local temporary_dir temporary_service temporary_config
  temporary_dir="$(mktemp -d)"
  trap "rm -rf -- '$temporary_dir'" EXIT
  temporary_service="$temporary_dir/$SERVICE_NAME.service"
  temporary_config="$temporary_dir/kiddo-programmer.env"
  render_service > "$temporary_service"

  if ! sudo test -f "$CONFIG_FILE"; then
    write_default_config "$temporary_config"
    sudo install -o root -g root -m 0644 "$temporary_config" "$CONFIG_FILE"
    say "Created settings: $CONFIG_FILE"
  else
    say "Kept existing settings: $CONFIG_FILE"
  fi

  sudo install -o root -g root -m 0644 "$temporary_service" "$SERVICE_FILE"
  sudo systemctl daemon-reload
  sudo systemctl enable --now "$SERVICE_NAME"
  sudo systemctl restart "$SERVICE_NAME"

  local configured_port pi_ip
  configured_port="$(sudo sed -nE 's/^PORT=([0-9]+)$/\1/p' "$CONFIG_FILE" | tail -n 1)"
  configured_port="${configured_port:-3000}"
  pi_ip="$(first_ip || true)"

  say ""
  say "Kiddo Programmer is installed and will start automatically with the Pi."
  if [[ -n "$pi_ip" ]]; then
    say "Open this on the iPad: http://$pi_ip:$configured_port"
  else
    say "Open http://<PI-IP>:$configured_port on the iPad."
  fi
  say "Check it:  sudo systemctl status $SERVICE_NAME"
  say "See logs: sudo journalctl -u $SERVICE_NAME -n 100"
}

case "${1:-install}" in
  install) install_service ;;
  --check|check) print_check ;;
  --help|-h|help)
    say "Usage: ./install.sh [install|--check|--help]"
    say ""
    say "  install  Install or update the system service (default)."
    say "  --check  Check Node, Git, Codex, sign-in, and show the expected URL."
    ;;
  *) fail "Unknown option: $1. Run ./install.sh --help." ;;
esac
