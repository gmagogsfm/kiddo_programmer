#!/usr/bin/env bash
set -Eeuo pipefail

readonly SERVICE_NAME="kiddo-programmer"
readonly MIN_NODE_MAJOR=20
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly TEMPLATE="$SCRIPT_DIR/packaging/kiddo-programmer.service.template"
readonly CONFIG_FILE="/etc/kiddo-programmer.env"
readonly TOKEN_FILE="/etc/kiddo-programmer-token.env"
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
  require_command node "Node.js 20 or newer is required. See the Raspberry Pi setup section in README.md."
  require_command git "Git is required. Install it with: sudo apt install git"

  local node_major
  node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
  [[ "$node_major" =~ ^[0-9]+$ ]] || fail "Could not determine the Node.js version."
  (( node_major >= MIN_NODE_MAJOR )) || fail "Node.js 20 or newer is required; found $(node --version)."

  [[ -f "$SCRIPT_DIR/server.mjs" ]] || fail "Run this installer from a complete Kiddo Programmer checkout."
  [[ -f "$TEMPLATE" ]] || fail "The system service template is missing."
}

choose_agent() {
  local choice
  say "Choose the coding agent that will build and review children's projects:"
  say "  1) OpenAI Codex (supported)"
  say ""

  if [[ -n "${KIDDO_AGENT:-}" ]]; then
    choice="$KIDDO_AGENT"
    say "Using coding agent from KIDDO_AGENT: $choice"
  elif [[ -t 0 ]]; then
    read -r -p "Coding agent [1]: " choice
    choice="${choice:-1}"
  else
    choice="1"
    say "No interactive terminal detected; selecting OpenAI Codex."
  fi

  case "${choice,,}" in
    1|codex|openai-codex) selected_agent="codex" ;;
    *) fail "That coding agent is not supported yet. Choose 1 for OpenAI Codex." ;;
  esac
}

confirm_provider_data_use() {
  say ""
  say "Privacy notice for the grown-up:"
  say "  A child's current request, age, and recent conversation context are sent"
  say "  to the selected AI provider so it can build and review the app."
  say "  Full project and conversation files remain stored on this Raspberry Pi."
  if [[ "${KIDDO_ACCEPT_PROVIDER_DATA:-}" == "1" ]]; then
    say "Provider data use accepted through KIDDO_ACCEPT_PROVIDER_DATA=1."
    return
  fi
  [[ -t 0 ]] || fail "A grown-up must accept the provider data notice. Run setup interactively, or set KIDDO_ACCEPT_PROVIDER_DATA=1 after reviewing README.md."
  local answer
  read -r -p "Continue with the selected AI provider? [y/N] " answer
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]] || fail "Setup stopped without consent."
}

ensure_agent_ready() {
  case "$selected_agent" in
    codex)
      require_command codex "Codex CLI is required. The npm package includes it; source installs can run: npm install --global @openai/codex"
      if codex login status >/dev/null 2>&1; then
        say "OpenAI Codex is already signed in."
        return
      fi

      [[ -t 0 ]] || fail "Codex needs an interactive sign-in. Run 'kiddo-programmer setup' in a terminal."
      say ""
      say "Codex needs a grown-up to sign in."
      say "A code and web address will appear. Complete those instructions on any device."
      say ""
      codex login --device-auth || fail "Codex sign-in did not finish. You can run setup again to retry."
      codex login status >/dev/null 2>&1 || fail "Codex did not report a completed sign-in. Run setup again to retry."
      say "OpenAI Codex sign-in is complete."
      ;;
    *) fail "No setup adapter exists for coding agent: $selected_agent" ;;
  esac
}

check_agent() {
  require_command codex "Codex CLI is required. The npm package includes it; source installs can run: npm install --global @openai/codex"

  if ! codex login status >/dev/null 2>&1; then
    fail "Codex is not signed in. Run 'kiddo-programmer setup' to complete the guided sign-in."
  fi
}

print_check() {
  check_prerequisites
  check_agent
  local pi_ip
  pi_ip="$(first_ip || true)"
  say "Kiddo Programmer prerequisites look good."
  say "Node:  $(node --version) ($(command -v node))"
  say "Codex: $(codex --version 2>/dev/null | head -n 1) ($(command -v codex))"
  if [[ -n "$pi_ip" ]]; then
    say "Expected iPad address: http://$pi_ip:${PORT:-3000}"
  fi
}

