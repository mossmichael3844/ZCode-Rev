/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的 tar.gz 归档构建逻辑
 * 源文件: out/host/index.js
 *
 * 反编译函数映射:
 *   h_e   → writeGzipTar
 *   Vst   → writeGzipTarToPath
 *   qst   → writeTarEntry
 *   Kst   → writeTarBufferEntry
 *   Gst   → writeTarFileEntry
 *   k5    → writeTarHeader
 *   g_e   → writeBufferEntry
 *   w5    → writePadding
 *   i$    → waitForStreamDrain
 *   Hst   → createPaxPathHeader
 *   Wst   → createPaxRecord
 *   y5    → normalizeTarPathForHeader
 *   m_e   → fitsInStandardHeader
 *   f_e   → assertGzipOutputWithinLimit
 *   Zst   → buildTarHeaderBuffer
 *   Dk    → TarOutputLimitExceededError
 */

import { createWriteStream, createReadStream, statSync } from "fs";
import { createGzip } from "zlib";
import { mkdir, rename, rm, stat } from "fs/promises";
import { dirname, basename } from "path";
import type { Writable } from "stream";
import type { TarEntry } from "./types.js";

const TAR_BLOCK_SIZE = 512;
const PAX_HEADER_PREFIX = "PaxHeaders/";

class TarOutputLimitExceededError extends Error {
  maxOutputBytes: number;
  actualOutputBytes: number;
  constructor(opts: { maxOutputBytes: number; actualOutputBytes: number }) {
    super(
      `repo snapshot gzip output exceeds max ${opts.maxOutputBytes} bytes: ${opts.actualOutputBytes} bytes`
    );
    this.name = "TarOutputLimitExceededError";
    this.maxOutputBytes = opts.maxOutputBytes;
    this.actualOutputBytes = opts.actualOutputBytes;
  }
}

function normalizeTarPathForHeader(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function fitsInStandardHeader(path: string): boolean {
  return Buffer.byteLength(path, "utf-8") <= 100;
}

function createPaxRecord(keyword: string, value: string): Buffer {
  const content = `${keyword}=${value}\n`;
  const prefix = `${content.length + String(content.length).length + 1} `;
  const record = `${prefix.length + content.length} ${content}`;
  return Buffer.from(record, "utf-8");
}

function createPaxPathHeader(
  entry: TarEntry,
  index: number
): { path: string; content: Buffer; sizeBytes: number } | null {
  const normalized = normalizeTarPathForHeader(entry.path);
  if (fitsInStandardHeader(normalized)) return null;

  const content = createPaxRecord("path", normalized);
  return {
    path: `${PAX_HEADER_PREFIX}${index}`,
    content,
    sizeBytes: content.byteLength,
  };
}

function buildTarHeaderBuffer(
  entry: { path: string; sizeBytes: number },
  opts?: { typeFlag?: string }
): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE);
  const path = normalizeTarPathForHeader(entry.path);

  header.write(path.slice(0, 100), 0, 100, "utf-8");

  // mode
  header.write("0000644\0", 100, 8, "utf-8");
  // uid
  header.write("0001000\0", 108, 8, "utf-8");
  // gid
  header.write("0001000\0", 116, 8, "utf-8");
  // size (octal)
  header.write(entry.sizeBytes.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");
  // mtime
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");
  // typeflag
  const typeFlag = opts?.typeFlag ?? "0";
  header.write(typeFlag, 156, 1, "utf-8");
  // magic
  header.write("ustar\0", 257, 6, "utf-8");
  // version
  header.write("00", 263, 2, "utf-8");

  // checksum placeholder
  header.fill(0x20, 148, 156);
  let checksum = 0;
  for (let i = 0; i < TAR_BLOCK_SIZE; i++) {
    checksum += header[i]!;
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");

  return header;
}

function waitForStreamDrain(stream: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain);
      stream.off("error", onError);
      stream.off("close", onClose);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("repo snapshot gzip stream closed before drain"));
    };
    stream.once("drain", onDrain);
    stream.once("error", onError);
    stream.once("close", onClose);
  });
}

async function writeBufferEntry(
  stream: Writable,
  entry: { content: Buffer },
  checkLimit?: () => void
): Promise<void> {
  stream.write(entry.content) || (await waitForStreamDrain(stream));
  checkLimit?.();
}

