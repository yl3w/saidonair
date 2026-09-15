import { Unbuilt } from "../components/Unbuilt";
import { UNBUILT_COPY } from "../lib/copy";
import { Guard } from "../session";

export function History() {
  return (
    <Guard>
      <Unbuilt title="History" note={UNBUILT_COPY.history} />
    </Guard>
  );
}
