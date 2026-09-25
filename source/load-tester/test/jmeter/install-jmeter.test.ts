// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";

import type { S3Client } from "@aws-sdk/client-s3";
import { TarArchive, ZipArchive } from "archiver";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installJMeter } from "../../src/jmeter/install-jmeter.js";
import { buildRawZip } from "../archive/raw-zip.js";

const VERSION = "5.6.3";
const BUNDLE_KEY = "frameworks/jmeter/jmeter-bundle.tgz";
const DEFAULT_PLUGINS = ["jpgc-casutg-3.1.1", "jpgc-json-2.7"];

interface BundleOptions {
  readonly version?: string;
  /** Plugin zip basenames to put in plugins/, without the .zip suffix. */
  readonly plugins?: readonly string[];
  readonly omitRelease?: boolean;
  readonly corruptRelease?: boolean;
  readonly omitChecksumDigest?: boolean;
  /** Plugin names to ship as bytes that are not a zip file. */
  readonly corruptPlugins?: readonly string[];
  /** Plugin names to ship as a readable zip that holds no regular file. */
  readonly emptyPlugins?: readonly string[];
  readonly launcher?: string;
  readonly launcherMode?: number;
  /** Extra jar every plugin zip ships, to make an overlap observable. */
  readonly sharedJarContent?: Readonly<Record<string, string>>;
}

describe("installJMeter", () => {
  let testDir: string;
  let installParent: string;
  let bundle: Buffer;
  let requestedKeys: string[];
  let s3: S3Client;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dlt-install-jmeter-test-"));
    installParent = join(testDir, "install");
    requestedKeys = [];
    await mkdir(installParent);
    bundle = await buildBundle();

    s3 = {
      send: (command: { input: { Key?: string } }) => {
        requestedKeys.push(command.input.Key ?? "");
        return Promise.resolve({ Body: Readable.from(bundle) });
      },
    } as unknown as S3Client;
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("installs JMeter and every plugin the bundle ships", async () => {
    const jmeterHome = await runInstaller();
    const installRoot = dirname(jmeterHome);

    expect(dirname(installRoot)).toBe(installParent);
    expect(basename(installRoot)).toMatch(/^dlt-jmeter-/);
    expect(basename(jmeterHome)).toBe(`apache-jmeter-${VERSION}`);
    expect(requestedKeys).toEqual([BUNDLE_KEY]);
    await expect(readdir(join(jmeterHome, "lib", "ext"))).resolves.toEqual(
      expect.arrayContaining(["jpgc-casutg.jar", "jpgc-json.jar"])
    );
    // The bundle and the release tar are large and must not survive setup.
    await expect(readdir(installRoot)).resolves.toEqual([`apache-jmeter-${VERSION}`]);
  });

  // The installed version comes from the bundle, not from a constant here or a
  // manifest the bundle could disagree with.
  it("installs whatever version the bundle contains", async () => {
    bundle = await buildBundle({ version: "6.0" });

    expect(basename(await runInstaller())).toBe("apache-jmeter-6.0");
  });

  it("installs plugins in name order so a jar two plugins share resolves consistently", async () => {
    bundle = await buildBundle({
      plugins: ["zzz-last-1.0", "aaa-first-1.0"],
      sharedJarContent: { "aaa-first-1.0": "from-aaa", "zzz-last-1.0": "from-zzz" },
    });

    const jmeterHome = await runInstaller();

    await expect(readFile(join(jmeterHome, "lib", "ext", "shared.jar"), "utf8")).resolves.toBe("from-zzz");
  });

  it("rejects a release that fails its checksum", async () => {
    bundle = await buildBundle({ corruptRelease: true });

    await expect(runInstaller()).rejects.toThrow("Checksum mismatch");
  });

  it("rejects a checksum file with no digest in it", async () => {
    bundle = await buildBundle({ omitChecksumDigest: true });

    await expect(runInstaller()).rejects.toThrow("No SHA-512 checksum found");
  });

  it("rejects a bundle with no release tar", async () => {
    bundle = await buildBundle({ omitRelease: true });

    await expect(runInstaller()).rejects.toThrow("does not contain a apache-jmeter-*.tgz release");
  });

  it("rejects a bundle that ships no plugins", async () => {
    bundle = await buildBundle({ plugins: [] });

    await expect(runInstaller()).rejects.toThrow("contains no plugins");
  });

  it("names the plugin it could not extract", async () => {
    bundle = await buildBundle({ plugins: ["jpgc-json-2.7", "jpgc-broken-1.0"], corruptPlugins: ["jpgc-broken-1.0"] });

    await expect(runInstaller()).rejects.toThrow('Unable to install JMeter plugin "jpgc-broken-1.0.zip"');
  });

  // A plugin zip that extracts cleanly but writes nothing installs no jars, and
  // JMeter would otherwise fail much later as a missing sampler class.
  it("rejects a plugin zip that installs no files", async () => {
    bundle = await buildBundle({ plugins: ["jpgc-json-2.7", "jpgc-empty-1.0"], emptyPlugins: ["jpgc-empty-1.0"] });

    const thrown = await runInstaller().catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(Error);
    const failure = thrown as Error;
    expect(failure.message).toContain('Unable to install JMeter plugin "jpgc-empty-1.0.zip"');
    // The cause carries the diagnosis: the zip was readable, it just held nothing.
    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toBe("Plugin zip yielded no files (non-regular entries skipped: 1).");
  });

  it("rejects a JMeter that reports another version", async () => {
    bundle = await buildBundle({ launcher: '#!/bin/sh\necho "5.5"\n' });

    await expect(runInstaller()).rejects.toThrow(`did not report version ${VERSION}`);
  });

  it("rejects a launcher that cannot be executed", async () => {
    bundle = await buildBundle({ launcherMode: 0o644 });

    await expect(runInstaller()).rejects.toThrow("Unable to run installed JMeter");
  });

  // The only diagnostic for a JMeter that will not start: prepare() fails before
  // the health marker, so ECS reports its own generic reason and this is all the
  // customer has. A real example is the JVM refusing an -Xmx below the launcher's
  // default -Xms1g, which it explains on stderr.
  it("reports what the launcher printed, not just that it failed", async () => {
    bundle = await buildBundle({
      launcher: '#!/bin/sh\necho "Initial heap size set to a larger value than the maximum heap size" >&2\nexit 1\n',
    });

    await expect(runInstaller()).rejects.toThrow(/Unable to run installed JMeter.*Initial heap size set to a larger/s);
  });

  describe("when the bundle cannot be read", () => {
    it("surfaces a bundle that is not in the bucket", async () => {
      s3 = failingClient(new Error("NoSuchKey: The specified key does not exist."));

      await expect(runInstaller()).rejects.toThrow("NoSuchKey");
    });

    it("surfaces a stream that fails part-way through", async () => {
      const half = bundle.subarray(0, Math.floor(bundle.length / 2));
      s3 = streamingClient(() =>
        Readable.from(
          (function* () {
            yield half;
            throw new Error("socket hang up");
          })()
        )
      );

      await expect(runInstaller()).rejects.toThrow("socket hang up");
    });

    it.each([
      ["an empty object", (): Buffer => Buffer.alloc(0)],
      ["a truncated bundle", (full: Buffer): Buffer => full.subarray(0, Math.floor(full.length / 2))],
      ["something that is not a gzip stream", (): Buffer => Buffer.from('<?xml version="1.0"?>\n')],
    ])("rejects %s", async (_name, corrupt) => {
      bundle = corrupt(bundle);

      await expect(runInstaller()).rejects.toThrow();
    });
  });

  function runInstaller(): Promise<string> {
    return installJMeter({ s3, bucket: "scenarios-bucket", temporaryDirectory: installParent });
  }
});

