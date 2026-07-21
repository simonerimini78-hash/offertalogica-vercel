import fs from "node:fs/promises";

const filePath = new URL("../public/index.html", import.meta.url);
const marker = "OFFERTALOGICA_UPLOAD_INTRO_REMOVED_V106_8_8_5";
const source = await fs.readFile(filePath, "utf8");

if (source.includes(marker)) process.exit(0);

const pattern = /(<h3>Carica bolletta o scheda sintetica<\/h3>)\s*<p>[\s\S]*?<\/p>/u;
if (!pattern.test(source)) {
  throw new Error("upload_intro_anchor_not_found");
}

const updated = source.replace(
  pattern,
  `$1\n        <!-- ${marker} -->`,
);
await fs.writeFile(filePath, updated, "utf8");
