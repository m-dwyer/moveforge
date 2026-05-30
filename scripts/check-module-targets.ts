import { readModuleTarget } from "./lib/modules.ts";

const checks: Array<{
  componentType: string;
  coreImplSuffix: string;
  dspAuthoring: string;
  id: string;
  renderBinSuffix: string;
}> = [
  {
    componentType: "sound_generator",
    coreImplSuffix: "src/modules/westfold/dsp/westfold_core.c",
    dspAuthoring: "c",
    id: "westfold",
    renderBinSuffix: "build/render_wav_westfold"
  },
  {
    componentType: "audio_fx",
    coreImplSuffix: "src/modules/faust_drive/dsp/faust_drive_adapter.c",
    dspAuthoring: "faust",
    id: "faust_drive",
    renderBinSuffix: "build/render_fx_faust_drive"
  },
  {
    componentType: "midi_fx",
    coreImplSuffix: "src/modules/arpy/dsp/arpy_core.c",
    dspAuthoring: "c",
    id: "arpy",
    renderBinSuffix: "build/trace_midi_fx_arpy"
  }
];

for (const check of checks) {
  const target = await readModuleTarget(check.id);
  assertEqual(target.componentType, check.componentType, `${check.id} component type`);
  assertEqual(target.dspAuthoring, check.dspAuthoring, `${check.id} DSP authoring`);
  assertEqual(target.coreImpl, check.coreImplSuffix, `${check.id} core implementation`);
  assertEqual(target.renderBin, `./${check.renderBinSuffix}`, `${check.id} render binary`);
}

console.log(`Validated ${checks.length} module target resolver case(s)`);

function assertEqual(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    console.error(`${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
}
