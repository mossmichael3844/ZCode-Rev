/**
 * 用户自助备份侧车
 *
 * 复用原始 ZCode 的核心采集逻辑 (扫描, tar 打包, manifest, 增量),
 * 但去掉了:
 *   - Z.ai 服务器凭证协商 (用户自己提供 AccessKey)
 *   - 服务器控制的 RSA 加密 (用户自己持有密码/密钥)
 *   - OSS 回调到 Z.ai 后端 (用户的 Bucket, 无回调)
 *   - 绕过隐私设置的行为 (用户主动配置, enabled=true 才运行)
 *
 * 数据流:
 *
 *   用户主动启用 (config.enabled = true)
 *     ↓
 *   scanWorkspaceFiles()        ← 尊重 filter 配置, 默认包含 .git/
 *     ↓
 *   buildRepoSnapshotArtifact() ← tar.gz 打包
 *     ↓
 *   selfEncryptArchive()        ← 用户密码 → PBKDF2 → AES-256-CTR (用户可自行解密)
 *     ↓                            或 mode=none 跳过加密
 *   ossBackupClient.uploadFile()← PUT 到用户自己的阿里云 OSS Bucket
 *     ↓
 *   清理本地临时文件, 维护快照数量上限
 */

import { readdir, stat, rm, writeFile } from "fs/promises";
import { join, relative } from "path";
import { createHash, randomUUID } from "crypto";

import { OssBackupClient } from "./oss-backup-client.js";
import { selfEncryptArchive } from "./self-encrypt.js";
import { buildRepoSnapshotArtifact, buildRepoSnapshotDelta } from "./build-artifact.js";
import { REPO_SNAPSHOT_MANIFEST_SCHEMA } from "./types.js";
import {
  resolveFilter,
  resolveSchedule,
  resolveEncryption,
  validateBackupConfig,
} from "./backup-config.js";
import type { SelfBackupConfig, BackupFilterConfig } from "./backup-config.js";
import type { RepoSnapshotManifest, RepoSnapshotManifestFile } from "./types.js";

// ── 工作区扫描 (可配置过滤) ──

function shouldExcludeDir(name: string, filter: Required<BackupFilterConfig>): boolean {
  if (filter.excludeDirs.includes(name)) return true;
  if (name === ".git") return !filter.includeGitDir;
  return false;
}

function shouldExcludeGitSubdir(name: string, filter: Required<BackupFilterConfig>): boolean {
  if (name === "lfs" && !filter.includeGitLfs) return true;
  return false;
}

function matchesGlob(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.startsWith("*.")) {
      if (path.endsWith(pattern.slice(1))) return true;
    } else if (path === pattern || path.endsWith(`/${pattern}`)) {
      return true;
    }
  }
  return false;
}

async function scanWorkspaceFilesFiltered(
  rootPath: string,
  filter: Required<BackupFilterConfig>,
  signal?: AbortSignal
): Promise<RepoSnapshotManifestFile[]> {
  const files: RepoSnapshotManifestFile[] = [];

  async function walk(dirPath: string, isGitSubdir: boolean): Promise<void> {
    signal?.throwIfAborted();
    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      signal?.throwIfAborted();
      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(rootPath, fullPath).replaceAll("\\", "/");

      if (entry.isDirectory()) {
        if (isGitSubdir && shouldExcludeGitSubdir(entry.name, filter)) continue;
        if (!isGitSubdir && shouldExcludeDir(entry.name, filter)) continue;
        const enteringGit = !isGitSubdir && entry.name === ".git";
        await walk(fullPath, isGitSubdir || enteringGit);
      } else if (entry.isFile()) {
        if (matchesGlob(relativePath, filter.excludeFiles)) continue;
        try {
          const fileStat = await stat(fullPath);
          if (fileStat.size > filter.maxFileSizeBytes) continue;
          files.push({ path: relativePath, sizeBytes: fileStat.size });
        } catch {
          // 跳过无法读取的文件
        }
      }
    }
  }

  await walk(rootPath, false);
  return files;
}

function buildManifest(
  files: RepoSnapshotManifestFile[],
  createdAt: string
): RepoSnapshotManifest {
  return {
    schema: REPO_SNAPSHOT_MANIFEST_SCHEMA,
    createdAt,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    stats: {
      includedFileCount: files.length,
      includedBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
    },
  };
}

function computeManifestHash(manifest: RepoSnapshotManifest): string {
  return createHash("sha256")
    .update(JSON.stringify(manifest, null, 2))
    .digest("hex");
}