async function writePadding(
  stream: Writable,
  sizeBytes: number,
  checkLimit?: () => void
): Promise<void> {
  const remainder = (TAR_BLOCK_SIZE - (sizeBytes % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
  if (remainder > 0) {
    stream.write(Buffer.alloc(remainder)) || (await waitForStreamDrain(stream));
  }
  checkLimit?.();
}

async function writeTarHeader(
  stream: Writable,
  entry: { path: string; sizeBytes: number },
  opts?: { typeFlag?: string; checkOutputLimit?: () => void }
): Promise<void> {
  stream.write(buildTarHeaderBuffer(entry, opts)) || (await waitForStreamDrain(stream));
  opts?.checkOutputLimit?.();
}

async function writeTarBufferEntry(
  stream: Writable,
  entry: TarEntry & { content: Buffer },
  checkLimit?: () => void
): Promise<void> {
  await writeTarHeader(stream, entry, { checkOutputLimit: checkLimit });
  await writeBufferEntry(stream, entry, checkLimit);
  await writePadding(stream, entry.sizeBytes, checkLimit);
}

async function writeTarFileEntry(
  stream: Writable,
  entry: TarEntry & { absolutePath: string },
  checkLimit?: () => void
): Promise<void> {
  const beforeStat = await stat(entry.absolutePath);
  const sized = { ...entry, sizeBytes: beforeStat.size };
  await writeTarHeader(stream, sized, { checkOutputLimit: checkLimit });

  let bytesWritten = 0;
  const readable = createReadStream(entry.absolutePath);
  try {
    for await (const chunk of readable) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesWritten += buf.byteLength;
      stream.write(buf) || (await waitForStreamDrain(stream));
      checkLimit?.();
    }
  } finally {
    readable.destroy();
  }

  const afterStat = await stat(entry.absolutePath);
  if (
    bytesWritten !== beforeStat.size ||
    afterStat.size !== beforeStat.size ||
    afterStat.mtimeMs !== beforeStat.mtimeMs
  ) {
    throw new Error(
      `repo snapshot file changed while packing: ${entry.path} expected ${beforeStat.size} bytes, wrote ${bytesWritten} bytes`
    );
  }

  await writePadding(stream, beforeStat.size, checkLimit);
}

async function writeTarEntry(
  stream: Writable,
  entry: TarEntry,
  index: number,
  checkLimit?: () => void
): Promise<void> {
  const pax = createPaxPathHeader(entry, index);
  if (pax) {
    await writeTarHeader(stream, pax, { typeFlag: "x", checkOutputLimit: checkLimit });
    await writeBufferEntry(stream, pax, checkLimit);
    await writePadding(stream, pax.sizeBytes, checkLimit);
  }

  const effective = pax ? { ...entry, path: `${PAX_HEADER_PREFIX}${index}.data` } : entry;

  if ("content" in effective && effective.content) {
    await writeTarBufferEntry(stream, effective as TarEntry & { content: Buffer }, checkLimit);
    return;
  }

  await writeTarFileEntry(stream, effective as TarEntry & { absolutePath: string }, checkLimit);
}

function assertGzipOutputWithinLimit(
  gzipStream: { bytesWritten: number },
  maxBytes?: number
): void {
  if (maxBytes !== undefined && gzipStream.bytesWritten > maxBytes) {
    throw new TarOutputLimitExceededError({
      maxOutputBytes: maxBytes,
      actualOutputBytes: gzipStream.bytesWritten,
    });
  }
}

async function writeGzipTarToPath(
  entries: TarEntry[],
  outputPath: string,
  opts: { maxOutputBytes?: number; signal?: AbortSignal } = {}
): Promise<void> {
  opts.signal?.throwIfAborted();

  const fileStream = createWriteStream(outputPath);
  const gzipStream = createGzip();

  const abort = () => {
    const reason =
      opts.signal?.reason instanceof Error
        ? opts.signal.reason
        : new DOMException("Repo snapshot archive was cancelled", "AbortError");
    gzipStream.destroy(reason);
    fileStream.destroy(reason);
  };
  opts.signal?.addEventListener("abort", abort, { once: true });

  gzipStream.pipe(fileStream);

  const finished = new Promise<void>((resolve, reject) => {
    fileStream.on("finish", resolve);
    fileStream.on("error", reject);
    gzipStream.on("error", reject);
  });
  finished.catch(() => {});

  const checkOutputLimit = () => {
    opts.signal?.throwIfAborted();
    assertGzipOutputWithinLimit(fileStream, opts.maxOutputBytes);
  };

  try {
    checkOutputLimit();
    for (const [index, entry] of entries.entries()) {
      await writeTarEntry(gzipStream, entry, index, checkOutputLimit);
      checkOutputLimit();
    }
    // tar 结束标记: 1024 字节零填充
    gzipStream.end(Buffer.alloc(1024));
    await finished;
    assertGzipOutputWithinLimit(fileStream, opts.maxOutputBytes);
  } catch (err) {
    gzipStream.unpipe(fileStream);
    gzipStream.destroy();
    fileStream.destroy();
    throw err;
  } finally {
    opts.signal?.removeEventListener("abort", abort);
  }
}

/**
 * writeGzipTar (反编译自 h_e)
 * 先写入临时文件，再原子重命名到目标路径
 */
export async function writeGzipTar(
  entries: TarEntry[],
  outputPath: string,
  opts: { maxOutputBytes?: number; signal?: AbortSignal } = {}
): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  try {
    await writeGzipTarToPath(entries, tmpPath, opts);
    await rename(tmpPath, outputPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    await rm(outputPath, { force: true });
    throw err;
  }
}

export { TarOutputLimitExceededError };
