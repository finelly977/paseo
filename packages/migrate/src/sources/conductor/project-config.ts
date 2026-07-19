import { existsSync, readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";
import type { PaseoConfigRaw, PaseoScriptEntryRaw } from "@getpaseo/protocol/messages";
import { normalizeServiceEnvName } from "@getpaseo/protocol/service-env-name";
import { parse as parseToml } from "smol-toml";
import type { MigrationNotice } from "../../types.js";

export class InvalidConductorProjectConfigError extends Error {
  constructor(readonly relativePath: string) {
    super(`Invalid Conductor project config: ${relativePath}`);
  }
}

interface SourceFile {
  relativePath: string;
  bytes: string;
}

export interface ConductorSettings {
  scripts?: unknown;
  file_include_globs?: unknown;
  environment_variables?: unknown;
  environment_variables_forward?: unknown;
  runScriptMode?: unknown;
  enterprise_data_privacy?: unknown;
  enterpriseDataPrivacy?: unknown;
  prompts?: unknown;
  git?: unknown;
  spotlight_testing?: unknown;
  [key: string]: unknown;
}

interface ConductorRunScript {
  command: string;
  args?: string[];
  default?: boolean;
  hide?: boolean;
  icon?: string;
  cwd?: string;
  availableIn?: string | string[];
}

type RewriteContext = "lifecycle" | "run";

export function inspectConductorProjectConfig(
  repoRoot: string,
  databaseSettings: ConductorSettings = {},
  platform: NodeJS.Platform = process.platform,
): { config: PaseoConfigRaw | null; notices: MigrationNotice[] } {
  const settings = mergeSettings(
    databaseSettings,
    loadConductorSettings(discoverSources(repoRoot)),
  );
  const config: PaseoConfigRaw = {};
  const notices: MigrationNotice[] = [];
  const scripts = isRecord(settings.scripts) ? settings.scripts : null;

  if (settings.scripts !== undefined && !scripts) {
    notices.push(malformedSetting("scripts", "Expected a scripts table."));
  }

  mapLifecycle(scripts?.setup, "worktree.setup", "setup", config, notices, platform);
  mapLifecycle(scripts?.archive, "worktree.teardown", "teardown", config, notices, platform);
  mapRunScripts(scripts?.run, config, notices, platform);
  mapMetadataPrompts(settings.prompts, config, notices);
  reportUnsupported(repoRoot, settings, notices);

  return { config: Object.keys(config).length > 0 ? config : null, notices };
}

function discoverSources(repoRoot: string): SourceFile[] {
  const sharedToml = join(repoRoot, ".conductor", "settings.toml");
  const candidates = [
    ...(!existsSync(sharedToml) ? [join(repoRoot, "conductor.json")] : []),
    join(repoRoot, ".conductor", "settings.json"),
    sharedToml,
    join(repoRoot, ".conductor", "settings.local.json"),
    join(repoRoot, ".conductor", "settings.local.toml"),
  ];
  return candidates.filter(existsSync).map((sourcePath) => {
    const relativePath = relative(repoRoot, sourcePath).replaceAll("\\", "/");
    try {
      return { relativePath, bytes: readFileSync(sourcePath, "utf8") };
    } catch {
      throw new InvalidConductorProjectConfigError(relativePath);
    }
  });
}

function loadConductorSettings(sourceFiles: SourceFile[]): ConductorSettings {
  let merged: ConductorSettings = {};
  for (const file of sourceFiles) {
    let parsed: unknown;
    try {
      parsed = file.relativePath.endsWith(".json") ? JSON.parse(file.bytes) : parseToml(file.bytes);
    } catch {
      throw new InvalidConductorProjectConfigError(file.relativePath);
    }
    if (!isRecord(parsed)) throw new InvalidConductorProjectConfigError(file.relativePath);
    merged = mergeSettings(merged, parsed as ConductorSettings);
  }
  return merged;
}

function mergeSettings(base: ConductorSettings, override: ConductorSettings): ConductorSettings {
  return {
    ...base,
    ...override,
    scripts: mergeScripts(base.scripts, override.scripts),
    environment_variables: mergeNested(base.environment_variables, override.environment_variables),
    environment_variables_forward: mergeNested(
      base.environment_variables_forward,
      override.environment_variables_forward,
    ),
    prompts: mergeNested(base.prompts, override.prompts),
  };
}

function mergeScripts(base: unknown, override: unknown): unknown {
  if (override !== undefined && !isRecord(override)) return override;
  if (override === undefined && !isRecord(base)) return base;
  const baseScripts = isRecord(base) ? base : {};
  const overrideScripts = isRecord(override) ? override : {};
  return {
    ...baseScripts,
    ...overrideScripts,
    run: mergeRunScripts(baseScripts.run, overrideScripts.run),
  };
}

function mergeNested(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) return override ?? base;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) merged[key] = mergeNested(base[key], value);
  return merged;
}