// ── 备份侧车 ──

export interface BackupSidecarLogger {
  info: (context: unknown, message: string, data?: unknown) => void;
  warn: (context: unknown, message: string, data?: unknown) => void;
  error: (context: unknown, message: string, data?: unknown) => void;
}

export interface BackupResult {
  snapshotId: string;
  kind: "baseline" | "increment";
  fileCount: number;
  totalBytes: number;
  archiveSizeBytes: number;
  encrypted: boolean;
  ossObjectKey?: string;
  ossUrl?: string;
  durationMs: number;
}

export class BackupSidecar {
  private config: SelfBackupConfig;
  private ossClient: OssBackupClient;
  private checkpointsDir: string;
  private logger?: BackupSidecarLogger;
  private baseManifestByWorkspace = new Map<string, RepoSnapshotManifest>();
  private baseManifestHashByWorkspace = new Map<string, string>();
  private snapshotHistory: Array<{ snapshotId: string; createdAt: string }> = [];
  private intervalTimer?: ReturnType<typeof setInterval>;

  constructor(opts: {
    config: SelfBackupConfig;
    checkpointsDir: string;
    logger?: BackupSidecarLogger;
    fetchImpl?: typeof fetch;
  }) {
    this.config = opts.config;
    this.checkpointsDir = opts.checkpointsDir;
    this.logger = opts.logger;
    this.ossClient = new OssBackupClient(opts.config.oss, opts.fetchImpl);
  }

  updateConfig(config: SelfBackupConfig): void {
    this.config = config;
    this.ossClient.updateConfig(config.oss);
    this.stopInterval();
    if (config.enabled && config.schedule?.trigger === "interval") {
      this.startInterval(config.schedule.intervalSeconds ?? 300);
    }
  }

  private startInterval(seconds: number): void {
    this.intervalTimer = setInterval(() => {
      // interval 模式下不需要 workspacePath, 需外部传入
    }, seconds * 1000);
    this.intervalTimer.unref?.();
  }

  private stopInterval(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
  }

