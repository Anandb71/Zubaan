import fs from "node:fs";

const s = fs.readFileSync("Zubaan.html", "utf8");
const m = s.match(/<script type="__bundler\/template">\s*([\s\S]*?)\s*<\/script>/);
if (!m) throw new Error("template missing");
const h = JSON.parse(m[1]);
fs.writeFileSync("dev/zubaan-extracted.html", h);
const colors = [...new Set(h.match(/#[0-9a-fA-F]{6}/g) || [])];
const fonts = [...new Set([...h.matchAll(/font-family:\s*['"]?([^;'"]+)/g)].map((x) => x[1].trim()))];
const text = [...h.matchAll(/>([^<>]{2,90})</g)]
  .map((x) => x[1].replace(/\s+/g, " ").trim())
  .filter((t) => t && !t.includes("{") && !/woff|format|unicode/i.test(t))
  .slice(0, 200);
console.log(JSON.stringify({ len: h.length, colors: colors.slice(0, 40), fonts: fonts.slice(0, 20), text }, null, 2));
