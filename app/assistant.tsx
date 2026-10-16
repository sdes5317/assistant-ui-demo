"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime, AssistantChatTransport } from "@assistant-ui/ai-sdk";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { useRouter } from "next/navigation";
import type { StoredChat } from "@/lib/chat-store";

export const Assistant = ({ chat }: { chat: StoredChat }) => {
  const router = useRouter();
  const runtime = useChatRuntime({
    messageRepository: { headId: chat.headId, messages: chat.messages },
    onFinish: () => router.refresh(),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    transport: new AssistantChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ messages, trigger }) => ({
        body: {
          id: chat.id,
          message: messages.at(-1),
          parentId: messages.at(-2)?.id ?? null,
          trigger,
        },
      }),
    }),
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="h-full">
        <Thread />
      </div>
    </AssistantRuntimeProvider>
  );
};
