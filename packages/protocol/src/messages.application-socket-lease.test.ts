import { expect, test } from "vitest";
import { CLIENT_CAPS } from "./client-capabilities.js";
import { WSHelloMessageSchema } from "./messages.js";

const legacyHello = {
  type: "hello" as const,
  clientId: "client-1",
  clientType: "browser" as const,
  protocolVersion: 1,
};

test("hello accepts the application socket lease capability", () => {
  const hello = WSHelloMessageSchema.parse({
    ...legacyHello,
    capabilities: { [CLIENT_CAPS.applicationSocketLease]: true },
  });

  expect(hello.capabilities?.[CLIENT_CAPS.applicationSocketLease]).toBe(true);
});

test("hello remains compatible when the application socket lease capability is absent", () => {
  const hello = WSHelloMessageSchema.parse(legacyHello);

  expect(hello.capabilities).toBeUndefined();
});