function mergeRunScripts(base: unknown, override: unknown): unknown {
  if (typeof override === "string") return override;
  if (!isRecord(base) || !isRecord(override)) return override ?? base;
  const merged: Record<string, unknown> = { ...base };
  for (const [scriptId, entry] of Object.entries(override)) {
    const previous = base[scriptId];
    merged[scriptId] =
      isRecord(previous) && isRecord(entry)
        ? {
            ...previous,
            ...entry,
            ...(isRecord(previous.options) && isRecord(entry.options)
              ? { options: { ...previous.options, ...entry.options } }
              : {}),
          }
        : entry;
  }
  return merged;
}

function mapLifecycle(
  value: unknown,
  key: string,
  target: "setup" | "teardown",
  config: PaseoConfigRaw,
  notices: MigrationNotice[],
  platform: NodeJS.Platform,
): void {
  if (value === undefined) return;
  if (typeof value !== "string" || value.trim().length === 0) {
    notices.push(malformedSetting(key, "Expected a non-empty command string."));
    return;
  }
  const command = rewriteExactCommand(value, "lifecycle", key, notices, platform);
  if (!command) return;
  config.worktree = { ...config.worktree, [target]: command };
}

function mapRunScripts(
  runConfig: unknown,
  config: PaseoConfigRaw,
  notices: MigrationNotice[],
  platform: NodeJS.Platform,
): void {
  if (runConfig === undefined) return;
  const services = new Map<string, string>();
  if (typeof runConfig === "string") {
    mapRunScript("run", { command: runConfig }, config, notices, services, platform);
    return;
  }
  if (!isRecord(runConfig)) {
    notices.push(malformedSetting("scripts.run", "Expected a command string or script table."));
    return;
  }
  for (const scriptId of Object.keys(runConfig).sort()) {
    const value = runConfig[scriptId];
    if (!isRecord(value)) {
      notices.push(malformedSetting(`scripts.${scriptId}`, "Expected a script table."));
      continue;
    }
    const script = normalizeRunScript(scriptId, value, notices);
    if (script) mapRunScript(scriptId, script, config, notices, services, platform);
  }
}

function normalizeRunScript(
  scriptId: string,
  value: Record<string, unknown>,
  notices: MigrationNotice[],
): ConductorRunScript | null {
  const key = `scripts.${scriptId}`;
  reportUnknownKeys(
    value,
    new Set(["command", "args", "default", "hide", "icon", "options", "available_in"]),
    key,
    notices,
  );
  if (typeof value.command !== "string" || value.command.trim().length === 0) {
    notices.push(malformedSetting(key, "Expected a non-empty command string."));
    return null;
  }
  let args: string[] | undefined;
  if (value.args !== undefined) {
    if (!Array.isArray(value.args) || value.args.some((argument) => typeof argument !== "string")) {
      notices.push(malformedSetting(`${key}.args`, "Expected only string arguments."));
      return null;
    }
    args = value.args as string[];
  }
  const options = normalizeRunOptions(value.options, key, notices);
  if (!options.valid) return null;
  for (const [field, expected] of [
    ["default", "boolean"],
    ["hide", "boolean"],
    ["icon", "string"],
  ] as const) {
    if (value[field] !== undefined && typeof value[field] !== expected) {
      notices.push(malformedSetting(`${key}.${field}`, `Expected a ${expected}.`));
      return null;
    }
  }
  const availableIn = normalizeAvailableIn(value.available_in);
  if (value.available_in !== undefined && !availableIn) {
    notices.push(
      malformedSetting(`${key}.available_in`, "Expected a string or an array of strings."),
    );
    return null;
  }
  return {
    command: value.command,
    ...(args ? { args } : {}),
    ...(typeof value.default === "boolean" ? { default: value.default } : {}),
    ...(typeof value.hide === "boolean" ? { hide: value.hide } : {}),
    ...(typeof value.icon === "string" ? { icon: value.icon } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(availableIn ? { availableIn } : {}),
  };
}

function normalizeRunOptions(
  value: unknown,
  key: string,
  notices: MigrationNotice[],
): { valid: boolean; cwd?: string } {
  if (value === undefined) return { valid: true };
  if (!isRecord(value)) {
    notices.push(malformedSetting(`${key}.options`, "Expected an options table."));
    return { valid: false };
  }
  reportUnknownKeys(value, new Set(["cwd"]), `${key}.options`, notices);
  if (value.cwd !== undefined && typeof value.cwd !== "string") {
    notices.push(malformedSetting(`${key}.options.cwd`, "Expected a relative path string."));
    return { valid: false };
  }
  return { valid: true, ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}) };
}

