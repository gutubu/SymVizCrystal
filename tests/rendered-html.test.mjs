import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the SymViz application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>SymViz — 晶体对称性可视化工作台<\/title>/i);
  assert.match(html, /CRYSTAL SYMMETRY EXPLORER/);
  assert.match(html, /打开 CIF/);
  assert.match(html, /对称操作/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships CIF parsing and the interactive crystal viewer without starter assets", async () => {
  const [page, parser, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/crystal-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<canvas/);
  assert.match(page, /loadFile\(file/);
  assert.match(page, /applyOperation/);
  assert.match(page, /onContextMenu/);
  assert.match(page, /聚焦该不对称位点/);
  assert.match(page, /findSymmetryAxisOrigin/);
  assert.match(page, /createLinearGradient/);
  assert.match(page, /补全分子片段/);
  assert.match(page, /坐标计算器/);
  assert.match(page, /操作 1、操作 2/);
  assert.match(page, /quaternionMultiply/);
  assert.match(page, /quaternionForView/);
  assert.match(page, /normalize\(bVector\)/);
  assert.match(page, /projectedLength = maximumLength \* screenFraction/);
  assert.match(page, /沿笛卡尔正/);
  assert.match(page, /沿晶格正/);
  assert.match(page, /元素图例/);
  assert.match(page, /type="color"/);
  assert.match(page, /axisAppearance\.lineWidth/);
  assert.match(page, /字母字体/);
  assert.match(page, /恢复坐标轴默认外观/);
  assert.match(page, /氢键候选（深粉虚线）/);
  assert.match(page, /Steiner 保守/);
  assert.match(page, /H···A 最大距离/);
  assert.match(page, /D–H···A 最小角/);
  assert.match(page, /IUPAC 2011/);
  assert.match(page, /#c2185b/);
  assert.doesNotMatch(page, /rotation\.current\.pitch/);
  assert.match(parser, /_space_group_symop_operation_xyz/);
  assert.match(parser, /_atom_site_fract_x/);
  assert.match(parser, /pointGroupFromNumber/);
  assert.match(parser, /hillElementOrder/);
  assert.match(parser, /molecularDisplayFracts/);
  assert.match(parser, /findHydrogenBonds/);
  assert.match(parser, /molecularComponentIds/);
  assert.match(parser, /acceptorImageShift/);
  assert.doesNotMatch(page, /g\{String\(operation\.id\)/);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("public/favicon.svg", root)));
});
