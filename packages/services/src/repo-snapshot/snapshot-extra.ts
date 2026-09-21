/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的附加文件采集逻辑
 * 源文件: out/host/index.js
 *
 * 反编译函数映射:
 *   Vce    → buildRepoSnapshotExtra
 *   Jce    → readAcceptedBaseExtraManifest
 *   Xce    → buildRepoSnapshotExtraDelta
 *   Yce    → selectDeltaExtraFiles
 *   p4     → computeRepoSnapshotExtraManifestHash
 *   tle    → buildRepoSnapshotReferenceExtraFileInputs
 *   ry     → extraFileKey
 *   Gce    → extraFileMap
 */

import { createHash } from "crypto";
import { stat, readFile } from "fs/promises";
import { basename } from "path";
import {
  REPO_SNAPSHOT_EXTRA_MANIFEST_SCHEMA,
  REPO_SNAPSHOT_EXTRA_DELTA_SCHEMA,
} from "./types.js";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  MAX_INLINE_TEXT_BYTES,
  MAX_REFERENCE_FILES,
} from "./constants.js";
import type {
  RepoSnapshotExtraFile,
  RepoSnapshotExtraManifest,
  RepoSnapshotExtraManifestGroup,
} from "./types.js";

const PROMPT_ATTACHMENT_GROUP = "prompt-attachment";

function extraFileKey(file: { groupId: string; path: string }): string {
  return `${file.groupId}\0${file.path}`;
}

function extraFileMap(
  manifest: RepoSnapshotExtraManifest
): Map<string, RepoSnapshotExtraFile> {
  const map = new Map<string, RepoSnapshotExtraFile>();
  for (const group of manifest.groups) {
    for (const file of group.files) {
      map.set(extraFileKey({ groupId: group.groupId, path: file.path }), {
        ...file,
        groupId: group.groupId,
        sizeBytes: file.sizeBytes,
      });
    }
  }
  return map;
}

function normalizePath(p: string): string {
  return p.replaceAll("\\", "/").replace(/^\/+/, "").trim();
}

async function sha256Buffer(buf: Buffer): Promise<string> {
  return createHash("sha256").update(buf).digest("hex");
}

async function sha256File(filePath: string, signal?: AbortSignal): Promise<string> {
  const content = await readFile(filePath);
  return sha256Buffer(content);
}

function toBuffer(content: string | Buffer): Buffer {
  return typeof content === "string" ? Buffer.from(content, "utf-8") : content;
}

export function computeRepoSnapshotExtraManifestHash(
  manifest: RepoSnapshotExtraManifest
): string {
  const sorted: RepoSnapshotExtraManifest = {
    schema: manifest.schema,
    createdAt: manifest.createdAt,
    groups: [...manifest.groups]
      .sort((a, b) => a.groupId.localeCompare(b.groupId))
      .map((g) => ({
        groupId: g.groupId,
        changePolicy: g.changePolicy,
        files: [...g.files]
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((f) => ({
            path: f.path,
            sizeBytes: f.sizeBytes,
            contentHash: f.contentHash,
            source: f.source,
          })),
      })),
    stats: manifest.stats,
  };
  return createHash("sha256")
    .update(JSON.stringify(sorted, null, 2))
    .digest("hex");
}

export interface ExtraFileInput {
  groupId: string;
  path?: string;
  absolutePath?: string;
  content?: string | Buffer;
  source?: string;
  changePolicy?: string;
}

/**
 * buildRepoSnapshotExtra (反编译自 Vce)
 * 构建附加文件清单 (prompt 附件等)
 */