function mapRunScript(
  scriptId: string,
  script: ConductorRunScript,
  config: PaseoConfigRaw,
  notices: MigrationNotice[],
  serviceNames: Map<string, string>,
  platform: NodeJS.Platform,
): void {
  const key = `scripts.${scriptId}`;
  if (script.hide) {
    notices.push(unsupportedSetting(key, "Hidden scripts are not imported."));
    return;
  }
  if (isCloudOnly(script.availableIn)) {
    notices.push(unsupportedSetting(key, "Cloud-only scripts are not imported."));
    return;
  }
  if (script.default !== undefined) {
    notices.push(unsupportedSetting(`${key}.default`, "Default script selection is not imported."));
  }
  if (script.icon !== undefined) {
    notices.push(unsupportedSetting(`${key}.icon`, "Script icons are not imported."));
  }
  if (platform === "win32" && script.args && script.args.length > 0) {
    notices.push(
      unsupportedSetting(`${key}.args`, "Script arguments are not imported on Windows."),
    );
    return;
  }

  let command = appendArgs(script.command, script.args ?? []);
  if (script.cwd) {
    if (platform === "win32") {
      notices.push(
        unsupportedSetting(`${key}.cwd`, "Working-directory scripts are not imported on Windows."),
      );
      return;
    }
    const cwdPrefix = safeCwdPrefix(script.cwd);
    if (!cwdPrefix) {
      notices.push(
        unsupportedSetting(`${key}.cwd`, "Absolute or escaping cwd values are not imported."),
      );
      return;
    }
    command = `${cwdPrefix}${command}`;
  }
  if (containsArithmeticVariableOperation(command, "CONDUCTOR_PORT")) {
    notices.push(
      unsupportedSetting(
        `${key}.port_arithmetic`,
        "Conductor port arithmetic is not imported because Paseo reserves one service port.",
      ),
    );
    return;
  }

  const service = containsShellVariable(command, "CONDUCTOR_PORT");
  if (service) {
    const environmentName = normalizeServiceEnvName(scriptId);
    const collision = serviceNames.get(environmentName);
    if (collision) {
      notices.push(
        unsupportedSetting(
          key,
          `Service environment name collides with "${collision}" (${environmentName}).`,
          "conductor-setting-collision",
        ),
      );
      return;
    }
  }

  const rewritten = rewriteExactCommand(
    command,
    service ? "run" : "lifecycle",
    key,
    notices,
    platform,
  );
  if (!rewritten) return;
  if (service) {
    const environmentName = normalizeServiceEnvName(scriptId);
    serviceNames.set(environmentName, scriptId);
  }
  const entry: PaseoScriptEntryRaw = { command: rewritten };
  if (service) entry.type = "service";
  config.scripts = { ...config.scripts, [scriptId]: entry };
}

