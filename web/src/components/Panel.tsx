import { useStore, selectSelectedSlot } from "@/store";
import { Chain } from "./Chain";
import { Controls } from "./Controls";
import { ParamSnapshots } from "./ParamSnapshots";
import { Presets } from "./Presets";
import { TrackBar } from "./TrackBar";

export type PanelSection = "track" | "chain" | "presets" | "snapshots" | "controls";

const ALL_SECTIONS: PanelSection[] = ["track", "chain", "presets", "snapshots", "controls"];

export function Panel({ sections = ALL_SECTIONS }: { sections?: PanelSection[] }) {
  const slot = useStore(selectSelectedSlot);
  const has = (s: PanelSection) => sections.includes(s);
  return (
    <>
      {has("track") && <TrackBar />}
      {has("chain") && <Chain />}
      {has("presets") && slot.kind !== "settings" && <Presets />}
      {has("snapshots") && <ParamSnapshots />}
      {has("controls") && <Controls />}
    </>
  );
}
