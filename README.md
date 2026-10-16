This is the [assistant-ui](https://github.com/assistant-ui/assistant-ui) minimal starter project.

## Getting Started

### 1. Configure Environment Variables

Add your OpenAI API key to a `.env.local` file:

```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OPENAI_MODEL=gpt-6-luna
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

### 3. Run the Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Development

You can start customizing the UI by modifying components in the `components/assistant-ui/elements/` directory.

To add more assistant-ui components:

```bash
npx assistant-ui add
```

### Key Files

- `app/assistant.tsx` - Sets up the runtime provider
- `app/api/chat/route.ts` - Chat API endpoint
- `components/assistant-ui/elements/thread.aui.tsx` - Chat thread component

## 歷史紀錄

首頁會導向新的 `/chat/<id>`。送出第一筆訊息後，側欄出現該對話；
點選歷史紀錄或重新整理同一 URL，Server Component 會讀取 JSON，
透過 `messageRepository` 還原訊息及 parentId。空白對話不會產生檔案。
切換 URL 以 `key={id}` 重新建立 runtime，避免混用不同對話。

## 單筆訊息傳輸

`AssistantChatTransport.prepareSendMessagesRequest` 只送出 `{ id, message, parentId, trigger }`，
沒有 `messages` 歷史陣列。後端從 `.chats/<id>.json` 重建上下文，先保存使用者訊息，
再於串流 `onEnd` 保存完整 `UIMessage` 與伺服器產生的 assistant ID。
檔案透過暫存檔與 rename 更新；資料不會加入 Git。

此為單機、單一 Node process 的文字對話範例，同一對話生成期間的其他請求會回傳 409。

## 修改

沿用 Thread 內建的鉛筆與 Update 按鈕。修改後的訊息取得新 ID，
並傳送原先的 `parentId`；後端只取該 parent 的祖先作為模型上下文，
保留原始分支。重新開啟對話時，所有分支都會經 `messageRepository` 還原。

## 重新產生與重新整理

沿用 Thread 內建的 Refresh 按鈕。AI SDK 在 regenerate 前移除待重生的回覆，
因此仍只送最後一筆 user message 與 `trigger: "regenerate-message"`。
後端確認它是已保存的訊息，從該訊息所在分支生成新的 assistant ID，原回覆仍保留。
切換分支會將選中的 `head` 記在 URL，重新整理也能還原同一分支。

串流有獨立的後端 consumer，關閉分頁或重新整理後仍會生成並保存結果；
再次載入可看到完成的內容。此範例沒有串流斷線續傳；Stop 會停止前端接收，
後端仍會完成並保存該次回覆。

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

參考：[AI SDK 訊息持久化](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)、
[assistant-ui AI SDK](https://www.assistant-ui.com/docs/api-reference/integrations/ai-sdk)。
