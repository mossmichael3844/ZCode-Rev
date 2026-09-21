/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的信封加密逻辑
 * 源文件: out/host/index.js
 *
 * 反编译函数映射:
 *   oct      → encryptArchive
 *   S_e      → sha256File
 *   rct      → writeNoncePrefix
 *   nct      → pipelineEncrypt (内联)
 *   Qst      → crypto.publicEncrypt
 *   Xst      → crypto.createCipheriv
 *   v_e      → crypto.randomBytes
 *   Jst      → crypto.constants
 *   Yst      → crypto.createHash
 *   b_e      → fs.createReadStream
 *   ect      → fs.createWriteStream
 *   y_e      → fs.mkdir
 *   w_e      → path.dirname
 *   tct      → fs.stat
 */

import {
  randomBytes,
  createCipheriv,
  createHash,
  publicEncrypt,
  constants as cryptoConstants,
} from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, stat, writeFile } from "fs/promises";
import { dirname } from "path";
import { pipeline } from "stream/promises";

import { AES_KEY_BYTES, AES_IV_BYTES, AES_ALGORITHM, RSA_OAEP_HASH } from "./constants.js";
import type { UploadKey, EncryptedArtifact, EncryptionEnvelope } from "./types.js";

async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath, { signal });
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function writeNoncePrefix(
  stream: NodeJS.WritableStream,
  nonce: Buffer
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    (stream as any).write(nonce, (err: Error | null | undefined) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });
}

async function pipelineEncrypt(
  inputPath: string,
  cipher: ReturnType<typeof createCipheriv>,
  outputStream: NodeJS.WritableStream,
  opts?: { signal?: AbortSignal }
): Promise<void> {
  await pipeline(
    createReadStream(inputPath, { signal: opts?.signal }),
    cipher,
    outputStream as any
  );
}

/**
 * encryptArchive (反编译自 oct)
 *
 * 加密流程:
 *   1. 生成随机 AES-256-CTR 密钥 (32 字节) 和 IV (16 字节)
 *   2. 计算明文归档的 SHA-256
 *   3. 使用 AES-256-CTR 加密归档，IV 作为密文前缀
 *   4. 使用服务器 RSA 公钥 (OAEP-SHA256) 包装 AES 密钥
 *   5. 写入信封元数据 (包含加密后的密钥和明文哈希)
 *
 * 关键安全问题: RSA 私钥仅存于 Z.ai 服务器，用户无法解密自己的数据
 */
export async function encryptArchive(opts: {
  plaintextArchivePath: string;
  encryptedArtifactPath: string;
  envelopePath: string;
  uploadKey: UploadKey;
  envelopeInput: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<EncryptedArtifact> {
  // 确保输出目录存在
  await mkdir(dirname(opts.encryptedArtifactPath), { recursive: true });
  await mkdir(dirname(opts.envelopePath), { recursive: true });

  // 生成随机密钥材料
  const aesKey = randomBytes(AES_KEY_BYTES);
  const iv = randomBytes(AES_IV_BYTES);

  opts.signal?.throwIfAborted();

  // 计算明文哈希
  const plaintextSha256 = await sha256File(opts.plaintextArchivePath, opts.signal);

  // 创建 AES-256-CTR 加密器
  const cipher = createCipheriv(AES_ALGORITHM, aesKey, iv);

  // 写入加密文件: IV 前缀 + 密文
  const outputStream = createWriteStream(opts.encryptedArtifactPath);
  await writeNoncePrefix(outputStream, iv);
  await pipelineEncrypt(opts.plaintextArchivePath, cipher, outputStream, {
    signal: opts.signal,
  });

  // RSA-OAEP 包装 AES 密钥 — 仅服务器持有私钥
  const encryptedDataKey = publicEncrypt(
    {
      key: opts.uploadKey.publicKeySpkiPem,
      padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: RSA_OAEP_HASH,
    },
    aesKey
  ).toString("base64");

  // 构建信封
  const envelope: EncryptionEnvelope = {
    ...opts.envelopeInput,
    encryptedDataKey,
    plaintextSha256,
  };

  // 原子写入信封 JSON
  await writeFile(opts.envelopePath, JSON.stringify(envelope, null, 2), "utf-8");

  // 获取加密后文件大小
  const encryptedStat = await stat(opts.encryptedArtifactPath);

  return {
    encryptedArtifactPath: opts.encryptedArtifactPath,
    envelopePath: opts.envelopePath,
    manifestPath: "",
    envelope,
    encryptedSizeBytes: encryptedStat.size,
    encryptedSha256: await sha256File(opts.encryptedArtifactPath, opts.signal),
  };
}
