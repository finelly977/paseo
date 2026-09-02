import { getPaseoToolLeafName } from "./tool-name-normalization.js";

export interface PaseoToolDetailField {
  key: string;
  label: string;
  value: string;
}

export type PaseoToolDetailSection =
  | {
      kind: "prose";
      title: string;
      text: string;
    }
  | {
      kind: "fields";
      title: string;
      fields: PaseoToolDetailField[];
    };

interface ToolDetailSpec {
  promptField?: string;
  inputOrder?: readonly string[];
  outputFields?: readonly string[];
}

const WORKSPACE_FIELDS = [
  "title",
  "workspaceId",
  "projectId",
  "isolation",
  "path",
  "mode",
  "worktreeSlug",
  "branchName",
  "baseBranch",
  "branch",
  "prNumber",
  "forge",
] as const;
const AGENT_FIELDS = [
  "title",
  "agentId",
  "provider",
  "workspaceId",
  "cwd",
  "sessionMode",
  "modeId",
  "background",
  "notifyOnFinish",
  "settings",
  "labels",
] as const;
const AUTOMATION_FIELDS = [
  "name",
  "id",
  "cron",
  "timezone",
  "provider",
  "cwd",
  "isolation",
  "maxRuns",
  "expiresIn",
  "clearExpires",
] as const;
const BROWSER_FIELDS = [
  "browserId",
  "url",
  "ref",
  "sourceRef",
  "targetRef",
  "value",
  "text",
  "key",
  "button",
  "doubleClick",
  "modifiers",
  "filePaths",
  "fullPage",
  "maxEntries",
  "timeoutMs",
  "deltaX",
  "deltaY",
  "width",
  "height",
  "function",
] as const;

