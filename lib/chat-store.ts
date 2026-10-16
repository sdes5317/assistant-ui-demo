import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { UIMessage } from "ai";

export type StoredChat = {
  id: string;
  updatedAt: string;
  headId: string | null;
  messages: { message: UIMessage; parentId: string | null }[];
};

export const isValidId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);

export const chatDirectory = () => path.resolve(process.env.CHAT_DATA_DIR ?? ".chats");

function chatFile(id: string) {
  if (!isValidId(id)) throw new Error("Invalid chat ID");
  return path.join(chatDirectory(), `${id}.json`);
}

export async function loadChat(id: string): Promise<StoredChat | null> {
  try {
    return JSON.parse(await readFile(chatFile(id), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function emptyChat(id: string): StoredChat {
  return { id, updatedAt: new Date().toISOString(), headId: null, messages: [] };
}

export async function listChats() {
  await mkdir(chatDirectory(), { recursive: true });
  const files = await readdir(chatDirectory(), { withFileTypes: true });
  const chats = await Promise.all(
    files
      .filter((file) => file.isFile() && file.name.endsWith(".json"))
      .map((file) => loadChat(file.name.slice(0, -5))),
  );
  return chats
    .filter((chat): chat is StoredChat => chat !== null)
    .map((chat) => ({
      id: chat.id,
      title:
        branchMessages(chat)
          .find((message) => message.role === "user")
          ?.parts.filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
          .slice(0, 60) || "新對話",
      updatedAt: chat.updatedAt,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function branchMessages(chat: StoredChat, headId = chat.headId): UIMessage[] {
  const byId = new Map(chat.messages.map((item) => [item.message.id, item]));
  const messages: UIMessage[] = [];
  const seen = new Set<string>();
  while (headId !== null) {
    const item = byId.get(headId);
    if (!item || seen.has(headId)) throw new Error("Invalid message parent");
    seen.add(headId);
    messages.push(item.message);
    headId = item.parentId;
  }
  return messages.reverse();
}

export function saveBranch(chat: StoredChat, messages: UIMessage[]) {
  let parentId: string | null = null;
  for (const message of messages) {
    const existing = chat.messages.find((item) => item.message.id === message.id);
    if (existing) existing.message = message;
    else chat.messages.push({ message, parentId });
    parentId = message.id;
  }
  chat.headId = parentId;
  chat.updatedAt = new Date().toISOString();
  return saveChat(chat);
}

export async function saveChat(chat: StoredChat) {
  const file = chatFile(chat.id);
  await mkdir(chatDirectory(), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(chat, null, 2), "utf8");
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
