import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { PaseoConfigRaw, PaseoScriptEntryRaw } from "@getpaseo/protocol/messages";
import type { ProjectConfigImportAdapter } from "../../registry.js";
import {
  InvalidProjectConfigImportSourceError,
  type ProjectConfigImportCandidate,
  type ProjectConfigImportInput,
  type ProjectConfigImportItem,
  type ProjectConfigImportSource,
} from "../../service.js";

interface SourceFile {
  role: string;
  relativePath: string;
  path: string;
  bytes: string;
}

interface ConductorSettings {
  scripts?: {
    setup?: unknown;
    archive?: unknown;
    run?: unknown;
    run_mode?: unknown;
    auto_run_after_setup?: unknown;
  };
  file_include_globs?: unknown;
  environment_variables?: unknown;
  environment_variables_forward?: unknown;
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
  options?: {
    cwd?: string;
  };
  available_in?: string | string[];
}

type RewriteContext = "lifecycle" | "run";

export const conductorProjectConfigImporter = {
  source: { kind: "conductor" },
  inspect: inspectConductorImport,
} satisfies ProjectConfigImportAdapter<{ kind: "conductor" }>;

function inspectConductorImport(input: {
  repoRoot: string;
  source: ProjectConfigImportSource;
}): ProjectConfigImportCandidate | null {
  const sourceFiles = discoverConductorSources(input.repoRoot);
  if (sourceFiles.length === 0) {
    return null;
  }

  const settings = loadConductorSettings(input.source, sourceFiles);
  const inputs = sourceFiles.map<ProjectConfigImportInput>((file) => ({
    role: file.role,
    relativePath: file.relativePath,
  }));
  const patch: PaseoConfigRaw = {};
  const items: ProjectConfigImportItem[] = [];

  mapLifecycle(settings.scripts?.setup, {
    key: "worktree.setup",
    label: "Worktree setup",
    target: "setup",
    patch,
    items,
  });
  mapLifecycle(settings.scripts?.archive, {
    key: "worktree.teardown",
    label: "Worktree teardown",
    target: "teardown",
    patch,
    items,
  });
  mapRunScripts(settings.scripts?.run, patch, items);
  reportUnsupported(input.repoRoot, settings, items);

  return {
    sourceRevision: hashSourceFiles(sourceFiles),
    inputs,
    items,
    patch,
  };
}

function discoverConductorSources(repoRoot: string): SourceFile[] {
  const localTomlPath = join(repoRoot, ".conductor", "settings.local.toml");
  const localJsonPath = join(repoRoot, ".conductor", "settings.local.json");
  const sharedTomlPath = join(repoRoot, ".conductor", "settings.toml");
  const sharedJsonPath = join(repoRoot, ".conductor", "settings.json");
  const rootLegacyPath = join(repoRoot, "conductor.json");
  const files: SourceFile[] = [];

  if (existsSync(sharedTomlPath)) {
    files.push(readSourceFile(repoRoot, sharedTomlPath, "shared"));
  } else if (existsSync(sharedJsonPath)) {
    files.push(readSourceFile(repoRoot, sharedJsonPath, "shared"));
  } else if (existsSync(rootLegacyPath)) {
    files.push(readSourceFile(repoRoot, rootLegacyPath, "legacy"));
  }
  if (existsSync(localTomlPath)) {
    files.push(readSourceFile(repoRoot, localTomlPath, "local"));
  } else if (existsSync(localJsonPath)) {
    files.push(readSourceFile(repoRoot, localJsonPath, "local"));
  }
  return files;
}

function readSourceFile(repoRoot: string, path: string, role: string): SourceFile {
  return {
    role,
    relativePath: relative(repoRoot, path).replaceAll("\\", "/"),
    path,
    bytes: readFileSync(path, "utf8"),
  };
}

function loadConductorSettings(
  source: ProjectConfigImportSource,
  sourceFiles: SourceFile[],
): ConductorSettings {
  let merged: ConductorSettings = {};
  for (const file of sourceFiles) {
    let parsed: unknown;
    try {
      parsed = file.relativePath.endsWith(".json") ? JSON.parse(file.bytes) : parseToml(file.bytes);
    } catch {
      throw new InvalidProjectConfigImportSourceError(source, file.relativePath);
    }
    if (!isRecord(parsed)) {
      throw new InvalidProjectConfigImportSourceError(source, file.relativePath);
    }
    merged = mergeSettings(merged, parsed as ConductorSettings);
  }
  return merged;
}

function mergeSettings(base: ConductorSettings, override: ConductorSettings): ConductorSettings {
  return {
    ...base,
    ...override,
    scripts: {
      ...(isRecord(base.scripts) ? base.scripts : {}),
      ...(isRecord(override.scripts) ? override.scripts : {}),
      run: mergeRunScripts(base.scripts?.run, override.scripts?.run),
    },
  };
}

function mergeRunScripts(base: unknown, override: unknown): unknown {
  if (typeof override === "string") {
    return override;
  }
  if (!isRecord(base) || !isRecord(override)) {
    return override ?? base;
  }
  const merged: Record<string, unknown> = { ...base };
  for (const [scriptId, overrideEntry] of Object.entries(override)) {
    const baseEntry = base[scriptId];
    merged[scriptId] = mergeRunScriptEntry(baseEntry, overrideEntry);
  }
  return merged;
}

