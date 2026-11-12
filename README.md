# Paseo 独立二开版

本仓库是 **[finelly977/paseo](https://github.com/finelly977/paseo)**，独立维护桌面、网页、服务端和 Android 构建。反馈、下载与更新均以本仓库为准。

- [下载二开版本](https://github.com/finelly977/paseo/releases)
- [问题反馈](https://github.com/finelly977/paseo/issues)
- [使用文档](public-docs/index.md)
- [二开功能清单](docs/fork-features.md)
- [开发指南](docs/development.md)

## 功能

Paseo 连接你自己的开发环境，管理 Claude Code、Codex、OpenCode、Pi 等编程智能体。支持工作区、对话历史、文件编辑、Git 面板、终端、计划任务和插件。

本二开版提供原生会话同步与分页、独立插件中心、多主机工作区及桌面显示优化等能力。当前有效行为与适用边界见[二开功能清单](docs/fork-features.md)。

## 安装与连接

桌面端和 Android APK 从[本仓库 Releases](https://github.com/finelly977/paseo/releases)下载。不使用原作者的应用商店、Homebrew 或 npm 包作为二开版安装来源。

网页端可以由自己的守护进程直接提供，见[自托管网页端](public-docs/web-ui.md)。反向代理到域名后，客户端直连该域名及对外端口；配对和中继配置见[配置文档](public-docs/configuration.md)。

Docker 使用本仓库源码构建或本仓库工作流发布的镜像，见[Docker 指南](docs/docker.md)。

## 本地开发

在仓库根目录使用 PowerShell：

```powershell
git clone https://github.com/finelly977/paseo.git
Set-Location -LiteralPath '.\paseo'
npm ci
npm run build:server
npm run dev
```

另开终端，在仓库根目录启动网页客户端：

```powershell
npm run dev:app
```

开发环境使用仓库内的独立数据目录，不要重启正在管理会话的生产守护进程。桌面构建、测试和发布说明见 [CLAUDE.md](CLAUDE.md) 与 [docs/](docs/)。

## 许可证与来源

代码采用 [Apache License 2.0](LICENSE)。原项目来源与版权说明保留在 [NOTICE](NOTICE)，历史发布记录和第三方许可证不作删除。
