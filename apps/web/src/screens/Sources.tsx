import { Unbuilt } from "../components/Unbuilt";
import { UNBUILT_COPY } from "../lib/copy";
import { Guard } from "../session";

export function Sources() {
  return (
    <Guard>
      <Unbuilt title="Sources" note={UNBUILT_COPY.sources} />
    </Guard>
  );
}
