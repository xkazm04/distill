// "Your agent is the AI" end to end: a scripted agent (the MCP SDK's client on Handrail's own MCP server and host)
// drives the real side panel and the real tab. The e2e build's service worker plays the helper program's native side,
// so no native host is needed on the machine and the tests stay hermetic.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright/test";
import { expect, OUT, test } from "./harness";

test.use({ grantHelper: true });

const ARTICLE_TITLE = "City council approves new bus routes after months of debate";

interface Task { taskId: string; task: string; prompt: string; schema: unknown; pageToken: string }
interface Block { id: string; kind: string; text: string }

/** A screenshot of a moment in the middle of a scenario, beside the harness's end-of-scenario ones in e2e/out. */
async function moment(panel: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await panel.screenshot({ path: join(OUT, `moment-${name}.png`), animations: "disabled" });
}

/** Choose a view in the panel's strip of views. */
async function pick(panel: Page, name: RegExp) {
  await panel.locator(".workspace").waitFor();
  await panel.getByTestId("view-strip").getByRole("button", { name }).click();
}

/** The person opens the menu and chooses who does the AI work. */
async function chooseMyAgent(panel: Page) {
  await panel.getByRole("button", { name: "Menu" }).click();
  await expect(panel.getByTestId("ai-provider")).toContainText("Who does the AI work");
  await panel.getByTestId("ai-provider-agent").check();
  await panel.keyboard.press("Escape");
}

