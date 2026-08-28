import { expect, test } from "@playwright/test";

test("two isolated anonymous sessions collaborate through canonical realtime state", async ({ browser }) => {
  const engineerContext = await browser.newContext();
  const designerContext = await browser.newContext();
  const engineer = await engineerContext.newPage();
  const designer = await designerContext.newPage();

  await Promise.all([engineer.goto("/room/demo"), designer.goto("/room/demo")]);
  await expect(engineer.getByTestId("connection-status")).toHaveText("Connected");
  await expect(designer.getByTestId("connection-status")).toHaveText("Connected");

  await engineer.getByTestId("claim-demo-engineer").click();
  await expect(engineer.getByText("Your seat")).toBeVisible();
  await expect(designer.getByTestId("room-version")).toHaveText("1");

  await designer.getByTestId("claim-demo-designer").click();
  await expect(designer.getByText("Your seat")).toBeVisible();
  await expect(engineer.getByTestId("room-version")).toHaveText("2");

  await engineer.getByTestId("position-form").getByLabel("Summary").fill("Ship an accessible thin slice.");
  await engineer.getByTestId("position-form").getByLabel("Constraint").fill("No authentication rewrite in this milestone.");
  await engineer.getByTestId("position-form").getByRole("button").click();
  await expect(designer.getByTestId("constraints")).toContainText("No authentication rewrite in this milestone.");
  await expect(designer.getByTestId("room-version")).toHaveText("3");

  await engineer.getByTestId("advance-phase").click();
  await expect(designer.getByTestId("room-phase")).toHaveText("proposals");

  await engineer.getByTestId("proposal-form").getByLabel("Title").fill("Progressive onboarding hints");
  await engineer.getByTestId("proposal-form").getByLabel("Summary").fill("Add two accessible hints to the existing flow.");
  await engineer.getByTestId("proposal-form").getByLabel("Rationale").fill("Fits two-week capacity without new dependencies.");
  await engineer.getByTestId("proposal-form").getByRole("button").click();
  await expect(designer.getByTestId("proposals")).toContainText("Progressive onboarding hints");
  await expect(designer.getByTestId("room-version")).toHaveText("5");

  await designer.getByTestId("advance-phase").click();
  await expect(engineer.getByTestId("room-phase")).toHaveText("deliberation");

  await designer.getByTestId("objection-form").getByLabel("Reason").fill("The hint focus order needs an accessibility review.");
  await designer.getByTestId("objection-form").getByRole("button").click();
  await expect(engineer.getByTestId("conflicts")).toContainText("The hint focus order needs an accessibility review.");
  await expect(engineer.getByTestId("room-version")).toHaveText("7");
  await expect(engineer.getByTestId("activity")).toContainText("objection.raised · v7");

  await engineerContext.close();
  await designerContext.close();
});
