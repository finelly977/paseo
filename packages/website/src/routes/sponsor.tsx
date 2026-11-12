import { createFileRoute, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/sponsor")({
  beforeLoad: () => {
    throw notFound();
  },
});
