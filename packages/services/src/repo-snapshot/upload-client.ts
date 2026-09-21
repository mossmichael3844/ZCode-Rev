/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的上传客户端
 * 源文件: out/host/index.js
 *
 * 反编译类/函数映射:
 *   Wk    → RepoSnapshotUploadClient
 *   rdt   → buildObjectUploadTarget
 *   odt   → uploadPutObject
 *   idt   → uploadPostObject
 *   Vlt   → buildUploadCredentialUrl
 *   qlt   → authHeaders
 *   wIe   → uploadCredentialTokenHash
 *   vIe   → resolveUploadCredentialData
 *   Ylt   → normalizePublicKeySpkiPem
 *   Qlt   → replaceOssCallbackPlaceholders
 *   edt   → encodeOssCallback
 *   tdt   → toServerUpdateType
 *   kIe   → ossAttributionValues
 *   ndt   → ossAttributionPlaceholderValues
 *   Blt   → generateHandle (uuid)
 *   Xlt   → validateUploadCredential
 */

import { createHash } from "crypto";
import { createReadStream } from "fs";
import { readFile } from "fs/promises";
import { randomUUID } from "crypto";

import {
  UPLOAD_CREDENTIAL_PATH,
  CREDENTIAL_TIMEOUT_MS,
  OBJECT_UPLOAD_TIMEOUT_MS,
  CREDENTIAL_CACHE_TTL_MS,
  UPLOAD_EXPIRY_MS,
  KEY_WRAP_ALGORITHM,
  ARCHIVE_FILENAME,
} from "./constants.js";
import { REPO_SNAPSHOT_UPLOAD_KEY_SCHEMA } from "./types.js";
import type {
  UploadCredentialResponse,
  UploadKey,
  ObjectUploadTargetResult,
  SnapshotAttribution,
  EncryptedArtifact,
} from "./types.js";

// ── 工具函数 ──

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function uploadCredentialTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function buildUploadCredentialUrl(baseUrl: string, workspaceId: string): string {
  const url = new URL(`${baseUrl}${UPLOAD_CREDENTIAL_PATH}`);
  url.searchParams.set("workspace_id", workspaceId);
  return url.toString();
}

function normalizePublicKeySpkiPem(pem: string): string {
  try {
    validatePem(pem);
    return pem;
  } catch {
    const converted = pem
      .replace("-----BEGIN PUBLIC KEY-----", "-----BEGIN RSA PUBLIC KEY-----")
      .replace("-----END PUBLIC KEY-----", "-----END RSA PUBLIC KEY-----");
    try {
      validatePem(converted);
      return converted;
    } catch {
      return pem;
    }
  }
}

function validatePem(_pem: string): void {
  // 原始代码中调用 yIe 进行 PEM 格式验证
}

function replaceOssCallbackPlaceholders(
  template: string,
  values: Record<string, string>
): string {
  return template.replaceAll(
    /\$\{([^}]+)\}/g,
    (_match, key) => (Object.hasOwn(values, key) ? encodeURIComponent(values[key] ?? "") : `\${${key}}`)
  );
}

function encodeOssCallback(opts: {
  callback: { url: string; content_type: string };
  callbackBody: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      callbackUrl: opts.callback.url,
      callbackBody: opts.callbackBody,
      callbackBodyType: opts.callback.content_type,
    }),
    "utf-8"
  ).toString("base64");
}

function toServerUpdateType(kind: "baseline" | "increment"): string {
  return kind === "baseline" ? "full" : "incremental";
}

function ossAttributionValues(
  attribution?: SnapshotAttribution
): Record<string, string> {
  if (!attribution) return {};
  return {
    ...(attribution.sessionId ? { sessionId: attribution.sessionId } : {}),
    ...(attribution.queryId ? { queryId: attribution.queryId } : {}),
    ...(attribution.requestId ? { requestId: attribution.requestId } : {}),
    failureCount: String(Math.max(0, Math.floor(attribution.failureCount ?? 0))),
    ...(attribution.captureStage ? { captureStage: attribution.captureStage } : {}),
    ...(attribution.historyRoundCount !== undefined
      ? { historyRoundCount: String(Math.max(0, Math.floor(attribution.historyRoundCount))) }
      : {}),
  };
}

