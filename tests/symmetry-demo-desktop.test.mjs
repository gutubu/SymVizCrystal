import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startRendererServer } from "../desktop/renderer-server.mjs";

function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)]
      .map((match) => [match[1].toLowerCase(), match[2] ?? match[3]]),
  );
}

test("desktop serves the complete symmetry demo and catalog from its own renderer origin", { timeout: 30_000 }, async () => {
  const appRoot = fileURLToPath(new URL("../", import.meta.url));
  const server = await startRendererServer(appRoot);
  try {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const indexUrl = new URL("/symmetry-demo/index.html", server.url);
    const paths = ["index.html", "catalog.json", "gallery.css", "gallery.js", "element-diagrams.json", "projection-diagrams.js", "ferro-transition.js", "ferro-transition.css"];
    const responses = await Promise.all(paths.map((name) =>
      fetch(new URL(name, indexUrl), { signal: AbortSignal.timeout(10_000) }),
    ));
    const [html, catalogText, css, js, elementText, diagramJs, transitionJs, transitionCss] = await Promise.all(responses.map((response) => response.text()));
    for (let i = 0; i < responses.length; i += 1) {
      assert.equal(responses[i].status, 200, `${paths[i]} must be included in the desktop build`);
    }
    assert.match(responses[0].headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.match(responses[1].headers.get("content-type") ?? "", /^application\/json\b/i);
    assert.match(responses[2].headers.get("content-type") ?? "", /^text\/css\b/i);
    assert.match(responses[3].headers.get("content-type") ?? "", /^(?:text|application)\/javascript\b/i);
    assert.ok(css.length > 100, "the stylesheet must contain the bundled demo styles");
    assert.ok(js.length > 1_000, "the script must contain the interactive demo, not a placeholder");
    assert.match(responses[4].headers.get("content-type") ?? "", /^application\/json\b/i);
    assert.equal(JSON.parse(elementText).groups.length, 230);
    assert.match(diagramJs, /SymVizDiagrams/);
    assert.match(transitionJs, /SymVizFerroTransition/);
    assert.match(transitionCss, /\.ferro-transition/);
    assert.match(html, /role="tab"[^>]*data-suite-view="transition"/);
    assert.match(html, /<option value="222F1">/);
    assert.match(html, /<option value="mF1">/);
    assert.match(html, /data-transition-species="mF1"/);
    assert.doesNotMatch(js, /international-tables|internationalTables|closeOriginal/,
      "the self-drawn demo must load without original-table assets or dialogs");
    assert.doesNotMatch(diagramJs, /国际表原图|data-it-original|sv-it-dialog/,
      "the diagram viewer must expose only the interactive drawing modes");

    const catalog = JSON.parse(catalogText);
    assert.ok(Array.isArray(catalog.groups));
    assert.equal(catalog.groups.length, 230, "all 230 space-group types must be available");
    assert.deepEqual(catalog.groups.map((group) => group.id), Array.from({ length: 230 }, (_, i) => i + 1));
    assert.equal(catalog.groupCount, catalog.groups.length);
    assert.equal(catalog.groups.filter((group) => group.polarGroup === true).length, 68);
    assert.equal(catalog.groups.filter((group) => group.centrosymmetric === true).length, 92);
    assert.equal(catalog.groups.filter((group) => group.nonpolarAcentric === true).length, 70);
    assert.equal(catalog.polarGroupCount, 68);
    assert.equal(catalog.centrosymmetricGroupCount, 92);
    assert.equal(catalog.nonpolarAcentricGroupCount, 70);
    assert.equal(catalog.groups.reduce((sum, group) => sum + group.operations.length, 0), catalog.operationCount);
    assert.equal(catalog.operationCount, 4425, "all conventional-cell representative operations must be bundled");
    for (const group of catalog.groups) {
      assert.equal(group.hasInversion, group.centrosymmetric);
      assert.equal(Number(group.polarGroup) + Number(group.centrosymmetric) + Number(group.nonpolarAcentric), 1,
        `No.${group.id} belongs to exactly one of the three classifications`);
      assert.equal(group.category, group.polarGroup ? "polar" : group.centrosymmetric ? "centrosymmetric" : "nonpolar-acentric");
      assert.ok(group.operations.every((operation) => typeof operation.description === "string" && operation.description.trim()),
        `No.${group.id} needs a readable explanation for every operation`);
      assert.ok(Array.isArray(group.inversionCenters));
      assert.equal(group.inversionCenters.length > 0, group.centrosymmetric,
        `No.${group.id} must supply red-centre locations exactly when it has inversion symmetry`);
    }
    for (const id of [1, 4, 7]) {
      const group = catalog.groups.find((entry) => entry.id === id);
      assert.ok(group?.operations.length, `the previously demonstrated No.${id} must work inside SymViz`);
    }
    const p2n = catalog.groups.find((group) => group.id === 13);
    assert.equal(p2n.name, "P2/n");
    assert.equal(p2n.centrosymmetric, true);
    assert.equal(p2n.operations.length, 4);
    assert.ok(catalog.groups.some((group) => group.id === 230 && group.centrosymmetric), "the final cubic centrosymmetric type must be included");
    for (const id of [16, 81, 152, 187, 196, 220]) {
      const group = catalog.groups.find((entry) => entry.id === id);
      assert.equal(group.nonpolarAcentric, true, `No.${id} is a newly included nonpolar acentric type`);
      assert.equal(group.polarDimension, 0);
      assert.deepEqual(group.inversionCenters, [], "rotatory inversion alone must never create a pure-inversion red marker");
    }

    const metaTags = (html.match(/<meta\b[^>]*>/gi) ?? []).map(attributes);
    const policy = metaTags.find((tag) => tag["http-equiv"]?.toLowerCase() === "content-security-policy")?.content;
    assert.ok(policy, "the embedded demo needs its own Content-Security-Policy");
    const directives = new Map(policy.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name?.toLowerCase(), sources];
    }));
    const scriptSources = directives.get("script-src");
    assert.ok(scriptSources?.includes("'self'"), "local gallery.js must be allowed");
    assert.ok(scriptSources.every((source) => source === "'self'" || /^'(?:sha(?:256|384|512)-|nonce-)[^']+'$/.test(source)),
      "script-src must restrict executable scripts to this renderer origin or explicit inline hashes/nonces");

    const scripts = (html.match(/<script\b[^>]*>/gi) ?? []).map(attributes).filter((tag) => tag.src);
    assert.ok(scripts.some((tag) => new URL(tag.src, indexUrl).pathname === "/symmetry-demo/gallery.js"));
    assert.ok(scripts.some((tag) => new URL(tag.src, indexUrl).pathname === "/symmetry-demo/projection-diagrams.js"));
    assert.ok(scripts.some((tag) => new URL(tag.src, indexUrl).pathname === "/symmetry-demo/ferro-transition.js"));
    for (const script of scripts) {
      assert.equal(new URL(script.src, indexUrl).origin, indexUrl.origin, "scripts cannot depend on an external origin");
    }
    const styles = (html.match(/<link\b[^>]*>/gi) ?? []).map(attributes)
      .filter((tag) => tag.rel?.toLowerCase().split(/\s+/).includes("stylesheet"));
    assert.ok(styles.some((tag) => new URL(tag.href, indexUrl).pathname === "/symmetry-demo/gallery.css"));
    for (const style of styles) {
      assert.equal(new URL(style.href, indexUrl).origin, indexUrl.origin, "styles must be served by the desktop renderer");
    }
    assert.doesNotMatch(html + css + js, /(?:127\.0\.0\.1|localhost):8770\b/i,
      "the integrated demo cannot rely on the earlier standalone preview server");
    assert.doesNotMatch(js, /\b(?:fetch|import)\s*\(\s*["'`](?:https?:)?\/\//i,
      "runtime script or data loading must use local resources");
    assert.doesNotMatch(css, /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i,
      "the demo stylesheet cannot import a CDN dependency");
  } finally {
    await server.close();
  }
});
