import { Unbuilt } from "../components/Unbuilt";
import { UNBUILT_COPY } from "../lib/copy";
import { Guard } from "../session";

export function Chats() {
  return (
    <Guard>
      <Unbuilt title="Chats" note={UNBUILT_COPY.chats} />
    </Guard>
  );
}
