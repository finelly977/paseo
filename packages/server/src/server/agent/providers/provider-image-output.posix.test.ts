import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { materializeProviderImage } from "./provider-image-output.js";

describe.skipIf(process.platform === "win32")("materializeProviderImage", () => {
  const originalPaseoHome = process.env.PASEO_HOME;
  let testHome: string | null = null;

  beforeEach(() => {
    testHome = mkdtempSync(path.join(os.tmpdir(), "paseo-provider-image-posix-"));
    process.env.PASEO_HOME = testHome;
  });

  afterEach(() => {
    if (originalPaseoHome === undefined) {
      delete process.env.PASEO_HOME;
    } else {
      process.env.PASEO_HOME = originalPaseoHome;
    }
    if (testHome) {
      rmSync(testHome, { recursive: true, force: true });
      testHome = null;
    }
  });

  test("writes image attachments under a private persistent directory", () => {
    const materialized = materializeProviderImage({
      data: "YWJjMTIz",
      mimeType: "image/png",
    });
    const attachmentDir = path.dirname(materialized.path);

    try {
      expect(attachmentDir).toBe(path.join(testHome!, "paseo-attachments"));
      expect(existsSync(materialized.path)).toBe(true);
      expect(statSync(attachmentDir).mode & 0o777).toBe(0o700);
      expect(statSync(materialized.path).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(attachmentDir, { recursive: true, force: true });
    }
  });
});
