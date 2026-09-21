/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的遥测配置
 * 源文件: out/main/chunk-DBVOEQ2Z.js, out/main/chunk-6XM33EZR.js
 *
 * ZCode 使用阿里云 ARMS (Application Real-Time Monitoring Service) 进行:
 *   - OpenTelemetry 链路追踪 (OTLP → 北京区域)
 *   - RUM (Real User Monitoring) 前端监控
 *
 * 所有遥测数据发送至中国北京区域的阿里云服务器
 */

export const TELEMETRY_CONFIG = {
  /**
   * OpenTelemetry OTLP 导出端点
   * 目标: 阿里云 ARMS 链路追踪 (北京区域)
   */
  OTEL_EXPORTER_OTLP_ENDPOINT:
    "https://proj-xtrace-7e235817c9b9381c22d8b743908d469f-cn-beijing.cn-beijing.log.aliyuncs.com/apm/trace/opentelemetry",

  /**
   * OTLP 导出头部
   * 包含 ARMS 许可证密钥、项目 ID 和工作区标识
   */
  OTEL_EXPORTER_OTLP_HEADERS: [
    "x-arms-license-key=j2c03hoppk@8309eb6928a66ff",
    "x-arms-project=proj-xtrace-7e235817c9b9381c22d8b743908d469f-cn-beijing",
    "x-cms-workspace=default-cms-1936221977589032-cn-beijing",
  ].join(","),

  /**
   * 服务名称
   */
  OTEL_SERVICE_NAME: "zcode-cli-agent",

  /**
   * 遥测运行时分发标识
   */
  ZCODE_TELEMETRY_RUNTIME_DISTRIBUTION: "packaged",
} as const;

export const ARMS_RUM_CONFIG = {
  /**
   * ARMS RUM (Real User Monitoring) 端点
   * 用于前端性能监控和用户行为追踪
   */
  endpoint:
    "https://proj-xtrace-7e235817c9b9381c22d8b743908d469f-cn-beijing.cn-beijing.log.aliyuncs.com/rum/web/v2",
  workspace: "default-cms-1936221977589032-cn-beijing",
  serviceId: "j2c03hoppk@7023210754a92ac5d1971",
} as const;

/**
 * 已知的 ZCode 网络端点
 *
 * 反编译自 out/main/chunk-6XM33EZR.js:
 *   ht  → ZCODE_API_ORIGIN
 *   yi  → ZCODE_TEST_ORIGIN
 *   By  → ZAI_API_ORIGIN
 *   Zy  → ZAI_CHAT_ORIGIN
 *   Ny  → BIGMODEL_ORIGIN
 */
export const KNOWN_ENDPOINTS = {
  ZCODE_API_ORIGIN: "https://zcode.z.ai",
  ZCODE_TEST_ORIGIN: "https://zcode.chatglm.site",
  ZCODE_LOCAL_ORIGIN: "http://localhost:3000",
  BIGMODEL_ORIGIN: "https://bigmodel.cn",
  BIGMODEL_DEV_ORIGIN: "https://dev.bigmodel.cn",
  ZAI_CHAT_ORIGIN: "https://chat.z.ai",
  ZAI_TEST_ORIGIN: "https://zai-test.chatglm.site",
  ZAI_API_ORIGIN: "https://api.z.ai",
  ZAI_API_TEST_ORIGIN: "https://api.chatglm.site",
  WEBSOCKET_ORIGIN: "wss://zcode.z.ai/ws",
} as const;

/**
 * OAuth 客户端 ID (硬编码)
 *
 * 反编译自 out/main/chunk-6XM33EZR.js:
 *   Fy → OAUTH_CLIENT_ID_PRODUCTION
 *   qy → OAUTH_CLIENT_ID_TEST
 */
export const OAUTH_CLIENT_IDS = {
  production: "client_P8X5CMWmlaRO9gyO-KSqtg",
  test: "client_RzngVdSk8sYsG2_3HzOMdQ",
} as const;

/**
 * 版本信息
 * 反编译自 out/main/chunk-6XM33EZR.js
 */
export const BUILD_INFO = {
  version: "3.12.3",
  commitId: "d7f8ea37",
  buildDate: "2026-09-16T14:59:46.787Z",
  minimumUpgradeVersion: "3.4.0",
} as const;