const TOOL_SPECS: Readonly<Record<string, ToolDetailSpec>> = {
  create_workspace: {
    inputOrder: WORKSPACE_FIELDS,
    outputFields: ["workspaceId", "projectId"],
  },
  list_workspaces: {},
  archive_workspace: {
    inputOrder: ["workspaceId"],
    outputFields: ["workspaceId", "archivedAgentIds", "removedDirectory"],
  },
  rename_workspace: { inputOrder: ["title", "workspaceId"] },
  create_agent: {
    promptField: "initialPrompt",
    inputOrder: AGENT_FIELDS,
    outputFields: ["agentId", "status", "currentModeId", "cwd"],
  },
  send_agent_prompt: {
    promptField: "prompt",
    inputOrder: AGENT_FIELDS,
    outputFields: ["status", "lastMessage", "permission"],
  },
  get_agent_status: { inputOrder: ["agentId"] },
  list_agents: { inputOrder: ["cwd", "statuses", "sinceHours", "limit", "includeArchived"] },
  cancel_agent: { inputOrder: ["agentId"] },
  archive_agent: { inputOrder: ["agentId"] },
  kill_agent: { inputOrder: ["agentId"] },
  update_agent: { inputOrder: AGENT_FIELDS },
  get_agent_activity: { inputOrder: ["agentId", "limit"] },
  set_agent_mode: { inputOrder: ["agentId", "modeId"] },
  list_workspace_scripts: { inputOrder: ["workspaceId"] },
  start_workspace_script: { inputOrder: ["workspaceId", "scriptName"] },
  stop_workspace_script: { inputOrder: ["workspaceId", "scriptName"] },
  list_terminals: { inputOrder: ["cwd", "all"] },
  create_terminal: { inputOrder: ["cwd", "workspaceId", "name", "command"] },
  kill_terminal: { inputOrder: ["terminalId"] },
  capture_terminal: { inputOrder: ["terminalId", "lines"] },
  send_terminal_keys: { inputOrder: ["terminalId", "keys", "literal"] },
  create_schedule: {
    promptField: "prompt",
    inputOrder: AUTOMATION_FIELDS,
    outputFields: ["id", "status", "nextRunAt", "expiresAt"],
  },
  create_heartbeat: {
    promptField: "prompt",
    inputOrder: AUTOMATION_FIELDS,
    outputFields: ["id", "status", "nextRunAt", "expiresAt"],
  },
  delete_heartbeat: { inputOrder: ["id"] },
  list_schedules: {},
  inspect_schedule: { inputOrder: ["id"] },
  pause_schedule: { inputOrder: ["id"] },
  resume_schedule: { inputOrder: ["id"] },
  delete_schedule: { inputOrder: ["id"] },
  update_schedule: { promptField: "prompt", inputOrder: AUTOMATION_FIELDS },
  schedule_logs: { inputOrder: ["id"] },
  run_schedule_once: { inputOrder: ["id"] },
  list_providers: {},
  list_models: { inputOrder: ["provider"] },
  list_profiles: {},
  inspect_provider: { inputOrder: ["provider", "cwd", "settings"] },
  list_pending_permissions: {},
  respond_to_permission: { inputOrder: ["agentId", "requestId", "response"] },
  browser_list_tabs: {},
  browser_new_tab: { inputOrder: BROWSER_FIELDS },
  browser_snapshot: { inputOrder: BROWSER_FIELDS },
  browser_click: { inputOrder: BROWSER_FIELDS },
  browser_fill: { inputOrder: BROWSER_FIELDS },
  browser_wait: { inputOrder: BROWSER_FIELDS },
  browser_type: { inputOrder: BROWSER_FIELDS },
  browser_keypress: { inputOrder: BROWSER_FIELDS },
  browser_navigate: { inputOrder: BROWSER_FIELDS },
  browser_back: { inputOrder: BROWSER_FIELDS },
  browser_forward: { inputOrder: BROWSER_FIELDS },
  browser_reload: { inputOrder: BROWSER_FIELDS },
  browser_screenshot: { inputOrder: BROWSER_FIELDS },
  browser_upload: { inputOrder: BROWSER_FIELDS },
  browser_hover: { inputOrder: BROWSER_FIELDS },
  browser_select: { inputOrder: BROWSER_FIELDS },
  browser_drag: { inputOrder: BROWSER_FIELDS },
  browser_logs: { inputOrder: BROWSER_FIELDS },
  browser_evaluate: { inputOrder: BROWSER_FIELDS },
  browser_scroll: { inputOrder: BROWSER_FIELDS },
  browser_resize: { inputOrder: BROWSER_FIELDS },
  browser_close_tab: { inputOrder: BROWSER_FIELDS },
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  agentId: "智能体",
  archivedAgentIds: "已归档智能体",
  background: "后台运行",
  baseBranch: "基础分支",
  branch: "分支",
  branchName: "新分支",
  browserId: "浏览器标签",
  button: "鼠标按键",
  clearExpires: "清除到期时间",
  command: "命令",
  cron: "计划表达式",
  currentModeId: "当前模式",
  cwd: "工作目录",
  deltaX: "横向滚动量",
  deltaY: "纵向滚动量",
  doubleClick: "双击",
  enabled: "启用",
  expiresIn: "到期时长",
  expiresAt: "到期时间",
  forge: "代码托管平台",
  filePaths: "文件",
  fullPage: "整页",
  function: "函数",
  initialPrompt: "提示词",
  id: "标识",
  isolation: "隔离方式",
  key: "按键",
  lastMessage: "最后消息",
  labels: "标签",
  literal: "原样输入",
  maxEntries: "最大条数",
  maxRuns: "最大运行次数",
  modeId: "模式",
  mode: "模式",
  modifiers: "修饰键",
  name: "名称",
  newMode: "新模式",
  nextRunAt: "下次运行",
  notifyOnFinish: "完成时通知",
  prNumber: "变更请求",
  projectId: "项目",
  provider: "智能体提供方",
  ref: "页面元素",
  removedDirectory: "已移除目录",
  requestId: "权限申请",
  response: "处理结果",
  scriptName: "脚本",
  sessionMode: "会话模式",
  settings: "设置",
  sinceHours: "最近小时数",
  sourceRef: "来源",
  status: "状态",
  success: "成功",
  targetRef: "目标",
  terminalId: "终端",
  text: "文字",
  thinkingOptionId: "思考强度",
  timezone: "时区",
  title: "标题",
  timeoutMs: "超时（毫秒）",
  updateCount: "更新数",
  url: "网址",
  value: "值",
  workspaceId: "工作区",
  worktreeSlug: "工作树",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function humanizeKey(key: string): string {
  const known = FIELD_LABELS[key];
  if (known) return known;
  return key;
}

function formatValue(value: unknown, depth = 0): string {
  if (value === null) return "无";
  if (value === undefined) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "无";
    return value.map((item) => `• ${indentMultiline(formatValue(item, depth + 1), 2)}`).join("\n");
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, child]) => child !== undefined);
    if (entries.length === 0) return "无";
    return entries
      .map(([key, child]) => {
        const formatted = formatValue(child, depth + 1);
        return `${humanizeKey(key)}: ${indentMultiline(formatted, 2)}`;
      })
      .join("\n");
  }
  return String(value);
}

