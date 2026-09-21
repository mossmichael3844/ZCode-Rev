/**
 * 用户自助 OSS 备份客户端
 *
 * 与原始 ZCode 上传客户端的关键区别:
 *   原始: 通过 Z.ai API 获取 STS 凭证 → 上传到智谱控制的 Bucket
 *   现在: 用户自己提供 AccessKey → 上传到用户自己的 Bucket
 *
 * 使用阿里云 OSS V4 签名 (HMAC-SHA256) 直接 PUT 上传
 * 无需 ZCode 服务器参与，不发送任何请求到 Z.ai
 */

import { createHash, createHmac } from "crypto";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import type { OssBackupConfig } from "./backup-config.js";

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

function getDateStrings(): { dateStamp: string; dateTime: string } {
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const dateTime = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return { dateStamp, dateTime };
}

function extractRegionFromEndpoint(endpoint: string): string {
  const match = endpoint.match(/oss-([a-z0-9-]+)\./);
  return match?.[1] ?? "cn-hangzhou";
}

function buildObjectKey(config: OssBackupConfig, snapshotId: string, filename: string): string {
  const prefix = config.prefix?.replace(/\/+$/, "") ?? "";
  const parts = [prefix, snapshotId, filename].filter(Boolean);
  return parts.join("/");
}

/**
 * 使用 OSS V4 签名 (HMAC-SHA256) 构建 Authorization 头
 *
 * 参考: https://help.aliyun.com/document_detail/31951.html
 */
