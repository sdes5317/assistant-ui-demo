import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
