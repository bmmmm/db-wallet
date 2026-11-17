#!/usr/bin/env node
// Upgrade check: what happens between a published release and HEAD (or a
// directory) on old and new devices/tabs — storage, QR/link, JSON backup,
// order, the first start after a deploy, the update notice.
//
//   node scripts/upgrade-check.js <alter-ref> [--new-root <dir>]
//
// Unpacks <alter-ref> with `git archive | tar -x` into a temp directory, runs
// scripts/scenarios-upgrade.js against it and prints a Markdown table.
// Exit: 1 if a scenario loses data (DATENVERLUST), 2 on a usage error (no
// ref, unknown ref), else 0. Only Node built-ins; see docs/upgrade-compat.md.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO = path.join(__dirname, "..");
const USAGE = "Aufruf: node scripts/upgrade-check.js <alter-ref> [--new-root <dir>]";

function fail(msg) {
  process.stderr.write(msg + "\n" + USAGE + "\n");
  process.exit(2);
}

function parseArgs(argv) {
  let ref = "";
  let newRoot = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--new-root") {
      newRoot = argv[++i] || "";
      if (!newRoot) fail("--new-root braucht ein Verzeichnis.");
    } else if (a === "-h" || a === "--help") {
      process.stdout.write(USAGE + "\n");
      process.exit(0);
    } else if (a.startsWith("-")) {
      fail(`Unbekannte Option: ${a}`);
    } else if (!ref) {
      ref = a;
    } else {
      fail(`Zu viele Argumente: ${a}`);
    }
  }
  return { ref, newRoot };
}

const git = (args, opts = {}) =>
  execFileSync("git", args, { cwd: REPO, stdio: ["ignore", "pipe", "pipe"], ...opts });

function resolveRef(ref) {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).toString().trim();
  } catch (e) {
    return "";
  }
}

const shortSha = (sha) => git(["rev-parse", "--short", sha]).toString().trim();

const cell = (v) => String(v == null ? "" : v).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

async function main() {
  const { ref, newRoot: newRootArg } = parseArgs(process.argv.slice(2));
  if (!ref) fail("Kein Ref angegeben.");
  const sha = resolveRef(ref);
  if (!sha) fail(`Unbekannter Ref: ${ref}`);
  let newRoot = REPO;
  let newLabel = "";
  if (newRootArg) {
    newRoot = path.resolve(newRootArg);
    if (!fs.existsSync(path.join(newRoot, "wallet.html"))) fail(`Kein App-Verzeichnis: ${newRootArg}`);
    newLabel = newRoot;
  } else {
    newLabel = `HEAD (${shortSha("HEAD")})`;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "db-wallet-upgrade-"));
  let results;
  try {
    const tarball = git(["archive", sha], { maxBuffer: 1 << 30 });
    execFileSync("tar", ["-x", "-C", tmp], { input: tarball, stdio: ["pipe", "ignore", "pipe"] });
    const { runScenarios } = require("./scenarios-upgrade");
    results = await runScenarios({ oldRoot: tmp, newRoot });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const lines = [
    `alt: ${ref} (${shortSha(sha)}), neu: ${newLabel}`,
    "",
    "| ID | Pfad | Erwartung | Beobachtet | Klasse |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const r of results) {
    lines.push(`| ${[r.id, r.pfad, r.erwartung, r.beobachtet, r.klasse].map(cell).join(" | ")} |`);
  }
  const loss = results.some((r) => r.klasse === "DATENVERLUST");
  process.stdout.write(lines.join("\n") + "\n", () => process.exit(loss ? 1 : 0));
}

main().catch((e) => {
  process.stderr.write(`upgrade-check: ${(e && e.stack) || e}\n`);
  process.exit(2);
});