test("agent is the AI: the agent simplifies the page, the panel shows Made by your agent", async ({ distill }) => {
  const agent = await distill.startAgent();
  const tab = await distill.openTab("article");
  const panel = await distill.openPanel(tab.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(ARTICLE_TITLE);
  await expect(panel.getByRole("tab", { name: /^Agent/, includeHidden: true })).toContainText("Connected");

  // The agent reads the page first: the PageModel plus its pageToken.
  const page = await agent.call<{ title: string; blocks: Block[]; pageToken: string }>("distill_read");
  expect(page.title).toBe(ARTICLE_TITLE);
  expect(page.pageToken).toMatch(/^[0-9a-f]{64}$/);

  await chooseMyAgent(panel);
  await expect(panel.getByTestId("agent-task-waiting")).toContainText("Waiting for your agent...");
  await expect(panel.getByTestId("agent-task-waiting").getByRole("button", { name: "Use Distill's AI instead" })).toBeVisible();
  await panel.evaluate(() => window.scrollTo(0, 0));
  await moment(panel, "waiting-for-your-agent");

  const { tasks } = await agent.call<{ tasks: Task[] }>("distill_tasks", { waitSeconds: 10 });
  expect(tasks).toHaveLength(1);
  const task = tasks[0] as Task;
  expect(task.task).toBe("simplifyBlocks");
  expect(task.pageToken).toBe(page.pageToken);
  expect(task.prompt).toContain("The city council voted 9 to 4");

  // A first answer naming no block of the page is refused with reasons; the agent answers again.
  const wrong = await agent.call<{ accepted: boolean; errors: string[] }>("distill_answer", { taskId: task.taskId, json: { blocks: [{ id: "b999", text: "x" }] } });
  expect(wrong.accepted).toBe(false);
  expect(wrong.errors[0]).toMatch(/b999/);

  const para = page.blocks.find((b) => b.text.startsWith("The city council voted 9 to 4")) as Block;
  const simpler = "The council said yes to the new bus routes: 9 votes for, 4 against.";
  const ok = await agent.call<{ accepted: boolean; dropped: number }>("distill_answer", { taskId: task.taskId, json: JSON.stringify({ blocks: [{ id: para.id, text: simpler }] }) });
  expect(ok).toEqual({ accepted: true, dropped: 0, errors: [] });

  await expect(panel.locator("article.reading")).toContainText(simpler);
  await expect(panel.getByTestId("source-chip")).toContainText("Made by your agent");
  await expect(panel.getByTestId("agent-task-waiting")).toHaveCount(0);
  await panel.evaluate(() => window.scrollTo(0, 0));
  await moment(panel, "made-by-your-agent");

  await pick(panel, /^Agent/);
  const trail = panel.getByTestId("agent-trail");
  await expect(trail).toContainText("Your agent read this page");
  await expect(trail).toContainText("Your agent took the task: make this page easier to read");
  await expect(trail).toContainText("Your agent made this page easier to read - 1 block, 0 dropped");
});

test("agent is the AI: an answer for a page that changed is refused", async ({ distill }) => {
  const agent = await distill.startAgent();
  const tab = await distill.openTab("article");
  const panel = await distill.openPanel(tab.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText(ARTICLE_TITLE);
  await chooseMyAgent(panel);
  const { tasks } = await agent.call<{ tasks: Task[] }>("distill_tasks", { waitSeconds: 10 });
  const task = tasks[0] as Task;
  // The page changes in place before the agent answers.
  await tab.page.evaluate(() => { document.querySelector("main p")?.append(" (updated)"); });
  await expect(agent.call("distill_answer", { taskId: task.taskId, json: { blocks: [{ id: "b0", text: "x" }] } })).rejects.toThrow(/^stale_page: /);
});

test("page actions: the agent asks to click, the person accepts, the tab is clicked", async ({ distill }) => {
  const agent = await distill.startAgent();
  const tab = await distill.openTab("blank");
  await tab.page.evaluate(() => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = "Next page";
    b.addEventListener("click", () => { document.body.dataset.clicked = "yes"; });
    document.body.append(b);
    const f = document.createElement("form");
    f.innerHTML = '<label for="q">Name</label><input id="q" name="q"><button>Send the form</button>';
    f.addEventListener("submit", (e) => { e.preventDefault(); document.body.dataset.sent = "yes"; });
    document.body.append(f);
  });
  const panel = await distill.openPanel(tab.id);
  await expect(panel.getByRole("heading", { level: 1 })).toHaveText("Blank");
  await tab.page.locator("#q").fill("TYPED-BY-PERSON");

  const listed = await agent.call<{ pageToken: string; actions: Array<{ actionId: string; label: string; kind: string }> }>("page_actions");
  expect(listed.actions.map((a) => `${a.label}:${a.kind}`)).toEqual(["Next page:button", "Send the form:submit"]);
  expect(JSON.stringify(listed)).not.toContain("TYPED-BY-PERSON");
  const next = listed.actions[0] as { actionId: string };
  const send = listed.actions[1] as { actionId: string };

  // Reject: the submit card warns that it sends the form, and nothing is sent.
  const rejected = agent.call<{ verdict: string }>("page_action_propose", { actionId: send.actionId, rationale: "The form looks complete.", pageToken: listed.pageToken, waitSeconds: 20 });
  await pick(panel, /^Agent/);
  const card = panel.getByTestId("action-proposal");
  await expect(card).toContainText('Your agent wants to click "Send the form"');
  await expect(card.getByTestId("action-submit")).toHaveText("This sends the form.");
  await moment(panel, "your-agent-wants-to-click");
  await card.getByRole("button", { name: "Reject" }).click();
  expect((await rejected).verdict).toBe("rejected");
  expect(await tab.page.evaluate(() => document.body.dataset.sent ?? "no")).toBe("no");

  // Accept: the tab's button is clicked.
  const accepted = agent.call<{ verdict: string }>("page_action_propose", { actionId: next.actionId, rationale: "Go on to the next page.", pageToken: listed.pageToken, waitSeconds: 20 });
  await expect(panel.getByTestId("action-proposal")).toContainText('Your agent wants to click "Next page"');
  await panel.getByTestId("action-proposal").getByRole("button", { name: "Accept" }).click();
  expect((await accepted).verdict).toBe("accepted");
  await expect.poll(() => tab.page.evaluate(() => document.body.dataset.clicked ?? "no")).toBe("yes");
  await expect(panel.getByTestId("agent-trail")).toContainText('Your agent wants to click "Next page"');

  // A stale pageToken is refused.
  await expect(agent.call("page_action_propose", { actionId: next.actionId, rationale: "Again", pageToken: "0".repeat(64) })).rejects.toThrow(/^stale_page: /);
});
