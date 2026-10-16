import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream, type UIMessage } from "ai";
import { createChatHandler } from "../lib/chat-handler.ts";
import { branchMessages, listChats, loadChat } from "../lib/chat-store.ts";

await mkdir(".chats", { recursive: true });
const directory = await mkdtemp(path.resolve(".chats/test-"));
process.env.CHAT_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));

const model = new MockLanguageModelV4({
  doStream: async (options) => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "text-start", id: "text" },
        { type: "text-delta", id: "text", delta: `context:${options.prompt.length}` },
        { type: "text-end", id: "text" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ],
      initialDelayInMs: null,
      chunkDelayInMs: null,
    }),
  }),
});
const handle = createChatHandler(model);
const user = (id: string, text: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});
async function send(body: object) {
  const response = await handle(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return { response, text };
}

test("one-message requests rebuild context and persist stable response IDs", async () => {
  const id = "latest-only";
  const first = await send({
    id,
    parentId: null,
    trigger: "submit-message",
    message: user("u1", "first"),
  });
  assert.equal(first.response.status, 200);
  assert.match(first.text, /context:1/);
  const chat = await loadChat(id);
  assert.ok(chat);
  const firstMessages = branchMessages(chat);
  assert.equal(firstMessages.length, 2);
  assert.match(first.text, new RegExp(firstMessages[1]!.id));

  const second = await send({
    id,
    parentId: firstMessages[1]!.id,
    trigger: "submit-message",
    message: user("u2", "second"),
  });
  assert.equal(second.response.status, 200);
  assert.match(second.text, /context:3/);
  const saved = JSON.parse(await readFile(path.join(directory, `${id}.json`), "utf8"));
  assert.equal(branchMessages(saved).length, 4);
  assert.equal(saved.messages[1].parentId, "u1");
});

test("rejects full-history payloads, path traversal and invalid messages", async () => {
  for (const body of [
    { id: "../escape", trigger: "submit-message", message: user("u1", "hello") },
    { id: "invalid", trigger: "submit-message", messages: [], message: user("u1", "hello") },
    { id: "invalid", trigger: "submit-message", message: user("u1", " ") },
    { id: "invalid", trigger: "submit-message", message: { id: "u1", role: "system", parts: [] } },
  ]) {
    assert.equal((await send(body)).response.status, 400);
  }
  assert.equal(await loadChat("invalid"), null);
});

test("editing an earlier message uses its parent and preserves both branches", async () => {
  const id = "edit";
  await send({
    id,
    parentId: null,
    trigger: "submit-message",
    message: user("old-user", "original"),
  });
  const original = branchMessages((await loadChat(id))!);
  await send({
    id,
    parentId: original[1]!.id,
    trigger: "submit-message",
    message: user("later-user", "later"),
  });

  const edited = await send({
    id,
    parentId: null,
    trigger: "submit-message",
    message: user("edited-user", "changed"),
  });
  assert.equal(edited.response.status, 200);
  assert.match(edited.text, /context:1/);
  const chat = (await loadChat(id))!;
  assert.equal(chat.messages.length, 6);
  assert.equal(branchMessages(chat)[0]!.id, "edited-user");
  assert.equal(branchMessages(chat, original[1]!.id)[0]!.id, "old-user");

  const continued = await send({
    id,
    parentId: original[1]!.id,
    trigger: "submit-message",
    message: user("old-branch-user", "continue old branch"),
  });
  assert.equal(continued.response.status, 200);
  assert.match(continued.text, /context:3/);
  assert.deepEqual(
    branchMessages((await loadChat(id))!)
      .map((message) => message.id)
      .slice(0, 3),
    ["old-user", original[1]!.id, "old-branch-user"],
  );

  for (const body of [
    {
      id,
      parentId: "unknown",
      trigger: "submit-message",
      message: user("u-new", "invalid parent"),
    },
    { id, parentId: null, trigger: "submit-message", message: user("old-user", "overwrite") },
    {
      id,
      parentId: null,
      trigger: "submit-message",
      message: user(original[1]!.id, "overwrite assistant"),
    },
  ])
    assert.equal((await send(body)).response.status, 409);
});

test("history survives reloading the store and lists conversation titles", async () => {
  const reloaded = await loadChat("latest-only");
  assert.ok(reloaded);
  assert.deepEqual(
    branchMessages(reloaded).map((message) => message.role),
    ["user", "assistant", "user", "assistant"],
  );
  const chats = await listChats();
  assert.deepEqual(
    chats.map((chat) => ({ id: chat.id, title: chat.title })),
    [
      { id: "edit", title: "original" },
      { id: "latest-only", title: "first" },
    ],
  );
});

test("regeneration uses only its user message and preserves old replies", async () => {
  const id = "regenerate";
  const message = user("regen-user", "question");
  await send({ id, parentId: null, trigger: "submit-message", message });
  const oldReply = branchMessages((await loadChat(id))!)[1]!;
  const result = await send({ id, parentId: null, trigger: "regenerate-message", message });
  assert.equal(result.response.status, 200);
  assert.match(result.text, /context:1/);
  const saved = (await loadChat(id))!;
  assert.equal(saved.messages.length, 3);
  assert.equal(saved.messages.filter((item) => item.message.role === "user").length, 1);
  const visible = branchMessages(saved);
  assert.equal(visible.length, 2);
  assert.notEqual(visible[1]!.id, oldReply.id);
  assert.equal(branchMessages(saved, oldReply.id)[1]!.id, oldReply.id);

  await send({
    id,
    parentId: visible[1]!.id,
    trigger: "submit-message",
    message: user("regen-later", "later"),
  });
  const earlier = await send({ id, parentId: null, trigger: "regenerate-message", message });
  assert.match(earlier.text, /context:1/);
  assert.equal(branchMessages((await loadChat(id))!).length, 2);
  assert.equal(
    (
      await send({
        id,
        parentId: null,
        trigger: "regenerate-message",
        message: user("unknown-user", "missing"),
      })
    ).response.status,
    409,
  );
});

test("generation saves after the response consumer disconnects", async () => {
  const response = await handle(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify({
        id: "disconnect",
        parentId: null,
        trigger: "submit-message",
        message: user("disconnect-user", "hello"),
      }),
    }),
  );
  await response.body!.cancel();
  for (let attempt = 0; attempt < 100; attempt++) {
    const chat = await loadChat("disconnect");
    if (chat && branchMessages(chat).length === 2) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Assistant response was not persisted after disconnect");
});