function rewriteExactCommand(
  command: string,
  context: RewriteContext,
  key: string,
  notices: MigrationNotice[],
  platform: NodeJS.Platform,
): string | null {
  if (containsActiveHereDocument(command)) {
    notices.push(unsupportedSetting(key, "Here-document commands are not imported."));
    return null;
  }
  const sourceVariables = collectConductorVariables(command);
  if (platform === "win32" && sourceVariables.length > 0) {
    notices.push(
      unsupportedSetting(
        key,
        `Conductor variables use unsupported shell syntax on Windows: ${sourceVariables.join(", ")}. Command was not imported.`,
      ),
    );
    return null;
  }
  let rewritten = command;
  for (const [from, to] of [
    ["CONDUCTOR_WORKSPACE_PATH", "PASEO_WORKTREE_PATH"],
    ["CONDUCTOR_ROOT_PATH", "PASEO_SOURCE_CHECKOUT_PATH"],
    ["CONDUCTOR_PORT", context === "run" ? "PASEO_PORT" : "PASEO_WORKTREE_PORT"],
  ] as const) {
    rewritten = replaceShellVariable(rewritten, from, to);
  }
  const unsupported = collectConductorVariables(rewritten);
  if (unsupported.length > 0) {
    notices.push(
      unsupportedSetting(
        key,
        `Unsupported Conductor variables: ${unsupported.join(", ")}. Command was not imported.`,
      ),
    );
    return null;
  }
  return rewritten;
}

function reportUnsupported(
  repoRoot: string,
  settings: ConductorSettings,
  notices: MigrationNotice[],
): void {
  const scripts = isRecord(settings.scripts) ? settings.scripts : {};
  const unsupportedValues: Array<[string, unknown, string]> = [
    ["scripts.run_mode", scripts.run_mode, "Paseo has no project-wide run mode."],
    ["runScriptMode", settings.runScriptMode, "Paseo has no project-wide run mode."],
    [
      "scripts.auto_run_after_setup",
      scripts.auto_run_after_setup,
      "Paseo does not auto-run scripts after setup.",
    ],
    [
      "file_include_globs",
      settings.file_include_globs,
      "File include globs are not converted to shell copy commands.",
    ],
    [
      "spotlight_testing",
      settings.spotlight_testing,
      "Paseo spotlight is a separate workflow, not project config.",
    ],
    ["git", settings.git, "Conductor Git settings are not imported."],
    [
      "enterprise_data_privacy",
      settings.enterprise_data_privacy,
      "Conductor enterprise data privacy settings are not imported.",
    ],
    [
      "enterpriseDataPrivacy",
      settings.enterpriseDataPrivacy,
      "Conductor enterprise data privacy settings are not imported.",
    ],
  ];
  for (const [key, value, detail] of unsupportedValues) {
    if (value !== undefined) notices.push(unsupportedSetting(key, detail));
  }
  if (existsSync(join(repoRoot, ".worktreeinclude"))) {
    notices.push(
      unsupportedSetting(
        ".worktreeinclude",
        "Worktree include patterns are not converted to shell copy commands.",
      ),
    );
  }
  const environmentNames = collectEnvironmentVariableNames(settings);
  if (environmentNames.length > 0) {
    notices.push(
      unsupportedSetting(
        "environment_variables",
        `Environment variable values are not imported. Found: ${environmentNames.join(", ")}.`,
      ),
    );
  }
  reportUnsupportedPrompts(settings.prompts, notices);
  for (const key of [
    "claude_code_executable_path",
    "codex_executable_path",
    "claude_provider",
    "codex_provider",
    "bedrock_region",
    "vertex_project_id",
    "ssh_key_path",
  ]) {
    if (settings[key] !== undefined) {
      notices.push(
        unsupportedSetting(key, "Conductor harness and provider settings are not imported."),
      );
    }
  }
  reportUnknownKeys(
    settings,
    new Set([
      "scripts",
      "file_include_globs",
      "environment_variables",
      "environment_variables_forward",
      "runScriptMode",
      "enterprise_data_privacy",
      "enterpriseDataPrivacy",
      "prompts",
      "git",
      "spotlight_testing",
      "claude_code_executable_path",
      "codex_executable_path",
      "claude_provider",
      "codex_provider",
      "bedrock_region",
      "vertex_project_id",
      "ssh_key_path",
    ]),
    "settings",
    notices,
  );
  if (isRecord(settings.scripts)) {
    reportUnknownKeys(
      settings.scripts,
      new Set(["setup", "archive", "run", "run_mode", "auto_run_after_setup"]),
      "scripts",
      notices,
    );
  }
}