/** An S3 whose GetObject never returns an object. */
function failingClient(error: Error): S3Client {
  return { send: () => Promise.reject(error) } as unknown as S3Client;
}

/** An S3 whose GetObject returns the given body stream. */
function streamingClient(body: () => Readable): S3Client {
  return { send: () => Promise.resolve({ Body: body() }) } as unknown as S3Client;
}

/**
 * Builds a real jmeter-bundle.tgz with the layout scripts/download-jmeter-bundle.sh
 * produces: the release tar, its checksum file, jmeter.json, and plugins/.
 */
async function buildBundle(options: BundleOptions = {}): Promise<Buffer> {
  const version = options.version ?? VERSION;
  const releaseName = `apache-jmeter-${version}.tgz`;
  const release = await buildRelease(version, options);
  const checksumSource = options.corruptRelease === true ? Buffer.from("other bytes") : release;

  const bundle = new ZipToBuffer(new TarArchive({ gzip: true }));
  if (options.omitRelease !== true) {
    bundle.archive.append(release, { name: `jmeter-bundle/${releaseName}`, type: "file", mode: 0o644 });
  }
  bundle.archive.append(Buffer.from(checksumFileContent(checksumSource, releaseName, options)), {
    name: `jmeter-bundle/${releaseName}.sha512`,
    type: "file",
    mode: 0o644,
  });
  // The installer ignores jmeter.json — the bundle carries it for the legacy
  // Taurus path — but the fixture ships it so the layout stays faithful.
  bundle.archive.append(Buffer.from(JSON.stringify({ version, plugins: {} })), {
    name: "jmeter-bundle/jmeter.json",
    type: "file",
    mode: 0o644,
  });

  // An empty plugins/ still has to exist, the way the build script creates it.
  const plugins = options.plugins ?? DEFAULT_PLUGINS;
  bundle.archive.append(Buffer.alloc(0), { name: "jmeter-bundle/plugins/", type: "directory", mode: 0o755 });
  for (const name of plugins) {
    const contents = await buildPluginContents(name, options);
    bundle.archive.append(contents, { name: `jmeter-bundle/plugins/${name}.zip`, type: "file", mode: 0o644 });
  }

  return bundle.finish();
}

