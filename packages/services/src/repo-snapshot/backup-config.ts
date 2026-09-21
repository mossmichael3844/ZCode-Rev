/**
 * 用户自助备份配置
 *
 * 将原始 ZCode 静默上传改造为用户可控的静默备份:
 *   - 用户自己提供阿里云 OSS AccessKey / Bucket
 *   - 用户自己持有加密密钥（可解密自己的数据）
 *   - 无需 ZCode 服务器参与，不发送任何数据到 Z.ai
 */

export interface OssBackupConfig {
  /** 阿里云 AccessKey ID */
  accessKeyId: string;
  /** 阿里云 AccessKey Secret */
  accessKeySecret: string;
  /** STS 临时安全令牌 (可选，使用 STS 临时凭证时填写) */
  securityToken?: string;
  /** OSS Bucket 名称 */
  bucket: string;
  /** OSS 区域端点, 例如 "https://oss-cn-hangzhou.aliyuncs.com" */
  endpoint: string;
  /** 对象键前缀, 例如 "backups/my-project/" */
  prefix?: string;
  /** 存储类型 */
  storageClass?: "Standard" | "IA" | "Archive" | "ColdArchive";
}

export interface BackupEncryptionConfig {
  /** 加密模式 */
  mode: "aes-256-ctr" | "none";
  /**
   * 用户自己的加密密码 (仅 mode=aes-256-ctr 时需要)
   * 密码经 PBKDF2 派生为 AES 密钥，用户持有密码即可解密
   */
  passphrase?: string;
  /**
   * 或直接提供 32 字节 hex AES 密钥 (高级用法)
   * 优先于 passphrase
   */
  aesKeyHex?: string;
}

export interface BackupScheduleConfig {
  /** 触发模式 */
  trigger:
    | "on-prompt"       // 每次 prompt 时 (与原始 ZCode 行为一致)
    | "on-save"         // 文件保存时
    | "interval"        // 定时
    | "manual";         // 仅手动触发
  /** 定时间隔 (秒), 仅 trigger=interval 时生效 */
  intervalSeconds?: number;
  /** 最大快照保留数量, 超出后自动清理最旧的 */
  maxSnapshots?: number;
}

export interface BackupFilterConfig {
  /** 排除的目录 (glob 模式), 默认排除 node_modules */
  excludeDirs?: string[];
  /** 排除的文件 (glob 模式) */
  excludeFiles?: string[];
  /**
   * 是否包含 .git/ 目录
   * 原始 ZCode 行为: 总是包含
   * 默认: true (与原始行为一致，完整备份)
   */
  includeGitDir?: boolean;
  /**
   * 是否包含 .git/lfs/ 缓存
   * 仅在 includeGitDir=true 时生效
   * 默认: true
   */
  includeGitLfs?: boolean;
  /** 单文件大小上限 (字节), 超过则跳过, 默认 100MB */
  maxFileSizeBytes?: number;
}

export interface SelfBackupConfig {
  /** 是否启用自助备份 */
  enabled: boolean;
  /** OSS 存储配置 */
  oss: OssBackupConfig;
  /** 加密配置, 默认使用 AES-256-CTR */
  encryption?: BackupEncryptionConfig;
  /** 调度配置, 默认手动触发 */
  schedule?: BackupScheduleConfig;
  /** 文件过滤配置 */
  filter?: BackupFilterConfig;
}

const DEFAULT_EXCLUDE_DIRS = [
  "node_modules",
  ".cache",
  ".next",
  ".turbo",
  ".venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
];

export function resolveFilter(filter?: BackupFilterConfig): Required<BackupFilterConfig> {
  return {
    excludeDirs: filter?.excludeDirs ?? DEFAULT_EXCLUDE_DIRS,
    excludeFiles: filter?.excludeFiles ?? [],
    includeGitDir: filter?.includeGitDir ?? true,
    includeGitLfs: filter?.includeGitLfs ?? true,
    maxFileSizeBytes: filter?.maxFileSizeBytes ?? 100 * 1024 * 1024,
  };
}

export function resolveSchedule(schedule?: BackupScheduleConfig): Required<BackupScheduleConfig> {
  return {
    trigger: schedule?.trigger ?? "manual",
    intervalSeconds: schedule?.intervalSeconds ?? 300,
    maxSnapshots: schedule?.maxSnapshots ?? 50,
  };
}

export function resolveEncryption(encryption?: BackupEncryptionConfig): Required<BackupEncryptionConfig> {
  return {
    mode: encryption?.mode ?? "aes-256-ctr",
    passphrase: encryption?.passphrase ?? "",
    aesKeyHex: encryption?.aesKeyHex ?? "",
  };
}

export function validateBackupConfig(config: SelfBackupConfig): string[] {
  const errors: string[] = [];

  if (!config.oss.accessKeyId?.trim()) errors.push("oss.accessKeyId 不能为空");
  if (!config.oss.accessKeySecret?.trim()) errors.push("oss.accessKeySecret 不能为空");
  if (!config.oss.bucket?.trim()) errors.push("oss.bucket 不能为空");
  if (!config.oss.endpoint?.trim()) errors.push("oss.endpoint 不能为空");

  const enc = resolveEncryption(config.encryption);
  if (enc.mode === "aes-256-ctr") {
    if (!enc.passphrase && !enc.aesKeyHex) {
      errors.push("encryption.mode 为 aes-256-ctr 时必须提供 passphrase 或 aesKeyHex");
    }
    if (enc.aesKeyHex && !/^[0-9a-f]{64}$/i.test(enc.aesKeyHex)) {
      errors.push("encryption.aesKeyHex 必须是 64 位十六进制字符串 (32 字节)");
    }
  }

  const sched = resolveSchedule(config.schedule);
  if (sched.trigger === "interval" && sched.intervalSeconds < 10) {
    errors.push("schedule.intervalSeconds 最小为 10 秒");
  }

  return errors;
}
