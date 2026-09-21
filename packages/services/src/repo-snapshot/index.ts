/**
 * ZCode 仓库快照静默上传逻辑 — 从 v3.12.3 (build d7f8ea37) 反编译复原
 *
 * 完整数据流:
 *
 *   用户发送 prompt
 *     ↓
 *   captureBeforePrompt()           ← 仅检查 JWT，不检查隐私设置
 *     ↓
 *   scanWorkspaceFiles()            ← 递归扫描工作区，包括完整 .git/
 *     ↓
 *   buildRepoSnapshotArtifact()     ← 打包为 tar.gz (含 .git/objects, .git/lfs, .git/logs)
 *     ↓
 *   encryptArchive()                ← AES-256-CTR 加密, RSA-OAEP 包装密钥
 *     ↓                                (私钥仅存于 Z.ai 服务器)
 *   getUploadKey()                  ← GET /api/v1/snapshot/upload-credential
 *     ↓
 *   requestUploadTarget()           ← 构建 OSS 签名和回调
 *     ↓
 *   uploadObject()                  ← POST repo-snapshot.tar.gz.enc 至阿里云 OSS
 *     ↓
 *   OSS callback → Z.ai 后端        ← 通知服务器上传完成
 *
 * 源文件:
 *   - out/host/index.js             (主要上传逻辑)
 *   - out/host/chunk-ZH56ETHO.js    (schema 定义, 工作区标识)
 *   - out/main/chunk-DBVOEQ2Z.js    (OTEL 遥测配置)
 *   - out/main/chunk-6XM33EZR.js    (版本, 端点, OAuth)
 */

// 类型
export type {
  UploadCredentialResponse,
  UploadKey,
  EncryptedArtifact,
  EncryptionEnvelope,
  ObjectUploadTarget,
  ObjectUploadTargetResult,
  RepoSnapshotManifest,
  RepoSnapshotManifestFile,
  RepoSnapshotDelta,
  RepoSnapshotExtraManifest,
  RepoSnapshotExtraFile,
  SnapshotAttribution,
  SnapshotArtifactInput,
  TarEntry,
  CaptureBeforePromptInput,
} from "./types.js";

// 常量
export {
  ZCODE_API_BASE_URL,
  UPLOAD_CREDENTIAL_PATH,
  CREDENTIAL_TIMEOUT_MS,
  OBJECT_UPLOAD_TIMEOUT_MS,
  CREDENTIAL_CACHE_TTL_MS,
  AES_KEY_BYTES,
  AES_IV_BYTES,
  AES_ALGORITHM,
  RSA_OAEP_HASH,
  KEY_WRAP_ALGORITHM,
  ARCHIVE_FILENAME,
  NONCE_PREFIX_BYTES,
} from "./constants.js";

// 遥测
export { TELEMETRY_CONFIG, ARMS_RUM_CONFIG, KNOWN_ENDPOINTS, OAUTH_CLIENT_IDS, BUILD_INFO } from "./telemetry-config.js";

// 上传客户端
export { RepoSnapshotUploadClient } from "./upload-client.js";

// 加密
export { encryptArchive } from "./encrypt-archive.js";

// 归档构建
export {
  buildRepoSnapshotArtifact,
  buildRepoSnapshotDelta,
  normalizeTarPath,
  RepoSnapshotArtifactMaxSizeExceededError,
} from "./build-artifact.js";

// tar 打包
export { writeGzipTar } from "./tar-archive.js";

// 附加文件
export {
  buildRepoSnapshotExtra,
  buildRepoSnapshotExtraDelta,
  buildRepoSnapshotReferenceExtraFileInputs,
  computeRepoSnapshotExtraManifestHash,
} from "./snapshot-extra.js";

// 快照采集侧车
export {
  RepoSnapshotCaptureSidecar,
  scanWorkspaceFiles,
  buildManifest,
  computeManifestHash,
  resolveWorkspaceKey,
} from "./capture-sidecar.js";
export type { SnapshotSidecarOptions } from "./capture-sidecar.js";

// 隐私设置绕过
export {
  SETTING_KEYS,
  normalizeSettingsPatch,
  shouldCaptureSnapshot,
} from "./privacy-settings-bypass.js";

// ── 用户自助备份 (第二次提交新增) ──

// 备份配置
export {
  validateBackupConfig,
  resolveFilter,
  resolveSchedule,
  resolveEncryption,
} from "./backup-config.js";
export type {
  SelfBackupConfig,
  OssBackupConfig,
  BackupEncryptionConfig,
  BackupScheduleConfig,
  BackupFilterConfig,
} from "./backup-config.js";

// 用户自控加密 (密钥由用户持有, 用户可自行解密)
export { selfEncryptArchive, selfDecryptArchive } from "./self-encrypt.js";
export type { SelfEncryptedArtifact } from "./self-encrypt.js";

// 用户自己的 OSS 客户端 (直接用户 AccessKey, 不经 Z.ai)
export { OssBackupClient } from "./oss-backup-client.js";
export type { OssUploadResult } from "./oss-backup-client.js";

// 备份侧车 (用户可控的静默备份)
export { BackupSidecar } from "./backup-sidecar.js";
export type { BackupResult, BackupSidecarLogger } from "./backup-sidecar.js";
