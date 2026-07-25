import type { Metadata } from "next";

import { NewChatRedirect } from "./new-chat-redirect";

export const metadata: Metadata = {
  title: "Chat",
};

export default function ChatPage() {
  return <NewChatRedirect />;
}