export async function buildRepoSnapshotExtra(opts: {
  inputs: ExtraFileInput[];
  createdAt: string;
  signal?: AbortSignal;
}): Promise<{
  manifest?: RepoSnapshotExtraManifest;
  files: RepoSnapshotExtraFile[];
}> {
  if (!opts.inputs?.length) return { files: [] };

  const changePolicies = new Map<string, string>();
  const groupFiles = new Map<string, RepoSnapshotExtraFile[]>();

  for (const input of opts.inputs) {
    opts.signal?.throwIfAborted();
    const groupId = normalizePath(input.groupId);

    if (input.content !== undefined) {
      if (!input.path) throw new Error("repo snapshot extra content requires path");
      const buf = toBuffer(input.content);
      const path = normalizePath(input.path);
      const file: RepoSnapshotExtraFile = {
        groupId,
        path,
        content: buf,
        sizeBytes: buf.byteLength,
        contentHash: await sha256Buffer(buf),
        source: input.source ?? PROMPT_ATTACHMENT_GROUP,
      };
      appendFile(groupFiles, file);
      if (input.changePolicy) changePolicies.set(groupId, input.changePolicy);
      continue;
    }

    if (!input.absolutePath) {
      throw new Error("repo snapshot extra file requires content or absolutePath");
    }

    const path = normalizePath(input.path ?? basename(input.absolutePath));
    const fileStat = await stat(input.absolutePath);
    if (fileStat.isFile()) {
      const file: RepoSnapshotExtraFile = {
        groupId,
        path,
        absolutePath: input.absolutePath,
        sizeBytes: fileStat.size,
        contentHash: await sha256File(input.absolutePath, opts.signal),
        source: input.source ?? PROMPT_ATTACHMENT_GROUP,
      };
      appendFile(groupFiles, file);
      if (input.changePolicy) changePolicies.set(groupId, input.changePolicy);
    }
  }

  const groups: RepoSnapshotExtraManifestGroup[] = [...groupFiles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupId, files]) => ({
      groupId,
      changePolicy: changePolicies.get(groupId),
      files: files
        .sort((a, b) => a.path.localeCompare(b.path))
        .map(({ path, sizeBytes, contentHash, source }) => ({
          path,
          sizeBytes,
          contentHash,
          source,
        })),
    }));

  const allFiles = [...groupFiles.values()].flat();
  if (groups.length === 0) return { files: [] };

  return {
    manifest: {
      schema: REPO_SNAPSHOT_EXTRA_MANIFEST_SCHEMA,
      createdAt: opts.createdAt,
      groups,
      stats: {
        includedFileCount: allFiles.length,
        includedBytes: allFiles.reduce((sum, f) => sum + f.sizeBytes, 0),
      },
    },
    files: allFiles,
  };
}

function appendFile(
  map: Map<string, RepoSnapshotExtraFile[]>,
  file: RepoSnapshotExtraFile
): void {
  const list = map.get(file.groupId) ?? [];
  const idx = list.findIndex((f) => f.path === file.path);
  if (idx >= 0) {
    list[idx] = file;
  } else {
    list.push(file);
  }
  map.set(file.groupId, list);
}

/**
 * buildRepoSnapshotExtraDelta (反编译自 Xce)
 */
export function buildRepoSnapshotExtraDelta(opts: {
  baseExtraManifest: RepoSnapshotExtraManifest;
  nextExtraManifest: RepoSnapshotExtraManifest;
  baseExtraManifestHash: string;
  nextExtraManifestHash: string;
}): unknown {
  const baseMap = extraFileMap(opts.baseExtraManifest);
  const nextMap = extraFileMap(opts.nextExtraManifest);

  const groups: Array<{
    groupId: string;
    addedOrModified: Array<{ path: string; sizeBytes: number; contentHash: string; source: string }>;
    deleted: string[];
  }> = opts.nextExtraManifest.groups
    .map((group) => {
      const added = group.files
        .filter((f) => {
          const base = baseMap.get(extraFileKey({ groupId: group.groupId, path: f.path }));
          return !base || base.sizeBytes !== f.sizeBytes || base.contentHash !== f.contentHash;
        })
        .sort((a, b) => a.path.localeCompare(b.path));

      const baseGroup = opts.baseExtraManifest.groups.find(
        (g) => g.groupId === group.groupId
      );
      const deleted = (baseGroup?.files ?? [])
        .filter((f) => !nextMap.has(extraFileKey({ groupId: group.groupId, path: f.path })))
        .map((f) => f.path)
        .sort((a, b) => a.localeCompare(b));

      return { groupId: group.groupId, addedOrModified: added, deleted };
    })
    .filter((g) => g.addedOrModified.length > 0 || g.deleted.length > 0);

  // 检查已删除的 group
  for (const baseGroup of opts.baseExtraManifest.groups) {
    if (!opts.nextExtraManifest.groups.some((g) => g.groupId === baseGroup.groupId)) {
      groups.push({
        groupId: baseGroup.groupId,
        addedOrModified: [],
        deleted: baseGroup.files.map((f) => f.path).sort((a, b) => a.localeCompare(b)),
      });
    }
  }

  return {
    schema: REPO_SNAPSHOT_EXTRA_DELTA_SCHEMA,
    baseExtraManifestHash: opts.baseExtraManifestHash,
    nextExtraManifestHash: opts.nextExtraManifestHash,
    groups: groups.sort((a, b) => a.groupId.localeCompare(b.groupId)),
  };
}

/**
 * buildRepoSnapshotReferenceExtraFileInputs (反编译自 tle)
 *
 * 从 prompt 附件构建附加文件输入列表
 * 限制: 最多 16 个文件, 单文件最大 100MB, 总计最大 1GB
 */
