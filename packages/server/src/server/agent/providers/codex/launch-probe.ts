import { LRUCache } from "lru-cache";
import type {
  ProviderLaunchAvailability,
  ResolvedProviderLaunch,
} from "../../provider-launch-config.js";

interface ProbeEntry {
  expiresAt: number;
  availability: Promise<ProviderLaunchAvailability>;
  version: Promise<string> | null;
}

interface CodexLaunchProbeDependencies {
  checkAvailability: (launch: ResolvedProviderLaunch) => Promise<ProviderLaunchAvailability>;
  readVersion: (command: string) => Promise<string>;
  now?: () => number;
}

// 模型目录、会话和桌面工具共享同一轮探测；短期缓存允许安装或升级后重新检测。
export class CodexLaunchProbe {
  private readonly entries = new LRUCache<string, ProbeEntry>({ max: 32 });

  constructor(private readonly deps: CodexLaunchProbeDependencies) {}

  checkAvailability(launch: ResolvedProviderLaunch): Promise<ProviderLaunchAvailability> {
    return this.getEntry(launch).availability;
  }

  readVersion(launch: ResolvedProviderLaunch): Promise<string> {
    const entry = this.getEntry(launch);
    if (!entry.version) {
      entry.version = (async () => {
        const availability = await entry.availability;
        if (!availability.available) throw new Error("Codex binary is not available");
        const command =
          launch.source === "override"
            ? launch.command
            : (availability.resolvedPath ?? launch.command);
        const version = await this.deps.readVersion(command);
        if (!/\b\d+\.\d+\.\d+\b/.test(version) || version.startsWith("error:")) {
          throw new Error(`Invalid Codex version response: ${version}`);
        }
        return version;
      })().catch((error: unknown) => {
        // 不缓存失败，下一次请求可在用户修复安装后立即重试。
        entry.expiresAt = 0;
        entry.version = null;
        throw error;
      });
    }
    return entry.version;
  }

  private getEntry(launch: ResolvedProviderLaunch): ProbeEntry {
    const key = JSON.stringify([
      launch,
      process.env.PATH,
      process.env.PATHEXT,
      process.env.LOCALAPPDATA,
      process.cwd(),
    ]);
    const now = this.deps.now ?? Date.now;
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > now()) return cached;
    const entry: ProbeEntry = {
      expiresAt: Infinity,
      availability: Promise.resolve().then(() => this.deps.checkAvailability(launch)),
      version: null,
    };
    entry.availability = entry.availability.then(
      (availability) => {
        entry.expiresAt = availability.available ? now() + 60_000 : 0;
        return availability;
      },
      (error: unknown) => {
        entry.expiresAt = 0;
        throw error;
      },
    );
    this.entries.set(key, entry);
    return entry;
  }
}
