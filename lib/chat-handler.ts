import {
  consumeStream,
  convertToModelMessages,
  generateId,
  safeValidateUIMessages,
  streamText,
  type LanguageModel,
} from "ai";
import { branchMessages, emptyChat, isValidId, loadChat, saveBranch } from "./chat-store.ts";

// ponytail: one local Node process; use a database lock for multiple servers.
const running = new Set<string>();

export function createChatHandler(model: LanguageModel) {
  return async (req: Request): Promise<Response> => {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (
      !body ||
      typeof body !== "object" ||
      !isValidId(body.id) ||
      "messages" in body ||
      body.trigger !== "submit-message" ||
      !isValidId(body.message?.id) ||
      body.message?.role !== "user"
    ) {
      return Response.json({ error: "Expected one user message" }, { status: 400 });
    }
    const validated = await safeValidateUIMessages({ messages: [body.message] });
    if (!validated.success) {
      return Response.json({ error: "Invalid message" }, { status: 400 });
    }
    const message = validated.data[0]!;
    if (
      !message.parts.length ||
      message.parts.some((part) => part.type !== "text") ||
      !message.parts.some((part) => part.type === "text" && part.text.trim())
    ) {
      return Response.json({ error: "Expected non-empty text" }, { status: 400 });
    }
    const id: string = body.id;
    if (running.has(id)) {
      return Response.json({ error: "This chat is still generating" }, { status: 409 });
    }
    running.add(id);
    try {
      const chat = (await loadChat(id)) ?? emptyChat(id);
      const history = branchMessages(chat);
      // Repeated delivery of a user message must not duplicate it.
      const existing = history.findIndex((item) => item.id === message.id);
      const messages = [...(existing < 0 ? history : history.slice(0, existing)), message];
      await saveBranch(chat, messages);
      const result = streamText({
        model,
        messages: await convertToModelMessages(messages),
      });
      return result.toUIMessageStreamResponse({
        originalMessages: messages,
        generateMessageId: generateId,
        consumeSseStream: ({ stream }) => consumeStream({ stream }),
        onEnd: async ({ messages }) => {
          try {
            await saveBranch(chat, messages);
          } finally {
            running.delete(id);
          }
        },
        onError: (error) => {
          console.error("Chat generation failed", error);
          return "回覆失敗，請稍後重試。";
        },
      });
    } catch (error) {
      running.delete(id);
      console.error("Chat request failed", error);
      return Response.json({ error: "Unable to process chat" }, { status: 500 });
    }
  };
}
