"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="flex h-dvh flex-col items-center justify-center gap-4">
      <p role="alert">無法載入對話，請確認歷史檔案可讀取後再試一次。</p>
      <button onClick={reset} className="rounded-md border px-4 py-2">
        重新載入
      </button>
    </main>
  );
}