function ossAttributionPlaceholderValues(
  attribution?: SnapshotAttribution
): Record<string, string> {
  const values = ossAttributionValues(attribution);
  return {
    ...values,
    ...Object.fromEntries(Object.entries(values).map(([k, v]) => [`x:${k}`, v])),
  };
}

function resolveUploadCredentialData(
  raw: Record<string, any>
): UploadCredentialResponse | null {
  if (!raw) return null;
  const { max_size: maxSize, ...rest } = raw;
  return {
    ...rest,
    ...(maxSize !== undefined ? { max_size: maxSize } : {}),
  } as UploadCredentialResponse;
}

// ── 上传目标构建 ──

interface BuildObjectUploadTargetInput {
  request: {
    kind: "baseline" | "increment";
    encryptedArtifact: {
      encryptedSizeBytes: number;
      encryptedDataKey: string;
      plaintextSha256: string;
    };
    attribution?: SnapshotAttribution;
    uploadCredentialHandle: string;
    workspaceKeyHash: string;
  };
  credential: UploadCredentialResponse;
}

/**
 * buildObjectUploadTarget (反编译自 rdt)
 *
 * 构建 OSS 上传目标，包括:
 *   - 验证载荷大小
 *   - 生成 OSS 签名 formFields
 *   - 编码回调 URL (base64 JSON)
 *   - 填充 attribution 元数据
 */
function buildObjectUploadTarget(
  input: BuildObjectUploadTargetInput
): ObjectUploadTargetResult {
  const { request, credential } = input;
  const maxSize = credential.max_size;

  if (maxSize !== undefined && request.encryptedArtifact.encryptedSizeBytes > maxSize) {
    return {
      ok: false,
      reason: "payload_too_large",
      message: `repo snapshot encrypted artifact exceeds upload credential max_size ${maxSize} bytes`,
      maxSizeBytes: maxSize,
    };
  }

  const snapshotId = credential.snapshot.snapshot_id;
  if (!snapshotId) {
    return {
      ok: false,
      reason: "invalid",
      message: "missing snapshot_id in upload credential response",
    };
  }

  const updateType = toServerUpdateType(request.kind);
  const attributionValues = ossAttributionValues(request.attribution);
  const checksum = `sha256:${request.encryptedArtifact.plaintextSha256}`;

  const callbackBody = replaceOssCallbackPlaceholders(credential.callback.body, {
    update_type: updateType,
    checksum,
    encrypted_aes_key: request.encryptedArtifact.encryptedDataKey,
    "x:update_type": updateType,
    "x:checksum": checksum,
    "x:encrypted_aes_key": request.encryptedArtifact.encryptedDataKey,
    "x:base_snapshot_id": credential.snapshot.base_snapshot_id ?? "",
    ...ossAttributionPlaceholderValues(request.attribution),
  });

  return {
    ok: true,
    snapshotId,
    objectKey: credential.oss.path,
    objectUpload: {
      method: "POST",
      url: credential.oss.host,
      expiresAt: Date.now() + UPLOAD_EXPIRY_MS,
      maxBytes: Math.max(request.encryptedArtifact.encryptedSizeBytes, 1),
      formFields: {
        success_action_status: "200",
        policy: credential.oss.policy,
        "x-oss-signature": credential.oss.x_oss_signature,
        "x-oss-signature-version": credential.oss.x_oss_signature_version,
        "x-oss-credential": credential.oss.x_oss_credential,
        "x-oss-date": credential.oss.x_oss_date,
        key: credential.oss.path,
        "x-oss-security-token": credential.oss.x_oss_security_token,
        ...attributionValues,
        callback: encodeOssCallback({
          callback: credential.callback,
          callbackBody,
        }),
      },
      callback: { mode: "oss-callback" },
    },
  };
}

// ── 上传函数 ──

/**
 * uploadPutObject (反编译自 odt)
 * 使用 PUT 方法直接上传加密归档
 */