  /**
   * 执行一次备份
   *
   * 与原始 ZCode captureBeforePrompt 的区别:
   *   1. 必须 config.enabled=true 才执行 (尊重用户意愿)
   *   2. 尊重 filter 配置 (默认包含 .git/)
   *   3. 用户自己的密码加密 (可解密)
   *   4. 上传到用户自己的 OSS Bucket
   *   5. 无 Z.ai 服务器参与
   */
  async backup(opts: {
    workspacePath: string;
    workspaceIdentity?: string;
    signal?: AbortSignal;
  }): Promise<BackupResult | null> {
    if (!this.config.enabled) return null;

    const errors = validateBackupConfig(this.config);
    if (errors.length > 0) {
      this.logger?.error(undefined, "备份配置校验失败", { errors });
      return null;
    }

    const startTime = Date.now();
    const filter = resolveFilter(this.config.filter);
    const encryption = resolveEncryption(this.config.encryption);
    const schedule = resolveSchedule(this.config.schedule);
    const snapshotId = randomUUID();
    const workspaceKey = opts.workspaceIdentity?.trim() || opts.workspacePath;
    const createdAt = new Date().toISOString();

    try {
      // 1. 扫描工作区 (尊重过滤配置)
      this.logger?.info(undefined, "备份: 扫描工作区", { workspaceKey });
      const files = await scanWorkspaceFilesFiltered(
        opts.workspacePath,
        filter,
        opts.signal
      );
      const manifest = buildManifest(files, createdAt);
      const manifestHash = computeManifestHash(manifest);

      // 2. 计算增量
      const baseManifest = this.baseManifestByWorkspace.get(workspaceKey);
      const baseManifestHash = this.baseManifestHashByWorkspace.get(workspaceKey);
      const kind: "baseline" | "increment" = baseManifest ? "increment" : "baseline";
      const delta =
        kind === "increment" && baseManifest && baseManifestHash
          ? buildRepoSnapshotDelta({
              baseManifest,
              nextManifest: manifest,
              baseManifestHash,
              nextManifestHash: manifestHash,
            })
          : undefined;

      // 3. 确定需要打包的文件
      const filesToPack =
        kind === "increment" && delta
          ? delta.addedOrModified.map((f) => ({
              path: f.path,
              absolutePath: join(opts.workspacePath, f.path),
              sizeBytes: f.sizeBytes,
            }))
          : files.map((f) => ({
              path: f.path,
              absolutePath: join(opts.workspacePath, f.path),
              sizeBytes: f.sizeBytes,
            }));

      // 4. 构建 tar.gz 归档
      this.logger?.info(undefined, "备份: 构建归档", {
        fileCount: filesToPack.length,
      });
      const archivePath = join(this.checkpointsDir, `backup-${snapshotId}.tar.gz`);
      await buildRepoSnapshotArtifact({
        snapshotId,
        kind,
        prompt: { schema: "self-backup/v1", createdAt },
        manifest,
        delta,
        files: filesToPack,
        outputPath: archivePath,
        signal: opts.signal,
      });

      // 5. 加密 (或跳过)
      let uploadPath = archivePath;
      let uploadFilename = "backup.tar.gz";
      let encrypted = false;

      if (encryption.mode === "aes-256-ctr") {
        this.logger?.info(undefined, "备份: AES-256-CTR 加密 (用户持有密钥)");
        const encryptedPath = join(this.checkpointsDir, `backup-${snapshotId}.tar.gz.enc`);
        const envelopePath = join(this.checkpointsDir, `backup-${snapshotId}.envelope.json`);
        await selfEncryptArchive({
          plaintextPath: archivePath,
          encryptedPath,
          envelopePath,
          encryption,
          signal: opts.signal,
        });
        uploadPath = encryptedPath;
        uploadFilename = "backup.tar.gz.enc";
        encrypted = true;

        // 上传 envelope (用户解密时需要)
        await this.ossClient.uploadFile({
          localPath: envelopePath,
          snapshotId,
          filename: "envelope.json",
          contentType: "application/json",
          signal: opts.signal,
        });
      }

      // 6. 上传 manifest
      const manifestPath = join(this.checkpointsDir, `backup-${snapshotId}.manifest.json`);
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
      await this.ossClient.uploadFile({
        localPath: manifestPath,
        snapshotId,
        filename: "manifest.json",
        contentType: "application/json",
        signal: opts.signal,
      });

      // 7. 上传归档到用户的 OSS
      this.logger?.info(undefined, "备份: 上传到 OSS", {
        bucket: this.config.oss.bucket,
      });
      const uploadResult = await this.ossClient.uploadFile({
        localPath: uploadPath,
        snapshotId,
        filename: uploadFilename,
        signal: opts.signal,
      });

      // 8. 更新基线
      this.baseManifestByWorkspace.set(workspaceKey, manifest);
      this.baseManifestHashByWorkspace.set(workspaceKey, manifestHash);

      // 9. 记录历史, 清理超出上限的旧快照
      this.snapshotHistory.push({ snapshotId, createdAt });
      await this.pruneOldSnapshots(schedule.maxSnapshots, opts.signal);

      // 10. 清理本地临时文件
      await this.cleanupLocal(snapshotId);

      const result: BackupResult = {
        snapshotId,
        kind,
        fileCount: files.length,
        totalBytes: manifest.stats.includedBytes,
        archiveSizeBytes: uploadResult.sizeBytes,
        encrypted,
        ossObjectKey: uploadResult.objectKey,
        ossUrl: uploadResult.url,
        durationMs: Date.now() - startTime,
      };

      this.logger?.info(undefined, "备份: 完成", result);
      return result;
    } catch (err) {
      if (opts.signal?.aborted) return null;
      this.logger?.error(undefined, "备份: 失败", {
        workspaceKey,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.cleanupLocal(snapshotId);
      throw err;
    }
  }

  private async pruneOldSnapshots(
    maxSnapshots: number,
    signal?: AbortSignal
  ): Promise<void> {
    while (this.snapshotHistory.length > maxSnapshots) {
      const oldest = this.snapshotHistory.shift();
      if (!oldest) break;
      try {
        await this.ossClient.deleteSnapshot({
          snapshotId: oldest.snapshotId,
          signal,
        });
        this.logger?.info(undefined, "备份: 清理旧快照", {
          snapshotId: oldest.snapshotId,
        });
      } catch (err) {
        this.logger?.warn(undefined, "备份: 清理旧快照失败", {
          snapshotId: oldest.snapshotId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private async cleanupLocal(snapshotId: string): Promise<void> {
    const patterns = [
      `backup-${snapshotId}.tar.gz`,
      `backup-${snapshotId}.tar.gz.enc`,
      `backup-${snapshotId}.envelope.json`,
      `backup-${snapshotId}.manifest.json`,
    ];
    for (const filename of patterns) {
      await rm(join(this.checkpointsDir, filename), { force: true }).catch(() => {});
    }
  }

  dispose(): void {
    this.stopInterval();
  }
}
