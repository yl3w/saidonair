import { Unbuilt } from "../components/Unbuilt";
import { UNBUILT_COPY } from "../lib/copy";
import { Guard } from "../session";

export function Source() {
  return (
    <Guard>
      <Unbuilt title="Source" note={UNBUILT_COPY.source} />
    </Guard>
  );
}