function mapMetadataPrompts(
  value: unknown,
  config: PaseoConfigRaw,
  notices: MigrationNotice[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    notices.push(malformedSetting("prompts", "Expected a prompt table."));
    return;
  }
  const mappings = {
    title: "title",
    branch_name: "branchName",
    commit_message: "commitMessage",
    pull_request: "pullRequest",
  } as const;
  for (const [sourceKey, targetKey] of Object.entries(mappings)) {
    const instructions = value[sourceKey];
    if (instructions === undefined) continue;
    if (typeof instructions !== "string" || instructions.trim().length === 0) {
      notices.push(malformedSetting(`prompts.${sourceKey}`, "Expected non-empty instructions."));
      continue;
    }
    config.metadataGeneration = {
      ...config.metadataGeneration,
      [targetKey]: { instructions },
    };
  }
}

function reportUnsupportedPrompts(value: unknown, notices: MigrationNotice[]): void {
  if (!isRecord(value)) return;
  const supported = new Set(["title", "branch_name", "commit_message", "pull_request"]);
  const unknown = Object.keys(value).filter((key) => !supported.has(key));
  if (unknown.length > 0) {
    notices.push(
      unsupportedSetting("prompts", `Unsupported prompt keys: ${unknown.sort().join(", ")}.`),
    );
  }
}

function reportUnknownKeys(
  value: Record<string, unknown>,
  known: Set<string>,
  prefix: string,
  notices: MigrationNotice[],
): void {
  for (const key of Object.keys(value)
    .filter((candidate) => !known.has(candidate))
    .sort()) {
    notices.push(unsupportedSetting(`${prefix}.${key}`, "Unknown Conductor setting."));
  }
}

function collectEnvironmentVariableNames(settings: ConductorSettings): string[] {
  const names = new Set<string>();
  for (const key of ["environment_variables", "environment_variables_forward"] as const) {
    collectNames(settings[key], names);
  }
  return [...names].sort();
}

function collectNames(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const name of value) if (typeof name === "string") names.add(name);
    return;
  }
  if (!isRecord(value)) return;
  for (const [name, nested] of Object.entries(value)) {
    if (isRecord(nested)) collectNames(nested, names);
    else names.add(name);
  }
}

function unsupportedSetting(
  key: string,
  detail: string,
  code = "conductor-setting-unsupported",
): MigrationNotice {
  return { code, level: "warning", message: `${key}: ${detail}` };
}

function malformedSetting(key: string, detail: string): MigrationNotice {
  return { code: "conductor-setting-malformed", level: "warning", message: `${key}: ${detail}` };
}

function replaceShellVariable(command: string, from: string, to: string): string {
  const mask = activeShellMask(command);
  const pattern = new RegExp(`\\$\\{${from}(?=[}:#%+\\-=?])|\\$${from}(?![A-Za-z0-9_])`, "g");
  return replaceArithmeticVariable(
    command.replace(pattern, (match, offset: number) => {
      if (mask[offset] !== "$") return match;
      return match.startsWith("${") ? `\${${to}` : `$${to}`;
    }),
    from,
    to,
  );
}

