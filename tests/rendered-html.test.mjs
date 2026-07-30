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
  const [page, parser, characterTableSource, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/crystal-data.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/character-tables.ts", import.meta.url), "utf8"),
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
  assert.doesNotMatch(page, /操作编号/);
  assert.match(page, /特征标表/);
  assert.match(page, /浏览 32 个晶体学点群/);
  assert.match(page, /如何阅读特征标表/);
  assert.match(page, /什么是 Wyckoff 位置/);
  assert.match(page, /字母未提供/);
  assert.match(page, /siteSymmetryOrder/);
  assert.match(page, /由对称操作算得/);
  assert.doesNotMatch(page, /source\.multiplicity \?\? "\?"/);
  assert.match(page, /selectedCharacterTable\.classes/);
  assert.match(page, /对称等价位置生成/);
  assert.match(page, /className="mapping-help"/);
  assert.match(page, /text\("说明", "Help"\)/);
  assert.match(page, /CIF 位点标签/);
  assert.match(page, /SymViz 生成编号/);
  assert.doesNotMatch(page, /当前原子是怎样由 CIF 原始位点生成的/);
  assert.doesNotMatch(page, /不是对称符号/);
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
  assert.match(page, /显示氢原子/);
  assert.match(page, /氢键候选/);
  assert.doesNotMatch(page, /深粉虚线/);
  assert.match(page, /sidebarCollapsed/);
  assert.match(page, /收起边栏/);
  assert.match(page, /hydrogenBondAppearance/);
  assert.match(page, /虚线颜色/);
  assert.match(page, /虚线粗细/);
  assert.match(page, /Steiner 保守/);
  assert.match(page, /H···A 最大距离/);
  assert.match(page, /D–H···A 最小角/);
  assert.match(page, /IUPAC 2011/);
  assert.match(page, /#c2185b/);
  assert.match(page, /超胞 \/ 显示范围/);
  assert.match(page, /2×1/);
  assert.match(page, /3×3×3/);
  assert.match(page, /分数显示范围/);
  assert.match(page, /step="0\.25"/);
  assert.match(page, /buildDisplayAtomInstances/);
  assert.match(page, /displayedAtomCount/);
  assert.match(page, /Z clipping \/ fade/);
  assert.match(page, /后边界/);
  assert.match(page, /前边界/);
  assert.match(page, /渐隐宽度/);
  assert.match(page, /clipSegmentToDepth/);
  assert.match(page, /clipPolygonToDepth/);
  assert.match(page, /depthOpacity/);
  assert.match(page, /depthStrokeStyle/);
  assert.match(page, /smoothstep/);
  assert.match(page, /focusOpacity \* clippingOpacity/);
  assert.match(page, /depthVisible\(projection\.depth\)/);
  assert.match(page, /越过边界后才完全隐藏/);
  assert.match(page, /type Language = "zh-CN" \| "en-US"/);
  assert.match(page, /symviz-language/);
  assert.match(page, /EN-US/);
  assert.match(page, /Interface language/);
  assert.match(page, /Structure overview/);
  assert.match(page, /Hydrogen-bond geometry filter/);
  assert.match(page, /Coordinate calculator/);
  assert.match(page, /三维构象切换/);
  assert.match(page, /占有率一致性/);
  assert.match(page, /className="occupancy-help"/);
  assert.match(page, /解释占有率一致性/);
  assert.match(page, /部分占位本身不等于已经确认无序/);
  assert.match(page, /Split-site/);
  assert.match(page, /disorderSelections/);
  assert.match(page, /Explicit disorder in CIF/);
  assert.match(page, /document\.documentElement\.lang/);
  assert.doesNotMatch(page, /rotation\.current\.pitch/);
  assert.match(parser, /_space_group_symop_operation_xyz/);
  assert.match(parser, /_atom_site_fract_x/);
  assert.match(parser, /_atom_site_site_symmetry_multiplicity/);
  assert.match(parser, /_atom_site\.site_symmetry_multiplicity/);
  assert.match(parser, /pointGroupFromNumber/);
  assert.match(parser, /hillElementOrder/);
  assert.match(parser, /molecularDisplayFracts/);
  assert.match(parser, /findHydrogenBonds/);
  assert.match(parser, /molecularComponentIds/);
  assert.match(parser, /acceptorImageShift/);
  assert.match(parser, /_atom_site_disorder_assembly/);
  assert.match(parser, /_atom_site_disorder_group/);
  assert.match(parser, /analyzeDisorder/);
  assert.match(parser, /splitSiteCandidates/);
  assert.match(parser, /disorderSitesCanCoexist/);
  assert.equal([...characterTableSource.matchAll(/^\s+hm: "/gm)].length, 32);
  assert.match(characterTableSource, /hm: "6\/mmm"/);
  assert.match(characterTableSource, /hm: "m-3m"/);
  assert.match(characterTableSource, /characterTableForPointGroup/);
  assert.doesNotMatch(page, /g\{String\(operation\.id\)/);
  assert.match(layout, /lang="zh-CN"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await assert.rejects(access(new URL("public/favicon.svg", root)));
});
