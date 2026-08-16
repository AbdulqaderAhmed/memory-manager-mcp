/**
 * Vitest global setup: build the project once so CLI and MCP stdio tests can
 * spawn `node dist/...`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export default function setup(): void {
  // Resolve the typescript package entry, then locate its bin/tsc. This is
  // robust across npm/pnpm node_modules layouts.
  const tsEntry = require.resolve("typescript");
  const tsBin = path.join(path.dirname(tsEntry), "..", "bin", "tsc");
  execFileSync(process.execPath, [tsBin, "-p", "tsconfig.json"], {
    cwd: root,
    stdio: "inherit",
  });
}
