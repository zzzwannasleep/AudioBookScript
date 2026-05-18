import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import parser from "../src/shared/bilibili-parser.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function findDefaultHtml() {
  return fs
    .readdirSync(repoRoot)
    .find((fileName) => /\.html$/i.test(fileName) && /bilibili/i.test(fileName));
}

const target = process.argv[2] || findDefaultHtml();

if (!target) {
  console.error("没有找到可预览的 B 站 HTML。请手动传入本地保存的页面路径。");
  process.exit(1);
}

const resolvedPath = path.isAbsolute(target) ? target : path.join(repoRoot, target);

if (!fs.existsSync(resolvedPath)) {
  console.error(`文件不存在：${resolvedPath}`);
  process.exit(1);
}

const html = fs.readFileSync(resolvedPath, "utf8");
const parsed = parser.parseHtml(html, { url: "" });

console.log(JSON.stringify(parsed, null, 2));
