import ChatWindow from "@/components/chat/chat-window";

export default function Home() {
  return (
    <main className="flex h-full min-h-screen w-full items-center justify-center bg-[var(--color-bg)] px-4 py-8">
      <div className="h-[min(760px,92vh)] w-full max-w-[980px]">
        <ChatWindow />
      </div>
    </main>
  );
}
