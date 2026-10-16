import { openai } from "@ai-sdk/openai";
import { createChatHandler } from "@/lib/chat-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = createChatHandler(openai(process.env.OPENAI_MODEL ?? "gpt-6-luna"));
