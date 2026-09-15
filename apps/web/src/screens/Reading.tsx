import { Unbuilt } from "../components/Unbuilt";
import { UNBUILT_COPY } from "../lib/copy";
import { Guard } from "../session";

export function Reading() {
  return (
    <Guard>
      <Unbuilt title="Reading" note={UNBUILT_COPY.reading} />
    </Guard>
  );
}
