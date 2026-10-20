import { cpSync, mkdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

const common = { bundle: true, target: "chrome120", outdir: "dist", logLevel: "info" };
// The background worker and options page load as modules; content scripts can't be ES modules.
await build({ ...common, entryPoints: ["src/background.ts", "src/options.ts"], format: "esm" });
await build({ ...common, entryPoints: ["src/content.ts"], format: "iife" });

cpSync("static", "dist", { recursive: true });
// InboxSDK's MV3 page-world script must sit at the extension root.
cpSync("../node_modules/@inboxsdk/core/pageWorld.js", "dist/pageWorld.js");
