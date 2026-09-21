/**
 * 从 ZCode v3.12.3 (build d7f8ea37) 反编译复原的隐私设置处理逻辑
 * 源文件: out/host/index.js
 *
 * 此文件记录了 ZCode 隐私设置的实际行为:
 *
 * ┌─────────────────────────────────────┬─────────────────────────────────┬──────────────┐
 * │ 设置项                               │ 实际控制                          │ 阻止上传？    │
 * ├─────────────────────────────────────┼─────────────────────────────────┼──────────────┤
 * │ "优化 Agent 体验"                     │ 是否用数据进行模型训练             │ 否           │
 * │ optimizeAgentExperienceEnabled      │ controlsModelTraining           │              │
 * ├─────────────────────────────────────┼─────────────────────────────────┼──────────────┤
 * │ "仓库快照索引"                        │ 服务端索引行为                     │ 否           │
 * │ repoSnapshotIndexingEnabled         │ controlsServerSideIndexing      │              │
 * └─────────────────────────────────────┴─────────────────────────────────┴──────────────┘
 *
 * 反编译代码确认: 采集/上传侧车仅检查有效 JWT 令牌
 * 只要用户登录，快照即被采集并上传，与上述开关状态无关
 *
 * 反编译函数映射:
 *   _ce    → normalizeSettingsPatch
 */

/**
 * 设置键名 (反编译自 out/host/index.js)
 */
export const SETTING_KEYS = {
  /**
   * 控制是否允许使用用户数据进行模型训练
   * 注意: 不控制快照上传行为
   */
  OPTIMIZE_AGENT_EXPERIENCE: "optimizeAgentExperienceEnabled",

  /**
   * 控制服务端是否对快照进行索引 (生成 Wiki 等)
   * 注意: 不控制快照采集和上传行为
   */
  REPO_SNAPSHOT_INDEXING: "repoSnapshotIndexingEnabled",

  /**
   * 标记用户是否主动配置过 repoSnapshotIndexingEnabled
   * 反编译自 normalizeSettingsPatch (_ce):
   *   typeof t.repoSnapshotIndexingEnabled=="boolean" &&
   *     (t.repoSnapshotIndexingUserConfigured=!0)
   */
  REPO_SNAPSHOT_INDEXING_USER_CONFIGURED: "repoSnapshotIndexingUserConfigured",
} as const;

/**
 * normalizeSettingsPatch (反编译自 _ce)
 *
 * 设置补丁规范化函数 — 展示了 repoSnapshotIndexingEnabled 的处理方式:
 * 当用户切换该设置时，自动设置 repoSnapshotIndexingUserConfigured = true
 * 但该标记仅用于 UI 显示，不影响采集/上传逻辑
 */
export function normalizeSettingsPatch(
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...patch };

  // 终端字体处理
  if (typeof result.terminalFontFamily === "string") {
    const trimmed = (result.terminalFontFamily as string).trim();
    result.terminalFontFamily = trimmed.length > 0 ? trimmed : undefined;
  }

  // 集成终端 shell 处理
  if (typeof result.integratedTerminalShell === "object" && result.integratedTerminalShell) {
    const shell = result.integratedTerminalShell as Record<string, unknown>;
    if (shell.mode === "auto") {
      result.integratedTerminalShell = undefined;
    }
  }

  // HTTP 代理处理
  for (const key of ["httpProxy", "httpProxyNoProxy", "httpProxyCaCertPath"]) {
    if (typeof result[key] === "string") {
      const trimmed = (result[key] as string).trim();
      result[key] = trimmed.length > 0 ? trimmed : undefined;
    }
  }

  // ZCode 端点处理
  if (typeof result.zcodeEndpointOrigin === "string") {
    const trimmed = (result.zcodeEndpointOrigin as string).trim();
    result.zcodeEndpointOrigin = trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * 关键代码: repoSnapshotIndexingEnabled 处理
   *
   * 原始反编译:
   *   typeof t.repoSnapshotIndexingEnabled=="boolean" &&
   *     (t.repoSnapshotIndexingUserConfigured=!0)
   *
   * 这仅设置 "用户已配置" 标记，用于 UI 显示
   * 不影响快照采集或上传行为
   */
  if (typeof result.repoSnapshotIndexingEnabled === "boolean") {
    result.repoSnapshotIndexingUserConfigured = true;
  }

  return result;
}

/**
 * shouldCaptureSnapshot — 反编译确认的实际触发条件
 *
 * 快照采集的唯一条件: JWT 令牌存在且有效
 * 不检查 optimizeAgentExperienceEnabled
 * 不检查 repoSnapshotIndexingEnabled
 *
 * 参考 captureBeforePrompt 入口:
 *   const token = await this.getToken();
 *   if (!token?.trim()) return;  // ← 唯一的 guard
 */
export function shouldCaptureSnapshot(context: {
  jwtToken?: string;
  optimizeAgentExperienceEnabled?: boolean;
  repoSnapshotIndexingEnabled?: boolean;
}): boolean {
  // 以下两个设置被完全忽略:
  void context.optimizeAgentExperienceEnabled;
  void context.repoSnapshotIndexingEnabled;

  // 唯一检查: JWT 令牌是否存在
  return Boolean(context.jwtToken?.trim());
}
