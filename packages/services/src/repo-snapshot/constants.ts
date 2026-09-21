/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的常量
 * 源文件: out/host/index.js, out/main/chunk-DBVOEQ2Z.js, out/main/chunk-6XM33EZR.js
 */

// ── API 端点 ──
export const ZCODE_API_BASE_URL = "https://zcode.z.ai";
export const UPLOAD_CREDENTIAL_PATH = "/api/v1/snapshot/upload-credential";
export const CLIENT_SCENES_PATH = "/api/v1/client/scenes";

// ── 超时常量 (反编译自 Hlt, Klt, Glt) ──
export const CREDENTIAL_TIMEOUT_MS = 15_000;       // Hlt = 15e3
export const OBJECT_UPLOAD_TIMEOUT_MS = 60_000;     // Klt = 6e4
export const CREDENTIAL_CACHE_TTL_MS = 3_600_000;   // Glt = 3600 * 1e3
export const UPLOAD_EXPIRY_MS = 3_600_000;           // Date.now() + 3600 * 1e3

// ── 加密参数 ──
export const AES_KEY_BYTES = 32;
export const AES_IV_BYTES = 16;
export const AES_ALGORITHM = "aes-256-ctr";
export const RSA_OAEP_HASH = "sha256";
export const KEY_WRAP_ALGORITHM = "rsa-oaep-sha256";

// ── 归档常量 ──
export const ARCHIVE_FILENAME = "repo-snapshot.tar.gz.enc";
export const NONCE_PREFIX_BYTES = 16;  // k_e = 16

// ── 遥测 (OTEL / ARMS) ──
export const OTEL_EXPORTER_OTLP_ENDPOINT =
  "https://proj-xtrace-7e235817c9b9381c22d8b743908d469f-cn-beijing.cn-beijing.log.aliyuncs.com/apm/trace/opentelemetry";
export const OTEL_EXPORTER_OTLP_HEADERS =
  "x-arms-license-key=j2c03hoppk@8309eb6928a66ff," +
  "x-arms-project=proj-xtrace-7e235817c9b9381c22d8b743908d469f-cn-beijing," +
  "x-cms-workspace=default-cms-1936221977589032-cn-beijing";
export const OTEL_SERVICE_NAME = "zcode-cli-agent";
export const ARMS_RUM_ENDPOINT =
  "https://proj-xtrace-7e235817c9b9381c22d8b743908d469f-cn-beijing.cn-beijing.log.aliyuncs.com/rum/web/v2" +
  "?workspace=default-cms-1936221977589032-cn-beijing&service_id=j2c03hoppk@7023210754a92ac5d1971";

// ── CDN / 更新 ──
export const CDN_RELEASE_URLS = ["https://cdn-zcode.z.ai/zcode/electron/releases"];

// ── 附件限制 ──
export const MAX_ATTACHMENT_BYTES: Record<string, number> = {
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  default: 100 * 1024 * 1024,
};
export const MAX_TOTAL_ATTACHMENT_BYTES = 1024 * 1024 * 1024;
export const MAX_INLINE_TEXT_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_FILES = 16;

// ── OAuth / JWT ──
export const OAUTH_ACTIVE_PROVIDER_KEY = "oauth:active_provider";
export const ZCODE_JWT_TOKEN_KEY = "zcodejwttoken";