function signOssV4(opts: {
  method: string;
  host: string;
  objectKey: string;
  region: string;
  accessKeyId: string;
  accessKeySecret: string;
  securityToken?: string;
  dateStamp: string;
  dateTime: string;
  contentSha256: string;
  contentType: string;
}): Record<string, string> {
  const scope = `${opts.dateStamp}/${opts.region}/oss/aliyun_v4_request`;

  const headers: Record<string, string> = {
    host: opts.host,
    "x-oss-date": opts.dateTime,
    "x-oss-content-sha256": opts.contentSha256,
    "content-type": opts.contentType,
  };
  if (opts.securityToken) {
    headers["x-oss-security-token"] = opts.securityToken;
  }

  const signedHeaderKeys = Object.keys(headers).sort();
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headers[k]}`)
    .join("\n") + "\n";

  const canonicalRequest = [
    opts.method,
    `/${opts.objectKey}`,
    "",
    canonicalHeaders,
    signedHeaders,
    opts.contentSha256,
  ].join("\n");

  const stringToSign = [
    "OSS4-HMAC-SHA256",
    opts.dateTime,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const dateKey = hmacSha256(`aliyun_v4${opts.accessKeySecret}`, opts.dateStamp);
  const regionKey = hmacSha256(dateKey, opts.region);
  const serviceKey = hmacSha256(regionKey, "oss");
  const signingKey = hmacSha256(serviceKey, "aliyun_v4_request");
  const signature = hmacSha256(signingKey, stringToSign).toString("hex");

  const authorization =
    `OSS4-HMAC-SHA256 ` +
    `Credential=${opts.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, ` +
    `Signature=${signature}`;

  return {
    ...headers,
    Authorization: authorization,
  };
}

export interface OssUploadResult {
  objectKey: string;
  url: string;
  etag?: string;
  sizeBytes: number;
}

/**
 * OssBackupClient
 *
 * 直接使用用户提供的 AccessKey 上传到用户自己的 OSS Bucket
 * 不经过 ZCode 服务器
 */
export class OssBackupClient {
  private config: OssBackupConfig;
  private fetchImpl: typeof fetch;

  constructor(config: OssBackupConfig, fetchImpl?: typeof fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl ?? globalThis.fetch;
  }

  updateConfig(config: OssBackupConfig): void {
    this.config = config;
  }

  /**
   * PUT 上传文件到用户的 OSS Bucket
   */
  async uploadFile(opts: {
    localPath: string;
    snapshotId: string;
    filename: string;
    contentType?: string;
    signal?: AbortSignal;
  }): Promise<OssUploadResult> {
    const objectKey = buildObjectKey(this.config, opts.snapshotId, opts.filename);
    const fileStat = await stat(opts.localPath);
    const contentType = opts.contentType ?? "application/octet-stream";

    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    const host = `${this.config.bucket}.${new URL(endpoint).host}`;
    const url = `https://${host}/${objectKey}`;
    const region = extractRegionFromEndpoint(endpoint);

    const { dateStamp, dateTime } = getDateStrings();

    // 流式上传使用 UNSIGNED-PAYLOAD
    const contentSha256 = "UNSIGNED-PAYLOAD";

    const headers = signOssV4({
      method: "PUT",
      host,
      objectKey,
      region,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      securityToken: this.config.securityToken,
      dateStamp,
      dateTime,
      contentSha256,
      contentType,
    });

    if (this.config.storageClass && this.config.storageClass !== "Standard") {
      headers["x-oss-storage-class"] = this.config.storageClass;
    }
    headers["content-length"] = String(fileStat.size);

    const body = createReadStream(opts.localPath);

    const response = await this.fetchImpl(url, {
      method: "PUT",
      headers,
      body: body as any,
      duplex: "half",
      redirect: "error",
      signal: opts.signal,
    } as any);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `OSS 上传失败: ${response.status} ${response.statusText}\n${text}`
      );
    }

    return {
      objectKey,
      url,
      etag: response.headers.get("etag") ?? undefined,
      sizeBytes: fileStat.size,
    };
  }

  /**
   * 列出指定前缀下的快照对象
   */
  async listSnapshots(opts?: {
    maxKeys?: number;
    signal?: AbortSignal;
  }): Promise<Array<{ key: string; size: number; lastModified: string }>> {
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    const host = `${this.config.bucket}.${new URL(endpoint).host}`;
    const prefix = this.config.prefix?.replace(/\/+$/, "") ?? "";
    const maxKeys = opts?.maxKeys ?? 1000;

    const queryParams = new URLSearchParams({
      "list-type": "2",
      prefix: prefix ? `${prefix}/` : "",
      "max-keys": String(maxKeys),
    });
    const url = `https://${host}/?${queryParams}`;
    const region = extractRegionFromEndpoint(endpoint);
    const { dateStamp, dateTime } = getDateStrings();

    const headers = signOssV4({
      method: "GET",
      host,
      objectKey: `?${queryParams}`,
      region,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      securityToken: this.config.securityToken,
      dateStamp,
      dateTime,
      contentSha256: sha256Hex(""),
      contentType: "",
    });

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers,
      signal: opts?.signal,
    });

    if (!response.ok) {
      throw new Error(`OSS 列出对象失败: ${response.status}`);
    }

    const xml = await response.text();
    return parseListResult(xml);
  }

  /**
   * 删除指定快照的所有对象
   */
  async deleteSnapshot(opts: {
    snapshotId: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const objects = await this.listSnapshots({ signal: opts.signal });
    const prefix = buildObjectKey(this.config, opts.snapshotId, "");
    const toDelete = objects.filter((o) => o.key.startsWith(prefix));

    for (const obj of toDelete) {
      await this.deleteObject(obj.key, opts.signal);
    }
  }

  private async deleteObject(objectKey: string, signal?: AbortSignal): Promise<void> {
    const endpoint = this.config.endpoint.replace(/\/+$/, "");
    const host = `${this.config.bucket}.${new URL(endpoint).host}`;
    const url = `https://${host}/${objectKey}`;
    const region = extractRegionFromEndpoint(endpoint);
    const { dateStamp, dateTime } = getDateStrings();

    const headers = signOssV4({
      method: "DELETE",
      host,
      objectKey,
      region,
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      securityToken: this.config.securityToken,
      dateStamp,
      dateTime,
      contentSha256: sha256Hex(""),
      contentType: "",
    });

    const response = await this.fetchImpl(url, {
      method: "DELETE",
      headers,
      signal,
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`OSS 删除失败: ${response.status}`);
    }
  }
}

function parseListResult(
  xml: string
): Array<{ key: string; size: number; lastModified: string }> {
  const results: Array<{ key: string; size: number; lastModified: string }> = [];
  const contentRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = contentRegex.exec(xml)) !== null) {
    const block = match[1] ?? "";
    const key = block.match(/<Key>(.*?)<\/Key>/)?.[1] ?? "";
    const size = parseInt(block.match(/<Size>(.*?)<\/Size>/)?.[1] ?? "0", 10);
    const lastModified = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? "";
    if (key) results.push({ key, size, lastModified });
  }
  return results;
}

export { buildObjectKey, extractRegionFromEndpoint };
