#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Compatibility entry point. All ARERA catalog generation is delegated to the
// canonical Python transformer so this command cannot publish different prices.
const script = fileURLToPath(new URL("./update-arera-menu.py", import.meta.url));
const python = process.env.PYTHON || process.env.PYTHON3 || "python3";
const result = spawnSync(python, [script, ...process.argv.slice(2)], { stdio: "inherit" });

if (result.error) {
  console.error(`[ARERA] Impossibile avviare la trasformazione canonica: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
