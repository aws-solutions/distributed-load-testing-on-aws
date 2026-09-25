// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

// A minimal store-only zip writer for tests that need to control the unix mode
// each entry records.
//
// archiver, the builder the rest of the archive tests use, always ORs S_IFREG
// into an entry's external file attributes, whatever mode it is handed. It
// therefore cannot produce the permission-only modes that Python's
// zipfile.writestr and similar writers emit, which is why a filter that rejected
// exactly those entries once passed every test in this directory.
//
// Entries are stored uncompressed. That keeps the writer to three record types
// and needs no deflate stream, and yauzl reads a stored entry the same way it
// reads a deflated one.

import { crc32 } from "node:zlib";

export interface RawZipEntry {
  readonly name: string;
  readonly content?: string;
  /**
   * Unix mode recorded in the entry's external file attributes. Omit for zero,
   * which is what a writer that records no mode at all produces.
   *
   * Real-world values: 0o100644 from the `zip` CLI and from archiver, 0o600 from
   * Python's `zipfile.writestr`, 0o120777 for a symlink.
   */
  readonly mode?: number;
  /**
   * DOS attribute bits, the low half of the external file attributes. Windows
   * zip tools set these and leave the unix mode empty; 0x20 is the archive bit
   * every such entry carries. Extraction must ignore them entirely.
   */
  readonly dosAttributes?: number;
  /**
   * Sets general-purpose bit 11, the UTF-8 name flag. Modern writers set it, and
   * yauzl then decodes the name verbatim instead of through its CP437 table. That
   * distinction matters for any byte below 0x20: CP437 maps it to a printable
   * glyph, while UTF-8 decoding preserves it as a control character.
   */
  readonly utf8NameFlag?: boolean;
}

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
/** Version made by: high byte 3 (unix, so the mode is read as one), low byte 30. */
const VERSION_MADE_BY_UNIX = 0x031e;
const VERSION_NEEDED = 20;
const METHOD_STORED = 0;
/** DOS date for 1980-01-01, the epoch of the zip timestamp field. */
const DOS_DATE = 0x21;
/** General-purpose bit 11: the entry name is UTF-8 rather than CP437. */
const FLAG_UTF8_NAME = 0x0800;

/** Builds a zip archive in memory from `entries`, ready to write to disk. */
export function buildRawZip(entries: readonly RawZipEntry[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let localSize = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content ?? "", "utf8");
    const checksum = crc32(data);
    const flags = entry.utf8NameFlag === true ? FLAG_UTF8_NAME : 0;

    const local = Buffer.alloc(LOCAL_HEADER_SIZE);
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(METHOD_STORED, 8);
    local.writeUInt16LE(0, 10); // modification time
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18); // compressed size, same when stored
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    localRecords.push(local, name, data);

    const central = Buffer.alloc(CENTRAL_HEADER_SIZE);
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
    central.writeUInt16LE(VERSION_MADE_BY_UNIX, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(METHOD_STORED, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // no extra field
    central.writeUInt16LE(0, 32); // no comment
    central.writeUInt16LE(0, 34); // first disk
    central.writeUInt16LE(0, 36); // internal attributes
    // The unix mode occupies the top 16 bits, the DOS attributes the low 16. A
    // symlink mode overflows a signed 32-bit shift, so coerce back to unsigned.
    const externalAttributes = (((entry.mode ?? 0) << 16) >>> 0) | (entry.dosAttributes ?? 0);
    central.writeUInt32LE(externalAttributes >>> 0, 38);
    central.writeUInt32LE(localSize, 42); // offset of this entry's local header
    centralRecords.push(central, name);

    localSize += LOCAL_HEADER_SIZE + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralRecords);
  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4); // this disk
  eocd.writeUInt16LE(0, 6); // disk holding the central directory
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localSize, 16);
  eocd.writeUInt16LE(0, 20); // no archive comment

  return Buffer.concat([...localRecords, centralDirectory, eocd]);
}
