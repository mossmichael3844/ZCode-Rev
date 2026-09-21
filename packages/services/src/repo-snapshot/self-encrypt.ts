/**
 * 用户自控加密模块
 *
 * 与原始 ZCode 加密的关键区别:
 *   原始: RSA 公钥由服务器下发，私钥仅存服务端 → 用户无法解密
 *   现在: 用户自己提供密码/密钥，自己可以解密
 *
 * 加密方案:
 *   - PBKDF2 从用户密码派生 AES-256 密钥 (100,000 轮 SHA-256)
 *   - AES-256-CTR 加密归档
 *   - 密文格式: [16 字节 salt][16 字节 IV][密文...]
 *   - 信封文件记录 salt 和明文 SHA-256, 用户凭密码即可解密
 */

import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
} from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, stat, writeFile } from "fs/promises";
import { dirname } from "path";
import { pipeline } from "stream/promises";

import { AES_KEY_BYTES, AES_IV_BYTES, AES_ALGORITHM } from "./constants.js";
import type { BackupEncryptionConfig } from "./backup-config.js";

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = "sha256";
const SALT_BYTES = 16;

export interface SelfEncryptedArtifact {
  encryptedPath: string;
  envelopePath: string;
  plaintextSha256: string;
  encryptedSizeBytes: number;
  encryptedSha256: string;
  salt: string;
}

async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { signal });
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, AES_KEY_BYTES, PBKDF2_DIGEST);
}

function resolveAesKey(config: BackupEncryptionConfig, salt: Buffer): Buffer {
  if (config.aesKeyHex) {
    return Buffer.from(config.aesKeyHex, "hex");
  }
  if (config.passphrase) {
    return deriveKey(config.passphrase, salt);
  }
  throw new Error("加密需要 passphrase 或 aesKeyHex");
}

/**
 * 用户自控加密
 *
 * 密文格式: [16 字节 salt][16 字节 IV][AES-256-CTR 密文...]
 * 信封 JSON 记录 salt (hex) 和 plaintext SHA-256
 * 用户凭密码 + salt 即可通过 PBKDF2 重新派生密钥并解密
 */
export async function selfEncryptArchive(opts: {
  plaintextPath: string;
  encryptedPath: string;
  envelopePath: string;
  encryption: BackupEncryptionConfig;
  signal?: AbortSignal;
}): Promise<SelfEncryptedArtifact> {
  await mkdir(dirname(opts.encryptedPath), { recursive: true });
  await mkdir(dirname(opts.envelopePath), { recursive: true });

  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(AES_IV_BYTES);
  const aesKey = resolveAesKey(opts.encryption, salt);

  opts.signal?.throwIfAborted();

  const plaintextSha256 = await sha256File(opts.plaintextPath, opts.signal);

  const cipher = createCipheriv(AES_ALGORITHM, aesKey, iv);
  const output = createWriteStream(opts.encryptedPath);

  // 写入 salt + IV 前缀
  await new Promise<void>((resolve, reject) => {
    const header = Buffer.concat([salt, iv]);
    output.write(header, (err) => (err ? reject(err) : resolve()));
  });

  await pipeline(
    createReadStream(opts.plaintextPath, { signal: opts.signal }),
    cipher,
    output
  );

  const envelope = {
    format: "self-backup-v1",
    algorithm: AES_ALGORITHM,
    kdf: opts.encryption.aesKeyHex ? "none" : "pbkdf2-sha256",
    kdfIterations: opts.encryption.aesKeyHex ? 0 : PBKDF2_ITERATIONS,
    saltHex: salt.toString("hex"),
    ivHex: iv.toString("hex"),
    plaintextSha256,
  };

  await writeFile(opts.envelopePath, JSON.stringify(envelope, null, 2), "utf-8");

  const encryptedStat = await stat(opts.encryptedPath);

  return {
    encryptedPath: opts.encryptedPath,
    envelopePath: opts.envelopePath,
    plaintextSha256,
    encryptedSizeBytes: encryptedStat.size,
    encryptedSha256: await sha256File(opts.encryptedPath, opts.signal),
    salt: salt.toString("hex"),
  };
}

/**
 * 用户自行解密
 */
export async function selfDecryptArchive(opts: {
  encryptedPath: string;
  outputPath: string;
  encryption: BackupEncryptionConfig;
  signal?: AbortSignal;
}): Promise<{ outputPath: string; plaintextSha256: string }> {
  await mkdir(dirname(opts.outputPath), { recursive: true });

  // 读取 salt + IV 前缀
  const header = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const needed = SALT_BYTES + AES_IV_BYTES;
    const stream = createReadStream(opts.encryptedPath, { start: 0, end: needed - 1 });
    stream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    stream.on("error", reject);
    stream.on("end", () => {
      if (total < needed) {
        reject(new Error("加密文件头部不完整"));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });

  const salt = header.subarray(0, SALT_BYTES);
  const iv = header.subarray(SALT_BYTES, SALT_BYTES + AES_IV_BYTES);
  const aesKey = resolveAesKey(opts.encryption, salt);

  const decipher = createDecipheriv(AES_ALGORITHM, aesKey, iv);
  const dataStart = SALT_BYTES + AES_IV_BYTES;

  await pipeline(
    createReadStream(opts.encryptedPath, { start: dataStart, signal: opts.signal }),
    decipher,
    createWriteStream(opts.outputPath)
  );

  const plaintextSha256 = await sha256File(opts.outputPath, opts.signal);
  return { outputPath: opts.outputPath, plaintextSha256 };
}
