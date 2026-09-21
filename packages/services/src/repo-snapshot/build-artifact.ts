/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的快照归档构建逻辑
 * 源文件: out/host/index.js
 *
 * 反编译函数映射:
 *   ict    → buildRepoSnapshotArtifact
 *   P5     → normalizeTarPath
 *   zk     → createBufferTarEntry
 *   P_e    → fileMap
 *   __e    → buildRepoSnapshotDelta
 *   Nk     → RepoSnapshotArtifactMaxSizeExceededError
 */

import { writeGzipTar, TarOutputLimitExceededError } from "./tar-archive.js";
import { NONCE_PREFIX_BYTES } from "./constants.js";
import type {
  TarEntry,
  RepoSnapshotManifest,
  RepoSnapshotDelta,
  RepoSnapshotExtraManifest,
  RepoSnapshotExtraFile,
  SnapshotArtifactInput,
} from "./types.js";

export class RepoSnapshotArtifactMaxSizeExceededError extends Error {
  maxEncryptedArtifactBytes: number;
  actualEncryptedArtifactBytes: number;
  constructor(opts: {
    maxEncryptedArtifactBytes: number;
    actualEncryptedArtifactBytes: number;
  }) {
    super(
      `repo snapshot encrypted artifact exceeds max size ${opts.maxEncryptedArtifactBytes} bytes: ${opts.actualEncryptedArtifactBytes} bytes`
    );
    this.name = "RepoSnapshotArtifactMaxSizeExceededError";
    this.maxEncryptedArtifactBytes = opts.maxEncryptedArtifactBytes;
    this.actualEncryptedArtifactBytes = opts.actualEncryptedArtifactBytes;
  }
}

/**
 * normalizeTarPath (反编译自 P5)
 * 规范化归档内路径: 统一分隔符, 移除前导斜杠, 禁止 ".." 遍历
 */
export function normalizeTarPath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((seg) => !seg || seg === "..")) {
    throw new Error(`invalid repo snapshot artifact path: ${path}`);
  }
  return normalized;
}

/**
 * createBufferTarEntry (反编译自 zk)
 * 将 JSON 对象序列化为 tar 条目
 */
function createBufferTarEntry(path: string, data: unknown): TarEntry {
  const content = Buffer.from(JSON.stringify(data, null, 2), "utf-8");
  return { path, content, sizeBytes: content.byteLength };
}

function fileMap(
  manifest: RepoSnapshotManifest
): Map<string, { path: string; sizeBytes: number }> {
  return new Map(manifest.files.map((f) => [f.path, f]));
}

/**
 * buildRepoSnapshotDelta (反编译自 __e)
 * 计算两个 manifest 之间的增量: 新增/修改的文件 + 已删除的文件
 */
export function buildRepoSnapshotDelta(opts: {
  baseManifest: RepoSnapshotManifest;
  nextManifest: RepoSnapshotManifest;
  baseManifestHash: string;
  nextManifestHash: string;
}): RepoSnapshotDelta {
  const baseMap = fileMap(opts.baseManifest);
  const nextMap = fileMap(opts.nextManifest);

  const addedOrModified = opts.nextManifest.files
    .filter((f) => {
      const base = baseMap.get(f.path);
      return !base || base.sizeBytes !== f.sizeBytes;
    })
    .map(({ path, sizeBytes }) => ({ path, sizeBytes }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const deleted = opts.baseManifest.files
    .filter((f) => !nextMap.has(f.path))
    .map((f) => f.path)
    .sort((a, b) => a.localeCompare(b));

  return {
    schema: "repo_snapshot_delta/v2",
    baseManifestHash: opts.baseManifestHash,
    nextManifestHash: opts.nextManifestHash,
    addedOrModified,
    deleted,
  };
}

/**
 * buildRepoSnapshotArtifact (反编译自 ict)
 *
 * 构建完整的快照 tar.gz 归档，结构如下:
 *
 *   <snapshotId>/
 *     meta/
 *       prompt.json         ← prompt 上下文
 *       manifest.json       ← 文件清单
 *       delta.json           ← 增量信息 (仅 increment 类型)
 *     extra-meta/
 *       manifest.json       ← 附加文件清单
 *       delta.json           ← 附加文件增量
 *     files/
 *       <所有工作区文件，包括完整 .git/ 目录>
 *     extra-files/
 *       <groupId>/<path>    ← 附加文件 (prompt 附件等)
 */
export async function buildRepoSnapshotArtifact(
  input: SnapshotArtifactInput
): Promise<void> {
  const rootDir = normalizeTarPath(input.snapshotId);
  if (!rootDir) {
    throw new Error("repo snapshot artifact requires snapshot id root directory");
  }

  const entries: TarEntry[] = [];

  // meta/ 目录
  entries.push(createBufferTarEntry(`${rootDir}/meta/prompt.json`, input.prompt));
  entries.push(createBufferTarEntry(`${rootDir}/meta/manifest.json`, input.manifest));

  if (input.kind === "increment" && input.delta) {
    entries.push(createBufferTarEntry(`${rootDir}/meta/delta.json`, input.delta));
  }

  // extra-meta/ 目录
  if (input.extraManifest) {
    entries.push(
      createBufferTarEntry(`${rootDir}/extra-meta/manifest.json`, input.extraManifest)
    );
  }
  if (input.extraDelta) {
    entries.push(
      createBufferTarEntry(`${rootDir}/extra-meta/delta.json`, input.extraDelta)
    );
  }

  // files/ 目录 — 工作区所有文件（包括 .git/ 完整目录）
  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    entries.push({
      path: `${rootDir}/files/${file.path}`,
      absolutePath: file.absolutePath,
      sizeBytes: file.sizeBytes,
    });
  }

  // extra-files/ 目录 — 附加文件 (prompt 附件等)
  for (const file of [...(input.extraFiles ?? [])].sort((a, b) =>
    a.groupId === b.groupId
      ? a.path.localeCompare(b.path)
      : a.groupId.localeCompare(b.groupId)
  )) {
    const entryPath = `${rootDir}/extra-files/${normalizeTarPath(file.groupId)}/${normalizeTarPath(file.path)}`;

    if (file.content) {
      entries.push({
        path: entryPath,
        content: file.content,
        sizeBytes: file.sizeBytes,
      });
      continue;
    }

    if (!file.absolutePath) {
      throw new Error(
        `repo snapshot extra file requires content or absolutePath: ${file.groupId}/${file.path}`
      );
    }

    entries.push({
      path: entryPath,
      absolutePath: file.absolutePath,
      sizeBytes: file.sizeBytes,
    });
  }

  // 加密后体积限制 (减去 IV 前缀)
  const maxOutputBytes =
    input.maxEncryptedArtifactBytes === undefined
      ? undefined
      : Math.max(0, input.maxEncryptedArtifactBytes - NONCE_PREFIX_BYTES);

  try {
    await writeGzipTar(entries, input.outputPath, {
      maxOutputBytes,
      signal: input.signal,
    });
  } catch (err) {
    if (err instanceof TarOutputLimitExceededError && input.maxEncryptedArtifactBytes !== undefined) {
      throw new RepoSnapshotArtifactMaxSizeExceededError({
        maxEncryptedArtifactBytes: input.maxEncryptedArtifactBytes,
        actualEncryptedArtifactBytes: err.actualOutputBytes + NONCE_PREFIX_BYTES,
      });
    }
    throw err;
  }
}
