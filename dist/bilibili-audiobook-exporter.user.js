// ==UserScript==
// @name         Bilibili Audiobook Exporter
// @namespace    local.audiobookscript
// @version      0.1.0
// @description  Export current Bilibili video as audiobook-style files with metadata.json and cover.
// @match        https://www.bilibili.com/video/*
// @homepageURL  https://github.com/zzzwannasleep/AudioBookScript
// @supportURL   https://github.com/zzzwannasleep/AudioBookScript/issues
// @downloadURL  https://raw.githubusercontent.com/zzzwannasleep/AudioBookScript/userscript-dist/bilibili-audiobook-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/zzzwannasleep/AudioBookScript/userscript-dist/bilibili-audiobook-exporter.user.js
// @grant        none
// ==/UserScript==

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.BilibiliAudiobookParser = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var VERSION = "0.1.0";

  function decodeHtmlEntities(value) {
    if (value == null) {
      return "";
    }

    return String(value)
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#x([0-9a-f]+);/gi, function (_, hex) {
        try {
          return String.fromCodePoint(parseInt(hex, 16));
        } catch (error) {
          return _;
        }
      })
      .replace(/&#(\d+);/g, function (_, decimal) {
        try {
          return String.fromCodePoint(parseInt(decimal, 10));
        } catch (error) {
          return _;
        }
      });
  }

  function stripTags(value) {
    if (!value) {
      return "";
    }

    return decodeHtmlEntities(
      String(value)
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    );
  }

  function normalizeWhitespace(value) {
    if (value == null) {
      return "";
    }

    return stripTags(String(value))
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v\u00a0]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function uniqueStrings(values) {
    var seen = new Set();
    var result = [];

    values.forEach(function (item) {
      var normalized = normalizeWhitespace(item);
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      result.push(normalized);
    });

    return result;
  }

  function normalizeUrl(url) {
    if (!url) {
      return "";
    }

    var normalized = decodeHtmlEntities(String(url)).trim();
    if (!normalized) {
      return "";
    }
    if (normalized.indexOf("//") === 0) {
      return "https:" + normalized;
    }
    return normalized;
  }

  function normalizeBiliCoverUrl(url) {
    var normalized = normalizeUrl(url);
    if (!normalized) {
      return "";
    }

    var hashIndex = normalized.indexOf("#");
    var hash = "";
    if (hashIndex >= 0) {
      hash = normalized.slice(hashIndex);
      normalized = normalized.slice(0, hashIndex);
    }

    var queryIndex = normalized.indexOf("?");
    var query = "";
    if (queryIndex >= 0) {
      query = normalized.slice(queryIndex);
      normalized = normalized.slice(0, queryIndex);
    }

    normalized = normalized.replace(
      /(\.(?:jpe?g|png|webp|gif))(?:@[^/?#]+)?$/i,
      "$1"
    );

    return normalized + query + hash;
  }

  function sanitizeFileName(value, fallback) {
    var normalized = normalizeWhitespace(value)
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\.+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) {
      return fallback || "untitled";
    }

    return normalized.slice(0, 120);
  }

  function splitPeople(value) {
    return uniqueStrings(
      normalizeWhitespace(value)
        .split(/[\/|｜、,，&＆+]/)
        .map(function (item) {
          return item.trim();
        })
    );
  }

  function stripBilibiliSuffix(title) {
    return normalizeWhitespace(title)
      .replace(/[_\-\s]*(?:哔哩哔哩|bilibili).*$/i, "")
      .trim();
  }

  function buildMetaMap(html) {
    var metaMap = new Map();
    var matcher =
      /<meta[^>]+(?:name|itemprop|property)=["']([^"']+)["'][^>]+content=["']([^"']*)["'][^>]*>/gim;
    var match;

    while ((match = matcher.exec(html)) !== null) {
      metaMap.set(match[1].toLowerCase(), decodeHtmlEntities(match[2]));
    }

    return metaMap;
  }

  function extractTitle(html, meta) {
    var title =
      meta.get("title") ||
      meta.get("og:title") ||
      meta.get("name") ||
      firstMatch(html, [/<title>([\s\S]*?)<\/title>/i]);

    return stripBilibiliSuffix(title);
  }

  function firstMatch(text, patterns) {
    var index;
    var match;

    for (index = 0; index < patterns.length; index += 1) {
      match = patterns[index].exec(text);
      if (match && match[1]) {
        return normalizeWhitespace(match[1]);
      }
    }

    return "";
  }

  function extractPageDescription(html, meta) {
    var directDescription = firstMatch(html, [
      /<div[^>]+id="v_desc"[\s\S]*?<span[^>]+class="desc-info-text"[^>]*>([\s\S]*?)<\/span>/i,
      /<div[^>]+class="basic-desc-info"[^>]*>([\s\S]*?)<\/div>/i,
    ]);

    if (directDescription) {
      return directDescription;
    }

    return cleanMetaDescription(
      meta.get("description") || meta.get("itemprop:description") || ""
    );
  }

  function cleanMetaDescription(text) {
    var normalized = normalizeWhitespace(text);
    if (!normalized) {
      return "";
    }

    var candidates = [
      "相关视频：",
      "视频播放量",
      "弹幕量",
      "作者简介",
    ];

    candidates.forEach(function (token) {
      var tokenIndex = normalized.indexOf(token);
      if (tokenIndex > 0) {
        normalized = normalized.slice(0, tokenIndex).trim();
      }
    });

    return normalized;
  }

  function extractUploaderBio(html) {
    return firstMatch(html, [
      /<div[^>]+class="up-description up-detail-bottom"[^>]*>([\s\S]*?)<\/div>/i,
      /<div[^>]+class="up-description"[^>]*>([\s\S]*?)<\/div>/i,
    ]);
  }

  function extractCanonicalUrl(html, meta, fallbackUrl) {
    var metaUrl = meta.get("url") || meta.get("og:url");
    if (metaUrl) {
      return normalizeUrl(metaUrl);
    }

    var linkMatch = firstMatch(html, [/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i]);
    if (linkMatch) {
      return normalizeUrl(linkMatch);
    }

    return fallbackUrl || "";
  }

  function extractCoverUrl(html, meta) {
    var raw =
      meta.get("image") ||
      meta.get("thumbnailurl") ||
      meta.get("og:image") ||
      firstMatch(html, [
        /<meta[^>]+itemprop="image"[^>]+content="([^"]+)"/i,
        /<meta[^>]+itemprop="thumbnailUrl"[^>]+content="([^"]+)"/i,
      ]);

    return normalizeBiliCoverUrl(raw);
  }

  function extractUploaderName(meta) {
    return normalizeWhitespace(meta.get("author") || "");
  }

  function extractPublishedAt(meta) {
    return normalizeWhitespace(
      meta.get("uploaddate") || meta.get("datepublished") || ""
    );
  }

  function extractTags(html) {
    var tags = [];
    var matcher =
      /<a[^>]+class="tag-link"[^>]*>([\s\S]*?)<\/a>/gim;
    var match;

    while ((match = matcher.exec(html)) !== null) {
      tags.push(stripTags(match[1]));
    }

    return uniqueStrings(tags.filter(function (tag) {
      return tag && tag.length <= 40;
    }));
  }

  function extractAudioUrlFromPluginAnchor(html) {
    var match =
      /<a[^>]+title="[^"]*?_音频"[^>]+durl="([^"]+)"/i.exec(html);
    if (!match || !match[1]) {
      return "";
    }

    try {
      var payload = JSON.parse(decodeURIComponent(match[1]));
      return normalizeUrl(payload.url || "");
    } catch (error) {
      return "";
    }
  }

  function extractAudioUrlFromPluginLogs(html) {
    return normalizeUrl(
      firstMatch(html, [
        /音频：<\/p><p>(?:&nbsp;|\s)*主链接：\s*([^<\s]+)/i,
      ])
    );
  }

  function extractPlayInfo(html) {
    var match = /window\.__playinfo__=(\{.*?\})<\/script>/s.exec(html);
    if (!match || !match[1]) {
      return null;
    }

    try {
      return JSON.parse(match[1]);
    } catch (error) {
      return null;
    }
  }

  function extractAudioUrlFromPlayInfo(playInfo) {
    if (
      !playInfo ||
      !playInfo.data ||
      !playInfo.data.dash ||
      !Array.isArray(playInfo.data.dash.audio) ||
      !playInfo.data.dash.audio.length
    ) {
      return "";
    }

    var audioTrack = playInfo.data.dash.audio[0];
    return normalizeUrl(audioTrack.baseUrl || audioTrack.base_url || "");
  }

  function extractDurationMs(playInfo) {
    if (!playInfo || !playInfo.data) {
      return 0;
    }

    var value = Number(playInfo.data.timelength || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function extractNumericId(text, label) {
    if (!text) {
      return "";
    }

    var matcher = new RegExp(label + "\\s*[:：]\\s*(\\d+)", "i");
    var match = matcher.exec(text);
    return match && match[1] ? match[1] : "";
  }

  function extractBvid(html, canonicalUrl) {
    var sources = [canonicalUrl || "", html];
    var index;
    var match;

    for (index = 0; index < sources.length; index += 1) {
      match = /(BV[0-9A-Za-z]{10,})/.exec(sources[index]);
      if (match && match[1]) {
        return match[1];
      }
    }

    return "";
  }

  function extractAid(html) {
    return extractNumericId(html, "av");
  }

  function extractCid(html) {
    return extractNumericId(html, "cid");
  }

  function extractLabeledLine(text, labels) {
    var pattern = new RegExp(
      "(?:^|\\n)\\s*(?:" + labels.join("|") + ")\\s*[:：]\\s*([^\\n]+)",
      "i"
    );
    var match = pattern.exec(text);
    return match && match[1] ? normalizeWhitespace(match[1]) : "";
  }

  function inferBookTitle(descriptionText, rawTitle) {
    var labeled = extractLabeledLine(descriptionText, [
      "有声书名",
      "书名",
      "作品名",
      "原著",
      "原作",
      "漫画名",
      "小说名",
      "节目名",
      "标题",
    ]);

    if (labeled) {
      return labeled;
    }

    var quoteMatch = /《([^》]{1,80})》/.exec(descriptionText || "");
    if (quoteMatch && quoteMatch[1]) {
      return normalizeWhitespace(quoteMatch[1]);
    }

    return stripBilibiliSuffix(rawTitle);
  }

  function inferAuthors(descriptionText) {
    var authors = [];
    var primary = extractLabeledLine(descriptionText, [
      "作者",
      "原著",
      "原作",
      "作家",
    ]);
    var artists = extractLabeledLine(descriptionText, [
      "作画",
      "绘者",
      "画师",
      "插画",
    ]);

    if (primary) {
      authors = authors.concat(splitPeople(primary));
    }
    if (artists) {
      authors = authors.concat(splitPeople(artists));
    }

    return uniqueStrings(authors);
  }

  function inferNarrators(descriptionText, uploaderName) {
    var narrators = splitPeople(
      extractLabeledLine(descriptionText, [
        "播讲",
        "主播",
        "演播",
        "旁白",
        "朗读",
        "CV",
        "配音",
      ])
    );

    if (!narrators.length && uploaderName) {
      narrators = [uploaderName];
    }

    return uniqueStrings(narrators);
  }

  function buildFolderName(bookTitle, authors) {
    var authorPrefix = authors && authors.length ? "[" + authors.join("&") + "] " : "";
    return sanitizeFileName(authorPrefix + bookTitle, "bilibili-audiobook");
  }

  function buildMetadata(parsed, overrides) {
    var options = overrides || {};
    var bookTitle = sanitizeFileName(
      options.seriesTitle || parsed.bookTitle || parsed.videoTitle,
      "未命名作品"
    );
    var episodeTitle = sanitizeFileName(
      options.episodeTitle || parsed.videoTitle || parsed.bookTitle,
      bookTitle
    );
    var authors = splitPeople(options.authors || parsed.authors.join(" / "));
    var narrators = splitPeople(options.narrators || parsed.narrators.join(" / "));
    var description = normalizeWhitespace(options.description || parsed.summary || "");
    var publisher = normalizeWhitespace(options.publisher || "");
    var language = normalizeWhitespace(options.language || "zh-CN") || "zh-CN";
    var coverFileName = sanitizeFileName(options.coverFileName || "cover.jpg", "cover.jpg");
    var audioFileName = sanitizeFileName(
      options.audioFileName || "01 - " + episodeTitle + ".m4a",
      "01 - " + bookTitle + ".m4a"
    );
    var folderName = sanitizeFileName(
      options.folderName || buildFolderName(bookTitle, authors),
      buildFolderName(bookTitle, authors)
    );

    var metadata = {
      title: bookTitle,
      subtitle: episodeTitle !== bookTitle ? episodeTitle : "",
      authors: authors,
      author: authors.join(" / "),
      narrators: narrators,
      narrator: narrators.join(" / "),
      uploader: parsed.uploaderName || "",
      uploaderBio: parsed.uploaderBio || "",
      description: description,
      language: language,
      publisher: publisher,
      tags: parsed.tags || [],
      cover: coverFileName,
      audio: audioFileName,
      source_url: parsed.sourceUrl || "",
      bvid: parsed.bvid || "",
      aid: parsed.aid || "",
      cid: parsed.cid || "",
      published_at: parsed.publishedAt || "",
      duration_ms: parsed.durationMs || 0,
      extractor: {
        name: "bilibili-audiobook-exporter",
        version: VERSION,
        parsed_from: parsed.parsedFrom || [],
      },
    };

    var series = {
      title: bookTitle,
      authors: authors,
      author: authors.join(" / "),
      description: description,
      language: language,
      publisher: publisher,
      cover: coverFileName,
      source_url: parsed.sourceUrl || "",
      bvid: parsed.bvid || "",
    };

    return {
      folderName: folderName,
      audioFileName: audioFileName,
      coverFileName: coverFileName,
      metadata: metadata,
      series: series,
    };
  }

  function parseHtml(html, options) {
    var source = String(html || "");
    var meta = buildMetaMap(source);
    var sourceUrl = extractCanonicalUrl(source, meta, options && options.url);
    var videoTitle = extractTitle(source, meta);
    var descriptionText = extractPageDescription(source, meta);
    var uploaderName = extractUploaderName(meta);
    var uploaderBio = extractUploaderBio(source);
    var playInfo = extractPlayInfo(source);
    var audioUrl =
      extractAudioUrlFromPluginAnchor(source) ||
      extractAudioUrlFromPluginLogs(source) ||
      extractAudioUrlFromPlayInfo(playInfo);

    var bookTitle = inferBookTitle(descriptionText, videoTitle);
    var authors = inferAuthors(descriptionText);
    var narrators = inferNarrators(descriptionText, uploaderName);
    var coverUrl = extractCoverUrl(source, meta);
    var tags = extractTags(source);
    var publishedAt = extractPublishedAt(meta);
    var durationMs = extractDurationMs(playInfo);
    var bvid = extractBvid(source, sourceUrl);
    var aid = extractAid(source);
    var cid = extractCid(source);
    var summary = descriptionText || uploaderBio || videoTitle;
    var metadataBundle;

    metadataBundle = buildMetadata(
      {
        videoTitle: videoTitle,
        bookTitle: bookTitle,
        authors: authors,
        narrators: narrators,
        summary: summary,
        uploaderName: uploaderName,
        uploaderBio: uploaderBio,
        tags: tags,
        coverUrl: coverUrl,
        sourceUrl: sourceUrl,
        publishedAt: publishedAt,
        durationMs: durationMs,
        bvid: bvid,
        aid: aid,
        cid: cid,
        parsedFrom: audioUrl
          ? ["plugin-link-or-playinfo", "meta", "page-description"]
          : ["meta", "page-description"],
      },
      {}
    );

    return {
      version: VERSION,
      sourceUrl: sourceUrl,
      videoTitle: videoTitle,
      bookTitle: bookTitle,
      descriptionText: descriptionText,
      summary: summary,
      uploaderName: uploaderName,
      uploaderBio: uploaderBio,
      authors: authors,
      narrators: narrators,
      tags: tags,
      coverUrl: coverUrl,
      audioUrl: audioUrl,
      publishedAt: publishedAt,
      durationMs: durationMs,
      bvid: bvid,
      aid: aid,
      cid: cid,
      suggestedFolderName: metadataBundle.folderName,
      audioFileName: metadataBundle.audioFileName,
      metadata: metadataBundle.metadata,
      series: metadataBundle.series,
      parsedFrom: metadataBundle.metadata.extractor.parsed_from,
    };
  }

  return {
    version: VERSION,
    parseHtml: parseHtml,
    buildMetadata: buildMetadata,
    sanitizeFileName: sanitizeFileName,
    normalizeUrl: normalizeUrl,
    normalizeBiliCoverUrl: normalizeBiliCoverUrl,
    splitPeople: splitPeople,
  };
});


(function (root) {
  "use strict";

  var Parser = root.BilibiliAudiobookParser;

  if (!Parser) {
    console.error("[bilibili-audiobook-exporter] parser is missing");
    return;
  }

  if (root.__BILIBILI_AUDIOBOOK_EXPORTER__) {
    root.__BILIBILI_AUDIOBOOK_EXPORTER__.open();
    return;
  }

  if (!/https:\/\/www\.bilibili\.com\/video\//.test(root.location.href)) {
    console.warn("[bilibili-audiobook-exporter] 当前版本只针对普通视频页启用。");
    return;
  }

  var state = {
    parsed: null,
    mounted: false,
    exporting: false,
  };

  var dom = {};

  function injectStyle() {
    var style = document.createElement("style");
    style.textContent = [
      ".be-root{position:fixed;right:24px;bottom:24px;z-index:2147483647;font-family:\"Microsoft YaHei\",system-ui,sans-serif;}",
      ".be-launcher{border:0;border-radius:999px;padding:12px 18px;background:#00a1d6;color:#fff;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.22);cursor:pointer;}",
      ".be-overlay{position:fixed;inset:0;background:rgba(12,18,28,.48);display:none;align-items:center;justify-content:center;padding:24px;}",
      ".be-overlay.is-open{display:flex;}",
      ".be-panel{width:min(860px,100%);max-height:min(90vh,960px);overflow:auto;background:#fff;border-radius:24px;box-shadow:0 24px 80px rgba(0,0,0,.28);}",
      ".be-header{display:flex;align-items:flex-start;justify-content:space-between;padding:24px 24px 12px;border-bottom:1px solid #edf2f7;gap:16px;}",
      ".be-title{margin:0;font-size:24px;line-height:1.2;color:#0f172a;}",
      ".be-subtitle{margin:6px 0 0;color:#64748b;font-size:13px;line-height:1.5;}",
      ".be-close{border:0;background:#f1f5f9;border-radius:999px;width:36px;height:36px;font-size:18px;cursor:pointer;}",
      ".be-body{padding:20px 24px 24px;display:grid;gap:18px;}",
      ".be-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;}",
      ".be-field{display:grid;gap:6px;}",
      ".be-field.be-span-2{grid-column:1 / -1;}",
      ".be-label{font-size:12px;font-weight:700;letter-spacing:.02em;color:#334155;}",
      ".be-input,.be-textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:14px;padding:10px 12px;font:inherit;color:#0f172a;background:#fff;}",
      ".be-input:focus,.be-textarea:focus{outline:none;border-color:#00a1d6;box-shadow:0 0 0 3px rgba(0,161,214,.16);}",
      ".be-textarea{min-height:108px;resize:vertical;line-height:1.5;}",
      ".be-pill-row{display:flex;flex-wrap:wrap;gap:8px;}",
      ".be-pill{display:inline-flex;align-items:center;gap:6px;padding:8px 10px;border-radius:999px;background:#f8fafc;color:#334155;font-size:12px;}",
      ".be-actions{display:flex;flex-wrap:wrap;gap:10px;padding-top:8px;}",
      ".be-button{border:0;border-radius:14px;padding:11px 14px;font:inherit;font-size:14px;cursor:pointer;}",
      ".be-button.primary{background:#0f172a;color:#fff;}",
      ".be-button.secondary{background:#e2e8f0;color:#0f172a;}",
      ".be-button.accent{background:#00a1d6;color:#fff;}",
      ".be-button:disabled{opacity:.55;cursor:not-allowed;}",
      ".be-status{padding:12px 14px;border-radius:16px;background:#f8fafc;color:#1e293b;font-size:13px;line-height:1.6;white-space:pre-wrap;}",
      ".be-checks{display:flex;flex-wrap:wrap;gap:12px;}",
      ".be-check{display:flex;align-items:center;gap:8px;font-size:13px;color:#334155;}",
      "@media (max-width: 720px){.be-grid{grid-template-columns:1fr;}.be-panel{border-radius:18px;}.be-root{right:16px;bottom:16px;}}",
    ].join("");
    document.head.appendChild(style);
  }

  function createDom() {
    var rootEl = document.createElement("div");
    rootEl.className = "be-root";
    rootEl.innerHTML = [
      '<button class="be-launcher" type="button">导出有声书</button>',
      '<div class="be-overlay" role="dialog" aria-modal="true">',
      '  <div class="be-panel">',
      '    <div class="be-header">',
      '      <div>',
      '        <h2 class="be-title">B 站有声书导出</h2>',
      '        <p class="be-subtitle">优先复用下载插件已解析出的音频直链，再回退到页面 playinfo。</p>',
      "      </div>",
      '      <button class="be-close" type="button" aria-label="关闭">×</button>',
      "    </div>",
      '    <div class="be-body">',
      '      <div class="be-pill-row">',
      '        <span class="be-pill" data-pill="audio">音频：未解析</span>',
      '        <span class="be-pill" data-pill="cover">封面：未解析</span>',
      '        <span class="be-pill" data-pill="meta">元数据：未解析</span>',
      "      </div>",
      '      <div class="be-grid">',
      '        <label class="be-field"><span class="be-label">书名</span><input class="be-input" data-field="seriesTitle" /></label>',
      '        <label class="be-field"><span class="be-label">副标题 / 当前视频标题</span><input class="be-input" data-field="episodeTitle" /></label>',
      '        <label class="be-field"><span class="be-label">作者</span><input class="be-input" data-field="authors" /></label>',
      '        <label class="be-field"><span class="be-label">播讲 / UP 主</span><input class="be-input" data-field="narrators" /></label>',
      '        <label class="be-field"><span class="be-label">语言 ISO</span><input class="be-input" data-field="language" placeholder="zh-CN" /></label>',
      '        <label class="be-field"><span class="be-label">出版社</span><input class="be-input" data-field="publisher" /></label>',
      '        <label class="be-field be-span-2"><span class="be-label">简介</span><textarea class="be-textarea" data-field="description"></textarea></label>',
      '        <label class="be-field"><span class="be-label">导出目录名</span><input class="be-input" data-field="folderName" /></label>',
      '        <label class="be-field"><span class="be-label">音频文件名</span><input class="be-input" data-field="audioFileName" /></label>',
      "      </div>",
      '      <div class="be-checks">',
      '        <label class="be-check"><input type="checkbox" data-field="generateCover" checked /> 生成 cover.jpg</label>',
      '        <label class="be-check"><input type="checkbox" data-field="generateSeriesJson" checked /> 生成 series.json</label>',
      "      </div>",
      '      <div class="be-actions">',
      '        <button class="be-button secondary" type="button" data-action="refresh">重新解析</button>',
      '        <button class="be-button secondary" type="button" data-action="copy-audio">复制音频直链</button>',
      '        <button class="be-button accent" type="button" data-action="download-files">多文件下载</button>',
      '        <button class="be-button primary" type="button" data-action="export-dir">导出到目录</button>',
      "      </div>",
      '      <div class="be-status" data-status>等待解析当前页面...</div>',
      "    </div>",
      "  </div>",
      "</div>",
    ].join("");

    document.body.appendChild(rootEl);

    dom.root = rootEl;
    dom.launcher = rootEl.querySelector(".be-launcher");
    dom.overlay = rootEl.querySelector(".be-overlay");
    dom.close = rootEl.querySelector(".be-close");
    dom.status = rootEl.querySelector("[data-status]");
    dom.audioPill = rootEl.querySelector('[data-pill="audio"]');
    dom.coverPill = rootEl.querySelector('[data-pill="cover"]');
    dom.metaPill = rootEl.querySelector('[data-pill="meta"]');
    dom.fields = {
      seriesTitle: rootEl.querySelector('[data-field="seriesTitle"]'),
      episodeTitle: rootEl.querySelector('[data-field="episodeTitle"]'),
      authors: rootEl.querySelector('[data-field="authors"]'),
      narrators: rootEl.querySelector('[data-field="narrators"]'),
      description: rootEl.querySelector('[data-field="description"]'),
      language: rootEl.querySelector('[data-field="language"]'),
      publisher: rootEl.querySelector('[data-field="publisher"]'),
      folderName: rootEl.querySelector('[data-field="folderName"]'),
      audioFileName: rootEl.querySelector('[data-field="audioFileName"]'),
      generateCover: rootEl.querySelector('[data-field="generateCover"]'),
      generateSeriesJson: rootEl.querySelector('[data-field="generateSeriesJson"]'),
    };
  }

  function setStatus(message) {
    dom.status.textContent = message;
  }

  function open() {
    dom.overlay.classList.add("is-open");
  }

  function close() {
    dom.overlay.classList.remove("is-open");
  }

  function parseCurrentPage() {
    state.parsed = Parser.parseHtml(document.documentElement.outerHTML, {
      url: root.location.href,
    });

    dom.audioPill.textContent = state.parsed.audioUrl ? "音频：已解析" : "音频：未解析";
    dom.coverPill.textContent = state.parsed.coverUrl ? "封面：已解析" : "封面：未解析";
    dom.metaPill.textContent =
      state.parsed.bookTitle || state.parsed.videoTitle ? "元数据：已解析" : "元数据：未解析";

    dom.fields.seriesTitle.value = state.parsed.bookTitle || state.parsed.videoTitle || "";
    dom.fields.episodeTitle.value = state.parsed.videoTitle || state.parsed.bookTitle || "";
    dom.fields.authors.value = (state.parsed.authors || []).join(" / ");
    dom.fields.narrators.value = (state.parsed.narrators || []).join(" / ");
    dom.fields.description.value = state.parsed.summary || "";
    dom.fields.language.value = state.parsed.metadata.language || "zh-CN";
    dom.fields.publisher.value = state.parsed.metadata.publisher || "";
    dom.fields.folderName.value = state.parsed.suggestedFolderName || "";
    dom.fields.audioFileName.value = state.parsed.audioFileName || "";
    dom.fields.generateCover.checked = true;
    dom.fields.generateSeriesJson.checked = true;

    setStatus(
      [
        "解析完成。",
        "书名：" + (state.parsed.bookTitle || "未识别"),
        "作者：" + ((state.parsed.authors || []).join(" / ") || "未识别"),
        "UP 主：" + (state.parsed.uploaderName || "未识别"),
        "BVID：" + (state.parsed.bvid || "未识别"),
      ].join("\n")
    );
  }

  function collectOverrides() {
    return {
      seriesTitle: dom.fields.seriesTitle.value,
      episodeTitle: dom.fields.episodeTitle.value,
      authors: dom.fields.authors.value,
      narrators: dom.fields.narrators.value,
      description: dom.fields.description.value,
      language: dom.fields.language.value || "zh-CN",
      publisher: dom.fields.publisher.value,
      folderName: dom.fields.folderName.value,
      audioFileName: dom.fields.audioFileName.value,
    };
  }

  function buildBundle() {
    return Parser.buildMetadata(state.parsed, collectOverrides());
  }

  async function copyAudioUrl() {
    if (!state.parsed || !state.parsed.audioUrl) {
      setStatus("没拿到音频直链。先确认页面已经可播放，或者让下载插件先完成解析。");
      return;
    }

    try {
      await navigator.clipboard.writeText(state.parsed.audioUrl);
      setStatus("音频直链已复制到剪贴板。");
    } catch (error) {
      setStatus("复制失败： " + error.message);
    }
  }

  function triggerDownload(blob, fileName) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 3000);
  }

  async function fetchBlob(url, label) {
    if (!url) {
      throw new Error(label + " 链接为空");
    }

    var response = await fetch(url, {
      credentials: "include",
      mode: "cors",
      referrer: root.location.href,
    });

    if (!response.ok) {
      throw new Error(label + " 下载失败，HTTP " + response.status);
    }

    return response.blob();
  }

  async function writeTextFile(directory, name, value) {
    var handle = await directory.getFileHandle(name, { create: true });
    var writable = await handle.createWritable();
    await writable.write(value);
    await writable.close();
  }

  async function writeBlobFile(directory, name, blob) {
    var handle = await directory.getFileHandle(name, { create: true });
    var writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function exportToDirectory() {
    if (!state.parsed || !state.parsed.audioUrl) {
      setStatus("当前页面还没有解析出音频直链，不能导出。");
      return;
    }

    if (!root.showDirectoryPicker) {
      setStatus("当前浏览器不支持目录写入 API，已建议改用“多文件下载”。");
      return;
    }

    if (state.exporting) {
      return;
    }

    state.exporting = true;
    var bundle = buildBundle();

    try {
      setStatus("正在下载音频...");
      var audioBlob = await fetchBlob(state.parsed.audioUrl, "音频");
      var coverBlob = null;

      if (dom.fields.generateCover.checked && state.parsed.coverUrl) {
        setStatus("正在下载音频...\n正在下载封面...");
        coverBlob = await fetchBlob(state.parsed.coverUrl, "封面");
      }

      setStatus("正在选择目录...");
      var rootDirectory = await root.showDirectoryPicker({
        mode: "readwrite",
      });
      var targetDirectory = await rootDirectory.getDirectoryHandle(bundle.folderName, {
        create: true,
      });

      setStatus("正在写入文件...");
      await writeBlobFile(targetDirectory, bundle.audioFileName, audioBlob);
      await writeTextFile(
        targetDirectory,
        "metadata.json",
        JSON.stringify(bundle.metadata, null, 2)
      );

      if (dom.fields.generateSeriesJson.checked) {
        await writeTextFile(
          targetDirectory,
          "series.json",
          JSON.stringify(bundle.series, null, 2)
        );
      }

      if (coverBlob) {
        await writeBlobFile(targetDirectory, bundle.coverFileName, coverBlob);
      }

      setStatus(
        [
          "导出完成。",
          "目录：" + bundle.folderName,
          "音频：" + bundle.audioFileName,
          "封面：" + (coverBlob ? bundle.coverFileName : "已跳过"),
        ].join("\n")
      );
    } catch (error) {
      setStatus("导出失败： " + error.message + "\n可以先试试“复制音频直链”或“多文件下载”。");
    } finally {
      state.exporting = false;
    }
  }

  async function downloadFiles() {
    if (!state.parsed || !state.parsed.audioUrl) {
      setStatus("当前页面还没有解析出音频直链，不能下载。");
      return;
    }

    if (state.exporting) {
      return;
    }

    state.exporting = true;
    var bundle = buildBundle();
    var prefix = bundle.folderName + "__";

    try {
      setStatus("正在准备多文件下载...");
      var audioBlob = await fetchBlob(state.parsed.audioUrl, "音频");
      triggerDownload(audioBlob, prefix + bundle.audioFileName);
      triggerDownload(
        new Blob([JSON.stringify(bundle.metadata, null, 2)], {
          type: "application/json",
        }),
        prefix + "metadata.json"
      );

      if (dom.fields.generateSeriesJson.checked) {
        triggerDownload(
          new Blob([JSON.stringify(bundle.series, null, 2)], {
            type: "application/json",
          }),
          prefix + "series.json"
        );
      }

      if (dom.fields.generateCover.checked && state.parsed.coverUrl) {
        var coverBlob = await fetchBlob(state.parsed.coverUrl, "封面");
        triggerDownload(coverBlob, prefix + bundle.coverFileName);
      }

      setStatus("多文件下载已触发。浏览器如果拦截多个下载，记得手动允许当前站点。");
    } catch (error) {
      setStatus("多文件下载失败： " + error.message);
    } finally {
      state.exporting = false;
    }
  }

  function bindEvents() {
    dom.launcher.addEventListener("click", open);
    dom.close.addEventListener("click", close);
    dom.overlay.addEventListener("click", function (event) {
      if (event.target === dom.overlay) {
        close();
      }
    });

    dom.root.querySelector('[data-action="refresh"]').addEventListener("click", function () {
      parseCurrentPage();
    });
    dom.root
      .querySelector('[data-action="copy-audio"]')
      .addEventListener("click", copyAudioUrl);
    dom.root
      .querySelector('[data-action="export-dir"]')
      .addEventListener("click", exportToDirectory);
    dom.root
      .querySelector('[data-action="download-files"]')
      .addEventListener("click", downloadFiles);
  }

  function mount() {
    if (state.mounted) {
      return;
    }

    injectStyle();
    createDom();
    bindEvents();
    parseCurrentPage();
    state.mounted = true;
  }

  root.__BILIBILI_AUDIOBOOK_EXPORTER__ = {
    open: open,
    close: close,
    refresh: parseCurrentPage,
  };

  mount();
})(typeof globalThis !== "undefined" ? globalThis : this);

