import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const parserPath = path.join(repoRoot, "src", "shared", "bilibili-parser.js");
const exporterPath = path.join(repoRoot, "src", "browser", "exporter.js");
const outputDir = path.join(repoRoot, "dist");
const outputPath = path.join(outputDir, "bilibili-audiobook-exporter.user.js");

const parserSource = fs.readFileSync(parserPath, "utf8");
const exporterSource = fs.readFileSync(exporterPath, "utf8");

const header = `// ==UserScript==
// @name         Bilibili Audiobook Exporter
// @namespace    local.audiobookscript
// @version      0.1.0
// @description  Export current Bilibili video as audiobook-style files with metadata.json and cover.
// @match        https://www.bilibili.com/video/*
// @grant        none
// ==/UserScript==

`;

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, header + parserSource + "\n\n" + exporterSource + "\n", "utf8");

console.log(`Built userscript: ${outputPath}`);
