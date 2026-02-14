import tailwind from "bun-plugin-tailwind";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: ["./src/server.ts"],
  outdir: "dist",
  target: "bun",
  minify: true,
  publicPath: "/",
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Built ${result.outputs.length} files into dist/`);
