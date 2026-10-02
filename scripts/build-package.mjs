// Builds the npm package `opus-video-agent` into dist/opus-video-agent:
//   bin/cli.js      the `opus-video-agent` command (checks Claude Code, picks ports, opens the browser)
//   bin/server.js   the app server, bundled (dependencies stay in node_modules)
//   web/            the built web app, served by the server
//   skills/, templates/  what the agent loads
// Run: pnpm build:package   Then try it: cd dist/opus-video-agent && npm pack && npx ./opus-video-agent-*.tgz
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { build } from "esbuild";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "dist", "opus-video-agent");
const server = path.join(root, "apps", "server");
const rel = (p) => path.relative(root, p);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "bin"), { recursive: true });

// 1. The web app.
execSync(`pnpm --filter @lva/web exec vite build --outDir ${path.join(out, "web")} --emptyOutDir`, { cwd: root, stdio: "inherit" });

// 2. The server and the command, as two bundles: the command must set paths and ports before the server loads.
await build({
  entryPoints: { cli: path.join(server, "src", "cli.ts"), server: path.join(server, "src", "index.ts") },
  outdir: path.join(out, "bin"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
});
fs.chmodSync(path.join(out, "bin", "cli.js"), 0o755);
fs.copyFileSync(path.join(server, "src", "examples-data.json"), path.join(out, "bin", "examples-data.json"));

// 3. What the agent reads at run time.
for (const dir of ["skills", "templates"]) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
// Skill validators are TypeScript in the repo; ship them as JavaScript (Node won't strip types under node_modules).
for (const d of fs.readdirSync(path.join(out, "skills"))) {
  const ts = path.join(out, "skills", d, "validate.ts");
  if (!fs.existsSync(ts)) continue;
  await build({ entryPoints: [ts], outfile: ts.replace(/\.ts$/, ".js"), platform: "node", format: "esm", target: "node20", logLevel: "warning" });
  fs.rmSync(ts);
}

// 4. package.json: the server's runtime dependencies, plus ffmpeg as an optional fallback for machines without it.
const serverPkg = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8"));
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const pkg = {
  name: "opus-video-agent",
  version: rootPkg.version,
  description: "Make launch videos with Claude, in your browser, on your own Claude subscription.",
  type: "module",
  bin: { "opus-video-agent": "bin/cli.js" },
  files: ["bin", "web", "skills", "templates", "README.md"],
  engines: { node: ">=20" },
  os: ["darwin", "linux"],
  dependencies: serverPkg.dependencies,
  optionalDependencies: { "ffmpeg-static": "^5.3.0" },
  keywords: ["claude", "claude-code", "video", "launch-video", "agent"],
  license: rootPkg.license ?? "UNLICENSED",
};
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify(pkg, null, 2) + "\n");
fs.copyFileSync(path.join(root, "docs", "npm-readme.md"), path.join(out, "README.md"));

console.log(`\nBuilt ${rel(out)} (opus-video-agent ${pkg.version})`);
