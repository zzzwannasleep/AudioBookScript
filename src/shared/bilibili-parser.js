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
