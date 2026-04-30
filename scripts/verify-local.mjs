/**
 * `npm run verify:local` — quick local setup check without starting wrangler dev:
 * bootstrap .dev.vars if missing, warn on empty secrets, typecheck, local D1 migrate.
 */
import { execSync } from "node:child_process";
import {
  applyLocalD1Migrations,
  ensureDevVarsFile,
  repoRoot,
  warnIfSecretsMissing,
} from "./dev-vars-support.mjs";

ensureDevVarsFile();
warnIfSecretsMissing();

execSync("npm run typecheck", { stdio: "inherit", cwd: repoRoot, env: process.env, shell: true });

try {
  applyLocalD1Migrations();
} catch {
  process.exit(1);
}

console.log("\n[verify:local] OK — run `npm run dev` to start the Worker.\n");