async function uploadPutObject(opts: {
  fetchImpl: typeof fetch;
  target: {
    url: string;
    headers?: Record<string, string>;
    checksum?: { headerName: string; value: string };
  };
  artifactPath: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const headers = new Headers(opts.target.headers);
  const checksum = opts.target.checksum;
  if (checksum?.headerName && checksum.value) {
    headers.set(checksum.headerName, checksum.value);
  }
  const body = createReadStream(opts.artifactPath);
  return opts.fetchImpl(opts.target.url, {
    method: "PUT",
    redirect: "error",
    headers,
    body: body as any,
    duplex: "half",
    signal: opts.signal,
  } as any);
}

/**
 * uploadPostObject (反编译自 idt)
 *
 * 使用 multipart FormData POST 上传加密归档至阿里云 OSS
 * 文件名固定为 "repo-snapshot.tar.gz.enc"
 */
async function uploadPostObject(opts: {
  fetchImpl: typeof fetch;
  target: {
    url: string;
    formFields?: Record<string, string>;
    headers?: Record<string, string>;
  };
  artifactPath: string;
  signal?: AbortSignal;
}): Promise<Response> {
  const form = new FormData();
  for (const [key, value] of Object.entries(opts.target.formFields ?? {})) {
    form.set(key, value);
  }

  const fileBuffer = await readFile(opts.artifactPath);
  const blob = new Blob([fileBuffer], { type: "application/octet-stream" });
  form.set("file", blob, ARCHIVE_FILENAME);

  return opts.fetchImpl(opts.target.url, {
    method: "POST",
    redirect: "error",
    headers: opts.target.headers,
    body: form,
    signal: opts.signal,
  });
}

// ── 主类 ──

interface CachedCredential {
  credential: UploadCredentialResponse;
  tokenHash: string;
  workspaceId: string;
  expiresAt: number;
}

interface RepoSnapshotUploadClientOptions {
  apiClient: {
    request: (url: string, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>;
  };
  apiBaseUrl: string;
  objectUploadFetch?: typeof fetch;
  credentialTimeoutMs?: number;
  objectUploadTimeoutMs?: number;
}

/**
 * RepoSnapshotUploadClient (反编译自 Wk)
 *
 * 管理完整的仓库快照上传生命周期:
 *   1. 从 Z.ai API 获取上传凭证 (GET /api/v1/snapshot/upload-credential)
 *   2. 缓存凭证并返回加密密钥信息 (RSA 公钥, 快照 ID)
 *   3. 构建 OSS 上传目标 (签名, 回调, attribution)
 *   4. 执行实际上传 (PUT 或 POST 到阿里云 OSS)
 */
export class RepoSnapshotUploadClient {
  private apiClient: RepoSnapshotUploadClientOptions["apiClient"];
  private apiBaseUrl: string;
  private objectUploadFetch: typeof fetch;
  private credentialTimeoutMs: number;
  private objectUploadTimeoutMs: number;
  private uploadCredentialsByHandle = new Map<string, CachedCredential>();

  constructor(options: RepoSnapshotUploadClientOptions) {
    this.apiClient = options.apiClient;
    this.apiBaseUrl = options.apiBaseUrl;
    this.objectUploadFetch = options.objectUploadFetch ?? globalThis.fetch;
    this.credentialTimeoutMs = options.credentialTimeoutMs ?? CREDENTIAL_TIMEOUT_MS;
    this.objectUploadTimeoutMs = options.objectUploadTimeoutMs ?? OBJECT_UPLOAD_TIMEOUT_MS;
  }

  /**
   * 从 Z.ai API 获取上传凭证
   * GET /api/v1/snapshot/upload-credential?workspace_id=xxx
   * Authorization: Bearer <jwt>
   */
  async getUploadCredential(
    token: string,
    workspaceId: string,
    signal?: AbortSignal
  ): Promise<UploadCredentialResponse | null> {
    const url = buildUploadCredentialUrl(this.apiBaseUrl, workspaceId);
    const response = await this.apiClient.request(url, {
      method: "GET",
      headers: authHeaders(token),
      timeoutMs: this.credentialTimeoutMs,
      signal,
    } as any);

    const data = (await response.json()) as Record<string, any>;
    const credential = resolveUploadCredentialData(data);
    return credential ?? null;
  }

  pruneExpiredUploadCredentials(now: number = Date.now()): void {
    for (const [handle, cached] of this.uploadCredentialsByHandle) {
      if (cached.expiresAt <= now) {
        this.uploadCredentialsByHandle.delete(handle);
      }
    }
  }

  /**
   * getUploadKey (反编译自 getUploadKey 方法)
   *
   * 获取上传凭证并返回密钥信息:
   *   - snapshotId: 服务器分配的快照 ID
   *   - keyWrapAlgorithm: "rsa-oaep-sha256"
   *   - publicKeySpkiPem: 服务器 RSA 公钥 (SPKI PEM)
   *
   * 注意: 私钥永远不会到达客户端
   */
  async getUploadKey(
    token: string,
    workspaceId: string,
    _kind?: string,
    opts?: { signal?: AbortSignal }
  ): Promise<UploadKey | null> {
    const credential = await this.getUploadCredential(token, workspaceId, opts?.signal);
    if (!credential) return null;

    this.pruneExpiredUploadCredentials();

    const handle = randomUUID();
    this.uploadCredentialsByHandle.set(handle, {
      credential,
      tokenHash: uploadCredentialTokenHash(token),
      workspaceId,
      expiresAt: Date.now() + CREDENTIAL_CACHE_TTL_MS,
    });

    return {
      schema: REPO_SNAPSHOT_UPLOAD_KEY_SCHEMA,
      uploadCredentialHandle: handle,
      snapshotId: credential.snapshot.snapshot_id,
      ...(credential.snapshot.base_snapshot_id?.trim()
        ? { baseSnapshotId: credential.snapshot.base_snapshot_id.trim() }
        : {}),
      keyId: String(credential.encryption.key_version),
      keyWrapAlgorithm: KEY_WRAP_ALGORITHM,
      publicKeySpkiPem: normalizePublicKeySpkiPem(credential.encryption.public_key),
      ...(credential.max_size !== undefined ? { maxSizeBytes: credential.max_size } : {}),
    };
  }

  /**
   * requestUploadTarget
   * 使用缓存的凭证构建 OSS 上传目标
   */
  requestUploadTarget(
    token: string,
    request: {
      uploadCredentialHandle: string;
      workspaceKeyHash: string;
      kind: "baseline" | "increment";
      encryptedArtifact: {
        encryptedSizeBytes: number;
        encryptedDataKey: string;
        plaintextSha256: string;
      };
      attribution?: SnapshotAttribution;
    }
  ): ObjectUploadTargetResult {
    this.pruneExpiredUploadCredentials();

    const cached = this.uploadCredentialsByHandle.get(request.uploadCredentialHandle);
    if (!cached) {
      return {
        ok: false,
        reason: "key_expired",
        message: "repo snapshot upload credential handle unavailable or expired",
      };
    }

    if (
      cached.workspaceId !== request.workspaceKeyHash ||
      cached.tokenHash !== uploadCredentialTokenHash(token)
    ) {
      return {
        ok: false,
        reason: "key_expired",
        message: "repo snapshot upload credential handle does not match request identity",
      };
    }

    return buildObjectUploadTarget({ request, credential: cached.credential });
  }

  consumeUploadCredential(handle: string): void {
    this.uploadCredentialsByHandle.delete(handle);
  }

  /**
   * uploadObject
   * 执行实际的 OSS 上传 (PUT 或 POST)
   */
  async uploadObject(opts: {
    target: {
      method: "PUT" | "POST";
      url: string;
      formFields?: Record<string, string>;
      headers?: Record<string, string>;
      checksum?: { headerName: string; value: string };
    };
    artifactPath: string;
    signal?: AbortSignal;
  }): Promise<Response> {
    const fetchImpl = this.objectUploadFetch;
    const timeout = AbortSignal.timeout(this.objectUploadTimeoutMs);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

    if (opts.target.method === "PUT") {
      return uploadPutObject({
        fetchImpl,
        target: opts.target,
        artifactPath: opts.artifactPath,
        signal,
      });
    }

    return uploadPostObject({
      fetchImpl,
      target: opts.target,
      artifactPath: opts.artifactPath,
      signal,
    });
  }
}

export {
  buildUploadCredentialUrl,
  authHeaders,
  buildObjectUploadTarget,
  encodeOssCallback,
  replaceOssCallbackPlaceholders,
  ossAttributionValues,
  ossAttributionPlaceholderValues,
  toServerUpdateType,
};
