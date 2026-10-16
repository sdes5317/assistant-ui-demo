import Link from "next/link";
import { notFound } from "next/navigation";
import { Assistant } from "@/app/assistant";
import { emptyChat, isValidId, listChats, loadChat } from "@/lib/chat-store";

export const dynamic = "force-dynamic";

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const [stored, chats] = await Promise.all([loadChat(id), listChats()]);
  const chat = stored ?? emptyChat(id);

  return (
    <div className="flex h-dvh flex-col sm:flex-row">
      <aside className="bg-muted/30 flex max-h-40 flex-col border-b p-3 sm:max-h-none sm:w-60 sm:shrink-0 sm:border-r sm:border-b-0">
        <Link
          href="/"
          prefetch={false}
          className="bg-primary text-primary-foreground rounded-md px-3 py-2 text-center text-sm"
        >
          ＋ 新對話
        </Link>
        <h1 className="text-muted-foreground px-2 pt-4 pb-2 text-xs">歷史紀錄</h1>
        <nav aria-label="歷史紀錄" className="min-h-0 overflow-y-auto">
          {chats.length === 0 && <p className="text-muted-foreground px-2 text-sm">尚無對話</p>}
          {chats.map((item) => (
            <Link
              key={item.id}
              href={`/chat/${item.id}`}
              prefetch={false}
              aria-current={item.id === id ? "page" : undefined}
              className="hover:bg-accent aria-[current=page]:bg-accent block truncate rounded-md px-3 py-2 text-sm"
            >
              {item.title}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="min-h-0 min-w-0 flex-1">
        <Assistant key={id} chat={chat} />
      </main>
    </div>
  );
}