print_pairing() {
  require_command sudo "sudo is required to read the private pairing secret."
  local pairing_token configured_port pi_ip
  pairing_token="$(sudo sed -nE 's/^KIDDO_PAIRING_TOKEN=([A-Za-z0-9_-]+)$/\1/p' "$TOKEN_FILE" | tail -n 1)"
  [[ -n "$pairing_token" ]] || fail "No pairing secret was found. Run 'kiddo-programmer setup' first."
  configured_port="$(sudo sed -nE 's/^PORT=([0-9]+)$/\1/p' "$CONFIG_FILE" | tail -n 1)"
  configured_port="${configured_port:-3000}"
  pi_ip="$(first_ip || true)"
  [[ -n "$pi_ip" ]] || fail "Could not find the Pi's network address."
  say "A grown-up should open this once on each approved iPad:"
  say "http://$pi_ip:$configured_port/pair?token=$pairing_token"
  say "Keep this link private."
}

render_service() {
  local rendered
  rendered="$(<"$TEMPLATE")"
  rendered="${rendered//@KIDDO_USER@/$install_user}"
  rendered="${rendered//@KIDDO_GROUP@/$install_group}"
  rendered="${rendered//@KIDDO_ROOT@/$SCRIPT_DIR}"
  rendered="${rendered//@KIDDO_CONFIG@/$CONFIG_FILE}"
  rendered="${rendered//@KIDDO_TOKEN_FILE@/$TOKEN_FILE}"
  rendered="${rendered//@KIDDO_AGENT@/$selected_agent}"
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
    printf 'KIDDO_AGENT=%s\n' "$selected_agent"
    printf 'CODEX_WORKER_MODEL=gpt-5.6-sol\n'
    printf 'CODEX_SUPERVISOR_MODEL=gpt-5.6-sol\n'
    printf 'CODEX_TIMEOUT_MS=240000\n'
    printf 'SUPERVISOR_TIMEOUT_MS=120000\n'
    printf 'MAX_SUPERVISOR_ROUNDS=6\n'
  } > "$temporary_config"
}

write_pairing_token() {
  local temporary_token="$1"
  pairing_token="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"
  printf 'KIDDO_PAIRING_TOKEN=%s\n' "$pairing_token" > "$temporary_token"
  sudo install -o root -g root -m 0600 "$temporary_token" "$TOKEN_FILE"
}

install_service() {
  (( EUID != 0 )) || fail "Run this installer as your normal Pi user, not with sudo. It will request sudo only when needed."
  require_command sudo "sudo is required to install the system service."
  require_command systemctl "This installer requires a Raspberry Pi OS or Debian system that uses systemd."
  check_prerequisites
  choose_agent
  confirm_provider_data_use
  ensure_agent_ready

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

  local temporary_dir temporary_service temporary_config temporary_token pairing_token
  temporary_dir="$(mktemp -d)"
  trap "rm -rf -- '$temporary_dir'" EXIT
  temporary_service="$temporary_dir/$SERVICE_NAME.service"
  temporary_config="$temporary_dir/kiddo-programmer.env"
  temporary_token="$temporary_dir/kiddo-programmer-token.env"
  render_service > "$temporary_service"

  if ! sudo test -f "$CONFIG_FILE"; then
    write_default_config "$temporary_config"
    sudo install -o root -g root -m 0600 "$temporary_config" "$CONFIG_FILE"
    say "Created settings: $CONFIG_FILE"
  else
    say "Kept existing settings: $CONFIG_FILE"
    sudo chmod 0600 "$CONFIG_FILE"
  fi

  if ! sudo test -f "$TOKEN_FILE"; then
    write_pairing_token "$temporary_token"
    say "Created private iPad pairing secret."
  else
    pairing_token="$(sudo sed -nE 's/^KIDDO_PAIRING_TOKEN=([A-Za-z0-9_-]+)$/\1/p' "$TOKEN_FILE" | tail -n 1)"
    [[ -n "$pairing_token" ]] || fail "The pairing secret is invalid: $TOKEN_FILE"
    sudo chmod 0600 "$TOKEN_FILE"
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
  if [[ "${KIDDO_HIDE_PAIRING_TOKEN:-}" == "1" ]]; then
    say "Run 'kiddo-programmer pair' locally to print the private iPad pairing link."
  elif [[ -n "$pi_ip" ]]; then
    say "A grown-up should open this once on each iPad:"
    say "http://$pi_ip:$configured_port/pair?token=$pairing_token"
  else
    say "Open http://<PI-IP>:$configured_port on the iPad."
  fi
  say "Check it:  sudo systemctl status $SERVICE_NAME"
  say "See logs: sudo journalctl -u $SERVICE_NAME -n 100"
}

case "${1:-install}" in
  install) install_service ;;
  --check|check) print_check ;;
  pair|--pair) print_pairing ;;
  --help|-h|help)
    say "Usage: ./install.sh [install|--check|--pair|--help]"
    say ""
    say "  install  Install or update the system service (default)."
    say "  --check  Check Node, Git, Codex, sign-in, and show the expected URL."
    say "  --pair   Print the private iPad pairing link for a grown-up."
    ;;
  *) fail "Unknown option: $1. Run ./install.sh --help." ;;
esac
