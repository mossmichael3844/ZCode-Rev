/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的类型定义
 * 源文件: out/host/index.js, out/host/chunk-ZH56ETHO.js
 */

export const REPO_SNAPSHOT_MANIFEST_SCHEMA = "repo_snapshot_manifest/v2";
export const REPO_SNAPSHOT_PROMPT_SCHEMA = "repo_snapshot_prompt/v2";
export const REPO_SNAPSHOT_DELTA_SCHEMA = "repo_snapshot_delta/v2";
export const REPO_SNAPSHOT_EXTRA_MANIFEST_SCHEMA = "repo_snapshot_extra_manifest/v1";
export const REPO_SNAPSHOT_EXTRA_DELTA_SCHEMA = "repo_snapshot_extra_delta/v1";
export const REPO_SNAPSHOT_ENCRYPTED_ARTIFACT_SCHEMA = "repo_snapshot_encrypted_artifact/v2";
export const REPO_SNAPSHOT_ENCRYPTION_AAD_SCHEMA = "repo_snapshot_encryption_aad/v2";
export const REPO_SNAPSHOT_MANIFEST_HASH_SCHEMA = "repo_snapshot_manifest_hash/v1";
export const REPO_SNAPSHOT_UPLOAD_KEY_SCHEMA = "repo_snapshot_upload_key/v1";
export const REPO_SNAPSHOT_UPLOAD_TARGET_SCHEMA = "repo_snapshot_upload_target/v1";

export interface RepoSnapshotManifestFile {
  path: string;
  sizeBytes: number;
}

export interface RepoSnapshotManifest {
  schema: string;
  createdAt: string;
  files: RepoSnapshotManifestFile[];
  stats: {
    includedFileCount: number;
    includedBytes: number;
  };
}

export interface RepoSnapshotDelta {
  schema: string;
  baseManifestHash: string;
  nextManifestHash: string;
  addedOrModified: Array<{ path: string; sizeBytes: number }>;
  deleted: string[];
}

export interface RepoSnapshotExtraFile {
  path: string;
  sizeBytes: number;
  contentHash: string;
  source: string;
  groupId: string;
  absolutePath?: string;
  content?: Buffer;
}

export interface RepoSnapshotExtraManifestGroup {
  groupId: string;
  changePolicy?: string;
  files: Array<{
    path: string;
    sizeBytes: number;
    contentHash: string;
    source: string;
  }>;
}

export interface RepoSnapshotExtraManifest {
  schema: string;
  createdAt: string;
  groups: RepoSnapshotExtraManifestGroup[];
  stats: {
    includedFileCount: number;
    includedBytes: number;
  };
}

export interface UploadCredentialResponse {
  snapshot: {
    snapshot_id: string;
    base_snapshot_id?: string;
  };
  encryption: {
    key_version: number;
    public_key: string;
  };
  oss: {
    host: string;
    path: string;
    policy: string;
    x_oss_signature: string;
    x_oss_signature_version: string;
    x_oss_credential: string;
    x_oss_date: string;
    x_oss_security_token: string;
  };
  callback: {
    url: string;
    body: string;
    content_type: string;
  };
  max_size?: number;
}

export interface UploadKey {
  schema: string;
  uploadCredentialHandle: string;
  snapshotId: string;
  baseSnapshotId?: string;
  keyId: string;
  keyWrapAlgorithm: "rsa-oaep-sha256";
  publicKeySpkiPem: string;
  maxSizeBytes?: number;
}

export interface EncryptedArtifact {
  encryptedArtifactPath: string;
  envelopePath: string;
  manifestPath: string;
  envelope: EncryptionEnvelope;
  encryptedSizeBytes: number;
  encryptedSha256: string;
}

export interface EncryptionEnvelope {
  encryptedDataKey: string;
  plaintextSha256: string;
  [key: string]: unknown;
}

export interface ObjectUploadTarget {
  ok: true;
  snapshotId: string;
  objectKey: string;
  objectUpload: {
    method: "POST" | "PUT";
    url: string;
    expiresAt: number;
    maxBytes: number;
    formFields?: Record<string, string>;
    headers?: Record<string, string>;
    checksum?: { headerName: string; value: string };
    callback?: { mode: string };
  };
}

export interface ObjectUploadTargetError {
  ok: false;
  reason: "payload_too_large" | "key_expired" | "invalid";
  message: string;
  maxSizeBytes?: number;
}

export type ObjectUploadTargetResult = ObjectUploadTarget | ObjectUploadTargetError;

export interface SnapshotAttribution {
  sessionId?: string;
  queryId?: string;
  requestId?: string;
  failureCount?: number;
  captureStage?: string;
  historyRoundCount?: number;
}

export interface SnapshotArtifactInput {
  snapshotId: string;
  kind: "baseline" | "increment";
  prompt: unknown;
  manifest: RepoSnapshotManifest;
  delta?: RepoSnapshotDelta;
  extraManifest?: RepoSnapshotExtraManifest;
  extraDelta?: unknown;
  files: Array<{ path: string; absolutePath: string; sizeBytes: number }>;
  extraFiles?: RepoSnapshotExtraFile[];
  maxEncryptedArtifactBytes?: number;
  outputPath: string;
  signal?: AbortSignal;
}

export interface TarEntry {
  path: string;
  content?: Buffer;
  absolutePath?: string;
  sizeBytes: number;
}

export interface CaptureBeforePromptInput {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  traceId?: string;
  inputId: string;
  queryId?: string;
  captureStage: string;
  messageId?: string;
  provider?: string;
  model?: string;
  url?: string;
  content?: string;
  extraFiles?: RepoSnapshotExtraFile[];
  signal?: AbortSignal;
}