export async function buildRepoSnapshotReferenceExtraFileInputs(
  attachments: Array<{
    filename?: string;
    fileName?: string;
    localPath?: string;
    ref?: string;
    textContent?: string;
    dataBase64?: string;
    mimeType?: string;
    mime?: string;
    kind?: string;
  }>,
  opts?: {
    signal?: AbortSignal;
    maxFileBytes?: Record<string, number>;
    maxTotalBytes?: number;
  }
): Promise<ExtraFileInput[]> {
  if (!attachments?.length) return [];

  const usedPaths = new Set<string>();
  const result: ExtraFileInput[] = [];
  const maxTotal = opts?.maxTotalBytes ?? MAX_TOTAL_ATTACHMENT_BYTES;
  let totalBytes = 0;

  for (let i = 0; i < attachments.length; i++) {
    opts?.signal?.throwIfAborted();
    if (result.length >= MAX_REFERENCE_FILES) break;

    const attachment = attachments[i];
    if (!attachment || typeof attachment !== "object") continue;

    const filename =
      (typeof attachment.filename === "string" && attachment.filename.trim()) ||
      (typeof attachment.fileName === "string" && attachment.fileName.trim()) ||
      `attachment-${i + 1}.txt`;

    const mimeType = (attachment.mimeType ?? attachment.mime ?? "").toLowerCase();
    const category = mimeType.startsWith("image/")
      ? "image"
      : mimeType.startsWith("video/")
        ? "video"
        : mimeType.startsWith("audio/")
          ? "audio"
          : "default";
    const maxFileSize = opts?.maxFileBytes?.[category] ?? MAX_ATTACHMENT_BYTES[category] ?? MAX_ATTACHMENT_BYTES["default"]!;

    // 本地文件
    const localPath =
      (typeof attachment.localPath === "string" && attachment.localPath.trim()) ||
      (typeof attachment.ref === "string" &&
        attachment.ref.trim() &&
        !/^[a-z][a-z0-9+.-]*:\/\//i.test(attachment.ref)
        ? attachment.ref
        : undefined);

    if (localPath) {
      try {
        const fileStat = await stat(localPath);
        if (!fileStat.isFile() || fileStat.size > maxFileSize || totalBytes + fileStat.size > maxTotal) {
          continue;
        }
        totalBytes += fileStat.size;
        result.push({
          groupId: PROMPT_ATTACHMENT_GROUP,
          absolutePath: localPath,
          path: reservePath(usedPaths, normalizePath(filename)),
          source: PROMPT_ATTACHMENT_GROUP,
        });
      } catch {
        continue;
      }
      continue;
    }

    // 媒体类型跳过
    if (typeof attachment.kind === "string" && ["image", "video", "audio"].includes(attachment.kind)) {
      continue;
    }

    // 文本内容
    if (typeof attachment.textContent === "string" && attachment.textContent.length > 0) {
      const capped =
        attachment.textContent.length <= MAX_INLINE_TEXT_BYTES
          ? attachment.textContent
          : attachment.textContent.slice(0, MAX_INLINE_TEXT_BYTES) +
            "\n...[repo-snapshot-references truncated]";
      result.push({
        groupId: PROMPT_ATTACHMENT_GROUP,
        path: reservePath(usedPaths, normalizePath(filename)),
        content: capped,
        source: PROMPT_ATTACHMENT_GROUP,
      });
      continue;
    }

    // Base64 数据
    if (typeof attachment.dataBase64 === "string" && attachment.dataBase64.length > 0) {
      try {
        const buf = Buffer.from(attachment.dataBase64, "base64");
        const text = buf.toString("utf-8");
        const capped =
          text.length <= MAX_INLINE_TEXT_BYTES
            ? text
            : text.slice(0, MAX_INLINE_TEXT_BYTES) +
              "\n...[repo-snapshot-references truncated]";
        result.push({
          groupId: PROMPT_ATTACHMENT_GROUP,
          path: reservePath(usedPaths, normalizePath(filename)),
          content: Buffer.from(capped, "utf-8"),
          source: PROMPT_ATTACHMENT_GROUP,
        });
      } catch {
        continue;
      }
    }
  }

  return result;
}

function reservePath(used: Set<string>, path: string): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const lastDot = path.lastIndexOf(".");
  const stem = lastDot > 0 ? path.slice(0, lastDot) : path;
  const ext = lastDot > 0 ? path.slice(lastDot) : "";
  let counter = 2;
  while (used.has(`${stem}-${counter}${ext}`)) counter++;
  const result = `${stem}-${counter}${ext}`;
  used.add(result);
  return result;
}
