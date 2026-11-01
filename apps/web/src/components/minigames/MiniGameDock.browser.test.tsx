import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { MiniGameDock } from "./MiniGameDock";
import { openMiniGameDock } from "./miniGameDockStore";

it("pauses when the agent finishes and offers the way back to chat", async () => {
  const onBackToChat = vi.fn();
  openMiniGameDock("thread-key");
  await using screen = await render(
    <MiniGameDock isWorking latestRun={null} onBackToChat={onBackToChat} />,
  );
  await expect.element(screen.getByLabelText(/^Claude Run\./)).toHaveFocus();
  await expect.element(screen.getByRole("button", { name: "Pause" })).toBeVisible();

  await screen.rerender(
    <MiniGameDock
      isWorking={false}
      latestRun={{ startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:04:12.000Z" }}
      onBackToChat={onBackToChat}
    />,
  );
  await expect.element(screen.getByText("Your agent has finished")).toBeVisible();
  await expect.element(screen.getByText("Worked for 4m 12s")).toBeVisible();

  await screen.getByRole("status").getByRole("button", { name: "Back to chat" }).click();
  await vi.waitFor(() => expect(onBackToChat).toHaveBeenCalledOnce());
});
