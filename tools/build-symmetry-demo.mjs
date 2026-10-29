import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "tools", "symmetry-demo");
const destination = join(root, "public", "symmetry-demo");
const [template, baseCss, catalogText, elementText, diagramScript, transitionScript, transitionCss] = await Promise.all([
  readFile(join(source, "gallery-template.html"), "utf8"),
  readFile(join(source, "base.css"), "utf8"),
  readFile(join(destination, "catalog.json"), "utf8"),
  readFile(join(destination, "element-diagrams.json"), "utf8"),
  readFile(join(source, "projection-diagrams.js"), "utf8"),
  readFile(join(source, "ferro-transition.js"), "utf8"),
  readFile(join(source, "ferro-transition.css"), "utf8"),
]);
const catalog = JSON.parse(catalogText);
const elements = JSON.parse(elementText);
if (elements.groupCount !== 230 || elements.groups.length !== 230
  || new Set(elements.groups.map((group) => group.id)).size !== 230
  || elements.catalogueSha256 !== createHash("sha256").update(catalogText).digest("hex")) {
  throw new Error("Rebuild the complete symmetry-element diagrams with tools/build-symmetry-element-diagrams.py before bundling this catalogue.");
}
if (catalog.groups.length !== 230 || catalog.groups.filter((group) => group.polarGroup).length !== 68
  || catalog.groups.filter((group) => group.centrosymmetric).length !== 92
  || catalog.groups.filter((group) => group.nonpolarAcentric).length !== 70
  || new Set(catalog.groups.map((group) => group.id)).size !== 230
  || !catalog.groups.every((group) => Number.isInteger(group.id) && group.id >= 1 && group.id <= 230)
  || new Set(catalog.groups.map((group) => group.pointGroup)).size !== 32
  || catalog.groups.reduce((sum, group) => sum + group.operations.length, 0) !== 4425) {
  throw new Error("The SymViz symmetry catalog must contain all 230 types: 68 polar, 92 centrosymmetric and 70 nonpolar acentric types, with 4425 operations and 32 point groups.");
}
for (const group of catalog.groups) {
  const expectedCategory = group.centrosymmetric ? "centrosymmetric" : group.polarGroup ? "polar" : "nonpolar-acentric";
  if (group.centrosymmetric !== group.hasInversion
    || [group.polarGroup, group.centrosymmetric, group.nonpolarAcentric].filter((flag) => flag === true).length !== 1
    || group.category !== expectedCategory
    || !Array.isArray(group.inversionCenters) || Boolean(group.inversionCenters.length) !== group.centrosymmetric) {
    throw new Error(`Invalid symmetry classification or inversion-center metadata for space group ${group.id}.`);
  }
  for (const operation of group.operations) {
    if (typeof operation.description !== "string" || !operation.description.trim()
      || !Array.isArray(operation.steps) || !operation.steps.length
      || !operation.steps.every((step) => typeof step === "string" && step.trim())) {
      throw new Error(`Missing explanatory text for space group ${group.id}, operation ${operation.id}.`);
    }
  }
}
const css = template.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const script = template.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!css || !script) throw new Error("The symmetry viewer template is incomplete.");
if (/window\.openai|__POLAR_DATA__|https?:\/\/[^\s'"<>]+\.(?:js|css)\b/.test(script)) {
  throw new Error("The embedded viewer must run entirely from bundled, local assets.");
}
const markup = template.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<script>[\s\S]*?<\/script>/, "").trim();
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>SymViz · 对称操作与铁电相变</title><link rel="stylesheet" href="./gallery.css"><link rel="stylesheet" href="./ferro-transition.css"><script src="./projection-diagrams.js" defer></script><script src="./ferro-transition.js" defer></script><script src="./gallery.js" defer></script></head>
<body>${markup}</body></html>
`;
await mkdir(destination, { recursive: true });
await Promise.all([
  writeFile(join(destination, "index.html"), html),
  writeFile(join(destination, "gallery.css"), baseCss + "\n" + css),
  writeFile(join(destination, "gallery.js"), script.trim() + "\n"),
  writeFile(join(destination, "projection-diagrams.js"), diagramScript),
  writeFile(join(destination, "ferro-transition.js"), transitionScript),
  writeFile(join(destination, "ferro-transition.css"), transitionCss),
]);
console.log("SymViz: self-drawn interactive diagrams for 230 types, 4425 operations and the 222F1 / mF1 transitions bundled locally.");
