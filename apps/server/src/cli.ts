// `npx opus-video-agent`: start the app on this machine and open it in the browser. Generation runs through the
// user's own Claude Code (and so their own Claude subscription); nothing leaves the machine except what Claude
// Code itself sends to Anthropic.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { claudeStatus } from "./claude-status.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, ".."); // bin/ sits in the package root
const pkg = { version: "dev", ...(JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8")) as { version?: string }) };

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("--help") || flag("-h")) {
  console.log(`Opus Video Agent ${pkg.version}: make launch videos with Claude, on your own Claude subscription.

Usage: npx opus-video-agent [options]

  --port <n>     Port for the app (default 8787; the next free one if taken)
  --data <dir>   Where projects are kept (default ~/.opus-video-agent)
  --no-open      Don't open the browser
  --no-telemetry Don't send anonymous usage stats (also: OVA_TELEMETRY=0 or DO_NOT_TRACK=1)
  -v, --version  Print the version

Needs Claude Code, signed in: https://claude.com/claude-code`);
  process.exit(0);
}
if (flag("--version") || flag("-v")) {
  console.log(pkg.version);
  process.exit(0);
}

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error(`Opus Video Agent needs Node.js 20 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}

/** Is this port free on loopback? */
const free = (port: number) =>
  new Promise<boolean>((ok) => {
    const s = net.createServer();
    s.once("error", () => ok(false));
    s.listen(port, "127.0.0.1", () => s.close(() => ok(true)));
  });
/** Two free ports next to each other: the app, and the separate origin agent-written pages are served from. */
async function ports(start: number): Promise<[number, number]> {
  for (let p = start; p < start + 200; p += 2) if ((await free(p)) && (await free(p + 1))) return [p, p + 1];
  throw new Error(`No free ports between ${start} and ${start + 200}.`);
}

const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

async function main() {
  const dataDir = path.resolve(value("--data") ?? path.join(os.homedir(), ".opus-video-agent"));
  fs.mkdirSync(dataDir, { recursive: true });
  const [port, artifactPort] = await ports(Number(value("--port") ?? 8787));

  // Anonymous usage stats: a random id for this install (no account, no name), so one person counts once.
  const telemetry = !flag("--no-telemetry") && process.env.OVA_TELEMETRY !== "0" && !["1", "true"].includes(process.env.DO_NOT_TRACK ?? "");
  const idFile = path.join(dataDir, "install-id");
  if (!fs.existsSync(idFile)) fs.writeFileSync(idFile, randomUUID() + "\n");
  const installId = fs.readFileSync(idFile, "utf8").trim();

  Object.assign(process.env, {
    // The package ships skills/ and templates/ next to bin/; from a repo checkout the server finds them itself.
    ...(fs.existsSync(path.join(pkgRoot, "skills")) ? { OVA_ASSET_ROOT: pkgRoot } : {}),
    OVA_DATA: dataDir,
    PORT: String(port),
    ARTIFACT_PORT: String(artifactPort),
    OVA_QUIET: "1",
    OVA_TELEMETRY: telemetry ? "1" : "0",
    OVA_INSTALL_ID: installId,
    OVA_VERSION: pkg.version,
  });
  // The built web app ships in the package; from a repo checkout (development) the page comes from Vite instead.
  const web = path.join(pkgRoot, "web");
  if (fs.existsSync(path.join(web, "index.html"))) process.env.OVA_WEB_DIR = web;

  // Loaded only now, so it picks up the paths and ports above.
  const server = fs.existsSync(path.join(here, "server.js")) ? path.join(here, "server.js") : path.join(here, "index.ts");
  const { ready } = (await import(pathToFileURL(server).href)) as { ready: Promise<void> };
  await ready;

  const url = `http://localhost:${port}`;
  const claude = claudeStatus(true);
  console.log(`
  ${bold("Opus Video Agent")} ${dim(pkg.version)}

  ${bold(url)}
  ${dim(`Projects: ${dataDir.replace(os.homedir(), "~")}`)}
  ${claude.message}
  ${dim(telemetry ? "Anonymous usage stats and session replays help improve this. Opt out: --no-telemetry" : "Usage stats: off")}

  ${dim("Press Ctrl+C to stop.")}
`);
  if (!flag("--no-open")) openBrowser(url);
}

function openBrowser(url: string) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const argv = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, argv, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {}
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
