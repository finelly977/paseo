import { describe, expect, test } from "vitest";
import { restoreComposerDraftIfEmpty, restoreComposerTextIfEmpty } from "./composer-restore";
import { shouldRestoreComposerForRewindMode } from "./rewind-mode";

describe("restoreComposerTextIfEmpty", () => {
  test("restores the rewound message when the composer is empty", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "",
        rewoundText: "message before rewind",
      }),
    ).toBe("message before rewind");
  });

  test("preserves an existing composer draft", () => {
    expect(
      restoreComposerTextIfEmpty({
        currentText: "keep this draft",
        rewoundText: "message before rewind",
      }),
    ).toBe("keep this draft");
  });
});

describe("restoreComposerDraftIfEmpty", () => {
  test("restores the rewound text and image attachments together", () => {
    const image = {
      kind: "image" as const,
      metadata: {
        id: "rewound-image",
        mimeType: "image/png",
        storageType: "desktop-file" as const,
        storageKey: "C:\\attachments\\rewound-image.png",
        createdAt: 1,
      },
    };

    expect(
      restoreComposerDraftIfEmpty({
        currentText: "",
        currentAttachments: [],
        rewoundText: "message before rewind",
        rewoundAttachments: [image],
      }),
    ).toEqual({ text: "message before rewind", attachments: [image] });
  });
});

describe("shouldRestoreComposerForRewindMode", () => {
  test("restores only conversation-mutating rewind modes", () => {
    expect(shouldRestoreComposerForRewindMode("conversation")).toBe(true);
    expect(shouldRestoreComposerForRewindMode("files")).toBe(false);
    expect(shouldRestoreComposerForRewindMode("both")).toBe(true);
  });
});
