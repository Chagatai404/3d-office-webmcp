import { expect, test } from "@playwright/test";

/**
 * Join Meeting used to cut straight to `/join` with no camera flight, and the
 * small welcome-framed 3D card was left hanging over the join form because
 * `poseForPath` fell through to the welcome pose for that route. This proves
 * the fix end to end in a real browser: Join now flies through the same
 * continuous stage as Create and lands on its own unframed interior pose,
 * with the join form usable on top of it.
 */
test("join meeting flies the camera to an unframed interior pose and leaves no framed card behind", async ({ page }) => {
  test.setTimeout(90_000);
  // Next.js dev-mode compiles each route on first request; this may be the
  // first hit to "/" and "/join" in this webServer process.
  await page.goto("/", { timeout: 60_000 });

  const stage = page.locator(".flow-stage").first();
  await expect(stage).toHaveClass(/flow-stage-framed/);

  await page.getByRole("link", { name: "Join a meeting" }).click();

  // The camera flight lands before the route settles; the frame opens out of
  // the welcome card into the full window on the way there.
  await expect(stage).not.toHaveClass(/flow-stage-framed/);
  await page.waitForURL("**/join");

  // The join form is the foreground UI, clickable above the stage -- not a
  // hanging framed card layered over it. The first field is now "paste your
  // invite link"; room ID + passcode sit behind a disclosure.
  const firstField = page.getByRole("textbox").first();
  await expect(firstField).toBeVisible();
  await firstField.fill("rm_test123");
  await expect(firstField).toHaveValue("rm_test123");
  await expect(page.locator(".flow-stage-framed")).toHaveCount(0);

  // Back navigation returns cleanly to the welcome framing, with no stale
  // join flight state left armed.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(stage).toHaveClass(/flow-stage-framed/);
  await expect(page.locator("main.welcome[data-leaving]")).toHaveCount(0);
});
