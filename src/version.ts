import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const SERVER_NAME = "memory-manage-mcp";

/** Read the version from package.json so it can never drift from npm. */
function readPackageVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const SERVER_VERSION = readPackageVersion();
export const MEMORY_VERSION = 1;
