#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const bundledBin = path.join(packageRoot, "node_modules", ".bin");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    stdio: "inherit",
    env: { ...process.env, PATH: `${bundledBin}:${process.env.PATH || ""}` }
  });
  if (result.error) {
    console.error(`Could not start ${command}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function help() {
  console.log(`Kiddo Programmer ${packageJson.version}

Usage: kiddo-programmer <command>

Commands:
  setup     Check prerequisites and install or update the Raspberry Pi service
  check     Check Node, Git, Codex sign-in, and show the expected iPad URL
  start     Run the server in this terminal (development use)
  status    Show whether the installed service is running
  logs      Show recent messages from the installed service
  help      Show this help

First Raspberry Pi setup:
  codex login --device-auth
  kiddo-programmer setup`);
}

const [command = "help"] = process.argv.slice(2);

switch (command) {
  case "setup":
    if (process.platform !== "linux") {
      console.error("Automatic service setup currently supports Raspberry Pi OS and other systemd-based Linux systems.");
      process.exit(1);
    }
    run("bash", [path.join(packageRoot, "install.sh")]);
    break;
  case "check":
    run("bash", [path.join(packageRoot, "install.sh"), "--check"]);
    break;
  case "start":
    run(process.execPath, [path.join(packageRoot, "server.mjs")]);
    break;
  case "status":
    run("systemctl", ["status", "kiddo-programmer"]);
    break;
  case "logs":
    run("sudo", ["journalctl", "-u", "kiddo-programmer", "-n", "100"]);
    break;
  case "--version":
  case "-v":
  case "version":
    console.log(packageJson.version);
    break;
  case "--help":
  case "-h":
  case "help":
    help();
    break;
  default:
    console.error(`Unknown command: ${command}\n`);
    help();
    process.exit(1);
}