/** The release tar Apache ships: everything under apache-jmeter-<version>/. */
async function buildRelease(version: string, options: BundleOptions): Promise<Buffer> {
  const root = `apache-jmeter-${version}`;
  const release = new ZipToBuffer(new TarArchive({ gzip: true }));
  release.archive.append(Buffer.alloc(0), { name: `${root}/`, type: "directory", mode: 0o755 });
  release.archive.append(Buffer.alloc(0), { name: `${root}/lib/ext/`, type: "directory", mode: 0o755 });
  release.archive.append(Buffer.from(options.launcher ?? launcherScript(version)), {
    name: `${root}/bin/jmeter`,
    type: "file",
    mode: options.launcherMode ?? 0o755,
  });
  release.archive.append(Buffer.from("#!/bin/sh\nexit 0\n"), {
    name: `${root}/bin/stoptest.sh`,
    type: "file",
    mode: 0o755,
  });
  return release.finish();
}

/** The bytes to ship as one plugin zip, per the fixture options. */
async function buildPluginContents(name: string, options: BundleOptions): Promise<Buffer> {
  if (options.corruptPlugins?.includes(name)) {
    return Buffer.from("not a zip file");
  }
  if (options.emptyPlugins?.includes(name)) {
    // A readable zip whose only entry is a symlink. Extraction skips it, so the
    // zip installs nothing while raising no error of its own.
    return buildRawZip([{ name: `lib/ext/${jarName(name)}`, content: "elsewhere.jar", mode: 0o120777 }]);
  }
  return buildPluginZip(name, options.sharedJarContent?.[name]);
}

/** Plugin zips carry lib/ and lib/ext/ paths that overlay JMETER_HOME. */
async function buildPluginZip(name: string, sharedJarContent?: string): Promise<Buffer> {
  const zip = new ZipToBuffer(new ZipArchive());
  zip.archive.append(Buffer.from(`jar for ${name}`), { name: `lib/ext/${jarName(name)}`, mode: 0o644 });
  if (sharedJarContent !== undefined) {
    zip.archive.append(Buffer.from(sharedJarContent), { name: "lib/ext/shared.jar", mode: 0o644 });
  }
  return zip.finish();
}

/** `jpgc-json-2.7` ships `jpgc-json.jar`, as the real packages do. */
function jarName(zipBaseName: string): string {
  return `${zipBaseName.replace(/-\d[\d.]*$/, "")}.jar`;
}

/** Mirrors the banner real `jmeter --version` prints, which ends in the version. */
function launcherScript(version: string): string {
  return `#!/bin/sh\ncat <<'BANNER'\n    _    ____   _    ____ _   _ _____\n   / \\  |  _ \\ / \\  / ___| | | | ____| ${version}\n\nCopyright (c) 1999-2024 The Apache Software Foundation\nBANNER\n`;
}

function checksumFileContent(content: Buffer, filename: string, options: BundleOptions): string {
  if (options.omitChecksumDigest === true) {
    return `SHA512 sum unavailable for ${filename}\n`;
  }
  return `${createHash("sha512").update(content).digest("hex")} *${filename}\n`;
}

/** Collects an archiver stream into a Buffer. */
class ZipToBuffer {
  private readonly chunks: Buffer[] = [];
  private readonly done: Promise<Buffer>;

  constructor(readonly archive: TarArchive | ZipArchive) {
    this.done = new Promise<Buffer>((resolveBuffer, reject) => {
      archive.on("data", (chunk: Buffer) => {
        this.chunks.push(Buffer.from(chunk));
      });
      archive.on("end", () => {
        resolveBuffer(Buffer.concat(this.chunks));
      });
      archive.on("error", reject);
    });
  }

  async finish(): Promise<Buffer> {
    await this.archive.finalize();
    return this.done;
  }
}