test("overlapping requests return 409 and release the chat after completion", async () => {
  let unblock!: () => void;
  const ready = new Promise<void>((resolve) => {
    unblock = resolve;
  });
  const slow = createChatHandler(
    new MockLanguageModelV4({
      doStream: async (options) => {
        await ready;
        return model.doStream(options);
      },
    }),
  );
  const body = {
    id: "overlap",
    parentId: null,
    trigger: "submit-message",
    message: user("overlap-user", "hello"),
  };
  const first = await slow(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  try {
    assert.equal((await send(body)).response.status, 409);
  } finally {
    unblock();
  }
  await first.text();
  assert.equal((await send({ ...body, trigger: "regenerate-message" })).response.status, 200);
});

test("model failure keeps the user message and allows retry", async (context) => {
  context.mock.method(console, "error", () => {});
  const failing = createChatHandler(
    new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("Simulated provider failure");
      },
    }),
  );
  const body = {
    id: "failure",
    parentId: null,
    trigger: "submit-message",
    message: user("failed-user", "hello"),
  };
  const response = await failing(
    new Request("http://localhost/api/chat", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
  assert.match(await response.text(), /回覆失敗/);
  assert.equal(branchMessages((await loadChat("failure"))!)[0]!.id, "failed-user");
  assert.equal((await send(body)).response.status, 200);
});

test("corrupt history fails without overwriting the original file", async (context) => {
  context.mock.method(console, "error", () => {});
  const file = path.join(directory, "corrupt.json");
  await writeFile(file, "broken history", "utf8");
  const result = await send({
    id: "corrupt",
    parentId: null,
    trigger: "submit-message",
    message: user("corrupt-user", "hello"),
  });
  assert.equal(result.response.status, 500);
  assert.equal(await readFile(file, "utf8"), "broken history");
});
