import { createFileRoute } from "@tanstack/react-router";

import { UsagePage } from "../components/usage/UsagePage";

export const Route = createFileRoute("/_chat/usage")({
  validateSearch: (raw: Record<string, unknown>): { readonly section?: "plan" } =>
    raw.section === "plan" ? { section: "plan" } : {},
  component: UsagePage,
});