function indentMultiline(value: string, spaces: number): string {
  const indentation = " ".repeat(spaces);
  return value.replace(/\n/g, `\n${indentation}`);
}

function orderedEntries(
  value: Record<string, unknown>,
  order: readonly string[] = [],
  omittedKey?: string,
  includedKeys?: readonly string[],
): Array<[string, unknown]> {
  const included = includedKeys ? new Set(includedKeys) : null;
  const keys = Object.keys(value).filter(
    (key) => key !== omittedKey && value[key] !== undefined && (!included || included.has(key)),
  );
  const rank = new Map(order.map((key, index) => [key, index]));
  keys.sort((left, right) => {
    const leftRank = rank.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rank.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.localeCompare(right);
  });
  return keys.map((key) => [key, value[key]]);
}

function fieldsFromValue(
  value: unknown,
  order?: readonly string[],
  omittedKey?: string,
  includedKeys?: readonly string[],
): PaseoToolDetailField[] {
  if (value === null || value === undefined) return [];
  if (!isRecord(value)) {
    const formatted = formatValue(value);
    return formatted ? [{ key: "value", label: "值", value: formatted }] : [];
  }
  return orderedEntries(value, order, omittedKey, includedKeys).map(([key, child]) => ({
    key,
    label: humanizeKey(key),
    value: formatValue(child),
  }));
}

function parseJsonText(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function unwrapMcpResult(output: unknown): unknown {
  if (!isRecord(output)) return output;

  if (output.structuredContent !== undefined) {
    return output.structuredContent;
  }

  if (Array.isArray(output.content) && output.content.length === 1) {
    const item = output.content[0];
    if (isRecord(item) && item.type === "text") {
      return parseJsonText(item.text) ?? item.text;
    }
  }

  return output;
}

export function buildPaseoToolDetailSections(
  toolName: string,
  input: unknown,
  output: unknown,
): PaseoToolDetailSection[] | null {
  const leafName = getPaseoToolLeafName(toolName);
  if (!leafName) return null;

  const spec = TOOL_SPECS[leafName] ?? {};
  const sections: PaseoToolDetailSection[] = [];
  if (spec.promptField && isRecord(input)) {
    const prompt = input[spec.promptField];
    if (typeof prompt === "string" && prompt.length > 0) {
      sections.push({ kind: "prose", title: "提示词", text: prompt });
    }
  }

  const inputFields = fieldsFromValue(input, spec.inputOrder, spec.promptField);
  if (inputFields.length > 0) {
    sections.push({ kind: "fields", title: "详情", fields: inputFields });
  }

  const outputFields = fieldsFromValue(
    unwrapMcpResult(output),
    spec.outputFields,
    undefined,
    spec.outputFields,
  );
  if (outputFields.length > 0) {
    sections.push({ kind: "fields", title: "结果", fields: outputFields });
  }
  return sections;
}
