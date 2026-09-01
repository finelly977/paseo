import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./fixtures";
import { gotoAppShell } from "./helpers/app";
import { createIdleAgent } from "./helpers/archive-tab";
import { openCommandCenter } from "./helpers/command-center";
import { addOfflineHostAndReload } from "./helpers/hosts";
import { expectAgentTabActive } from "./helpers/launcher";
import { seedWorkspace } from "./helpers/seed-client";
import { getServerId } from "./helpers/server-id";

const PRIMARY_HOST_LABEL = "Primary Host";
const SECONDARY_HOST_ID = "host-command-center-secondary";

test.describe("Command center host labels", () => {
  test.describe.configure({ timeout: 180_000 });

  test("agent results show their host and open the selected workspace tab", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "command-center-host-" });
    const title = `cc-host-${randomUUID().slice(0, 8)}`;

    try {
      const agent = await createIdleAgent(seeded.client, {
        cwd: seeded.repoPath,
        workspaceId: seeded.workspaceId,
        title,
      });

      await gotoAppShell(page);
      await addOfflineHostAndReload(page, {
        serverId: SECONDARY_HOST_ID,
        label: "Secondary Host",
        primaryLabel: PRIMARY_HOST_LABEL,
      });

      const panel = await openCommandCenter(page);
      await panel.getByTestId("command-center-input").fill(title);
      const row = panel.getByTestId(`command-center-agent-${getServerId()}:${agent.id}`);
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toContainText(title);
      await expect(row).toContainText(PRIMARY_HOST_LABEL);

      await page.keyboard.press("Enter");
      await expectAgentTabActive(page, agent.id);
    } finally {
      await seeded.cleanup();
    }
  });
});
