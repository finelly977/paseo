import { expect, test } from "vitest";
import { fileReadonlyReason } from "./editing-policy";

test("本地与远端使用同一编辑规则，逐项说明只读原因", () => {
  const file = {
    web: true,
    supportsEditing: true,
    kind: "text" as const,
    size: 1024,
    writeAccess: "allowed" as const,
  };
  expect(fileReadonlyReason(file)).toBe(null);
  expect(fileReadonlyReason({ ...file, size: 1024 * 1024 })).toBe(null);
  expect(fileReadonlyReason({ ...file, size: 1024 * 1024 + 1 })).toBe("size");
  expect(fileReadonlyReason({ ...file, writeAccess: "denied" })).toBe("permission");
  expect(fileReadonlyReason({ ...file, writeAccess: undefined })).toBe(null);
  expect(fileReadonlyReason({ ...file, supportsEditing: false })).toBe("host");
  expect(fileReadonlyReason({ ...file, web: false })).toBe("platform");
  expect(fileReadonlyReason({ ...file, kind: "binary" })).toBe("type");
  expect(fileReadonlyReason({ ...file, kind: "image" })).toBe("type");
});
