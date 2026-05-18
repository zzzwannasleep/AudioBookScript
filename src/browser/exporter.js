(function (root) {
  "use strict";

  var Parser = root.BilibiliAudiobookParser;
  var ZipBuilder = root.BilibiliZipBuilder;
  var BuildInfo = root.__BILIBILI_AUDIOBOOK_BUILD_INFO__ || {};
  var BILIBILI_API_ORIGIN = "https://api.bilibili.com";
  var UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  var UPDATE_STORAGE_KEY = "bilibili-audiobook-exporter:update-state";

  if (!Parser) {
    console.error("[bilibili-audiobook-exporter] parser is missing");
    return;
  }

  if (!ZipBuilder) {
    console.error("[bilibili-audiobook-exporter] zip builder is missing");
    return;
  }

  if (root.__BILIBILI_AUDIOBOOK_EXPORTER__) {
    root.__BILIBILI_AUDIOBOOK_EXPORTER__.open();
    return;
  }

  function isVideoPageUrl(url) {
    return /https:\/\/www\.bilibili\.com\/video\//.test(String(url || ""));
  }

  function getSpaceCollectionContext(urlString) {
    try {
      var url = new URL(urlString || root.location.href, root.location.href);
      var match;
      var type;
      var collectionType = "season";

      if (url.hostname !== "space.bilibili.com") {
        return null;
      }

      match = /^\/(\d+)\/lists\/(\d+)\/?$/.exec(url.pathname);
      if (!match) {
        return null;
      }

      type = String(url.searchParams.get("type") || "season").toLowerCase();
      if (type === "series") {
        collectionType = "series";
      } else if (type === "fav-season" || type === "fav_season" || type === "favorite") {
        collectionType = "fav-season";
      }

      return {
        kind: "space-collection",
        mid: match[1],
        listId: match[2],
        collectionType: collectionType,
        url: url.toString(),
      };
    } catch (error) {
      return null;
    }
  }

  function getPageContext(urlString) {
    var collection = getSpaceCollectionContext(urlString);

    if (collection) {
      return collection;
    }

    if (isVideoPageUrl(urlString)) {
      return {
        kind: "video",
        url: String(urlString || root.location.href),
      };
    }

    return {
      kind: "unsupported",
      url: String(urlString || root.location.href),
    };
  }

  var initialPageContext = getPageContext(root.location.href);

  if (initialPageContext.kind === "unsupported") {
    console.warn("[bilibili-audiobook-exporter] 当前版本只针对普通视频页启用。");
    return;
  }

  var state = {
    parsed: null,
    chapters: [],
    pageContext: initialPageContext,
    mounted: false,
    exporting: false,
    update: {
      currentVersion: BuildInfo.version || Parser.version || "0.1.0",
      latestVersion: "",
      installUrl: BuildInfo.downloadUrl || BuildInfo.updateUrl || "",
      available: false,
      checking: false,
      lastCheckedAt: 0,
      lastError: "",
    },
  };

  var dom = {};

  function injectStyle() {
    var style = document.createElement("style");
    style.textContent = [
      ".be-root{position:fixed;right:24px;bottom:24px;z-index:2147483647;font-family:\"Microsoft YaHei\",system-ui,sans-serif;}",
      ".be-launcher{border:0;border-radius:999px;padding:12px 18px;background:#00a1d6;color:#fff;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.22);cursor:pointer;}",
      ".be-overlay{position:fixed;inset:0;background:rgba(12,18,28,.48);display:none;align-items:center;justify-content:center;padding:24px;}",
      ".be-overlay.is-open{display:flex;}",
      ".be-panel{width:min(900px,100%);max-height:min(90vh,960px);overflow:auto;background:#fff;border-radius:24px;box-shadow:0 24px 80px rgba(0,0,0,.28);}",
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
      ".be-note{margin:0;color:#64748b;font-size:12px;line-height:1.5;}",
      ".be-pill-row{display:flex;flex-wrap:wrap;gap:8px;}",
      ".be-pill{display:inline-flex;align-items:center;gap:6px;padding:8px 10px;border-radius:999px;background:#f8fafc;color:#334155;font-size:12px;}",
      ".be-pill.is-hot{background:#fff7ed;color:#c2410c;}",
      ".be-actions{display:flex;flex-wrap:wrap;gap:10px;padding-top:8px;}",
      ".be-button{border:0;border-radius:14px;padding:11px 14px;font:inherit;font-size:14px;cursor:pointer;}",
      ".be-button.primary{background:#0f172a;color:#fff;}",
      ".be-button.secondary{background:#e2e8f0;color:#0f172a;}",
      ".be-button.accent{background:#00a1d6;color:#fff;}",
      ".be-button:disabled{opacity:.55;cursor:not-allowed;}",
      ".be-status{padding:12px 14px;border-radius:16px;background:#f8fafc;color:#1e293b;font-size:13px;line-height:1.6;white-space:pre-wrap;}",
      ".be-update-banner{display:none;padding:12px 14px;border-radius:16px;background:#fff7ed;color:#9a3412;font-size:13px;line-height:1.6;}",
      ".be-update-banner.is-visible{display:block;}",
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
      '        <p class="be-subtitle">默认走 ZIP 导出。单集适合短篇，多章节适合多 P 或合集页。</p>',
      "      </div>",
      '      <button class="be-close" type="button" aria-label="关闭">×</button>',
      "    </div>",
      '    <div class="be-body">',
      '      <div class="be-pill-row">',
      '        <span class="be-pill" data-pill="audio">音频：未解析</span>',
      '        <span class="be-pill" data-pill="cover">封面：未解析</span>',
      '        <span class="be-pill" data-pill="meta">元数据：未解析</span>',
      '        <span class="be-pill" data-pill="chapters">章节：未识别</span>',
      '        <span class="be-pill" data-pill="update">更新：待检查</span>',
      "      </div>",
      '      <div class="be-update-banner" data-update-banner></div>',
      '      <div class="be-grid">',
      '        <label class="be-field"><span class="be-label">书名 / 系列名</span><input class="be-input" data-field="seriesTitle" /></label>',
      '        <label class="be-field"><span class="be-label">当前章节标题（单集模式）</span><input class="be-input" data-field="episodeTitle" /></label>',
      '        <label class="be-field"><span class="be-label">作者</span><input class="be-input" data-field="authors" /></label>',
      '        <label class="be-field"><span class="be-label">播讲 / UP 主</span><input class="be-input" data-field="narrators" /></label>',
      '        <label class="be-field"><span class="be-label">语言 ISO</span><input class="be-input" data-field="language" placeholder="zh-CN" /></label>',
      '        <label class="be-field"><span class="be-label">出版社</span><input class="be-input" data-field="publisher" /></label>',
      '        <label class="be-field be-span-2"><span class="be-label">简介</span><textarea class="be-textarea" data-field="description"></textarea></label>',
      '        <label class="be-field be-span-2"><span class="be-label">压缩包 / 根目录名</span><input class="be-input" data-field="folderName" /></label>',
      "      </div>",
      '      <p class="be-note">音频文件名会自动整理成 `01 - 标题.m4a`。多章节模式会按每章一个子目录打包，系列信息放在压缩包根目录。</p>',
      '      <div class="be-checks">',
      '        <label class="be-check"><input type="checkbox" data-field="generateCover" checked /> 生成 cover.jpg</label>',
      '        <label class="be-check"><input type="checkbox" data-field="generateSeriesJson" checked /> 生成 series.json</label>',
      "      </div>",
      '      <div class="be-actions">',
      '        <button class="be-button secondary" type="button" data-action="refresh">重新解析</button>',
      '        <button class="be-button secondary" type="button" data-action="check-update">检查更新</button>',
      '        <button class="be-button secondary" type="button" data-action="copy-audio">复制当前音频直链</button>',
      '        <button class="be-button accent" type="button" data-action="download-single">下载单集 ZIP</button>',
      '        <button class="be-button primary" type="button" data-action="download-multi">下载多章节 ZIP</button>',
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
    dom.chapterPill = rootEl.querySelector('[data-pill="chapters"]');
    dom.updatePill = rootEl.querySelector('[data-pill="update"]');
    dom.updateBanner = rootEl.querySelector("[data-update-banner]");
    dom.actions = {
      refresh: rootEl.querySelector('[data-action="refresh"]'),
      checkUpdate: rootEl.querySelector('[data-action="check-update"]'),
      copyAudio: rootEl.querySelector('[data-action="copy-audio"]'),
      downloadSingle: rootEl.querySelector('[data-action="download-single"]'),
      downloadMulti: rootEl.querySelector('[data-action="download-multi"]'),
    };
    dom.fields = {
      seriesTitle: rootEl.querySelector('[data-field="seriesTitle"]'),
      episodeTitle: rootEl.querySelector('[data-field="episodeTitle"]'),
      authors: rootEl.querySelector('[data-field="authors"]'),
      narrators: rootEl.querySelector('[data-field="narrators"]'),
      description: rootEl.querySelector('[data-field="description"]'),
      language: rootEl.querySelector('[data-field="language"]'),
      publisher: rootEl.querySelector('[data-field="publisher"]'),
      folderName: rootEl.querySelector('[data-field="folderName"]'),
      generateCover: rootEl.querySelector('[data-field="generateCover"]'),
      generateSeriesJson: rootEl.querySelector('[data-field="generateSeriesJson"]'),
    };
  }

  function setStatus(message) {
    dom.status.textContent = message;
  }

  function readUpdateStorage() {
    try {
      return JSON.parse(root.localStorage.getItem(UPDATE_STORAGE_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function writeUpdateStorage(value) {
    try {
      root.localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(value));
    } catch (error) {
      return;
    }
  }

  function parseVersion(value) {
    return String(value || "")
      .split(/[^0-9]+/)
      .filter(Boolean)
      .map(function (item) {
        return Number(item);
      });
  }

  function compareVersions(left, right) {
    var leftParts = parseVersion(left);
    var rightParts = parseVersion(right);
    var length = Math.max(leftParts.length, rightParts.length);
    var index;

    for (index = 0; index < length; index += 1) {
      var leftValue = leftParts[index] || 0;
      var rightValue = rightParts[index] || 0;

      if (leftValue > rightValue) {
        return 1;
      }

      if (leftValue < rightValue) {
        return -1;
      }
    }

    if (String(left || "") === String(right || "")) {
      return 0;
    }

    return String(left || "") > String(right || "") ? 1 : -1;
  }

  function extractUserscriptHeaderValue(text, key) {
    var pattern = new RegExp("^//\\s*@" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+(.+)$", "mi");
    var match = pattern.exec(String(text || ""));
    return match && match[1] ? match[1].trim() : "";
  }

  function decodeBase64Text(value) {
    try {
      return root.atob(String(value || "").replace(/\s+/g, ""));
    } catch (error) {
      return "";
    }
  }

  function getUpdateMetaUrl() {
    return BuildInfo.updateMetaUrl || "";
  }

  function getInstallUrl() {
    return state.update.installUrl || BuildInfo.downloadUrl || BuildInfo.updateUrl || "";
  }

  function setLauncherText() {
    dom.launcher.textContent = state.update.available ? "导出有声书 · 有更新" : "导出有声书";
  }

  function renderUpdateState() {
    if (state.update.checking) {
      dom.updatePill.textContent = "更新：检查中";
      dom.updatePill.classList.remove("is-hot");
      dom.actions.checkUpdate.textContent = "检查中...";
      dom.updateBanner.classList.remove("is-visible");
      setLauncherText();
      return;
    }

    if (state.update.available) {
      dom.updatePill.textContent = "更新：" + state.update.latestVersion + " 可用";
      dom.updatePill.classList.add("is-hot");
      dom.actions.checkUpdate.textContent = "更新到 " + state.update.latestVersion;
      dom.updateBanner.textContent =
        "检测到新版本 " + state.update.latestVersion + "。点击“更新到 " +
        state.update.latestVersion + "”即可安装新脚本。";
      dom.updateBanner.classList.add("is-visible");
      setLauncherText();
      return;
    }

    dom.updatePill.textContent =
      state.update.lastCheckedAt ? "更新：已是最新" : "更新：待检查";
    dom.updatePill.classList.remove("is-hot");
    dom.actions.checkUpdate.textContent = "检查更新";

    if (state.update.lastError) {
      dom.updateBanner.textContent = "更新检查失败：" + state.update.lastError;
      dom.updateBanner.classList.add("is-visible");
    } else {
      dom.updateBanner.classList.remove("is-visible");
      dom.updateBanner.textContent = "";
    }

    setLauncherText();
  }

  function hydrateStoredUpdateState() {
    var stored = readUpdateStorage();
    var currentVersion = state.update.currentVersion;

    if (stored.currentVersion && compareVersions(stored.currentVersion, currentVersion) !== 0) {
      writeUpdateStorage({});
      renderUpdateState();
      return;
    }

    if (stored.lastCheckedAt) {
      state.update.lastCheckedAt = stored.lastCheckedAt;
    }

    if (stored.installUrl) {
      state.update.installUrl = stored.installUrl;
    }

    if (stored.latestVersion && compareVersions(stored.latestVersion, currentVersion) > 0) {
      state.update.latestVersion = stored.latestVersion;
      state.update.available = true;
    }

    renderUpdateState();
  }

  function persistUpdateState() {
    writeUpdateStorage({
      currentVersion: state.update.currentVersion,
      latestVersion: state.update.latestVersion,
      installUrl: state.update.installUrl,
      lastCheckedAt: state.update.lastCheckedAt,
    });
  }

  function shouldCheckForUpdates(force) {
    if (force) {
      return true;
    }

    if (!getUpdateMetaUrl()) {
      return false;
    }

    if (!state.update.lastCheckedAt) {
      return true;
    }

    return Date.now() - state.update.lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
  }

  async function fetchRemoteVersionInfo() {
    var metaUrl = getUpdateMetaUrl();

    if (!metaUrl) {
      throw new Error("未配置更新元数据地址");
    }

    var requestUrl = metaUrl + (metaUrl.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now();
    var response = await fetch(requestUrl, {
      credentials: "omit",
      mode: "cors",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    var payload = await response.json();
    var content = decodeBase64Text(payload.content || "");
    var remoteVersion = extractUserscriptHeaderValue(content, "version");
    var remoteInstallUrl =
      extractUserscriptHeaderValue(content, "downloadURL") ||
      payload.download_url ||
      BuildInfo.downloadUrl ||
      BuildInfo.updateUrl ||
      "";

    if (!remoteVersion) {
      throw new Error("未能解析远端版本号");
    }

    return {
      version: remoteVersion,
      installUrl: remoteInstallUrl,
    };
  }

  async function checkForUpdates(force, silent) {
    if (state.update.checking || !shouldCheckForUpdates(force)) {
      return;
    }

    state.update.checking = true;
    state.update.lastError = "";
    renderUpdateState();

    try {
      var remoteInfo = await fetchRemoteVersionInfo();
      state.update.lastCheckedAt = Date.now();
      state.update.latestVersion = remoteInfo.version;
      state.update.installUrl = remoteInfo.installUrl || state.update.installUrl;
      state.update.available =
        compareVersions(remoteInfo.version, state.update.currentVersion) > 0;
      state.update.lastError = "";
      persistUpdateState();
      renderUpdateState();

      if (!silent) {
        if (state.update.available) {
          setStatus(
            "检测到新版本 " +
              remoteInfo.version +
              "。\n点击“更新到 " +
              remoteInfo.version +
              "”即可安装新版脚本。"
          );
        } else {
          setStatus("已检查更新，当前脚本已经是最新版本。");
        }
      }
    } catch (error) {
      state.update.lastCheckedAt = Date.now();
      state.update.lastError = error.message || "未知错误";
      persistUpdateState();
      renderUpdateState();

      if (!silent) {
        setStatus("检查更新失败： " + state.update.lastError);
      }
    } finally {
      state.update.checking = false;
      renderUpdateState();
    }
  }

  function openUpdateInstall() {
    var installUrl = getInstallUrl();

    if (!installUrl) {
      setStatus("当前没有可用的安装链接。");
      return;
    }

    root.open(installUrl, "_blank", "noopener");
    setStatus("已打开更新链接。如果 Tampermonkey 接管成功，会提示你安装新版本。");
  }

  function open() {
    dom.overlay.classList.add("is-open");
  }

  function close() {
    dom.overlay.classList.remove("is-open");
  }

  function extractBvidFromText(value) {
    var match = /(BV[0-9A-Za-z]{10,})/.exec(String(value || ""));
    return match && match[1] ? match[1] : "";
  }

  function readPath(source, path) {
    var current = source;
    var segments = String(path || "").split(".");
    var index;

    for (index = 0; index < segments.length; index += 1) {
      if (current == null || typeof current !== "object") {
        return undefined;
      }

      current = current[segments[index]];
    }

    return current;
  }

  function firstNonEmptyPath(source, paths) {
    var index;

    for (index = 0; index < paths.length; index += 1) {
      var value = readPath(source, paths[index]);

      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }

      if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
      }
    }

    return "";
  }

  function firstArrayPath(source, paths) {
    var index;

    for (index = 0; index < paths.length; index += 1) {
      var value = readPath(source, paths[index]);

      if (Array.isArray(value)) {
        return value;
      }
    }

    return [];
  }

  function mergeCollectionMeta(left, right) {
    return {
      title: right.title || left.title || "",
      description: right.description || left.description || "",
      ownerName: right.ownerName || left.ownerName || "",
      coverUrl: right.coverUrl || left.coverUrl || "",
    };
  }

  async function fetchJson(path, params) {
    var requestUrl = new URL(path, BILIBILI_API_ORIGIN);
    var query = params || {};
    var key;

    for (key in query) {
      if (
        Object.prototype.hasOwnProperty.call(query, key) &&
        query[key] != null &&
        query[key] !== ""
      ) {
        requestUrl.searchParams.set(key, String(query[key]));
      }
    }

    var response = await fetch(requestUrl.toString(), {
      credentials: "include",
      mode: "cors",
      referrer: root.location.href,
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    var payload = await response.json();

    if (payload && typeof payload.code !== "undefined" && payload.code !== 0) {
      throw new Error((payload.message || payload.msg || "API error") + " (" + payload.code + ")");
    }

    return payload;
  }

  function getCurrentPageNumber() {
    try {
      var url = new URL(root.location.href);
      var value = Number(url.searchParams.get("p") || "1");
      if (Number.isFinite(value) && value > 0) {
        return Math.floor(value);
      }
    } catch (error) {
      return 1;
    }

    return 1;
  }

  function buildPageUrl(baseUrl, pageNumber) {
    var fallback = root.location.href;
    var source = baseUrl || fallback;
    var url = new URL(source, fallback);
    var clean = new URL(url.origin + url.pathname);

    if (pageNumber > 1) {
      clean.searchParams.set("p", String(pageNumber));
    }

    return clean.toString();
  }

  function cloneParsed(parsed, sourceUrl) {
    var next = {};
    var key;

    for (key in parsed) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        next[key] = parsed[key];
      }
    }

    next.sourceUrl = sourceUrl || parsed.sourceUrl || "";
    return next;
  }

  function normalizeChapterTitle(value, fallback) {
    return Parser.sanitizeFileName(value, fallback || "未命名章节");
  }

  function getRuntimeInitialState() {
    return root.__INITIAL_STATE__ || null;
  }

  function finalizeChapterList(chapters) {
    var total = chapters.length;
    var normalized = chapters.map(function (chapter, index) {
      return {
        trackNumber: chapter.trackNumber || index + 1,
        trackTotal: total,
        pageNumber: chapter.pageNumber || index + 1,
        bvid: chapter.bvid || extractBvidFromText(chapter.url || ""),
        cid: chapter.cid || "",
        title: normalizeChapterTitle(chapter.title, "第" + String(index + 1) + "章"),
        url: chapter.url || root.location.href,
        isCurrent: Boolean(chapter.isCurrent),
      };
    });

    if (normalized.length) {
      var hasCurrent = normalized.some(function (chapter) {
        return chapter.isCurrent;
      });

      if (!hasCurrent) {
        normalized[0].isCurrent = true;
      }
    }

    return normalized;
  }

  function extractVideoPageChapters(initialState, parsed) {
    if (
      !initialState ||
      !initialState.videoData ||
      !Array.isArray(initialState.videoData.pages) ||
      initialState.videoData.pages.length <= 1
    ) {
      return [];
    }

    var currentPageNumber = getCurrentPageNumber();
    var sourceUrl = parsed.sourceUrl || root.location.href;

    return finalizeChapterList(
      initialState.videoData.pages.map(function (pageItem, index) {
        var pageNumber = Number(pageItem.page || index + 1) || index + 1;
        var cid = String(pageItem.cid || "");

        return {
          trackNumber: index + 1,
          pageNumber: pageNumber,
          cid: cid,
          title: pageItem.part || parsed.videoTitle || "第" + String(index + 1) + "章",
          url: buildPageUrl(sourceUrl, pageNumber),
          isCurrent:
            (cid && String(parsed.cid || "") === cid) || currentPageNumber === pageNumber,
        };
      })
    );
  }

  function buildSeasonEpisodeUrl(parsed, episode, fallbackIndex) {
    var directUrl =
      episode.share_url ||
      episode.short_link ||
      episode.url ||
      episode.link ||
      episode.jump_url ||
      "";

    if (directUrl) {
      return Parser.normalizeUrl(directUrl);
    }

    if (episode.bvid) {
      return buildPageUrl("https://www.bilibili.com/video/" + episode.bvid + "/", episode.page || 1);
    }

    return buildPageUrl(parsed.sourceUrl || root.location.href, fallbackIndex + 1);
  }

  function buildSeasonEpisodeTitle(episode, fallbackIndex) {
    var primary = episode.long_title || "";
    var secondary = episode.title || "";
    var nested = episode.arc && episode.arc.title ? episode.arc.title : "";
    var segments = [secondary, primary, nested].filter(function (value, index, array) {
      return value && array.indexOf(value) === index;
    });

    if (segments.length) {
      return segments.join(" - ");
    }

    return "第" + String(fallbackIndex + 1) + "章";
  }

  function extractSeasonChapters(initialState, parsed) {
    var season = initialState && (initialState.ugcSeason || initialState.ugc_season);
    var sections = season && Array.isArray(season.sections) ? season.sections : [];
    var collected = [];
    var seen = new Set();
    var currentIndex = 0;

    sections.forEach(function (section) {
      var episodes = Array.isArray(section.episodes) ? section.episodes : [];

      episodes.forEach(function (episode) {
        var cid = String(episode.cid || "");
        var url = buildSeasonEpisodeUrl(parsed, episode, currentIndex);
        var key = [episode.bvid || "", cid, url].join("|");

        if (seen.has(key)) {
          return;
        }

        seen.add(key);
        collected.push({
          trackNumber: currentIndex + 1,
          pageNumber: episode.page || currentIndex + 1,
          cid: cid,
          title: buildSeasonEpisodeTitle(episode, currentIndex),
          url: url,
          isCurrent:
            (episode.bvid && String(episode.bvid) === String(parsed.bvid || "")) ||
            (cid && cid === String(parsed.cid || "")),
        });
        currentIndex += 1;
      });
    });

    if (collected.length <= 1) {
      return [];
    }

    return finalizeChapterList(collected);
  }

  function getCollectionCurrentBvid() {
    var selectors = [
      'a[href*="/video/BV"][aria-current="page"]',
      'a[href*="/video/BV"][aria-selected="true"]',
      '.active a[href*="/video/BV"]',
      '.is-active a[href*="/video/BV"]',
      'a[href*="/video/BV"].active',
      'a[href*="/video/BV"].is-active',
    ];
    var index;

    for (index = 0; index < selectors.length; index += 1) {
      var candidate = document.querySelector(selectors[index]);

      if (candidate && candidate.href) {
        var bvid = extractBvidFromText(candidate.href);

        if (bvid) {
          return bvid;
        }
      }
    }

    return "";
  }

  function getCollectionArchiveItems(data) {
    return firstArrayPath(data, [
      "archives",
      "list.archives",
      "items",
      "medias",
      "videos",
      "vlist",
      "list.vlist",
      "list",
    ]);
  }

  function getCollectionPageTotal(data) {
    var value = Number(
      firstNonEmptyPath(data, [
        "page.total",
        "page.count",
        "total",
        "count",
        "page_info.total",
      ])
    );

    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }

    return Math.floor(value);
  }

  function extractCollectionMeta(data, items) {
    return {
      title: firstNonEmptyPath(data, [
        "meta.name",
        "meta.title",
        "season.name",
        "season.title",
        "series.name",
        "series.title",
        "info.name",
        "info.title",
        "list_info.name",
        "list_info.title",
      ]),
      description: firstNonEmptyPath(data, [
        "meta.description",
        "meta.desc",
        "meta.intro",
        "meta.summary",
        "season.description",
        "season.desc",
        "series.description",
        "series.desc",
        "series.intro",
        "info.description",
        "info.desc",
        "info.intro",
      ]),
      ownerName: firstNonEmptyPath(data, [
        "meta.upper.name",
        "meta.owner.name",
        "owner.name",
        "upper.name",
        "info.upper.name",
        "info.owner.name",
      ]),
      coverUrl:
        Parser.normalizeBiliCoverUrl(
          firstNonEmptyPath(data, [
            "meta.cover",
            "meta.square_cover",
            "meta.pic",
            "season.cover",
            "series.cover",
            "info.cover",
            "info.pic",
          ])
        ) ||
        Parser.normalizeBiliCoverUrl(
          firstNonEmptyPath(items && items[0], ["cover", "pic", "arc.pic", "author.face"])
        ),
    };
  }

  function getCollectionArchiveBvid(archive) {
    return firstNonEmptyPath(archive, ["bvid", "bv_id", "arc.bvid", "video.bvid"]);
  }

  function getCollectionArchiveCid(archive) {
    return String(
      firstNonEmptyPath(archive, ["cid", "page.cid", "pages.0.cid", "arc.cid"]) || ""
    );
  }

  function getCollectionArchivePageNumber(archive, fallbackValue) {
    var value = Number(
      firstNonEmptyPath(archive, ["page.page", "pages.0.page", "arc.page", "page"]) ||
        fallbackValue ||
        1
    );

    if (!Number.isFinite(value) || value <= 0) {
      return fallbackValue || 1;
    }

    return Math.floor(value);
  }

  function buildCollectionArchiveUrl(parsed, archive, fallbackIndex) {
    var directUrl = firstNonEmptyPath(archive, [
      "share_url",
      "short_link",
      "url",
      "uri",
      "link",
      "jump_url",
      "arc.jump_url",
    ]);
    var bvid = getCollectionArchiveBvid(archive);
    var pageNumber = getCollectionArchivePageNumber(archive, 1);

    if (directUrl) {
      return Parser.normalizeUrl(directUrl);
    }

    if (bvid) {
      return buildPageUrl("https://www.bilibili.com/video/" + bvid + "/", pageNumber);
    }

    return "";
  }

  function buildCollectionArchiveTitle(archive, fallbackIndex) {
    var title = firstNonEmptyPath(archive, [
      "title",
      "intro",
      "name",
      "arc.title",
      "page.part",
      "pages.0.part",
    ]);
    var subtitle = firstNonEmptyPath(archive, ["long_title", "subtitle", "arc.subtitle"]);
    var segments = [title, subtitle].filter(function (value, index, array) {
      return value && array.indexOf(value) === index;
    });

    if (segments.length) {
      return segments.join(" - ");
    }

    return "Chapter " + String(fallbackIndex + 1);
  }

  function buildCollectionChapters(parsed, archives) {
    var currentBvid = getCollectionCurrentBvid();
    var collected = [];
    var seen = new Set();

    archives.forEach(function (archive) {
      var fallbackIndex = collected.length;
      var bvid = getCollectionArchiveBvid(archive);
      var cid = getCollectionArchiveCid(archive);
      var url = buildCollectionArchiveUrl(parsed, archive, fallbackIndex);
      var pageNumber = getCollectionArchivePageNumber(archive, fallbackIndex + 1);
      var key = [bvid || "", cid, url].join("|");

      if (!url || seen.has(key)) {
        return;
      }

      seen.add(key);
      collected.push({
        trackNumber: fallbackIndex + 1,
        pageNumber: pageNumber,
        bvid: bvid,
        cid: cid,
        title: buildCollectionArchiveTitle(archive, fallbackIndex),
        url: url,
        isCurrent:
          (currentBvid && bvid && currentBvid === bvid) ||
          (cid && String(parsed.cid || "") === cid),
      });
    });

    return finalizeChapterList(collected);
  }

  async function fetchCollectionArchivePage(pageContext, pageNumber, pageSize) {
    if (pageContext.collectionType === "series") {
      return fetchJson("/x/series/archives", {
        mid: pageContext.mid,
        current_mid: pageContext.mid,
        series_id: pageContext.listId,
        only_normal: "true",
        ps: pageSize,
        pn: pageNumber,
      });
    }

    if (pageContext.collectionType === "fav-season") {
      return fetchJson("/x/space/fav/season/list", {
        season_id: pageContext.listId,
        ps: pageSize,
        pn: pageNumber,
      });
    }

    return fetchJson("/x/polymer/web-space/seasons_archives_list", {
      mid: pageContext.mid,
      season_id: pageContext.listId,
      sort_reverse: "false",
      page_size: pageSize,
      page_num: pageNumber,
    });
  }

  async function fetchCollectionData(pageContext, parsed) {
    var pageNumber = 1;
    var pageSize = 100;
    var pagesGuard = 0;
    var archives = [];
    var meta = {
      title: "",
      description: "",
      ownerName: "",
      coverUrl: "",
    };

    while (pagesGuard < 50) {
      var payload = await fetchCollectionArchivePage(pageContext, pageNumber, pageSize);
      var data = payload && payload.data ? payload.data : {};
      var items = getCollectionArchiveItems(data);

      meta = mergeCollectionMeta(meta, extractCollectionMeta(data, items));

      if (!items.length) {
        break;
      }

      archives = archives.concat(items);

      var total = getCollectionPageTotal(data);
      if ((total && archives.length >= total) || items.length < pageSize) {
        break;
      }

      pageNumber += 1;
      pagesGuard += 1;
    }

    var chapters = buildCollectionChapters(parsed, archives);

    if (!chapters.length) {
      throw new Error("Unable to parse collection chapters");
    }

    return {
      chapters: chapters,
      meta: meta,
    };
  }

  function getCurrentChapterFromList(chapters) {
    var current = chapters.find(function (chapter) {
      return chapter.isCurrent;
    });

    return current || chapters[0] || null;
  }

  function applyCollectionMeta(parsed, collectionMeta, chapters) {
    var next = cloneParsed(parsed, parsed.sourceUrl);
    var currentChapter = getCurrentChapterFromList(chapters);
    var ownerName = collectionMeta.ownerName || next.uploaderName || "";
    var bundle;

    if (collectionMeta.title) {
      next.bookTitle = collectionMeta.title;
      next.videoTitle = next.videoTitle || collectionMeta.title;
    }

    if (collectionMeta.description) {
      next.descriptionText = collectionMeta.description;
      next.summary = collectionMeta.description;
    }

    if (collectionMeta.coverUrl) {
      next.coverUrl = collectionMeta.coverUrl;
    }

    if (!next.uploaderName && ownerName) {
      next.uploaderName = ownerName;
    }

    if ((!next.narrators || !next.narrators.length) && ownerName) {
      next.narrators = [ownerName];
    }

    bundle = Parser.buildMetadata(next, {
      seriesTitle: next.bookTitle || next.videoTitle,
      episodeTitle:
        (currentChapter && currentChapter.title) || next.videoTitle || next.bookTitle,
      authors: (next.authors || []).join(" / "),
      narrators: (next.narrators || []).join(" / "),
      description: next.summary || "",
    });

    next.suggestedFolderName = bundle.folderName;
    next.audioFileName = bundle.audioFileName;
    next.metadata = bundle.metadata;
    next.series = bundle.series;
    next.parsedFrom = (next.parsedFrom || []).concat(["space-collection-api"]).filter(function (
      value,
      index,
      array
    ) {
      return value && array.indexOf(value) === index;
    });

    return next;
  }

  function resolveParsedSourceUrl(parsed, pageContext) {
    if (pageContext && pageContext.kind === "video") {
      return buildPageUrl(parsed.sourceUrl || root.location.href, getCurrentPageNumber());
    }

    return root.location.href;
  }

  function extractVideoRuntimeChapters(parsed) {
    var initialState = getRuntimeInitialState();
    var chapters = extractVideoPageChapters(initialState, parsed);

    if (chapters.length) {
      return chapters;
    }

    chapters = extractSeasonChapters(initialState, parsed);
    if (chapters.length) {
      return chapters;
    }

    return finalizeChapterList([
      {
        trackNumber: 1,
        pageNumber: getCurrentPageNumber(),
        cid: String(parsed.cid || ""),
        title: parsed.videoTitle || parsed.bookTitle || "当前章节",
        url: buildPageUrl(parsed.sourceUrl || root.location.href, getCurrentPageNumber()),
        isCurrent: true,
      },
    ]);
  }

  async function resolvePageState(parsed, pageContext) {
    if (pageContext && pageContext.kind === "space-collection") {
      var collectionData = await fetchCollectionData(pageContext, parsed);

      return {
        parsed: applyCollectionMeta(parsed, collectionData.meta, collectionData.chapters),
        chapters: collectionData.chapters,
      };
    }

    return {
      parsed: parsed,
      chapters: extractVideoRuntimeChapters(parsed),
    };
  }

  function getCurrentChapter() {
    return getCurrentChapterFromList(state.chapters);
  }

  function updateActionState() {
    var hasParsed = Boolean(state.parsed);
    var hasCurrentAudio = Boolean(state.parsed && state.parsed.audioUrl);
    var hasMultiChapters = state.chapters.length > 1;

    dom.actions.refresh.disabled = state.exporting;
    dom.actions.checkUpdate.disabled = state.exporting || state.update.checking;
    dom.actions.copyAudio.disabled = state.exporting || !hasCurrentAudio;
    dom.actions.downloadSingle.disabled = state.exporting || !hasParsed;
    dom.actions.downloadMulti.disabled = state.exporting || !hasParsed || !hasMultiChapters;
    renderUpdateState();
  }

  function parseCurrentPageLegacy() {
    state.parsed = Parser.parseHtml(document.documentElement.outerHTML, {
      url: root.location.href,
    });
    state.parsed.sourceUrl = buildPageUrl(state.parsed.sourceUrl || root.location.href, getCurrentPageNumber());
    state.chapters = extractVideoRuntimeChapters(state.parsed);

    var currentChapter = getCurrentChapter();

    dom.audioPill.textContent = state.parsed.audioUrl ? "音频：已解析" : "音频：待抓取";
    dom.coverPill.textContent = state.parsed.coverUrl ? "封面：已解析" : "封面：未解析";
    dom.metaPill.textContent =
      state.parsed.bookTitle || state.parsed.videoTitle ? "元数据：已解析" : "元数据：未解析";
    dom.chapterPill.textContent =
      state.chapters.length > 1 ? "章节：" + state.chapters.length + " 章" : "章节：单集";

    dom.fields.seriesTitle.value = state.parsed.bookTitle || state.parsed.videoTitle || "";
    dom.fields.episodeTitle.value =
      (currentChapter && currentChapter.title) || state.parsed.videoTitle || state.parsed.bookTitle || "";
    dom.fields.authors.value = (state.parsed.authors || []).join(" / ");
    dom.fields.narrators.value = (state.parsed.narrators || []).join(" / ");
    dom.fields.description.value = state.parsed.summary || "";
    dom.fields.language.value = state.parsed.metadata.language || "zh-CN";
    dom.fields.publisher.value = state.parsed.metadata.publisher || "";
    dom.fields.folderName.value = state.parsed.suggestedFolderName || "";
    dom.fields.generateCover.checked = true;
    dom.fields.generateSeriesJson.checked = true;

    setStatus(
      [
        "解析完成。",
        "书名：" + (state.parsed.bookTitle || "未识别"),
        "当前章节：" + ((currentChapter && currentChapter.title) || "未识别"),
        "作者：" + ((state.parsed.authors || []).join(" / ") || "未识别"),
        "章节数：" + String(state.chapters.length),
        state.chapters.length > 1 ? "已可直接下载多章节 ZIP。" : "当前更适合用单集 ZIP。",
      ].join("\n")
    );

    updateActionState();
  }

  async function parseCurrentPage() {
    state.pageContext = getPageContext(root.location.href);
    state.parsed = null;
    state.chapters = [];
    setStatus(
      state.pageContext.kind === "space-collection"
        ? "Resolving collection chapters..."
        : "Waiting for page analysis..."
    );
    updateActionState();

    try {
      var parsed = Parser.parseHtml(document.documentElement.outerHTML, {
        url: root.location.href,
      });
      var resolvedState;
      var currentChapter;

      parsed.sourceUrl = resolveParsedSourceUrl(parsed, state.pageContext);
      resolvedState = await resolvePageState(parsed, state.pageContext);
      state.parsed = resolvedState.parsed;
      state.chapters = resolvedState.chapters;
      currentChapter = getCurrentChapter();
      dom.audioPill.textContent = state.parsed.audioUrl ? "Audio: ready" : "Audio: pending";
      dom.coverPill.textContent = state.parsed.coverUrl ? "Cover: ready" : "Cover: pending";
      dom.metaPill.textContent =
        state.parsed.bookTitle || state.parsed.videoTitle
          ? "Metadata: ready"
          : "Metadata: missing";
      dom.chapterPill.textContent =
        state.chapters.length > 1 ? "Chapters: " + state.chapters.length : "Chapters: single";
      /*

      dom.audioPill.textContent = state.parsed.audioUrl ? "闊抽锛氬凡瑙ｆ瀽" : "闊抽锛氬緟鎶撳彇";
      dom.coverPill.textContent = state.parsed.coverUrl ? "灏侀潰锛氬凡瑙ｆ瀽" : "灏侀潰锛氭湭瑙ｆ瀽";
      dom.metaPill.textContent =
        state.parsed.bookTitle || state.parsed.videoTitle ? "鍏冩暟鎹細宸茶В鏋? : "鍏冩暟鎹細鏈В鏋?;
      dom.chapterPill.textContent =
        state.chapters.length > 1 ? "绔犺妭锛? + state.chapters.length + " 绔? : "绔犺妭锛氬崟闆?;

      */
      dom.fields.seriesTitle.value = state.parsed.bookTitle || state.parsed.videoTitle || "";
      dom.fields.episodeTitle.value =
        (currentChapter && currentChapter.title) || state.parsed.videoTitle || state.parsed.bookTitle || "";
      dom.fields.authors.value = (state.parsed.authors || []).join(" / ");
      dom.fields.narrators.value = (state.parsed.narrators || []).join(" / ");
      dom.fields.description.value = state.parsed.summary || "";
      dom.fields.language.value = state.parsed.metadata.language || "zh-CN";
      dom.fields.publisher.value = state.parsed.metadata.publisher || "";
      dom.fields.folderName.value = state.parsed.suggestedFolderName || "";
      dom.fields.generateCover.checked = true;
      dom.fields.generateSeriesJson.checked = true;
      setStatus(
        [
          "Analysis complete.",
          "Series: " + (state.parsed.bookTitle || "Unknown"),
          "Current chapter: " + ((currentChapter && currentChapter.title) || "Unknown"),
          "Authors: " + ((state.parsed.authors || []).join(" / ") || "Unknown"),
          "Chapter count: " + String(state.chapters.length),
          state.chapters.length > 1
            ? "Multi-chapter ZIP is ready."
            : "Single-chapter ZIP is recommended.",
        ].join("\n")
      );
      /*

      setStatus(
        [
          "瑙ｆ瀽瀹屾垚銆?,
          "涔﹀悕锛? + (state.parsed.bookTitle || "鏈瘑鍒?),
          "褰撳墠绔犺妭锛? + ((currentChapter && currentChapter.title) || "鏈瘑鍒?),
          "浣滆€咃細" + ((state.parsed.authors || []).join(" / ") || "鏈瘑鍒?),
          "绔犺妭鏁帮細" + String(state.chapters.length),
          state.chapters.length > 1 ? "宸插彲鐩存帴涓嬭浇澶氱珷鑺?ZIP銆? : "褰撳墠鏇撮€傚悎鐢ㄥ崟闆?ZIP銆?,
        ].join("\n")
      );
      */
    } catch (error) {
      state.parsed = null;
      state.chapters = [];
      dom.audioPill.textContent = "Audio: missing";
      dom.coverPill.textContent = "Cover: missing";
      dom.metaPill.textContent = "Metadata: missing";
      dom.chapterPill.textContent = "Chapters: failed";
      /*
      dom.audioPill.textContent = "闊抽锛氭湭瑙ｆ瀽";
      dom.coverPill.textContent = "灏侀潰锛氭湭瑙ｆ瀽";
      dom.metaPill.textContent = "鍏冩暟鎹細鏈В鏋?";
      dom.chapterPill.textContent = "绔犺妭锛氳В鏋愬け璐?";
      */
      setStatus("Parse failed: " + (error.message || "unknown error"));
    }

    updateActionState();
  }

  function collectCommonOverrides() {
    return {
      seriesTitle: dom.fields.seriesTitle.value,
      authors: dom.fields.authors.value,
      narrators: dom.fields.narrators.value,
      description: dom.fields.description.value,
      language: dom.fields.language.value || "zh-CN",
      publisher: dom.fields.publisher.value,
      folderName: dom.fields.folderName.value,
    };
  }

  function buildSingleBundle(parsedChapter) {
    return Parser.buildMetadata(
      parsedChapter,
      Object.assign({}, collectCommonOverrides(), {
        episodeTitle: dom.fields.episodeTitle.value || parsedChapter.videoTitle || parsedChapter.bookTitle,
        trackNumber: 1,
        trackTotal: 1,
      })
    );
  }

  function buildSeriesBundle() {
    var currentChapter = getCurrentChapter();

    return Parser.buildMetadata(
      state.parsed,
      Object.assign({}, collectCommonOverrides(), {
        episodeTitle:
          (currentChapter && currentChapter.title) || state.parsed.videoTitle || state.parsed.bookTitle,
        trackNumber: 1,
        trackTotal: state.chapters.length || 1,
      })
    );
  }

  function buildChapterBundle(parsedChapter, chapter) {
    return Parser.buildMetadata(
      parsedChapter,
      Object.assign({}, collectCommonOverrides(), {
        episodeTitle: chapter.title,
        trackNumber: chapter.trackNumber,
        trackTotal: chapter.trackTotal,
      })
    );
  }

  async function copyAudioUrl() {
    if (!state.parsed || !state.parsed.audioUrl) {
      setStatus("当前页面还没拿到音频直链。可以先直接试试单集 ZIP，它会自动补抓当前章节。");
      return;
    }

    try {
      await navigator.clipboard.writeText(state.parsed.audioUrl);
      setStatus("当前章节音频直链已复制到剪贴板。");
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

  function formatUnixTimestamp(timestamp) {
    var numeric = Number(timestamp || 0);

    if (!Number.isFinite(numeric) || numeric <= 0) {
      return "";
    }

    try {
      return new Date(numeric * 1000).toISOString();
    } catch (error) {
      return "";
    }
  }

  function getChapterPageNumber(chapter) {
    var value = Number(chapter && chapter.pageNumber ? chapter.pageNumber : 1);

    if (!Number.isFinite(value) || value <= 0) {
      return 1;
    }

    return Math.floor(value);
  }

  function getChapterBvid(chapter) {
    if (chapter && chapter.bvid) {
      return String(chapter.bvid);
    }

    return extractBvidFromText((chapter && chapter.url) || "");
  }

  function getSameOriginPage(url) {
    try {
      return new URL(url, root.location.href).origin === root.location.origin;
    } catch (error) {
      return false;
    }
  }

  function pickBestAudioUrl(playurlData) {
    var dashAudio =
      playurlData &&
      playurlData.dash &&
      Array.isArray(playurlData.dash.audio)
        ? playurlData.dash.audio.slice()
        : [];

    if (dashAudio.length) {
      dashAudio.sort(function (left, right) {
        return Number(right.bandwidth || 0) - Number(left.bandwidth || 0);
      });

      return Parser.normalizeUrl(
        dashAudio[0].baseUrl ||
          dashAudio[0].base_url ||
          (Array.isArray(dashAudio[0].backupUrl) && dashAudio[0].backupUrl[0]) ||
          (Array.isArray(dashAudio[0].backup_url) && dashAudio[0].backup_url[0]) ||
          ""
      );
    }

    if (Array.isArray(playurlData && playurlData.durl) && playurlData.durl.length) {
      return Parser.normalizeUrl(playurlData.durl[0].url || "");
    }

    return "";
  }

  function dedupeStrings(values) {
    var seen = new Set();
    var result = [];

    (values || []).forEach(function (value) {
      var normalized = String(value || "").trim();

      if (!normalized || seen.has(normalized)) {
        return;
      }

      seen.add(normalized);
      result.push(normalized);
    });

    return result;
  }

  function buildChapterSourceUrl(chapter, bvid) {
    if (chapter && chapter.url) {
      return chapter.url;
    }

    if (bvid) {
      return buildPageUrl("https://www.bilibili.com/video/" + bvid + "/", getChapterPageNumber(chapter));
    }

    return root.location.href;
  }

  function pickChapterCidFromViewData(chapter, viewData) {
    var directCid = String((chapter && chapter.cid) || "");
    var pages = viewData && Array.isArray(viewData.pages) ? viewData.pages : [];
    var pageNumber = getChapterPageNumber(chapter);
    var matchedPage;

    if (directCid) {
      return directCid;
    }

    matchedPage = pages.find(function (page) {
      return Number(page.page || 0) === pageNumber;
    });

    if (matchedPage && matchedPage.cid) {
      return String(matchedPage.cid);
    }

    if (viewData && viewData.cid) {
      return String(viewData.cid);
    }

    if (pages.length && pages[0].cid) {
      return String(pages[0].cid);
    }

    return "";
  }

  function buildParsedFromApiData(chapter, viewData, playurlData) {
    var sourceUrl = buildChapterSourceUrl(chapter, getChapterBvid(chapter));
    var parsed = state.parsed ? cloneParsed(state.parsed, sourceUrl) : {};
    var ownerName = viewData && viewData.owner ? String(viewData.owner.name || "") : "";
    var coverUrl = Parser.normalizeBiliCoverUrl(
      (viewData && viewData.pic) || parsed.coverUrl || ""
    );
    var audioUrl = pickBestAudioUrl(playurlData);
    var videoTitle = String((chapter && chapter.title) || (viewData && viewData.title) || parsed.videoTitle || "");
    var summary = parsed.summary || String((viewData && viewData.desc) || videoTitle || "");
    var publishedAt = formatUnixTimestamp(viewData && viewData.pubdate);
    var durationMs = Number(
      (playurlData && playurlData.timelength) ||
        ((viewData && viewData.duration) ? Number(viewData.duration) * 1000 : 0) ||
        parsed.durationMs ||
        0
    );
    var bvid = getChapterBvid(chapter) || String((viewData && viewData.bvid) || "");
    var cid = pickChapterCidFromViewData(chapter, viewData);
    var nextBundle;

    if (!audioUrl) {
      throw new Error("API did not return an audio stream");
    }

    parsed.version = parsed.version || Parser.version || "0.1.0";
    parsed.sourceUrl = sourceUrl;
    parsed.videoTitle = videoTitle;
    parsed.bookTitle = parsed.bookTitle || videoTitle;
    parsed.descriptionText = String((viewData && viewData.desc) || parsed.descriptionText || "");
    parsed.summary = summary;
    parsed.uploaderName = parsed.uploaderName || ownerName;
    parsed.uploaderBio = parsed.uploaderBio || "";
    parsed.authors = Array.isArray(parsed.authors) ? dedupeStrings(parsed.authors) : [];
    parsed.narrators = Array.isArray(parsed.narrators) ? dedupeStrings(parsed.narrators) : [];
    parsed.tags = Array.isArray(parsed.tags) ? parsed.tags : [];
    parsed.coverUrl = coverUrl;
    parsed.audioUrl = audioUrl;
    parsed.publishedAt = publishedAt || parsed.publishedAt || "";
    parsed.durationMs = Number.isFinite(durationMs) ? durationMs : 0;
    parsed.bvid = bvid;
    parsed.aid = String((viewData && viewData.aid) || parsed.aid || "");
    parsed.cid = cid;

    if (!parsed.narrators.length && parsed.uploaderName) {
      parsed.narrators = [parsed.uploaderName];
    }

    parsed.parsedFrom = dedupeStrings((parsed.parsedFrom || []).concat(["view-api", "playurl-api"]));
    nextBundle = Parser.buildMetadata(parsed, {});
    parsed.suggestedFolderName = nextBundle.folderName;
    parsed.audioFileName = nextBundle.audioFileName;
    parsed.metadata = nextBundle.metadata;
    parsed.series = nextBundle.series;

    return parsed;
  }

  async function resolveChapterParsedViaApi(chapter, label) {
    var bvid = getChapterBvid(chapter);

    if (!bvid) {
      throw new Error(label + " 缺少 bvid，无法走 API 解析");
    }

    var viewPayload = await fetchJson("/x/web-interface/view", {
      bvid: bvid,
    });
    var viewData = viewPayload && viewPayload.data ? viewPayload.data : {};
    var cid = pickChapterCidFromViewData(chapter, viewData);

    if (!cid) {
      throw new Error(label + " 无法从 view 接口确定 cid");
    }

    var playurlPayload = await fetchJson("/x/player/playurl", {
      bvid: bvid,
      cid: cid,
      qn: 80,
      fnval: 16,
    });

    return buildParsedFromApiData(chapter, viewData, playurlPayload && playurlPayload.data);
  }

  async function fetchText(url, label) {
    if (!url) {
      throw new Error(label + " 链接为空");
    }

    var response = await fetch(url, {
      credentials: "include",
      mode: "cors",
      referrer: root.location.href,
    });

    if (!response.ok) {
      throw new Error(label + " 抓取失败，HTTP " + response.status);
    }

    return response.text();
  }

  async function resolveChapterParsedLegacy(chapter) {
    var label = "第 " + Parser.formatTrackNumber(chapter.trackNumber, chapter.trackTotal) + " 章";

    if (chapter.isCurrent && state.parsed && state.parsed.audioUrl) {
      return cloneParsed(state.parsed, chapter.url);
    }

    var html = await fetchText(chapter.url, label + " 页面");
    var parsed = Parser.parseHtml(html, { url: chapter.url });
    parsed.sourceUrl = chapter.url;

    if (!parsed.audioUrl) {
      throw new Error(label + " 没有解析到音频直链");
    }

    return parsed;
  }

  async function resolveChapterParsed(chapter) {
    var label = "Chapter " + Parser.formatTrackNumber(chapter.trackNumber, chapter.trackTotal);
    var shouldPreferApi = state.pageContext && state.pageContext.kind === "space-collection";

    if (chapter.isCurrent && state.parsed && state.parsed.audioUrl) {
      return cloneParsed(state.parsed, chapter.url);
    }

    if (shouldPreferApi) {
      return resolveChapterParsedViaApi(chapter, label);
    }

    try {
      var parsed = await resolveChapterParsedLegacy(chapter);

      if (parsed && parsed.audioUrl) {
        return parsed;
      }
    } catch (error) {
      if (!getChapterBvid(chapter) || getSameOriginPage(chapter.url)) {
        throw error;
      }
    }

    return resolveChapterParsedViaApi(chapter, label);
  }

  async function downloadSingleZip() {
    var currentChapter = getCurrentChapter();

    if (!currentChapter) {
      setStatus("当前页面没有可下载的章节。");
      return;
    }

    if (state.exporting) {
      return;
    }

    state.exporting = true;
    updateActionState();

    try {
      setStatus("正在抓取当前章节页面...");
      var parsedChapter = await resolveChapterParsed(currentChapter);
      var bundle = buildSingleBundle(parsedChapter);
      var rootPrefix = bundle.folderName + "/";
      var zipEntries = [];

      setStatus("正在下载当前章节音频...");
      var audioBlob = await fetchBlob(parsedChapter.audioUrl, "当前章节音频");
      zipEntries.push({
        name: rootPrefix + bundle.audioFileName,
        data: audioBlob,
      });
      zipEntries.push({
        name: rootPrefix + "metadata.json",
        data: JSON.stringify(bundle.metadata, null, 2),
      });

      if (dom.fields.generateSeriesJson.checked) {
        zipEntries.push({
          name: rootPrefix + "series.json",
          data: JSON.stringify(bundle.series, null, 2),
        });
      }

      if (dom.fields.generateCover.checked && parsedChapter.coverUrl) {
        setStatus("正在下载当前章节音频...\n正在下载封面...");
        var coverBlob = await fetchBlob(parsedChapter.coverUrl, "封面");
        zipEntries.push({
          name: rootPrefix + bundle.coverFileName,
          data: coverBlob,
        });
      }

      setStatus("正在打包单集 ZIP...");
      var zipBlob = await ZipBuilder.createZip(zipEntries);
      triggerDownload(zipBlob, bundle.folderName + ".zip");

      setStatus(
        [
          "单集 ZIP 下载已触发。",
          "压缩包：" + bundle.folderName + ".zip",
          "音频：" + bundle.audioFileName,
          "模式：单集",
        ].join("\n")
      );
    } catch (error) {
      setStatus("单集 ZIP 导出失败： " + error.message);
    } finally {
      state.exporting = false;
      updateActionState();
    }
  }

  async function downloadMultiZip() {
    if (state.chapters.length <= 1) {
      setStatus("当前没有识别到多章节。大多数短篇直接用“下载单集 ZIP”就够了。");
      return;
    }

    if (state.exporting) {
      return;
    }

    state.exporting = true;
    updateActionState();

    try {
      var seriesBundle = buildSeriesBundle();
      var rootPrefix = seriesBundle.folderName + "/";
      var zipEntries = [];
      var coverBlob = null;
      var coverFileName = seriesBundle.coverFileName;
      var rootCoverAdded = false;
      var processedChapterFolders = [];
      var chapterIndex;

      if (dom.fields.generateSeriesJson.checked) {
        zipEntries.push({
          name: rootPrefix + "series.json",
          data: JSON.stringify(seriesBundle.series, null, 2),
        });
      }

      for (chapterIndex = 0; chapterIndex < state.chapters.length; chapterIndex += 1) {
        var chapter = state.chapters[chapterIndex];
        var chapterLabel =
          "第 " + Parser.formatTrackNumber(chapter.trackNumber, chapter.trackTotal) + "/" +
          Parser.formatTrackNumber(chapter.trackTotal, chapter.trackTotal) + " 章";

        setStatus("正在抓取 " + chapterLabel + " 页面...");
        var parsedChapter = await resolveChapterParsed(chapter);

        if (dom.fields.generateCover.checked && !coverBlob && parsedChapter.coverUrl) {
          setStatus("正在抓取 " + chapterLabel + " 页面...\n正在下载系列封面...");
          coverBlob = await fetchBlob(parsedChapter.coverUrl, "系列封面");
        }

        if (coverBlob && !rootCoverAdded) {
          zipEntries.push({
            name: rootPrefix + coverFileName,
            data: coverBlob,
          });
          rootCoverAdded = true;
        }

        var chapterBundle = buildChapterBundle(parsedChapter, chapter);
        var chapterFolderName = Parser.buildEpisodeFolderName(
          chapter.trackNumber,
          chapter.title,
          chapter.trackTotal
        );

        setStatus("正在下载 " + chapterLabel + " 音频...");
        var audioBlob = await fetchBlob(parsedChapter.audioUrl, chapterLabel + " 音频");
        zipEntries.push({
          name: rootPrefix + chapterFolderName + "/" + chapterBundle.audioFileName,
          data: audioBlob,
        });
        zipEntries.push({
          name: rootPrefix + chapterFolderName + "/metadata.json",
          data: JSON.stringify(chapterBundle.metadata, null, 2),
        });

        if (coverBlob) {
          processedChapterFolders.forEach(function (previousFolderName) {
            zipEntries.push({
              name: rootPrefix + previousFolderName + "/" + chapterBundle.coverFileName,
              data: coverBlob,
            });
          });
          processedChapterFolders = [];
        }

        if (coverBlob) {
          zipEntries.push({
            name: rootPrefix + chapterFolderName + "/" + chapterBundle.coverFileName,
            data: coverBlob,
          });
        } else {
          processedChapterFolders.push(chapterFolderName);
        }
      }

      setStatus("正在打包多章节 ZIP...");
      var zipBlob = await ZipBuilder.createZip(zipEntries);
      triggerDownload(zipBlob, seriesBundle.folderName + ".zip");

      setStatus(
        [
          "多章节 ZIP 下载已触发。",
          "压缩包：" + seriesBundle.folderName + ".zip",
          "章节数：" + String(state.chapters.length),
          "模式：多章节",
        ].join("\n")
      );
    } catch (error) {
      setStatus("多章节 ZIP 导出失败： " + error.message);
    } finally {
      state.exporting = false;
      updateActionState();
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

    dom.actions.refresh.addEventListener("click", function () {
      parseCurrentPage();
    });
    dom.actions.checkUpdate.addEventListener("click", function () {
      if (state.update.available) {
        openUpdateInstall();
        return;
      }

      checkForUpdates(true, false);
    });
    dom.actions.copyAudio.addEventListener("click", copyAudioUrl);
    dom.actions.downloadSingle.addEventListener("click", downloadSingleZip);
    dom.actions.downloadMulti.addEventListener("click", downloadMultiZip);
  }

  function mount() {
    if (state.mounted) {
      return;
    }

    injectStyle();
    createDom();
    hydrateStoredUpdateState();
    bindEvents();
    parseCurrentPage();
    checkForUpdates(false, true);
    state.mounted = true;
  }

  root.__BILIBILI_AUDIOBOOK_EXPORTER__ = {
    open: open,
    close: close,
    refresh: parseCurrentPage,
    checkForUpdates: checkForUpdates,
    downloadSingle: downloadSingleZip,
    downloadMulti: downloadMultiZip,
  };

  mount();
})(typeof globalThis !== "undefined" ? globalThis : this);
