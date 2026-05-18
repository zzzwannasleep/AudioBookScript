import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const parserPath = path.join(repoRoot, "src", "shared", "bilibili-parser.js");
const zipBuilderPath = path.join(repoRoot, "src", "shared", "zip-builder.js");
const exporterPath = path.join(repoRoot, "src", "browser", "exporter.js");
const outputDir = path.join(repoRoot, "dist");
const outputPath = path.join(outputDir, "bilibili-audiobook-exporter.user.js");
const defaultRepository = process.env.GITHUB_REPOSITORY || "zzzwannasleep/AudioBookScript";
const defaultRepositoryUrl =
  `https://github.com/${defaultRepository}`;
const defaultLiveChannelUrl =
  `https://raw.githubusercontent.com/${defaultRepository}/userscript-dist/bilibili-audiobook-exporter.user.js`;
const defaultUpdateMetaUrl =
  `https://api.github.com/repos/${defaultRepository}/contents/bilibili-audiobook-exporter.user.js?ref=userscript-dist`;
const version = process.env.USERSCRIPT_VERSION || "0.1.0";
const downloadUrl =
  process.env.USERSCRIPT_DOWNLOAD_URL ||
  defaultLiveChannelUrl;
const updateUrl = process.env.USERSCRIPT_UPDATE_URL || downloadUrl;
const updateMetaUrl = process.env.USERSCRIPT_UPDATE_META_URL || defaultUpdateMetaUrl;
const homepageUrl = process.env.USERSCRIPT_HOMEPAGE_URL || defaultRepositoryUrl;
const supportUrl = process.env.USERSCRIPT_SUPPORT_URL || `${defaultRepositoryUrl}/issues`;

const parserSource = fs.readFileSync(parserPath, "utf8");
const zipBuilderSource = fs.readFileSync(zipBuilderPath, "utf8");
const exporterSource = fs.readFileSync(exporterPath, "utf8");

const header = `// ==UserScript==
// @name         Bilibili Audiobook Exporter
// @namespace    local.audiobookscript
// @version      ${version}
// @description  Export current Bilibili video as audiobook-style files with metadata.json and cover.
// @match        https://www.bilibili.com/video/*
// @match        https://space.bilibili.com/*
// @homepageURL  ${homepageUrl}
// @supportURL   ${supportUrl}
// @downloadURL  ${downloadUrl}
// @updateURL    ${updateUrl}
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      *
// ==/UserScript==

`;

const buildInfoScript = `(function(root){
  root.__BILIBILI_AUDIOBOOK_BUILD_INFO__ = ${JSON.stringify({
    version,
    downloadUrl,
    updateUrl,
    updateMetaUrl,
    homepageUrl,
    supportUrl,
    repository: defaultRepository,
  })};
})(typeof globalThis !== "undefined" ? globalThis : this);

`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(
  outputPath,
  header + buildInfoScript + parserSource + "\n\n" + zipBuilderSource + "\n\n" + exporterSource + "\n",
  "utf8"
);

console.log(`Built userscript: ${outputPath}`);
