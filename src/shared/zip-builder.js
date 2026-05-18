(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.BilibiliZipBuilder = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var textEncoder = new TextEncoder();
  var crcTable = (function () {
    var table = new Uint32Array(256);
    var index;
    var bit;
    var value;

    for (index = 0; index < 256; index += 1) {
      value = index;
      for (bit = 0; bit < 8; bit += 1) {
        if (value & 1) {
          value = 0xedb88320 ^ (value >>> 1);
        } else {
          value = value >>> 1;
        }
      }
      table[index] = value >>> 0;
    }

    return table;
  })();

  function normalizeEntryName(name) {
    return String(name || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/{2,}/g, "/");
  }

  function writeUint16(target, offset, value) {
    target[offset] = value & 255;
    target[offset + 1] = (value >>> 8) & 255;
  }

  function writeUint32(target, offset, value) {
    target[offset] = value & 255;
    target[offset + 1] = (value >>> 8) & 255;
    target[offset + 2] = (value >>> 16) & 255;
    target[offset + 3] = (value >>> 24) & 255;
  }

  function getDosDateTime(value) {
    var date = value instanceof Date ? value : new Date(value || Date.now());
    var year = Math.max(1980, date.getFullYear());
    var month = date.getMonth() + 1;
    var day = date.getDate();
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var seconds = Math.floor(date.getSeconds() / 2);

    return {
      date: ((year - 1980) << 9) | (month << 5) | day,
      time: (hours << 11) | (minutes << 5) | seconds,
    };
  }

  function crc32(bytes) {
    var crc = 0xffffffff;
    var index;

    for (index = 0; index < bytes.length; index += 1) {
      crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  async function toUint8Array(value) {
    if (value == null) {
      return new Uint8Array(0);
    }

    if (value instanceof Uint8Array) {
      return value;
    }

    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }

    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }

    if (typeof Blob !== "undefined" && value instanceof Blob) {
      return new Uint8Array(await value.arrayBuffer());
    }

    if (typeof value === "string") {
      return textEncoder.encode(value);
    }

    return textEncoder.encode(String(value));
  }

  async function createZip(entries) {
    var normalizedEntries = Array.isArray(entries) ? entries : [];
    var localParts = [];
    var centralParts = [];
    var localOffset = 0;
    var centralSize = 0;
    var index;

    for (index = 0; index < normalizedEntries.length; index += 1) {
      var entry = normalizedEntries[index] || {};
      var entryName = normalizeEntryName(entry.name);
      var entryNameBytes = textEncoder.encode(entryName);
      var entryBytes = await toUint8Array(entry.data);
      var entryCrc = crc32(entryBytes);
      var dos = getDosDateTime(entry.lastModified);
      var localHeader = new Uint8Array(30 + entryNameBytes.length);
      var centralHeader = new Uint8Array(46 + entryNameBytes.length);

      writeUint32(localHeader, 0, 0x04034b50);
      writeUint16(localHeader, 4, 20);
      writeUint16(localHeader, 6, 0);
      writeUint16(localHeader, 8, 0);
      writeUint16(localHeader, 10, dos.time);
      writeUint16(localHeader, 12, dos.date);
      writeUint32(localHeader, 14, entryCrc);
      writeUint32(localHeader, 18, entryBytes.length);
      writeUint32(localHeader, 22, entryBytes.length);
      writeUint16(localHeader, 26, entryNameBytes.length);
      writeUint16(localHeader, 28, 0);
      localHeader.set(entryNameBytes, 30);

      writeUint32(centralHeader, 0, 0x02014b50);
      writeUint16(centralHeader, 4, 20);
      writeUint16(centralHeader, 6, 20);
      writeUint16(centralHeader, 8, 0);
      writeUint16(centralHeader, 10, 0);
      writeUint16(centralHeader, 12, dos.time);
      writeUint16(centralHeader, 14, dos.date);
      writeUint32(centralHeader, 16, entryCrc);
      writeUint32(centralHeader, 20, entryBytes.length);
      writeUint32(centralHeader, 24, entryBytes.length);
      writeUint16(centralHeader, 28, entryNameBytes.length);
      writeUint16(centralHeader, 30, 0);
      writeUint16(centralHeader, 32, 0);
      writeUint16(centralHeader, 34, 0);
      writeUint16(centralHeader, 36, 0);
      writeUint32(centralHeader, 38, 0);
      writeUint32(centralHeader, 42, localOffset);
      centralHeader.set(entryNameBytes, 46);

      localParts.push(localHeader, entryBytes);
      centralParts.push(centralHeader);
      localOffset += localHeader.length + entryBytes.length;
      centralSize += centralHeader.length;
    }

    var endRecord = new Uint8Array(22);
    writeUint32(endRecord, 0, 0x06054b50);
    writeUint16(endRecord, 4, 0);
    writeUint16(endRecord, 6, 0);
    writeUint16(endRecord, 8, normalizedEntries.length);
    writeUint16(endRecord, 10, normalizedEntries.length);
    writeUint32(endRecord, 12, centralSize);
    writeUint32(endRecord, 16, localOffset);
    writeUint16(endRecord, 20, 0);

    return new Blob(localParts.concat(centralParts).concat([endRecord]), {
      type: "application/zip",
    });
  }

  return {
    createZip: createZip,
  };
});
