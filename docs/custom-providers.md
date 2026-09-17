# Custom Provider Configuration

Paseo supports configuring custom agent providers through `config.json` (located at `$PASEO_HOME/config.json`, typically `~/.paseo/config.json`). You can extend built-in providers with different API backends, add ACP-compatible agents, set custom binaries, disable providers, and create multiple profiles for the same underlying provider.

All provider configuration lives under `agents.providers` in config.json:

```json
{
  "version": 1,
  "agents": {
    "providers": {
      "provider-id": { ... }
    }
  }
}
```

Provider IDs must be lowercase alphanumeric with hyphens (`/^[a-z][a-z0-9-]*$/`).

---

## Table of Contents

- [Extending a built-in provider](#extending-a-built-in-provider)
- [Z.AI (Zhipu) coding plan](#zai-zhipu-coding-plan)
- [Alibaba Cloud (Qwen) coding plan](#alibaba-cloud-qwen-coding-plan)
- [Codex with a custom OpenAI-compatible endpoint](#codex-with-a-custom-openai-compatible-endpoint)
- [Multiple profiles for the same provider](#multiple-profiles-for-the-same-provider)
- [Custom binary for a provider](#custom-binary-for-a-provider)
- [Disabling a provider](#disabling-a-provider)
- [ACP providers](#acp-providers)
- [Provider override reference](#provider-override-reference)

---

## Extending a built-in provider

Use `extends` to create a new provider entry that inherits from a built-in provider (claude, codex, copilot, opencode, pi, omp). The new provider gets its own entry in the provider list, with its own label, environment, and model definitions.

```json
{
  "agents": {
    "providers": {
      "my-claude": {
        "extends": "claude",
        "label": "My Claude",
        "description": "Claude with custom API endpoint",
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-...",
          "ANTHROPIC_BASE_URL": "https://my-proxy.example.com/v1"
        }
      }
    }
  }
}
```

Required fields for custom providers:

- `extends` — which built-in provider to inherit from (or `"acp"`)
- `label` — display name in the UI

See [Codex with a custom OpenAI-compatible endpoint](#codex-with-a-custom-openai-compatible-endpoint) below for the dedicated Codex example.

---

## Z.AI (Zhipu) coding plan

[Z.AI](https://z.ai) is a Chinese AI company (Zhipu AI) that offers an Anthropic-compatible API endpoint. Their GLM Coding Plan provides flat-rate access to GLM models through Claude Code's Anthropic API protocol. These are **not** Anthropic Claude models — they are Zhipu's own GLM models exposed through an Anthropic-compatible API.

### Setup

1. Register at [z.ai](https://z.ai) and subscribe to a coding plan
2. Create an API key from the Z.AI dashboard
3. Add a provider entry in config.json:

```json
{
  "agents": {
    "providers": {
      "zai": {
        "extends": "claude",
        "label": "ZAI",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "<your-zai-api-key>",
          "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
          "API_TIMEOUT_MS": "3000000"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "glm-4.5-air", "label": "GLM 4.5 Air" },
          { "id": "glm-5-turbo", "label": "GLM 5 Turbo", "isDefault": true },
          { "id": "glm-5.1", "label": "GLM 5.1" }
        ]
      }
    }
  }
}
```

### Available models

| Model         | Tier                |
| ------------- | ------------------- |
| `glm-5.1`     | Advanced (flagship) |
| `glm-5-turbo` | Advanced            |
| `glm-4.7`     | Standard            |
| `glm-4.5-air` | Lightweight         |

### Notes

- `ANTHROPIC_AUTH_TOKEN` is used instead of `ANTHROPIC_API_KEY` — this is the z.ai API key
- The `API_TIMEOUT_MS` env var extends the request timeout (z.ai can be slower than direct Anthropic)
- If you get auth errors, run `/logout` inside Claude Code before switching to the z.ai provider
- Web search (`WebSearch` tool) is an Anthropic-only server-side feature — third-party endpoints don't support it. Add `"disallowedTools": ["WebSearch"]` to avoid errors.
- Automated setup is also available: `npx @z_ai/coding-helper`
- Official docs: [docs.z.ai/devpack/tool/claude](https://docs.z.ai/devpack/tool/claude)

---

## Alibaba Cloud (Qwen) coding plan

[Alibaba Cloud Model Studio](https://www.alibabacloud.com/en/campaign/ai-scene-coding) offers a coding plan that routes Claude Code requests to Qwen models through an Anthropic-compatible API. Like z.ai, these are **not** Anthropic Claude models.

### Setup

1. Go to the [Coding Plan page](https://modelstudio.console.alibabacloud.com/ap-southeast-1/?tab=globalset#/efm/coding_plan) on Alibaba Cloud Model Studio (Singapore region)
2. Subscribe to the Pro plan ($50/month)
3. Obtain your plan-specific API key (format: `sk-sp-xxxxx`) — this is different from a standard Model Studio key
4. Add a provider entry in config.json:

```json
{
  "agents": {
    "providers": {
      "qwen": {
        "extends": "claude",
        "label": "Qwen (Alibaba)",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "sk-sp-<your-coding-plan-key>",
          "ANTHROPIC_BASE_URL": "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "qwen3.5-plus", "label": "Qwen 3.5 Plus", "isDefault": true },
          { "id": "qwen3-coder-next", "label": "Qwen 3 Coder Next" },
          { "id": "kimi-k2.5", "label": "Kimi K2.5" }
        ]
      }
    }
  }
}
```

### API endpoints

| Mode                            | Base URL                                                    |
| ------------------------------- | ----------------------------------------------------------- |
| Coding plan (subscription)      | `https://coding-intl.dashscope.aliyuncs.com/apps/anthropic` |
| Pay-as-you-go (no subscription) | `https://dashscope-intl.aliyuncs.com/apps/anthropic`        |

For pay-as-you-go, use `ANTHROPIC_API_KEY` with a standard Model Studio key (`sk-xxxxx`) instead of `ANTHROPIC_AUTH_TOKEN`.

### Available models

**Recommended for coding plan:**

| Model              | Notes                       |
| ------------------ | --------------------------- |
| `qwen3.5-plus`     | Vision capable, recommended |
| `qwen3-coder-next` | Optimized for coding        |
| `kimi-k2.5`        | Vision capable              |
| `glm-5`            | Zhipu GLM                   |
| `MiniMax-M3`       | MiniMax                     |

**Additional models (pay-as-you-go):**
`qwen3-max`, `qwen3.5-flash`, `qwen3-coder-plus`, `qwen3-coder-flash`, `qwen3-vl-plus`, `qwen3-vl-flash`

### Notes

- API keys must be created in the **Singapore region**
- The coding plan is for personal use only in interactive coding tools
- Web search (`WebSearch` tool) is an Anthropic-only server-side feature — third-party endpoints don't support it. Add `"disallowedTools": ["WebSearch"]` to avoid errors.
- Official docs: [alibabacloud.com/help/en/model-studio/claude-code-coding-plan](https://www.alibabacloud.com/help/en/model-studio/claude-code-coding-plan)

---

## Codex with a custom OpenAI-compatible endpoint

Codex talks to OpenAI's Responses API by default. Custom providers that extend `"codex"` can point Codex at any OpenAI-compatible endpoint (OpenRouter, LiteLLM, vLLM, llama.cpp server, an internal gateway, etc.) by setting `OPENAI_BASE_URL` and `OPENAI_API_KEY` in the provider `env`.

Paseo passes those variables through to the Codex app-server process **and** maps them into Codex's thread config under `model_provider` / `model_providers`, because Codex reads provider routing from config rather than from `OPENAI_BASE_URL` alone.

### Setup

```json
{
  "agents": {
    "providers": {
      "my-codex": {
        "extends": "codex",
        "label": "My Codex",
        "description": "Codex via custom OpenAI-compatible endpoint",
        "env": {
          "OPENAI_API_KEY": "sk-...",
          "OPENAI_BASE_URL": "https://custom-relay.example.com"
        },
        "models": [{ "id": "custom-model", "label": "Custom Model", "isDefault": true }]
      }
    }
  }
}
```

### What Paseo wires up

Under the hood, for each custom Codex provider Paseo injects this into Codex's config:

```toml
model_provider = "my-codex"

[model_providers.my-codex]
name = "My Codex"
base_url = "https://custom-relay.example.com/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
requires_openai_auth = false
```

- `base_url` — taken from `OPENAI_BASE_URL`. If it does not already end in `/v1`, Paseo appends `/v1`. Trailing slashes are stripped.
- `wire_api` — always `"responses"` (OpenAI Responses API protocol).
- `env_key` — set to `"OPENAI_API_KEY"` when that env var is present and non-empty, so Codex reads the key from the same env var Paseo passes through.
- `requires_openai_auth` — forced to `false` when `OPENAI_API_KEY` is provided, so Codex skips its built-in OpenAI login flow.

### Notes

- The endpoint must speak the OpenAI **Responses API**, not just chat completions. Many gateways (OpenRouter, LiteLLM) support both — pick the Responses-compatible route.
- Set `models` explicitly. Custom endpoints expose their own model IDs (`anthropic/claude-opus-4-7`, `qwen/qwen3-coder`, `local/llama`, etc.), and Paseo does not discover them automatically for Codex.
- To run multiple endpoints side-by-side, define multiple entries that each extend `"codex"` with different IDs, labels, and env. Each appears as its own provider in the app.
- If you only want to override the binary (e.g. a nightly Codex build) without changing the endpoint, omit `OPENAI_BASE_URL` and use `command` instead — see [Custom binary for a provider](#custom-binary-for-a-provider).

### 按会话动态注入 Codex 服务商

如果只需要让某个 Codex 会话切换端点，而不想创建独立的 Paseo 提供方，请打开**设置 → Host → Agents → Codex 服务商注入**。每个条目把一个 Codex `model_provider` 标识映射到原生服务商定义及可选的进程环境变量：

```json
{
  "daemon": {
    "codexProviderInjections": [
      {
        "id": "internal_gateway",
        "name": "Internal gateway",
        "modelProvider": "internal_gateway",
        "model": "gpt-5.4",
        "definition": {
          "name": "Internal gateway",
          "base_url": "https://gateway.example.com/v1",
          "wire_api": "responses",
          "env_key": "INTERNAL_GATEWAY_KEY",
          "requires_openai_auth": false
        },
        "env": {
          "INTERNAL_GATEWAY_KEY": "sk-..."
        }
      }
    ]
  }
}
```

然后打开 Codex 会话菜单，在**注入 Codex 服务商**下选择一个条目。Paseo 会同时通过 Codex app-server 顶层的 `modelProvider` 字段和 `config.model_provider` 发送同一个标识，并把 `definition` 写入 `config.model_providers[modelProvider]`。

- `modelProvider` 可以与用户全局 Codex 配置中已经使用的标识相同。多个注入条目也可以复用同一标识，因为一个会话每次只会物化当前选中的定义。不要在 `definition` 内重复填写 `model_provider`；该对象只对应 `[model_providers.<id>]` 表。
- 尚未加载或已经释放运行时的会话会立即携带所选注入配置启动。已经加载的会话会完整重新加载，因为 Codex 不能原地切换已加载线程的服务商。
- Paseo 会话只保存所选条目 ID；凭据和服务商定义保留在守护进程配置中，仅在运行时启动时解析。
- 如果删除仍被会话选中的条目，该会话下次启动会明确失败，不能静默回退到其他端点。
- 此功能适合按会话切换。如果端点需要作为新会话和 Agent 配置档案中的普通提供方选项出现，应使用继承 `codex` 的自定义提供方。

### Windows 上独立托管官方桌面工具

Paseo 的 Codex 提供方可以自行托管已安装的官方 Computer Use 与 Chrome 工具运行时，不启动或隐藏整个 Codex App。它使用官方 SDK 和可执行文件，不复制专有实现，也不把技能替换成另一套浏览器自动化工具。

**前提：** 首次仍要通过 Codex App 安装、启用所需插件并完成运行时准备；Chrome 还需要安装官方扩展。Paseo 不负责下载专有运行时、首次登录或代替用户授权，也不会自动开启已关闭的插件。首次准备完成后，日常使用 Computer Use 或 Chrome 不要求 Codex App 保持打开；仍需保留官方 App 安装目录及其下载的运行时，不能在体验成功后直接卸载这些组件。

每次新建或恢复 Codex 运行实例时，Paseo 读取其有效配置，只接管 Windows 上由 App 配置的原生管道型 Node REPL：

- Computer Use 通过 Paseo 自有命名管道连接独立 SDK 宿主。首次操作时，宿主使用官方配套 Node 启动，并由官方 `WindowsHelperTransport` 启动原生组件；组件使用宿主的父进程标识，Codex 数据目录、原生审批和物理 Escape 停止语义均保留。发布版本将宿主及 Zod 等依赖打成自包含文件，桌面安装包将其解包到 `app.asar.unpacked`；外部 Node 不会收到无法读取的 ASAR 虚拟路径，宿主缺失时会明确报告。
- Paseo 不信任 App 写入配置的易失哈希路径。每次启动 Codex 运行实例时，它会从该会话实际使用的 Codex 启动命令重新解析 npm 原生 CLI，并从 Chrome 插件的 `latest` 目录解析浏览器服务；旧版本目录被更新移除后，不需要手工修改 `config.toml`。找不到与当前启动器匹配的原生 CLI 时明确失败，不能回退到另一个可能使用不同版本或登录环境的 Codex。
- Chrome 继续通过官方浏览器 SDK 连接扩展宿主；Paseo 会用官方插件自带的安装器幂等注册或刷新 Native Messaging Host，同一组运行路径在一个守护进程生命周期内只执行一次。扩展宿主仍由 Chrome 启动，Paseo 不冒充或抢占；独立模式不提供 Codex App 内置的 `iab` 浏览器。
- 会话配置只替换 Node REPL 的环境变量。统一工具插件的原 MCP 服务在该会话中关闭，并按原工具限制和界面配置注册同名服务；不改写全局 `config.toml` 或官方插件缓存。明确自定义相关 MCP 或插件覆盖的会话保留用户配置，不自动接管。
- Paseo 根据回合完成与中断通知调用官方 `turn_ended`，并按会话和回合回收本次原生控制组件，不依赖 CLI 是否加载了插件结束钩子。会话退出、初始化失败和异常断连也会释放租约；多个会话共享同一运行时的管道，旧连接及迟到的清理通知不会关闭其他回合。

**认证边界：** Chrome 后端发现成功、工具目录可见或普通 JavaScript 执行成功，都不代表实际浏览器连接已经可用。官方运行时仍通过配置的 `CODEX_CLI_PATH` 和 `CODEX_HOME` 查询认证；不要求 OpenAI 登录的本地转发配置可能使查询返回空认证，API Key 也不能当作 ChatGPT 登录态使用。出现 `Codex auth token is unavailable` 时，需要单独处理工具进程实际使用的登录环境，而不是重复启动宿主。Paseo 当前没有独立的桌面工具登录目录设置，不会自动改写模型路由、切换认证模式、复制凭证或伪造登录状态。不能仅凭更换模型提供方后能读到 API Key，就认定浏览器认证已经满足。

**打包验证：** 服务端 `build:lib` 生成 `desktop-tools-host.bundle.mjs`，不打包官方专有 SDK；Windows 打包钩子检查解包目录内的真实宿主文件，缺失时中止构建。回归测试使用真实 ASAR、Electron 的 Node 模式和独立 Node，覆盖宿主加载、请求和授权转发及退出；测试替换会操作真实桌面的 SDK 端口，不代表已经验证真实浏览器认证。

macOS、Linux 和非 App 管道型配置保持原有行为。运行时缺失、配置结构不合法或服务启动失败会明确报告，不会降级为跳过认证、自动批准或直接调用未受管理的桌面控制组件。官方 App 更新可能改变这些本地接口；排查时应先核对有效 MCP 配置和实际进程归属，不能只凭工具目录中出现技能名称判断执行宿主是否正常。

---

## Multiple profiles for the same provider

You can create multiple entries that extend the same built-in provider. Each gets its own entry in the provider list with independent credentials, models, and environment.

"Profile" here means a provider alias, and it is not an **Agent profile** — that is a named bundle of provider, model, mode, thinking option and features, stored under `daemon.agentProfiles`. See [glossary.md](glossary.md) for all four senses of the word.

Example: two different Anthropic accounts as separate profiles:

```json
{
  "agents": {
    "providers": {
      "claude-work": {
        "extends": "claude",
        "label": "Claude (Work)",
        "description": "Work Anthropic account",
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-work-..."
        }
      },
      "claude-personal": {
        "extends": "claude",
        "label": "Claude (Personal)",
        "description": "Personal Anthropic account",
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-personal-..."
        }
      }
    }
  }
}
```

Each profile appears as a separate provider in the Paseo app. You can select which one to use when launching an agent.

You can also combine profiles with model overrides to pin specific models per profile:

```json
{
  "agents": {
    "providers": {
      "claude-fast": {
        "extends": "claude",
        "label": "Claude (Fast)",
        "models": [{ "id": "claude-sonnet-4-6", "label": "Sonnet 4.6", "isDefault": true }]
      },
      "claude-smart": {
        "extends": "claude",
        "label": "Claude (Smart)",
        "models": [{ "id": "claude-opus-4-6", "label": "Opus 4.6", "isDefault": true }]
      }
    }
  }
}
```

---

## Custom binary for a provider

Override the command used to launch any provider with the `command` field. This is an array where the first element is the binary and the rest are arguments.

### Override a built-in provider's binary

```json
{
  "agents": {
    "providers": {
      "claude": {
        "command": ["/opt/claude-nightly/claude"]
      }
    }
  }
}
```

### Use a custom wrapper script

```json
{
  "agents": {
    "providers": {
      "claude": {
        "command": ["/usr/local/bin/my-claude-wrapper", "--verbose"]
      }
    }
  }
}
```

### Custom binary on a derived provider

```json
{
  "agents": {
    "providers": {
      "my-codex": {
        "extends": "codex",
        "label": "Codex (Custom Build)",
        "command": ["/home/user/codex-dev/target/release/codex"]
      }
    }
  }
}
```

The `command` array completely replaces the default command for that provider. The binary must exist on the system — Paseo checks for its availability and will mark the provider as unavailable if not found.

### OMP profiles and Pi-compatible forks

OMP ships as a first-class built-in provider option. It is disabled by default; enable it with:

```json
{
  "agents": {
    "providers": {
      "omp": { "enabled": true }
    }
  }
}
```

Custom OMP profiles should extend `omp`. They inherit the OMP adapter's `rpc-ui` approvals, native Paseo host tools, provider-managed subagents, and import behavior:

```json
{
  "agents": {
    "providers": {
      "omp-work": {
        "extends": "omp",
        "label": "Oh My Pi (Work)",
        "command": ["omp"],
        "env": {
          "XDG_CONFIG_HOME": "~/.config/omp-work",
          "XDG_STATE_HOME": "~/.local/state/omp-work"
        },
        "params": {
          "sessionDir": "~/.local/state/omp-work/omp/agent/sessions",
          "rpcTimeoutMs": 60000,
          "smolModel": "openai/gpt-5-mini",
          "slowModel": "anthropic/claude-opus-4-1",
          "planModel": "openai/o3"
        }
      }
    }
  }
}
```

`params.sessionDir` is used only for importing sessions that were started outside Paseo. If `command` or XDG env vars move OMP's state directory, set `params.sessionDir` to the resulting OMP JSONL session directory; launching and resuming still go through the configured command. `params.rpcTimeoutMs` overrides the 60-second OMP control-plane RPC deadline.

For other providers that keep Pi's `--mode rpc` API but write sessions somewhere else, extend `pi`, replace the command, and provide the JSONL session directory:

```json
{
  "agents": {
    "providers": {
      "my-pi-fork": {
        "extends": "pi",
        "label": "My Pi Fork",
        "command": ["my-pi-fork"],
        "params": {
          "sessionDir": "~/.my-pi-fork/sessions",
          "rpcTimeoutMs": 60000
        }
      }
    }
  }
}
```

This session directory is also import-only. Launching and resuming still go through the configured command, so this example resumes with `my-pi-fork --mode rpc --session <session-file>`. `params.rpcTimeoutMs` overrides the 60-second Pi control-plane RPC deadline.

---

## Disabling a provider

Set `enabled: false` to hide a provider from the provider list. The provider will not appear in the app or CLI.

```json
{
  "agents": {
    "providers": {
      "copilot": { "enabled": false },
      "codex": { "enabled": false }
    }
  }
}
```

This works for both built-in and custom providers. To re-enable, set `enabled: true` or remove the `enabled` field entirely. Most providers are enabled by default; OMP is intentionally disabled by default and requires `enabled: true`.

---

## ACP providers

The [Agent Client Protocol (ACP)](https://agentclientprotocol.com) is an open standard for communication between editors and AI coding agents — think LSP but for AI agents. Any agent that supports ACP can be added to Paseo as a custom provider.

ACP agents communicate over JSON-RPC 2.0 on stdio. Paseo spawns the agent process and talks to it through stdin/stdout.

Paseo also ships an in-app ACP provider catalog for common agents, including CodeWhale, Cursor, DeepAgents, DimCode, Gemini CLI, Hermes, Qwen Code, and Kimi Code. Catalog entries create the same `extends: "acp"` provider config shown below.

### Adding a generic ACP provider

Set `extends: "acp"` and provide a `command`:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent-binary", "--acp"],
        "env": {
          "MY_API_KEY": "..."
        }
      }
    }
  }
}
```

Required fields for ACP providers:

- `extends: "acp"`
- `label`
- `command` — the command to spawn the agent process (must support ACP over stdio)

Paseo tools such as subagent creation come from the shared internal tool catalog. ACP providers receive those tools through the MCP fallback by default because ACP exposes `mcpServers`, not Paseo's native tool catalog. Some ACP adapters cannot create sessions when `mcpServers` is non-empty. Disable injected MCP for those providers with `params.supportsMcpServers: false`:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent", "acp"],
        "params": {
          "supportsMcpServers": false
        }
      }
    }
  }
}
```

ACP agents execute filesystem operations in their own environment by default,
while terminal operations run through Paseo on the host. To customize which
operations Paseo handles, configure client capabilities in provider params:

```json
{
  "agents": {
    "providers": {
      "container-agent": {
        "extends": "acp",
        "label": "Container Agent",
        "command": ["container-agent", "acp"],
        "params": {
          "clientCapabilities": {
            "fs": {
              "readTextFile": false,
              "writeTextFile": false
            },
            "terminal": false
          }
        }
      }
    }
  }
}
```

When an agent runs in a container or remote environment that manages its own
terminal, set `terminal: false` to keep command execution inside the agent
container. When delegating filesystem operations to Paseo (`fs.readTextFile: true`
or `fs.writeTextFile: true`), ensure the agent and Paseo share equivalent
absolute workspace paths.

### Generic ACP diagnostics

Paseo diagnostics for `extends: "acp"` providers report the configured command, resolved launcher binary, version output, ACP `initialize`, ACP `session/new`, model count, modes, and final status.

For package-runner commands such as `npx -y @google/gemini-cli --acp`, the version probe keeps the package spec and runs `npx -y @google/gemini-cli --version`. This diagnoses the actual agent package instead of only proving that `npx` exists.

ACP probes use short timeouts and browser-suppression environment variables so agents that enter an auth/browser flow fail as a diagnostic error instead of hanging the provider screen.

### Example: Google Gemini CLI

[Gemini CLI](https://github.com/google-gemini/gemini-cli) supports ACP via the `--acp` flag.

1. Install: `npm install -g @google/gemini-cli` or see [Gemini CLI docs](https://github.com/google-gemini/gemini-cli)
2. Authenticate with Google (Gemini CLI handles its own auth)
3. Add to config.json:

```json
{
  "agents": {
    "providers": {
      "gemini": {
        "extends": "acp",
        "label": "Google Gemini",
        "command": ["gemini", "--acp"]
      }
    }
  }
}
```

Ref: [Gemini CLI ACP mode docs](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md)

### Example: Hermes (Nous Research)

[Hermes](https://github.com/NousResearch/hermes-agent) is an open-source coding agent by Nous Research with persistent memory and multi-provider LLM support. It supports ACP via the `acp` subcommand.

1. Install: `curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash`
2. Install ACP support: `pip install -e '.[acp]'`
3. Configure Hermes credentials in `~/.hermes/`
4. Add to config.json:

```json
{
  "agents": {
    "providers": {
      "hermes": {
        "extends": "acp",
        "label": "Hermes",
        "description": "Nous Research self-improving AI agent",
        "command": ["hermes", "acp"]
      }
    }
  }
}
```

Ref: [Hermes ACP docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp)

### How ACP providers work in Paseo

When you launch an agent with an ACP provider:

1. Paseo spawns the process using the configured `command`
2. Sends an `initialize` JSON-RPC request over stdin
3. The agent responds with its capabilities, available modes, and models
4. Paseo creates a session and sends prompts through the ACP protocol
5. The agent streams responses, tool calls, and permission requests back over stdout

Models and modes are discovered dynamically at runtime from the agent process. If you want to override the model list (e.g., to curate which models appear in the UI), use the `models` field:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent", "--acp"],
        "models": [
          { "id": "fast-model", "label": "Fast", "isDefault": true },
          { "id": "smart-model", "label": "Smart" }
        ]
      }
    }
  }
}
```

Profile models (defined in config.json) completely replace runtime-discovered models when present.

If you want to keep runtime-discovered models and add or relabel a few entries, use `additionalModels` instead.

Example: add an experimental model while keeping every model the provider discovers at runtime:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent", "--acp"],
        "additionalModels": [
          { "id": "experimental-model", "label": "Experimental", "isDefault": true }
        ]
      }
    }
  }
}
```

Example: relabel a discovered model without replacing the full list:

```json
{
  "agents": {
    "providers": {
      "my-agent": {
        "extends": "acp",
        "label": "My Agent",
        "command": ["my-agent", "--acp"],
        "additionalModels": [{ "id": "provider/model-id", "label": "My Preferred Label" }]
      }
    }
  }
}
```

When an `additionalModels` entry has the same `id` as a discovered model, it updates that model in place.

---

## Provider override reference

Every entry under `agents.providers` accepts these fields:

| Field              | Type                      | Required          | Description                                                        |
| ------------------ | ------------------------- | ----------------- | ------------------------------------------------------------------ |
| `extends`          | `string`                  | Yes (custom only) | Built-in provider ID to inherit from, or `"acp"`                   |
| `label`            | `string`                  | Yes (custom only) | Display name in the UI                                             |
| `description`      | `string`                  | No                | Short description shown in the UI                                  |
| `command`          | `string[]`                | Yes (ACP only)    | Command to spawn the agent process                                 |
| `env`              | `Record<string, string>`  | No                | Environment variables to set for the agent process                 |
| `params`           | `Record<string, unknown>` | No                | Provider-specific options such as `supportsMcpServers: false`      |
| `models`           | `ProviderProfileModel[]`  | No                | Static model list (overrides runtime discovery)                    |
| `additionalModels` | `ProviderProfileModel[]`  | No                | Static model additions (merged with runtime discovery or `models`) |
| `disallowedTools`  | `string[]`                | No                | Tool names to disable for this provider (e.g. `["WebSearch"]`)     |
| `enabled`          | `boolean`                 | No                | Set to `false` to hide the provider (default: `true`)              |
| `order`            | `number`                  | No                | Sort order in the provider list                                    |

### Model definition

Each entry in the `models` array:

| Field             | Type               | Required | Description                           |
| ----------------- | ------------------ | -------- | ------------------------------------- |
| `id`              | `string`           | Yes      | Model identifier sent to the provider |
| `label`           | `string`           | Yes      | Display name in the UI                |
| `description`     | `string`           | No       | Short description                     |
| `isDefault`       | `boolean`          | No       | Mark as the default model selection   |
| `thinkingOptions` | `ThinkingOption[]` | No       | Available thinking/reasoning levels   |

### Thinking option

| Field         | Type      | Required | Description                         |
| ------------- | --------- | -------- | ----------------------------------- |
| `id`          | `string`  | Yes      | Thinking option identifier          |
| `label`       | `string`  | Yes      | Display name                        |
| `description` | `string`  | No       | Short description                   |
| `isDefault`   | `boolean` | No       | Mark as the default thinking option |

### Claude settings.json model discovery

The built-in `claude` provider appends concrete model IDs from `~/.claude/settings.json` to its first-party Claude model list. Paseo reads the top-level `model` field and these `env` keys: `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, and `ANTHROPIC_DEFAULT_HAIKU_MODEL`.

This lets users who already configured Claude Code for Bedrock, OpenRouter, ollama, Z.AI, or another Anthropic-compatible gateway select the exact model ID in Paseo. When `agents.providers.claude.models` is set it **replaces** both the hardcoded first-party Claude list and any settings.json-discovered entries; use `agents.providers.claude.additionalModels` to keep the first-party list and append curated entries on top.

### Gotcha: `extends: "claude"` with third-party endpoints

When a custom provider extends `"claude"` but points `ANTHROPIC_BASE_URL` at a non-Anthropic API (Z.AI, Alibaba/Qwen, proxies), the Claude Agent SDK may try to use Anthropic-only server-side tools like `WebSearch`. Third-party APIs don't support these tools, causing errors.

Use `disallowedTools` to disable unsupported tools:

```json
{
  "agents": {
    "providers": {
      "my-proxy": {
        "extends": "claude",
        "label": "My Proxy",
        "env": {
          "ANTHROPIC_BASE_URL": "https://my-proxy.example.com/v1"
        },
        "disallowedTools": ["WebSearch"]
      }
    }
  }
}
```

### Valid `extends` values

Built-in providers: `claude`, `codex`, `copilot`, `opencode`, `pi`, `omp`

Special value: `acp` — creates a generic ACP provider (requires `command`)

### Full example

A config.json with multiple custom providers:

```json
{
  "version": 1,
  "agents": {
    "providers": {
      "copilot": { "enabled": false },

      "zai": {
        "extends": "claude",
        "label": "ZAI",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "<zai-api-key>",
          "ANTHROPIC_BASE_URL": "https://api.z.ai/api/anthropic",
          "API_TIMEOUT_MS": "3000000"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "glm-4.5-air", "label": "GLM 4.5 Air" },
          { "id": "glm-5-turbo", "label": "GLM 5 Turbo", "isDefault": true },
          { "id": "glm-5.1", "label": "GLM 5.1" }
        ]
      },

      "qwen": {
        "extends": "claude",
        "label": "Qwen (Alibaba)",
        "env": {
          "ANTHROPIC_AUTH_TOKEN": "sk-sp-<coding-plan-key>",
          "ANTHROPIC_BASE_URL": "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic"
        },
        "disallowedTools": ["WebSearch"],
        "models": [
          { "id": "qwen3.5-plus", "label": "Qwen 3.5 Plus", "isDefault": true },
          { "id": "qwen3-coder-next", "label": "Qwen 3 Coder Next" }
        ]
      },

      "gemini": {
        "extends": "acp",
        "label": "Google Gemini",
        "command": ["gemini", "--acp"]
      },

      "hermes": {
        "extends": "acp",
        "label": "Hermes",
        "command": ["hermes", "acp"]
      }
    }
  }
}
```
