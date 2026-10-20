import { cpSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/content.ts", "src/background.ts", "src/options.ts"],
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: "dist",
  logLevel: "info",
});

cpSync("static", "dist", { recursive: true });
// InboxSDK's MV3 page-world script must sit at the extension root.
cpSync("../node_modules/@inboxsdk/core/pageWorld.js", "dist/pageWorld.js");
