/**
 * Minimal, dependency-free ZIP writer.
 * ---------------------------------------------------------------------------
 * The release archive has to be byte-for-byte reproducible, must not pull in a
 * build-time dependency, and must carry sensible Unix permissions (so an
 * extracted `install/` is readable and configuration files are not). Writing
 * the container by hand is ~150 lines and removes all of that guesswork.
 *
 * Supports: store + deflate entries, UTF-8 names, Unix modes for files and
 * directories, ZIP64-free archives (< 4 GB, < 65535 entries — plenty here).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_UTF8 = 0x0800;

/** Standard CRC-32 (IEEE 802.3) table, built once. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/** Convert a JS date to the DOS date/time pair ZIP uses (local time). */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

class Zip {
  constructor() {
    this.entries = [];
    this.parts = [];
    this.offset = 0;
  }

  /**
   * @param {string} name        archive path, forward slashes, no leading slash
   * @param {Buffer} data
   * @param {object} [options]   { mode?: number, mtime?: Date, compress?: boolean, isDirectory?: boolean }
   */
  add(name, data, options = {}) {
    const isDirectory = !!options.isDirectory;
    const normalized = isDirectory ? name.replace(/\/+$/, "") + "/" : name;
    const mode = options.mode ?? (isDirectory ? 0o40755 : 0o100644);
    const mtime = options.mtime || new Date();
    const { time, date } = dosDateTime(mtime);

    const raw = isDirectory ? Buffer.alloc(0) : data;
    const compress = options.compress !== false && !isDirectory;
    const deflated = compress ? zlib.deflateRawSync(raw, { level: 9 }) : raw;
    const useDeflate = compress && deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE;
    const crc = isDirectory ? 0 : crc32(raw);

    const nameBuffer = Buffer.from(normalized, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(FLAG_UTF8, 6);       // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);              // extra field length

    this.parts.push(local, nameBuffer, isDirectory ? Buffer.alloc(0) : payload);

    this.entries.push({
      name: nameBuffer,
      method,
      time,
      date,
      crc,
      compressedSize: payload.length,
      uncompressedSize: raw.length,
      mode,
      isDirectory,
      offset: this.offset,
    });

    this.offset += local.length + nameBuffer.length + (isDirectory ? 0 : payload.length);
    return this;
  }

  /** Convenience: add a file from disk (mode taken from the file, defaults 0644). */
  addFileFromDisk(name, filePath, options = {}) {
    const stat = fs.statSync(filePath);
    const mode = options.mode ?? (stat.mode & 0o777) | 0o100000;
    return this.add(name, fs.readFileSync(filePath), { ...options, mode, mtime: stat.mtime });
  }

  addDirectory(name, options = {}) {
    return this.add(name, Buffer.alloc(0), { ...options, isDirectory: true });
  }

  /** Serialise the archive. */
  toBuffer() {
    const centralParts = [];
    let centralSize = 0;

    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(SIG_CENTRAL, 0);
      header.writeUInt16LE((3 << 8) | 20, 4);      // made by: UNIX, v2.0
      header.writeUInt16LE(20, 6);                 // version needed
      header.writeUInt16LE(FLAG_UTF8, 8);
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.time, 12);
      header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressedSize, 20);
      header.writeUInt32LE(entry.uncompressedSize, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt16LE(0, 30);                 // extra
      header.writeUInt16LE(0, 32);                 // comment
      header.writeUInt16LE(0, 34);                 // disk number
      header.writeUInt16LE(0, 36);                 // internal attributes
      // External attributes: unix mode in the high word, MS-DOS dir bit when set.
      const external = ((entry.mode & 0xffff) << 16) | (entry.isDirectory ? 0x10 : 0);
      header.writeUInt32LE(external >>> 0, 38);
      header.writeUInt32LE(entry.offset, 42);
      centralParts.push(header, entry.name);
      centralSize += header.length + entry.name.length;
    }

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(this.offset, 16);
    eocd.writeUInt16LE(0, 20);

    return Buffer.concat([...this.parts, ...centralParts, eocd]);
  }

  writeTo(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, this.toBuffer());
    return file;
  }
}

module.exports = { Zip, crc32 };
