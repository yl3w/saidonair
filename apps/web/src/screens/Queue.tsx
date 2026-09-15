import { Unbuilt } from "../components/Unbuilt";
import { UNBUILT_COPY } from "../lib/copy";
import { Guard } from "../session";

export function Queue() {
  return (
    <Guard>
      <Unbuilt title="Queue" note={UNBUILT_COPY.queue} />
    </Guard>
  );
}