function collectConductorVariables(command: string): string[] {
  const names = new Set<string>();
  const mask = activeShellMask(command);
  const direct =
    /\$\{[#!]?(CONDUCTOR_[A-Za-z0-9_]+)(?=[^A-Za-z0-9_])|\$(CONDUCTOR_[A-Za-z0-9_]+)(?![A-Za-z0-9_])/g;
  for (const match of command.matchAll(direct)) {
    if (mask[match.index] !== "$") continue;
    const name = match[1] ?? match[2];
    if (name) names.add(name);
  }
  forEachActiveArithmetic(command, (body) => {
    for (const match of body.matchAll(/(?:^|[^A-Za-z0-9_])(CONDUCTOR_[A-Za-z0-9_]+)/g)) {
      if (match[1]) names.add(match[1]);
    }
  });
  return [...names].sort();
}

function activeShellMask(command: string): string {
  const mask = [...command];
  let quote: "single" | "double" | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (quote === "single") {
      mask[index] = " ";
      if (character === "'") quote = null;
      continue;
    }
    if (character === "\\") {
      mask[index] = " ";
      if (index + 1 < mask.length) mask[index + 1] = " ";
      index += 1;
      continue;
    }
    if (
      quote === null &&
      character === "#" &&
      (index === 0 || /[\s;|&()<>]/.test(command[index - 1]))
    ) {
      while (index < command.length && command[index] !== "\n") {
        mask[index] = " ";
        index += 1;
      }
      index -= 1;
      continue;
    }
    if (quote === "double") {
      if (character === '"') {
        mask[index] = " ";
        quote = null;
      }
      continue;
    }
    if (character === "'") {
      mask[index] = " ";
      quote = "single";
    } else if (character === '"') {
      mask[index] = " ";
      quote = "double";
    }
  }
  return mask.join("");
}

function containsShellVariable(command: string, name: string): boolean {
  const mask = activeShellMask(command);
  const pattern = new RegExp(`\\$\\{${name}(?=[}:#%+\\-=?])|\\$${name}(?![A-Za-z0-9_])`, "g");
  for (const match of command.matchAll(pattern)) {
    if (mask[match.index] === "$") return true;
  }
  return containsArithmeticVariable(command, name);
}

function replaceArithmeticVariable(command: string, from: string, to: string): string {
  const mask = activeShellMask(command);
  return command.replace(/\$\(\(([\s\S]*?)\)\)/g, (expression, body: string, offset: number) => {
    if (mask.slice(offset, offset + 3) !== "$((") return expression;
    const identifier = new RegExp(`(^|[^A-Za-z0-9_])${from}(?![A-Za-z0-9_])`, "g");
    const rewritten = body.replace(identifier, (_match, prefix: string) => `${prefix}${to}`);
    return rewritten === body ? expression : `$((` + rewritten + `))`;
  });
}

function containsArithmeticVariable(command: string, name: string): boolean {
  const identifier = new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);
  let found = false;
  forEachActiveArithmetic(command, (body) => {
    if (identifier.test(body)) found = true;
  });
  return found;
}

function containsArithmeticVariableOperation(command: string, name: string): boolean {
  const identifier = new RegExp(`(^|[^A-Za-z0-9_])${name}(?![A-Za-z0-9_])`);
  const directVariable = new RegExp(`^(?:${name}|\\$${name}|\\$\\{${name}\\})$`);
  let found = false;
  forEachActiveArithmetic(command, (value) => {
    const body = value.trim();
    if (identifier.test(body) && !directVariable.test(body)) found = true;
  });
  return found;
}

function forEachActiveArithmetic(command: string, visit: (body: string) => void): void {
  const mask = activeShellMask(command);
  for (const match of command.matchAll(/\$\(\(([\s\S]*?)\)\)/g)) {
    if (mask.slice(match.index, match.index + 3) === "$((") visit(match[1]);
  }
}

function containsActiveHereDocument(command: string): boolean {
  const mask = activeShellMask(command);
  for (const match of command.matchAll(/<<-?/g)) {
    if (mask.slice(match.index, match.index + match[0].length) === match[0]) return true;
  }
  return false;
}

function appendArgs(command: string, args: string[]): string {
  return args.length === 0 ? command : `${command} ${args.map(shellQuoteArgument).join(" ")}`;
}

function safeCwdPrefix(cwd: string): string | null {
  const normalized = posix.normalize(cwd.replaceAll("\\", "/"));
  if (
    normalized.startsWith("/") ||
    /^(?:\/|[A-Za-z]:[\\/])/.test(cwd) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return null;
  }
  return `cd -- ${shellQuote(normalized)} && `;
}

function normalizeAvailableIn(value: unknown): string | string[] | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value as string[];
  }
  return undefined;
}

function isCloudOnly(value: string | string[] | undefined): boolean {
  return (
    value === "cloud" ||
    (Array.isArray(value) && value.length > 0 && value.every((target) => target === "cloud"))
  );
}

function shellQuoteArgument(value: string): string {
  const variablePattern =
    /\$\(\([\s\S]*?\)\)|\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?:(?:[^{}])|\{[^{}]*\})*\}|[A-Za-z_][A-Za-z0-9_]*)/g;
  const parts: string[] = [];
  let offset = 0;
  for (const match of value.matchAll(variablePattern)) {
    const index = match.index;
    if (index > offset) parts.push(shellQuote(value.slice(offset, index)));
    parts.push(`"${match[0]}"`);
    offset = index + match[0].length;
  }
  if (offset < value.length) parts.push(shellQuote(value.slice(offset)));
  return parts.length > 0 ? parts.join("") : shellQuote(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
