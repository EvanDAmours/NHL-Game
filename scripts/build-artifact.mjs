// Pack the Vite build into one self-contained page (CSS + JS inlined) for
// hosting as a single file, e.g. a claude.ai Artifact.
//   npm run build:artifact   ->  dist/rink-gm.html
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
const html = readFileSync(join(dist, "index.html"), "utf8");
const cssHref = html.match(/<link[^>]+rel="stylesheet"[^>]+href="\.?\/?(assets\/[^"]+\.css)"/)?.[1];
const jsSrc = html.match(/<script[^>]+src="\.?\/?(assets\/[^"]+\.js)"/)?.[1];
if (!cssHref || !jsSrc) throw new Error("Run `vite build` first: couldn't find the built CSS/JS in dist/index.html");

const css = readFileSync(join(dist, cssHref), "utf8");
// Keep the inline script from closing early or entering HTML comment parsing.
const js = readFileSync(join(dist, jsSrc), "utf8").replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)?.[0] || "";

const page = `<title>Rink GM</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts}
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
writeFileSync(join(dist, "rink-gm.html"), page);
console.log(`dist/rink-gm.html — ${(page.length / 1024).toFixed(0)} KB`);
