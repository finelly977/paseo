import { createFileRoute } from "@tanstack/react-router";
import { SiteShell } from "~/components/site-shell";
import { pageMeta } from "~/meta";

export const Route = createFileRoute("/cloud")({
  head: () => pageMeta("自行部署 Paseo", "在自己的服务器上运行 Paseo 二开版。", "/cloud"),
  component: SelfHosting,
});

function SelfHosting() {
  return (
    <SiteShell width="default">
      <h1 className="text-3xl font-medium tracking-tight mb-6">自行部署 Paseo</h1>
      <p className="text-muted-foreground mb-6">
        二开版不提供原作者的托管云服务或候补名单。你可以在自己的服务器上运行守护进程与网页端。
      </p>
      <a href="/docs/web-ui" className="underline hover:text-foreground">
        阅读自托管指南
      </a>
    </SiteShell>
  );
}