function mergeRunScriptEntry(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return override ?? base;
  }
  const merged: Record<string, unknown> = { ...base, ...override };
  if (isRecord(base.options) && isRecord(override.options)) {
    merged.options = { ...base.options, ...override.options };
  }
  return merged;
}

function mapLifecycle(
  value: unknown,
  input: {
    key: string;
    label: string;
    target: "setup" | "teardown";
    patch: PaseoConfigRaw;
    items: ProjectConfigImportItem[];
  },
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    return;
  }
  const rewritten = rewriteVariables(value, "lifecycle", input.items);
  input.patch.worktree = { ...input.patch.worktree, [input.target]: rewritten.command };
  input.items.push({
    key: input.key,
    label: input.label,
    outcome: "import",
    detail: rewritten.command,
  });
}

function mapRunScripts(
  runConfig: unknown,
  patch: PaseoConfigRaw,
  items: ProjectConfigImportItem[],
): void {
  if (typeof runConfig === "string") {
    mapRunScript("run", { command: runConfig }, patch, items);
    return;
  }
  if (!isRecord(runConfig)) {
    return;
  }
  for (const scriptId of Object.keys(runConfig).sort()) {
    const entry = runConfig[scriptId];
    if (!isRecord(entry)) {
      continue;
    }
    const command = entry.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      continue;
    }
    mapRunScript(scriptId, normalizeRunScript(entry, command), patch, items);
  }
}

function normalizeRunScript(entry: Record<string, unknown>, command: string): ConductorRunScript {
  const args = Array.isArray(entry.args)
    ? entry.args.filter((arg): arg is string => typeof arg === "string")
    : undefined;
  const options = isRecord(entry.options) ? entry.options : undefined;
  const availableIn = normalizeAvailableIn(entry.available_in);
  return {
    command,
    ...(args ? { args } : {}),
    ...(typeof entry.default === "boolean" ? { default: entry.default } : {}),
    ...(typeof entry.hide === "boolean" ? { hide: entry.hide } : {}),
    ...(typeof entry.icon === "string" ? { icon: entry.icon } : {}),
    ...(options && typeof options.cwd === "string" ? { options: { cwd: options.cwd } } : {}),
    ...(availableIn ? { available_in: availableIn } : {}),
  };
}

function mapRunScript(
  scriptId: string,
  script: ConductorRunScript,
  patch: PaseoConfigRaw,
  items: ProjectConfigImportItem[],
): void {
  if (script.hide) {
    items.push({
      key: `scripts.${scriptId}`,
      label: `Script ${scriptId}`,
      outcome: "unsupported",
      detail: "Hidden scripts are not imported.",
    });
    return;
  }

  if (isCloudOnly(script.available_in)) {
    items.push({
      key: `scripts.${scriptId}`,
      label: `Script ${scriptId}`,
      outcome: "unsupported",
      detail: "Cloud-only scripts are not imported.",
    });
    return;
  }

  if (script.default !== undefined) {
    unsupported(items, `scripts.${scriptId}.default`, "Default script selection is not imported.");
  }
  if (script.icon !== undefined) {
    unsupported(items, `scripts.${scriptId}.icon`, "Script icons are not imported.");
  }

  let command = appendArgs(script.command, script.args ?? []);
  if (script.options?.cwd) {
    const cwdPrefix = safeCwdPrefix(script.options.cwd);
    if (!cwdPrefix) {
      items.push({
        key: `scripts.${scriptId}.cwd`,
        label: `Script ${scriptId} working directory`,
        outcome: "unsupported",
        detail: "Absolute or escaping cwd values are not imported.",
      });
    } else {
      command = `${cwdPrefix}${command}`;
    }
  }

  const isService = containsShellVariable(command, "CONDUCTOR_PORT");
  const rewritten = rewriteVariables(command, isService ? "run" : "lifecycle", items);
  const entry: PaseoScriptEntryRaw = { command: rewritten.command };
  if (isService) {
    entry.type = "service";
    entry.port = "$PASEO_PORT";
  }

  patch.scripts = { ...patch.scripts, [scriptId]: entry };
  items.push({
    key: `scripts.${scriptId}`,
    label: `Script ${scriptId}`,
    outcome: "import",
    detail: rewritten.command,
  });
}

