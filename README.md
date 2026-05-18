# AudioBookScript

基于当前 B 站页面导出音频、封面和整理元数据的小工具集合。

## 文件说明

- `src/shared/bilibili-parser.js`
  共享解析核心。优先复用页面里已经被下载插件解析出来的音频直链，拿不到时再回退到 `window.__playinfo__`、页面描述和 `meta`。
- `src/browser/exporter.js`
  浏览器端导出面板逻辑。
- `tools/build-userscript.mjs`
  把共享解析器和浏览器导出脚本打包成一个可安装的 userscript。
- `tools/preview-saved-page.mjs`
  用本地保存的 B 站 HTML 预览解析结果，方便离线验字段。
- `dist/bilibili-audiobook-exporter.user.js`
  已生成好的 userscript。

## 生成 userscript

```powershell
node tools/build-userscript.mjs
```

## 安装链接

- 实时发布通道（推荐，工作流每次推送到 `main` 后自动更新）：
  [点击安装 `bilibili-audiobook-exporter.user.js`](https://raw.githubusercontent.com/zzzwannasleep/AudioBookScript/userscript-dist/bilibili-audiobook-exporter.user.js)
- 备用安装通道（直接读取 `main` 分支里的构建产物）：
  [点击安装备用链接](https://github.com/zzzwannasleep/AudioBookScript/raw/refs/heads/main/dist/bilibili-audiobook-exporter.user.js)

## 安装与使用

1. 安装 Tampermonkey 或同类 userscript 管理器。
2. 优先点击上面的“实时发布通道”安装；如果它暂时不可用，再用备用链接或手动导入 `dist/bilibili-audiobook-exporter.user.js`。
3. 打开任意 `https://www.bilibili.com/video/*` 页面。
4. 右下角会出现 `导出有声书` 按钮。
5. 点开后可预览并编辑：
   - 书名
   - 副标题
   - 作者
   - 播讲 / UP 主
   - 简介
   - 语言 ISO
   - 出版社
6. 点击 `导出到目录`，脚本会尝试写出：
   - `cover.jpg`
   - `metadata.json`
   - `series.json`
   - `01 - xxx.m4a`

如果浏览器不支持目录写入 API，会回退成多个文件下载。

通过“实时发布通道”安装后，只要 Tampermonkey 开着自动更新检查，脚本后续会跟随工作流发布自动更新。

## 本地预览解析

```powershell
node tools/preview-saved-page.mjs
```

也可以手动指定本地保存好的 B 站页面：

```powershell
node tools/preview-saved-page.mjs "C:\path\to\saved-bilibili-page.html"
```

## 当前实现范围

- 当前版本重点支持普通视频页 `bilibili.com/video/*`。
- 音频链接提取顺序：
  1. 下载插件生成的 `_音频` 链接
  2. 插件日志中的音频主链接
  3. `window.__playinfo__` 里的 `dash.audio`
- 标题、作者、简介提取顺序：
  1. 页面正文描述
  2. 页面 `meta`
  3. 页面标题

## metadata.json 字段

导出的 `metadata.json` 采用一个偏通用的有声书结构，重点字段包括：

- `title`
- `subtitle`
- `authors`
- `narrators`
- `description`
- `language`
- `publisher`
- `cover`
- `audio`
- `source_url`
- `bvid`
- `aid`
- `cid`
- `published_at`