function reportUnsupported(
  repoRoot: string,
  settings: ConductorSettings,
  items: ProjectConfigImportItem[],
): void {
  const scripts = settings.scripts;
  if (scripts?.run_mode !== undefined) {
    unsupported(items, "scripts.run_mode", "Paseo has no project-wide run mode.");
  }
  if (scripts?.auto_run_after_setup !== undefined) {
    unsupported(
      items,
      "scripts.auto_run_after_setup",
      "Paseo does not auto-run scripts after setup.",
    );
  }
  if (settings.file_include_globs !== undefined) {
    unsupported(
      items,
      "file_include_globs",
      "File include globs are not converted to shell copy commands.",
    );
  }
  if (existsSync(join(repoRoot, ".worktreeinclude"))) {
    unsupported(
      items,
      ".worktreeinclude",
      "Worktree include patterns are not converted to shell copy commands.",
    );
  }
  const environmentNames = collectEnvironmentVariableNames(settings);
  if (environmentNames.length > 0) {
    unsupported(
      items,
      "environment_variables",
      `Environment variable values are not imported. Found: ${environmentNames.join(", ")}.`,
    );
  }
  if (settings.spotlight_testing !== undefined) {
    unsupported(
      items,
      "spotlight_testing",
      "Paseo spotlight is a separate workflow, not project config.",
    );
  }
  if (settings.prompts !== undefined) {
    unsupported(items, "prompts", "Custom agent prompts are not imported.");
  }
  if (settings.git !== undefined) {
    unsupported(items, "git", "Conductor Git settings are not imported.");
  }
}

function collectEnvironmentVariableNames(settings: ConductorSettings): string[] {
  const names = new Set<string>();
  for (const key of ["environment_variables", "environment_variables_forward"] as const) {
    collectEnvironmentVariableNamesFromValue(settings[key], names);
  }
  return Array.from(names).sort();
}

function collectEnvironmentVariableNamesFromValue(value: unknown, names: Set<string>): void {
  if (Array.isArray(value)) {
    for (const name of value) {
      if (typeof name === "string") {
        names.add(name);
      }
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [name, nestedValue] of Object.entries(value)) {
    if (isRecord(nestedValue)) {
      collectEnvironmentVariableNamesFromValue(nestedValue, names);
    } else {
      names.add(name);
    }
  }
}

function unsupported(items: ProjectConfigImportItem[], key: string, detail: string): void {
  items.push({ key, label: key, outcome: "unsupported", detail });
}

function rewriteVariables(
  command: string,
  context: RewriteContext,
  items: ProjectConfigImportItem[],
): { command: string } {
  const replacements = new Map<string, string>([
    ["CONDUCTOR_WORKSPACE_PATH", "PASEO_WORKTREE_PATH"],
    ["CONDUCTOR_ROOT_PATH", "PASEO_SOURCE_CHECKOUT_PATH"],
    ["CONDUCTOR_PORT", context === "run" ? "PASEO_PORT" : "PASEO_WORKTREE_PORT"],
  ]);
  const unsupportedVariables = new Set([
    "CONDUCTOR_DEFAULT_BRANCH",
    "CONDUCTOR_WORKSPACE_NAME",
    "CONDUCTOR_IS_LOCAL",
  ]);
  let rewritten = command;
  for (const [from, to] of replacements) {
    const next = replaceShellVariable(rewritten, from, to);
    if (next !== rewritten) {
      items.push({
        key: `variables.${from}`,
        label: from,
        outcome: "rewrite",
        detail: `${from} -> ${to}`,
      });
      rewritten = next;
    }
  }
  for (const name of unsupportedVariables) {
    if (containsShellVariable(rewritten, name)) {
      items.push({
        key: `variables.${name}`,
        label: name,
        outcome: "unsupported",
        detail: `${name} has no equivalent Paseo variable.`,
      });
    }
  }
  return { command: rewritten };
}

function replaceShellVariable(command: string, from: string, to: string): string {
  const pattern = new RegExp(`\\$\\{${from}(?=[}:#%+\\-=?])|\\$${from}(?![A-Za-z0-9_])`, "g");
  return command.replace(pattern, (match) => (match.startsWith("${") ? `\${${to}` : `$${to}`));
}

function containsShellVariable(command: string, name: string): boolean {
  const pattern = new RegExp(`\\$\\{${name}(?=[}:#%+\\-=?])|\\$${name}(?![A-Za-z0-9_])`);
  return pattern.test(command);
}

function appendArgs(command: string, args: string[]): string {
  if (args.length === 0) {
    return command;
  }
  return `${command} ${args.map(shellQuoteArgument).join(" ")}`;
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

function isCloudOnly(availableIn: string | string[] | undefined): boolean {
  return (
    availableIn === "cloud" ||
    (Array.isArray(availableIn) &&
      availableIn.length > 0 &&
      availableIn.every((target) => target === "cloud"))
  );
}

function normalizeAvailableIn(value: unknown): string | string[] | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return undefined;
}

function shellQuoteArgument(value: string): string {
  const variablePattern =
    /\$(?:\{[A-Za-z_][A-Za-z0-9_]*(?:(?:[^{}])|\{[^{}]*\})*\}|[A-Za-z_][A-Za-z0-9_]*)/g;
  const parts: string[] = [];
  let offset = 0;
  for (const match of value.matchAll(variablePattern)) {
    const index = match.index;
    if (index > offset) {
      parts.push(shellQuote(value.slice(offset, index)));
    }
    parts.push(`"${match[0]}"`);
    offset = index + match[0].length;
  }
  if (offset < value.length) {
    parts.push(shellQuote(value.slice(offset)));
  }
  return parts.length > 0 ? parts.join("") : shellQuote(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function hashSourceFiles(sourceFiles: SourceFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...sourceFiles].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
