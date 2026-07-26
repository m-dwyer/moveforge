# Hardening the DSP pipeline — working plan

Status: **in progress on branch `harden-dsp-pipeline`.** This is the working
document for that branch, not a retrospective. Check items off as they land.

Every finding below was verified against the code at branch point (`fe81dc5`).
Line references are to that commit. Upstream Schwung references are to
`/Users/em/src/move-spike/overture/schwung` (schwung 0.11.4) and are marked `SW/`.

---

## Why this branch exists

moveforge's **authoring** side is strong: `module.json` as single source of
truth, four generators, working scaffolds, a transparent plain-C/Faust switch,
and the same wrapper compiled for device, host and browser.

Its **verification** side has not kept pace. Concretely:

1. **Nothing gates anything.** `.github/workflows/deploy-pages.yml` is the only
   workflow; it triggers on `push` only and runs `pnpm install` →
   `build-wasm.sh` → `build:web` → deploy. No `validate`, no C tests, no
   `check-renders`, no cross-compile. `.git/hooks/` is empty.
   `scripts/install-to-move.sh` runs no checks at all.
   `README.md:78`, `README.md:249` and `skills/schwung-dsp-development/SKILL.md:165`
   all describe a CI gate that does not exist.
2. **The audio-quality signal is weaker than the failures it is meant to catch.**
   Seven scalar metrics per file, compared only against a previously-blessed
   copy of themselves, with absolute-first tolerances that are frequently wider
   than the quantity being measured.
3. **The local model diverges from the device in behaviours that live in no
   header** — the idle gate, the audio-thread parameter smoother, and the CPU
   watchdog. None of them are visible to any local check.

Underneath all three: there is no shared DSP layer, so every module re-derives
its own primitives, and the Schwung wrappers are ~95% copy-paste.

### The case that proves it

`dustline`'s Chamberlin SVF caps `q` against the wrong stability condition.
`src/modules/dustline/dsp/dustline_core.c:96-97` enforces `fq < 2` via
`q_max = 1.8f / (f + 1e-6f)`. The binding Jury condition for this topology is
`f² + 2fq < 4`. Compiling the exact code and sweeping the shipped presets:

```
Init           cutoff=0.48 res=0.16  f=0.404 q=0.958  f²+2fq=0.937  stable
Dust Bass      cutoff=0.24 res=0.08  f=0.096 q=0.654  f²+2fq=0.135  stable
Air Noise      cutoff=0.70 res=0.56  f=0.888 q=2.027  f²+2fq=4.388  DIVERGES -> NaN
Pin Lead       cutoff=0.86 res=0.30  f=0.950 q=1.490  f²+2fq=3.734  stable
Glass Keys     cutoff=0.62 res=0.64  f=0.692 q=2.600  f²+2fq=4.079  DIVERGES -> NaN
Filter Sweep   cutoff=0.36 res=0.86  f=0.220 q=3.618  f²+2fq=1.642  stable
```

The two divergent presets are exactly the two whose blessed goldens are silent
(`goldens/dustline/metrics.json`):

```
02-air-noise.wav   peak=0.01611 rms=0.00029 silence_ratio=0.9991
04-glass-keys.wav  peak=0.40930 rms=0.02789 silence_ratio=0.9933
```

NaN casts to 0 through `moveforge_float_to_i16` (`src/modules/_shared/dsp_runtime.h:26-32` —
both clamp comparisons are false for NaN), so a filter explosion renders as
digital silence. **The goldens are the blowup.**

Git history closes the loop: `39bb936` found and fixed this ("these presets had
been quietly broken since they were first blessed"), then `28fe216` — commit
body: one line, "Fix module stress failures" — re-blessed `02-air-noise` from
`rms 0.05947` back down to `0.00029`, a 46 dB collapse.

Each gate that missed it is separately fixable, and that is the shape of this plan:

- `check-renders` compares only to the golden, and checks `abs` first
  (`scripts/check-renders.ts:245-250`). Golden `rms` is 0.00029 against an `abs`
  tolerance of 0.01 — the metric is a no-op across the entire range from digital
  silence to +7 dB.
- `tests/test_dustline_core.c:37` sweeps cutoff only at the default resonance
  0.18, which is stable.
- Nothing anywhere checks for NaN/Inf, and nothing has an absolute
  "must not be silent" floor.
- `bless-renders` is one unconditional `writeFile` + `copyFile`
  (`scripts/check-renders.ts:64-72`): no diff printed, no confirmation, and it
  blesses whatever WAVs are on disk without re-rendering.

The same class of hole exists elsewhere. **Trail's entire wet path can be
deleted and 2 of 6 presets still pass all seven metrics** — every Trail preset
renders an impulse, so golden `rms` (0.004-0.006) sits below its own 0.01
tolerance, and the 8-sample dry impulse accounts for ~97% of measured energy.
Collapsing Trail to mono moves `stereo_correlation` 0.953 → 1.0, inside the
0.05 band, on every preset.

---

## Phase 1 — Fix the live bug, and make it un-writable later

Do this first: it is the actual defect, and it becomes the regression test for
everything below.

- [x] **1.1 Fix the SVF stability cap.** Replaced the Chamberlin form with a
      TPT/ZDF SVF in the new `src/modules/_shared/mf_dsp.h` (`mf_svf_t`),
      unconditionally stable for every `g > 0`, `k > 0`, so no stability cap is
      needed at all. Filter coefficients now computed once per block rather than
      per sample, which also removes a `powf` + `sinf` from the sample loop.
- [x] **1.2 Resonance mapping — it was genuinely inverted, not just worth
      checking.** Measured peak gain of the shipped filter at cutoff 0.42:
      `res=0.00 → +9.09 dB`, `res=0.19 → +0.47 dB`, `res=0.38 → 0.00 dB`,
      `res≥0.57 → diverges` (at cutoff 0.70). `q` is the damping term, so the
      knob ran backwards: most resonant at zero, flat across its middle, then
      unstable. Replaced with an exponential-in-Q map (`Q` 0.5 → 25) which is
      near-constant in dB per turn:

      ```
      r      0.000  0.125  0.250  0.375  0.500  0.625  0.750  0.875  1.000
      peak   -0.00   0.28   3.13   6.96  11.06  15.14  18.99  22.36  25.15 dB
      ```

      A lowpass has no resonant peak until `Q > 1/sqrt(2)`, so the flat first
      step is inherent rather than a mapping flaw.
- [x] **1.3 Parameter-space sweep tests.**
      - `tests/test_dustline_core.c`: full cutoff × resonance plane (21 × 20) at
        three drive settings with noise off and full = 2520 points, each a
        complete note lifecycle. Fails on the pre-fix core
        (`unstable at cutoff=0.60 resonance=0.65`), passes after. Plus named
        assertions for the two divergent presets, and a normalized-slew check
        that catches an inverted resonance wiring.
      - `tests/test_mf_dsp.c` (new, module-independent — wired into
        `scripts/test.sh` ahead of the per-module loop): SVF stability across
        41 × 21 coefficient combinations under a full-scale square, peak-gain
        monotonicity and dB-per-turn evenness, cutoff/resonance clamping, and
        denormal flush.
      - `tests/test_westfold_core.c`: pairwise extremes across the 10 params with
        feedback or nonlinearity in their path (400 combinations). Passes as
        written — no westfold instability found.
      - `tests/test_trail_core.c`: every param at both extremes with feedback
        pinned at maximum and sustained near-full-scale input, then silence for
        the tail. Passes as written — no runaway found.

      Full suite stays green and gains ~1.5 s (11 s total).
- [x] **1.4 Re-rendered and re-blessed** after Phase 2 landed, so the new floors
      and the bless diff gate both had to pass first. Blessed with `--force`
      against a printed diff; the notable movements were:

      ```
      dustline 02-air-noise    rms 0.00029 -> 0.24296   (+58.5 dB; was the NaN silence)
      dustline 04-glass-keys   rms 0.02789 -> 0.27892   (+20.0 dB; same cause)
      dustline 01-dust-bass    peak 0.77704 -> 0.95502  (+1.8 dB; DC removal freed headroom)
      faust_voice 01-plucky    peak 0.6893 -> 0.86307   (+2.0 dB; same)
      lobber 02-stutter-16     peak 0.99988 -> 0.69925  (-3.1 dB; noise signal was
                                                         hitting full scale on its DC bias)
      ```

      No render clips or exceeds peak 0.99. `mise run check` passes end to end.

      Note `goldens/**/*.wav` is gitignored, so `tools/render_diff.py` still
      cannot produce diff artifacts on a fresh clone — see 2.11.

**Done when:** the sweep test fails on the pre-fix core and passes after, and
`02-air-noise` / `04-glass-keys` goldens have healthy `rms` and
`silence_ratio < 0.5`.

**Note for 5.1:** `src/modules/_shared/mf_dsp.h` is now a real dependency of
dustline's WASM TU and is *not* in `build-wasm.sh`'s dep list, so editing it
will not trigger a rebuild. Add it with the others.

---

## Phase 2 — Make the quality signal able to fail

The goal is that a golden can no longer be quieter than its own tolerance, and
that some checks hold without reference to any golden at all.

- [x] **2.1 Relative-first tolerances with a real floor.** `Tolerance` is now
      `{floor, rel}` and the band is `max(floor, rel * |golden|)`, so a
      tolerance can never be wider than the value it guards. Floors are set only
      to absorb cross-compiler last-ULP noise.
- [x] **2.2 Absolute sanity floors, independent of the golden.**
      `peak > 0.02`, `rms > 0.002`, `silence_ratio < 0.99`, per-channel
      `|dc| < 0.02`. They gate **bless as well as check**, and `--force` cannot
      override them — the distinction being "this changed" versus "this is
      broken". Verified: re-rendering `02-air-noise` with the pre-fix core makes
      bless refuse on all three level checks.
- [x] **2.3 NaN/Inf trap** — at the one place it can work.
      `moveforge_float_to_i16` (`_shared/dsp_runtime.h`) is where every module's
      float becomes int16 and therefore where NaN stops being detectable. It now
      counts non-finite input under `-DMOVEFORGE_COUNT_NONFINITE`, which only
      the three offline harnesses define, and they fail the render if the count
      is non-zero. Verified: the pre-fix dustline core reports **881,342
      non-finite samples** and exits 1; the fixed core is clean.

      Note the `nonfinite_samples` WAV metric was dropped again after being
      written — an int16 WAV cannot hold NaN, so it would read 0 forever and
      give false assurance.
- [x] **2.4 `bless` shows its work.** Per-metric before/after for anything
      moving >20%, with dB annotations on `peak`/`rms`, and `--force` required
      to proceed. Also added `render.sparse` for legitimately mostly-silent
      renders (relaxes only the silence floor).
- [x] **2.5 8-band log energy vector**, plus **2.7 `slew_ratio`** and a
      **`time_profile`** (8 equal time segments) — the temporal analogue, which
      is what actually catches an FX whose wet path dies.

      **Both vectors are in dB relative to their total, not fractions.** First
      implemented as fractions with a 0.02 floor, which reproduced the exact bug
      this phase exists to fix: a near-empty band had almost no dynamic range,
      so any floor wide enough for compiler noise in a loud band left quiet
      bands unprotected. Measured against faust_drive with smoothing added and
      removed, the fraction form missed a real change (top band 0.0076 → 0.0057,
      inside tolerance) that the dB form catches (-21.17 → -22.45 dB = 1.28 dB
      against a 0.75 dB band, while every other band moved ≤ 0.22 dB).
- [x] **2.6 Compare the metrics already recorded but ignored.** `frames`,
      `sample_rate` and `channels` now compare exactly, plus per-channel DC
      (`dc_offset` averaged both channels, so +x on L and −x on R cancelled).
      Array-length changes are reported rather than silently zipped.
- [x] **2.8 Params are exercised during a render.** New
      `tools/render_automation.h`, shared by both WAV harnesses, applied at
      block rate to match how the host delivers parameters. Driven from
      `presets.json` via `render.automate`:

      ```json
      "automate": [{ "key": "drive", "from": 0, "to": 1, "cycles": 24 },
                   { "key": "sync",  "steps": [0, 3, 6, 9] }]
      ```

      **`cycles` exists because sweep rate matters far more than range.** A
      plain 0→1 ramp over 4 s moves ~0.0007 per block — precisely the case where
      an unsmoothed parameter sounds fine. Measured against faust_drive (which
      smooths nothing, plan 4.5) such a ramp shifted `slew_ratio` by 0.4%, well
      inside tolerance; the cycled form is what makes the defect measurable.
      Applied to `faust_drive/00-init` (fast drive+mix sweep), `trail/01-slap`
      (stepped sync divisions, which jump `_dtime` unsmoothed) and
      `dustline/05-filter-sweep` (cutoff+resonance ramp).
- [x] **2.9 Fixed the `noise` test signal.** Centred it and removed the UB.
      `lobber/02-stutter-16` peak dropped 0.99988 → 0.69925 as a result — the
      old signal's DC bias had been pinning that render at full scale.
- [x] **2.10 Sweep now reaches 20 kHz** rather than stopping at 8 kHz.

**Found by the new floors, and fixed here** — three renders carried real DC
offsets that the old golden-relative check could never flag, because it only
ever compared them to themselves:

- [x] `dustline/01-dust-bass` **4.5% DC**, `faust_voice/00-init` and
      `01-plucky` **~2.8%**. Same cause in both: a saturator fed an asymmetric
      waveform produces DC even from a zero-mean input, so a DC blocker
      *upstream* of the output stage does not protect the output. dustline had
      one before its final `tanh`; faust_voice had none at all.

      Added `mf_dcblock_t` to `_shared/mf_dsp.h` (pulling a little of 4.2
      forward, as with `mf_svf_t`), used twice in dustline, and
      `fi.dcblocker` after `ma.tanh` in `faust_voice.dsp`.

      Placement detail worth keeping: the blocker goes after the nonlinearity
      but **before** the volume scale. Behind the gain it has decaying state, so
      `volume=0` left a ~10 ms tail instead of muting — caught by dustline's
      existing "volume zero mutes held note output" assertion.

**Done when:** deliberately breaking a module fails `check-renders` for every
affected preset. Verified for: a NaN-diverging filter (sanity floors + the C
trap), an inverted resonance wiring (Phase 1 slew test), and unsmoothed
parameters under automation (band_energy in dB).

### Still open in this area

- [ ] **2.11 Commit golden WAVs, or generate diff artifacts another way.**
      `.gitignore` excludes `goldens/**/*.wav`, so on a fresh clone
      `check-renders` prints "no golden WAV … re-bless to capture audio" and
      `tools/render_diff.py` never runs. The durable cross-machine contract is
      still metrics-only. Options: commit them (they are small at these
      lengths), use Git LFS, or generate the golden side on demand from a
      pinned build.
- [ ] **2.12 `check-stress` has 3 pre-existing failures** that block 3.4.
      `faust_drive` (`02-volume-max`, `20-hot-fast`) and `faust_voice`
      (`10-level-max`, `12-hot-fast`) clip at max level — real headroom bugs.
      `lobber` (`11-mute-max`, `20-all-max`) reports "unexpectedly silent", but
      a muted looper *should* be silent: that is a false positive from
      `render-stress.ts:110-134`, whose name-based `expect_silence` regex does
      not include `mute`. Fix the regex, then the headroom.

---

## Phase 3 — Turn the gate on

- [x] **3.1 Added `.github/workflows/ci.yml`** with `pull_request` + `push`
      triggers. Two jobs: `check` (runs `make check`) and `device-build`
      (`make move` plus a symbol check that each `dist/<id>/dsp.so` is aarch64
      **and** exports one of `move_plugin_init_v2` / `move_audio_fx_init_v2` /
      `move_midi_fx_init` — building is not the same as being loadable).

      **The device-build job earned its place immediately:** `mf_dsp.h` used
      `M_PI`, which is a POSIX extension that glibc does *not* define under
      `-std=c11`. It compiled on macOS and failed the aarch64 cross-compile.
      `tools/render_fx.c:133` had the same latent bug, pre-existing and never
      exercised because CI only ever ran `emcc`. Both now use an explicit
      constant.

      `pnpm test` is deliberately **not** gated yet — see 3.9.
- [x] **3.2 `-Wall -Wextra` on every compile line**, plus `-Werror` on the test
      path (`scripts/test.sh`). All hand-written C was already clean; the only
      warnings were `-Wunused-parameter` in generated Faust C, which is
      `#include`d into the adapter and so shares its translation unit and cannot
      take per-file flags. Fixed at the source: `gen-faust.ts` now wraps the
      generated body in a scoped `#pragma GCC diagnostic push/ignored/pop`, so
      the suppression travels with the artifact and every future scaffolded
      module inherits it while its own adapter code stays checked.

      Also made `tools/render_automation.h`'s helpers `static inline` — as plain
      `static` in a header they tripped `-Wunused-function` in any TU that did
      not use all three.
- [x] **3.3 ASan/UBSan second pass in `scripts/test.sh`** (`-O1`, opt out with
      `MOVEFORGE_NO_SANITIZE=1`). Clean across all modules; suite went 11 s → 25 s.

      Worth recording what this cannot catch: the hand-sized `zones[N]` overflow
      from 7.3 is an *intra-struct* overflow into an adjacent field, which has no
      ASan redzone. That stays a structural fix, not something a sanitizer will
      find.
- [x] **3.4 `check-stress` is in `make check`** (via `$(MAKE) stress`), once
      2.12 was resolved. All 7 modules pass. `Makefile:66-88` omits it;
      it holds the only *absolute* thresholds in the project
      (`scripts/check-stress.ts:53-62`: clipping, `|dc| > 0.05`, peak bounds,
      stereo imbalance). `SKILL.md:159` warns it is expected to fail on older
      modules — that is a reason to fix them, not to exclude the check.
- [x] **3.5 `deploy-to-move.sh` now runs `make check`** instead of a hand-rolled
      subset, so a deploy cannot skip the golden comparison.
- [x] **3.6 `scripts/gen-compile-commands.ts`** emits `compile_commands.json`
      (27 entries: cores, wrappers, tests, harnesses) with the same flags as
      `test.sh`, so editor diagnostics match what the gate rejects. Gitignored;
      regenerate with `mise run gen-compile-commands`.
- [x] **3.7 Added `.clang-format`, `.clang-format-ignore` and
      `scripts/format.sh`** (`mise run format` / `format-check`), tuned to the
      existing 4-space/K&R/100-col style with generated files excluded.

      **The repo is deliberately not reformatted and `format-check` is not in the
      gate.** A first pass would rewrite 1999 of 5830 lines (34%), which would
      bury every functional change in this branch. That belongs in its own
      commit. Tried `AlignConsecutiveAssignments`/`AlignConsecutiveMacros` to
      preserve the hand-aligned enum and constant tables; it made drift worse
      (lobber 178 → 206 lines) by aligning things that were not aligned before,
      so it is off.

**Also worth folding in here** (cheap, same area):

- [ ] `make check` renders the whole suite twice — `Makefile:16` declares
      `plot: suite` and `check` invokes `suite` separately as a sub-make.
- [x] `check-all` is now an alias for `check` (which already covers every
      module), keeping existing docs and muscle memory working.
- [ ] `scripts/module-target.ts` is spawned ~6× per module per script
      (~42 ms each, ~145 spawns ≈ 6 s across `make check`). One
      `module-target ids --json` call per script removes it.
- [ ] Mount a named volume at the emsdk cache dir in `scripts/build-wasm.sh:128-133`.
      `~/.emscripten_cache` currently lives inside the ephemeral container, so
      emscripten's sysroot cache is rebuilt from cold on **every** `docker run`.
      Largest single wall-clock win in the dev loop.
- [ ] `scripts/build.sh:59-60` only builds the Docker image if it does not
      exist, so editing `scripts/Dockerfile` never rebuilds it.
- [ ] Pin `faust` and `pnpm` in `mise.toml [tools]`. `node = "lts"` is floating
      while every `scripts/*.ts` relies on Node ≥22.6 type-stripping.
- [x] `mise run validate` no longer fails without Faust. `gen-faust.ts` check
      mode now compares the version recorded in the committed `*_faust.c`
      against the local `faust --version`, and skips with a warning when Faust
      is absent or is a different version — a byte comparison across Faust
      versions is meaningless, and "fixing" it would rewrite tens of KB of C
      with different inlining. Verified all three paths: matching version still
      byte-compares, mismatched version skips, absent skips; validate stays
      green in every case.

**Done when:** a PR that breaks a C test, drifts a generated file, or moves a
golden cannot be merged green. — **met**, with the caveats in 3.8/3.9 below.

### Still open in this area

- [ ] **3.8 Pin Faust so CI can check its drift too.** CI deliberately does not
      install Faust: apt does not carry 2.85.5, and any other version makes the
      byte-exact check meaningless (3.2 above). So Faust drift is currently
      verified only on a developer machine whose version matches. Pinning needs
      a container image or a source build.
- [ ] **3.9 Gate `pnpm test`.** Not added to CI yet: it is 41 Zustand/component
      tests with `@/audio` aliased to a mock, so it covers no audio, WASM or DSP,
      it needs a Playwright Chromium download, and `KeyboardPlay.spec.tsx` is
      silently excluded by the `tests/**/*.spec.ts` glob. Gate it after 5.10 and
      5.11, when the suite is honest about what it covers.
- [ ] **3.10 `device-build` is unverified in CI itself.** `make move` and the
      symbol check were both run locally against Docker, and the symbol-grep
      loop was exercised against the host build. The GitHub-hosted path
      (`binutils-aarch64-linux-gnu` on the runner, since `build.sh`
      cross-compiles inside its own image) has not run yet.
- [ ] **3.11 Reformat the repo** in a standalone commit, then add
      `format-check` to `make check`. See 3.7.

---

## Phase 4 — Build the shared DSP layer

`src/modules/_shared` is 290 lines, roughly 30 of which are DSP. Every module
re-derives its own primitives, and the dustline bug is a direct symptom.

Currently rewritten per module:

| Block | Where | State |
|---|---|---|
| one-pole smoother | `westfold_core.c:47-50`, `:52-59`, `trail.dsp:29` | 3 incompatible impls; 4 modules have none |
| DC blocker | `westfold_core.c:263-265`, `dustline_core.c:107-109` | 2 identical copies |
| AR/ADSR envelope | `westfold_core.c:212-222`, `dustline_core.c:74-76`, `faust_voice.dsp:39` | 3 different shapes |
| resonant filter | `dustline_core.c:92-101` (buggy), `fi.resonlp` | — |
| soft clip | raw `tanhf` at `westfold_core.c:108,119,260,269,270`, `dustline_core.c:106,110`, `faust_drive.dsp:26`, `trail.dsp:52` | no approximation anywhere |
| PRNG | `dustline_core.c:11-17` | **broken** — see 4.1 |
| NaN sanitize | `westfold_core.c:61-64,79-103`; `dustline_core.c:37-38` | westfold per block, dustline only on note-on, 4 modules never |
| denormal flush | nowhere | — |
| BPM/division → samples | `lobber_core.c:97-117`, `trail_adapter.c:16-27,53-71` | 2 different tables and conventions |
| linear ramp / declick | `lobber_core.c:387-393` **and** `:419-425` | same 7 lines twice in one function |
| voice alloc / note stack | nowhere | 5 ad-hoc gate representations across 6 modules |

- [ ] **4.1 Fix the PRNG.** `dustline_core.c:11-17` round-trips a 32-bit LCG
      state through a `float` every sample, destroying the low 8 bits.
      Measured period: **7412 samples ≈ 168 ms** — a 5.95 Hz repeating loop, not
      noise. `rng` can also reach exactly `1.0f`, making the next
      `(uint32_t)(1.0f * 4294967295.0f)` an out-of-range conversion. Keep the
      state in `uint32_t`; never leave integer domain.
- [ ] **4.2 Fill out `src/modules/_shared/mf_dsp.h`.** Created in Phase 1 with
      `mf_flush_denorm` and `mf_svf_t` (TPT/ZDF); `mf_dcblock_t` added in Phase 2
      when the new DC floors surfaced three real offsets. Tested in
      `tests/test_mf_dsp.c`. Still to add: `mf_smooth_t`, `mf_ar_t`,
      `mf_tanh_approx`, `mf_rng_t`, `mf_beats_to_samples`, `mf_sanitize` — then
      convert the remaining per-module copies listed above to use them.
      westfold and dustline still have their own inline DC blockers/smoothers.
- [ ] **4.3 Add `src/modules/_shared/moveforge.lib`** for the Faust side: `sm`
      (the `si.smooth(ba.tau2pole(0.02))` idiom that currently exists only
      inside `trail.dsp:29`), `satTanh`, `divBeats`. Import it from every `.dsp`.
- [ ] **4.4 Add a shared `mf_voice_t`** with a held-note stack. All three sound
      generators share the same latent bug: press A, press B, release B → sound
      stops while A is still held (`westfold_core.c:150-159`,
      `dustline_core.c:41-47`, `faust_voice_adapter.c:80-87` — none keeps a
      stack). None of them handle CC 120/123 either. `render_wav.c:103-116`
      plays strictly one note at a time, so the harness cannot see it.

### Parameter smoothing and denormals (do with 4.2/4.3)

- [ ] **4.5 `faust_drive` smooths nothing.** `faust_drive.dsp:14-17` — the
      generated code hoists `fSlow0/1/6` and applies them as hard steps at each
      128-sample block boundary (`faust_drive_faust.c:208-214`): a 344 Hz buzz
      while the encoder moves, and a click on every preset load. `faust_voice`
      has the same problem for `cutoff`/`resonance`/`level`
      (`faust_voice_faust.c:248-262`), where it also jumps the `resonlp`
      coefficients discontinuously at high Q.
- [ ] **4.6 Trail smooths the one control where it is most expensive.**
      Smoothing `tone` (`trail.dsp:32-38,47-49`) promotes it from a block
      constant to a per-sample signal, forcing Faust to recompute the bilinear
      `tan` mapping **every sample** for both filters and both channels
      (`trail_faust.c:1034-1048`). Smooth gains/mix; pre-warp or block-rate the
      cutoff coefficients.
- [ ] **4.7 Regenerate Faust with `-ftz 1`.** All generated C currently carries
      `-ftz 0` (`src/modules/*/dsp/*_faust.c:7`), and nothing anywhere sets FZ
      for the host or WASM builds. Trail's 16 Freeverb combs at 0.88 feedback
      plus a 3-second delay line all decay into the denormal range on silence.
      Note the device sets FPCR **FZ but not DAZ**
      (`SW/src/schwung_shim.c:4227-4241`), per-thread — so
      `SKILL.md`'s "denormals are silently flushed, don't add guards" is only
      half true, and offline renders run with denormals live regardless.

### Per-sample cost (ARM)

**Hardware correction, and it re-ranks everything below.** Move is a Raspberry Pi
CM4 — BCM2711, 4x Cortex-A72 @ 1.5 GHz. The original audit reasoned throughout
about a Cortex-A53 and drew conclusions from in-order execution, a 32 KB L1 and
a non-pipelined divide. The A72 is an out-of-order 3-wide superscalar with 1 MB
of L2 and pipelined FP divide, so it hides most of that latency. Confirmed
independently in the schwung tree: `SW/docs/plans/2026-04-08-usb-c-host-mode.md:15`
("Pi CM4, ARM64"), `SW/src/shadow/shadow_ui.js:5305` ("Move's Cortex-A72"), and
its build notes use `-march=armv8-a -mtune=cortex-a72`.

Working the frame budget: 2900 us per 128 frames at 1.5 GHz is 4,350,000 cycles
per block, ~34,000 cycles per sample, shared across 4 slots x 4 FX plus master
FX, LFOs, resampling, EQ, display and LEDs. Against that:

| item | approx cost | share of frame budget |
|---|---|---|
| **lobber capture memcpy** (4 MB scattered, in ONE block) | 800-2000 us | **28-69%** |
| westfold total (15 libm calls/sample) | ~550 cyc/sample | 1.6% |
| dustline block-constant math redone per sample | ~260 cyc/sample | 0.8% |
| westfold's 5 tanhf alone (the 4.12 target) | ~200 cyc/sample | 0.6% |
| scope.h 64-bit divide per sample | ~12 cyc/sample | 0.04% |

So only lobber's capture is a real xrun risk. The rest are worth doing when they
are free — pure hoisting, or a two-line change with no sonic effect — and not
worth doing when they trade sound for a fraction of a percent.

- [x] **4.0 Tune the cross-build for the actual CPU.** `scripts/build.sh` had no
      `-mtune` at all. Now `-march=armv8-a -mtune=cortex-a72`: baseline ISA so the
      `.so` still runs on any ARMv8, A72 scheduling model for the optimiser.

- [ ] **4.8 Hoist Dustline's block-constant math out of the sample loop.**
      `dustline_core.c:70-92` computes 2 × `powf`, 2 × `expf` and 1 × `sinf`
      per sample from inputs that are all block-constant — ~7 libm calls/sample
      where only the 2 `tanhf` need to be per-sample. `westfold_core.c:188-192`
      already does this correctly. Roughly a 3-5× CPU cut for zero sonic change.
- [ ] **4.9 Lobber's capture is a multi-megabyte memcpy in the audio callback.**
      `lobber_core.c:147-176`, called from the render path at `:222`/`:231`. At
      `loop_beats=16, bpm=40` that is 4 MB of scattered ring reads inside one
      128-frame block (2.9 ms budget) — a guaranteed xrun on device, fired on
      every CAPTURE press. Make it a pointer/length swap, or amortise it behind
      a state machine.
- [ ] **4.10 Lobber allocates 8 MB per instance and zeroes it twice.**
      `lobber_core.h:39-40,62-63` (`float[1<<19]` × 4); `lobber.c:33` `calloc`s
      it and `lobber_core.c:16` then `memset`s the same 8 MB.
      `trail_faust` adds 2.81 MB per instance plus a 256 KB static global sine
      table that `classInittrail_faust` refills on every init.
- [ ] **4.11 `_shared/scope.h:144` does a 64-bit integer division per sample**
      (`(long)s->pos * MF_SCOPE_COLS / s->window`) in the audio path — ~20-40
      cycles, non-pipelined on A53, ~4000 wasted cycles/block for a display
      feature. Use an incremental counter or reciprocal multiply.
- [ ] **4.12 Westfold: 11 libm calls/sample** (`sinf` ×4, `expf`, `powf`,
      `tanhf` ×5, plus 4 × `floorf`), none short-circuited when `chaos == 0`.
      `mf_tanh_approx` + `mf_sin_poly` from 4.2 cut this by an order of
      magnitude inaudibly.
- [ ] **4.13 Lobber uses double-precision interpolation for integer reads.**
      `lobber_core.c:132-141,433` — `slice_read` advances by exactly ±1, so
      `frac` is always 0, yet it pays a full double 2-tap interpolation per
      sample. Keep the position in double; interpolate in float; skip when
      `frac == 0`.
- [ ] **4.14 Lobber Slice mode has no output bound.** `lobber_core.c:440-441`
      (`out_l = dl + sl * mix`, both up to ±1) — no limiter, no DC blocker, no
      soft clip anywhere in lobber. The only bound is the hard clamp inside
      `moveforge_float_to_i16`.
- [ ] **4.15 Arpy hangs notes when the pattern is switched off.**
      `arpy_core.c:126-127` returns before the gate-off step, leaving
      `playing_note` sounding forever. Related: with `pattern == 0`,
      `process_midi` passes the *input* note-off through (`:103`) but the
      sounding note is the transposed chord note, so it addresses the wrong
      pitch; `held_active` is never cleared. `emit()` also drops messages past
      `max_out` (`:43`) while `arpy_tick:165` sets `playing_note` regardless.

**Done when:** `mf_dsp.h` and `moveforge.lib` are consumed by every module, and
`grep -c tanhf src/modules/*/dsp/*_core.c` finds no raw uses.

---

## Phase 5 — Make the browser loop stop lying

- [ ] **5.1 Fix the WASM rebuild dependency list.** `scripts/build-wasm.sh:76-104`
      omits `*_params.gen.inc`, `*_presets.gen.inc`, `*_scope.gen.inc`,
      `_shared/scope.h`, `src/host/faust_adapter.h`, `<id>.dsp` and
      `module.json` — all of which are `#include`d into the compiled TU or are
      upstream of one. **Correctness bug:** add a param, run `gen-params`,
      rebuild → prints `cached`, and the new knob silently does nothing because
      `<id>_param_id()` in the stale WASM returns -1.
- [ ] **5.2 Fix `reloadModuleWasm`.** `web/src/audio.ts:151-161` iterates all
      four tracks over slot IDs that are globally identical (`"sound"`,
      `"audio-fx-1"`, …, `web/src/chain-state.ts:232-254`) while the engine only
      holds the selected track's slots. Default state (4 tracks on westfold)
      means **4 audio-thread WASM instantiations per save**; and with track 0 on
      westfold and track 1 on dustline, editing dustline reloads westfold.
      Key by engine slot, not by track × slot ID.
- [ ] **5.3 Compile WASM off the audio thread.** `web/module-worklet.js:32-34`
      calls `WebAssembly.instantiate` inside `AudioWorkletGlobalScope` — an
      audible dropout on every hot-swap. `WebAssembly.compile()` on the main
      thread in `audio-engine.ts:145-160`, transfer the `Module`.
- [ ] **5.4 Make the dev watcher run the generators.** `vite.config.ts:211-226`
      spawns only `build-wasm.sh`, so editing a `.dsp` in the dev loop prints
      `cached` and you keep hearing the old sound — contradicting `README.md:133`.
      Also `vite.config.ts:189-190` skips `_`-prefixed dirs, so
      `_shared/*.h` edits trigger no rebuild at all.
- [ ] **5.5 Don't fire the HMR event when the build reports `cached`**
      (`vite.config.ts:220-222`), and debounce the watcher ~150 ms. Editing a
      `MANUAL.md` inside a module dir currently resets your audio (×4, per 5.2).
- [ ] **5.6 Add `depends = ["wasm"]` to `mise.toml`'s `dev`** (`:110-112`);
      `web` has it, `dev` does not, and `web/wasm/` is gitignored — so a fresh
      clone runs `mise run dev` and gets a UI with zero working modules.
- [ ] **5.7 Export `sch_get_param` from the WASM glue** and add it to
      `SCH_EXPORTS` (`build-wasm.sh:42`). Params are currently write-only in the
      browser, which is the structural reason the scope, meters and any DSP-side
      telemetry cannot reach the UI. Then render the existing `"__scope"`
      128-column format on a `<canvas>` — the device already has this
      (`_shared/scope.h:210-226`, `ui_chain.js:377-393`) and the browser cannot
      reach it at all.
- [ ] **5.8 Send `store.bpm` into the worklet.** `schwung_wasm_glue_fx.c:36-37`
      hardcodes `get_bpm() → 120` and `get_clock_status() → UNAVAILABLE`, so
      **Trail's sync mode always auditions at 120 BPM** regardless of the
      sequencer tempo. `lobber.c:49-68` degrades gracefully; `trail.c:50-59`
      does not.
- [ ] **5.9 Wire up sound-generator bypass.** `web/module-worklet.js:152` has a
      `soundBypass` handler that **nothing ever posts**; `buildSpec`
      (`audio.ts:25`) only drops disabled `midi_fx`/`audio_fx`. Meanwhile
      `ChainSlot.tsx:128` promises "Bypassed: synth is silent". Either send it or
      remove the affordance. Separately, audio-FX bypass currently *disposes* the
      instance (`audio-engine.ts:59-61`), hard-cutting delay/reverb tails and
      making bypass useless for A/B on time-based FX.
- [ ] **5.10 Fix the test glob.** `vite.config.ts:54` is `tests/**/*.spec.ts`,
      so `web/tests/KeyboardPlay.spec.tsx` **never runs** — three tests silently
      excluded.
- [ ] **5.11 `initialize()` silently empties `moduleIndex` in tests.**
      `module-metadata.ts:98-109` filters every module through `hasWasmBuild`,
      which fetches the real `.wasm` (absent in CI), so every `AppRoot` mount
      test runs with empty pickers. Also: `hasWasmBuild` downloads each module's
      **full** `.wasm` just to check 4 magic bytes, with `cache: "no-store"`.
- [ ] **5.12 Add a load meter to the worklet** — but not the way this item
      originally said, and not as a substitute for 6.5. Probed in Chrome against
      a live AudioContext:

      | API | available? |
      |---|---|
      | `performance` / `performance.now()` in `AudioWorkletGlobalScope` | **no** |
      | `AudioContext.renderCapacity` | **no** (not on the prototype either) |
      | `currentTime`, `currentFrame`, `Date.now()`, `sampleRate` | yes |

      So the `performance.now()` accumulator this item used to propose cannot be
      written — that global does not exist in a worklet. And `currentTime` cannot
      detect a missed deadline: it tracks the *hardware* audio clock, so it keeps
      advancing whether or not the render callback finished. Verified by burning
      400,000 sin() per quantum — far past a 2.9 ms budget — and still measuring
      the audio clock at 100.1% of wall clock.

      What does work: accumulate `Date.now()` deltas across many quanta. Coarse
      per call (1 ms resolution) but the sum over a few hundred quanta gives a
      usable average load, and the quantum is *exactly* the device's 128 frames
      at 44.1 kHz. Measured with a synthetic load:

      ```
      quantum = 2.902 ms (128 frames @ 44.1k — identical to the device)
      load      0 ->  0.1% of budget      load  60000 -> 44.3%
      load   5000 ->  5.4% of budget      load 400000 -> 76.5%
      load  20000 -> 22.6% of budget
      ```

      `currentFrame` also confirmed quanta are never skipped (frame-skew constant
      at 128): Chrome runs late rather than dropping a callback, so the underrun
      happens at the output device where the page cannot observe it.

      This is an **average**, so it has the same blind spot as the offline average
      — it would not catch lobber's one-bad-block capture. It is complementary to
      6.5, not a replacement: 6.5 owns per-block max with a real clock and gates
      CI; this owns "how heavy is this module while I play it" and belongs in the
      UI.

      Note also why CPU throttling is not the answer for emulating the device:
      DevTools throttling targets main-thread task scheduling rather than the
      audio render thread, and even if it applied it would not model CM4's memory
      bandwidth — which is precisely what dominates the one cost that matters
      (lobber's capture). It would mis-model the bug it was meant to find.
- [ ] **5.13 Fix the stale note-off timers in `useSequencer`.**
      `web/src/lib/useSequencer.ts:34-43` starts a new timer on retrigger
      without cancelling the old one. With `drone_hold` (`gateSteps: 16`) at
      `length: 8`, the previous timer fires 3.5 steps into the new note and
      chops the drone. `noteOffTimers` is a flat `Set` with no per-note key.
- [ ] **5.14 Rewrite or delete `docs/move-emulator-toolchain.md`** — it
      advertises 8 encoders, wheel controls, an OLED canvas, a preset browser
      and Web MIDI. None of that exists in `web/src` (grep for
      `encoder|jog|oled|canvas|requestMIDIAccess` → zero hits). It will actively
      mislead a module author about what can be checked locally.

**Done when:** a `.dsp` edit is audible in the browser without a manual
`gen-faust`, and one save produces exactly one slot reload.

---

## Phase 6 — Close the device-fidelity gaps

These are the "works locally, dead on device" set. None is described by any
header, and none is visible to any local check.

- [ ] **6.1 Set `capabilities.requires_continuous_processing`** on `lobber` and
      `trail`. `SW/src/schwung_shim.c:613-614` — after ~1 s of output below
      ±4 LSB (`DSP_IDLE_THRESHOLD 344`, `DSP_SILENCE_LEVEL 4`) the host **stops
      calling `render_block`**, probing roughly twice a second
      (`:1626-1638`, FX gated separately at `:1758-1785`). Loopers, delay write
      pointers, LFO phase and arp clocks freeze. The flag is read at
      `SW/src/modules/chain/dsp/chain_host.c:315-340`; **no moveforge module
      sets it today.** MIDI-FX `tick()` is called from inside the chain's
      `v2_render_block`, so an arpeggiator's clock is gated by audio silence too.
- [ ] **6.2 Declare discrete params as `int`/`enum`, not `float`.** The host
      runs a parameter smoother **on the audio thread**
      (`SW/src/modules/chain/dsp/chain_host.c:1972-2002`, `SMOOTH_COEFF 0.15`,
      ~90 ms to converge) and enrols anything typed `KNOB_TYPE_FLOAT`
      (`:830-838`). `trail.sync` (0-9), `arpy.pattern`, `arpy.chord`,
      `lobber.mode` are all `{"type":"float", step:1}` today, so changing
      `sync` 0 → 4 sweeps through every division on the way. Schwung's own
      modules use `enum`/`int`.
- [ ] **6.3 Stop `preset` being re-fired on every knob turn.** Traced
      `is_smoothable_float("0")` at `SW/.../chain_params.c:139-143`: the
      integer-index guard is `strchr(val,'.')==NULL && (f<0 || f>1)`, which is
      **false** for "0" and "1", so both fall through and return 1. Once
      enrolled, `smoother_update` re-sends **every** active key whenever any one
      of them is moving. So on preset 0 or 1, turning `fold` re-delivers
      `set_param("preset","0.000000")` → `westfold.c:63-68` runs
      `all_notes_off` + a full preset reset. Note also `MAX_SMOOTH_PARAMS 16`:
      westfold has 15 params + `preset` = exactly 16.
- [ ] **6.4 Make `set_param` audio-thread-safe by contract.** Per 6.2/6.3 it is
      called from the SPI (RT) thread, and `create_instance` reaches
      `dlopen`/`calloc`/`fopen` from there by design
      (`SW/docs/REALTIME_SAFETY.md:112-118`). Document this in `SKILL.md` and
      `CLAUDE.md`; today both treat `set_param` as a UI-thread call. While
      there: `SKILL.md` says SCHED_FIFO 90 — the DSP runs at **FIFO 70**
      (`SW/docs/REALTIME_SAFETY.md:9-14`).
- [ ] **6.5 Measure CPU time.** `SW/src/schwung_shim.c:4207-4208`:
      `OVERRUN_THRESHOLD_US 2850`, `SKIP_DSP_THRESHOLD 3` — three consecutive
      overruns and **the host drops your DSP**, and that 2900 µs budget is
      shared across 4 slots, their FX, master FX, LFOs, resampling, EQ, display
      and LEDs. moveforge measures nothing:
      `grep -rn "clock_gettime\|CLOCKS_PER_SEC\|performance.now" tools/ scripts/ src/ tests/`
      returns zero hits.

      **Measure per block, not a total ratio.** The formulation originally
      written here — `rendered_seconds / elapsed_seconds` — is an average, and
      the watchdog fires on three consecutive *blocks*. Measured on lobber with
      a capture every 500 blocks:

      ```
      AVERAGE view : 4110x realtime, mean 0.7 us/block     <- looks fine
      PER-BLOCK    : median 0.0 us  p99 1.0 us  MAX 172 us  <- the capture block
      ```

      lobber's steady-state cost is below clock resolution; the average hides
      the one block that matters entirely. So: record median / p99 / max per
      block and gate on the max.

      Caveat on interpreting it: the dev machine is not the device. That 172 us
      is an Apple M-series at ~4 GHz moving 2.8 MB at ~16 GB/s; on a 1.5 GHz A72
      with CM4's LPDDR4 at 2-4 GB/s effective for scattered reads the same work
      is roughly 700-1400 us. Ratios and regressions transfer, absolute
      microseconds do not — any "% of the 2900 us budget" claim derived from this
      needs that scaling stated. Real on-device numbers come from 6.8
      (`SW/tools/pytest-schwung`) and schwung's own `spi.pre` OTLP spans in
      `SW/src/host/schwung_trace.c`.
- [ ] **6.6 Reconcile MIDI FX `max_out`: 8 / 16 / 32.**
      `tools/trace_midi_fx.c:35` is 8, `SW/src/host/midi_fx_api_v1.h:19` is 16,
      `src/host/midi_fx_wasm_glue.c:7` is 32. The byte-exact golden trace is
      captured against the *least* representative of the three. Import
      `MIDI_FX_MAX_OUT_MSGS` rather than redefining it — moveforge's copy of the
      header omits both `MIDI_FX_MAX_OUT_MSGS` and `MIDI_FX_INIT_SYMBOL`, and
      renames the version macro and include guard. (Struct layouts are otherwise
      clean: `plugin_api_v1.h` is byte-identical to upstream, and
      `audio_fx_api_v2.h` differs only in comments.)
- [ ] **6.7 Populate the host struct in `trace_midi_fx.c:88`** — it passes
      `host_api_v1_t host = {0}`, so `sample_rate == 0` and every callback is
      NULL. The device always supplies a populated struct
      (`SW/.../chain_host.c:69-74`), so an arpy variant that reads
      `get_clock_status()` is untestable locally and NULL-derefs on device.
- [ ] **6.8 Wire up `pytest-schwung` as a post-install load probe.**
      `SW/tools/pytest-schwung` is a line protocol over TCP to `schwung-testd`
      with `SET_PARAM`/`GET_PARAM`/`WAIT_FRAME`/`SNAPSHOT_PAD_LEDS`/
      `SUBSCRIBE midi_out`/`RESTART_MOVE`, a pytest plugin, and it **skips
      cleanly when no device is attached**. This is the "did it actually load"
      check the deploy loop has never had — and it also gives arpy a device-side
      MIDI golden at the real `max_out = 16`, and a way to actually test 6.1
      and 6.3.
- [ ] **6.9 Make the install atomic.** `scripts/install-to-move.sh:118` plain
      `scp`s over a `.so` the host may have `dlopen`'d
      (`SW/.../chain_host.c:422`, `:247`, `chain_midi.c:155`), truncating a file
      mapped `PROT_EXEC` in the middle of the audio callback. `scp` to `.new`
      then `mv` is free and atomic.
- [ ] **6.10 Verify what actually got installed.** `install-to-move.sh:120-125`
      byte-count-compares **only** `dsp.so`, but the chain host loads audio FX
      from `<id>/<id>.so` (`SW/.../chain_host.c:243-244`). `module.json`,
      `ui.js`, `ui_chain.js` and `presets.json` are unverified. Use a checksum,
      and cover every shipped file.
- [ ] **6.11 Add a dirty-tree guard** — `SKILL.md:169` claims
      `install-to-move.sh` refuses one by default. There is no `git status`
      check anywhere in `scripts/`. Device builds are currently untraceable to
      a commit.
- [ ] **6.12 Add an uninstall / recovery path.** A module that segfaults in
      `create_instance` or `render_block` crash-loops: each of the 4 chain slots
      re-loads its autosave `slot_N.json` at boot
      (`SW/src/host/shadow_chain_mgmt.c:1047-1140`) and re-`dlopen`s the
      offender. Recovery today is SSH-only and undocumented. Also enable
      `debug_log_on` *before* installing — every load-failure path in
      `chain_host.c:295-310,439-500` is silent otherwise.
- [ ] **6.13 Validate against the host's real `module.json` limits.**
      `SW/.../chain_internal.h:103-116` and `chain_params.c:527-565`: key ≤ 31
      chars, name ≤ 63, `module.json` < 64 KiB, ≤ 256 params, and a **duplicate
      key anywhere across all levels rejects the module load**.
      `scripts/validate-params.ts:142` only walks `levels.root`.
- [ ] **6.14 Correct `CLAUDE.md`'s chain-UI discovery description.** It states
      the host decides from the `"ui_chain"` field and that there is no fallback
      editor. `SW/src/shadow/shadow_ui.js:2185-2224` defaults to
      `<moduleDir>/ui_chain.js` with no `module.json` field required and falls
      back to `ui.js`; `:2338-2344` provides a preset-browser fallback editor.
      Also note `SW/src/modules/chain/ui.js:172-192` searches top-level only,
      so it never finds a module installed under `modules/<kind>/<id>/`.

**Done when:** installing a module reports whether it loaded, and the idle gate
and param smoother are exercised by something before hardware.

---

## Phase 7 — Delete the copy-paste

Roughly 4,300 lines of generated/copy-paste duplication. The cost is not disk —
it is that every fix has to be made seven times.

- [ ] **7.1 Shared/generated Schwung wrapper.** `westfold.c` vs `faust_voice.c`
      differ by ~28 lines out of 125; `westfold.c` vs `dustline.c` by ~30;
      `trail.c` vs `faust_drive.c` by ~35. `on_midi` is byte-identical across
      all three sound generators. ~670 of 706 wrapper lines are mechanically
      derivable from `module.json` + the core header.
      **Concrete cost today:** four of seven wrappers never `#include` their
      generated `_presets.gen.inc` (`dustline.c`, `arpy.c`, `faust_drive.c`,
      `faust_voice.c`), so those modules **cannot expose presets on device**
      despite shipping `presets.json` and a generated helper — the chain UI's
      preset-browse screen is dead for them. A shared wrapper makes that
      impossible.
- [ ] **7.2 Generate the Faust adapter.** `faust_drive_adapter.c` contains zero
      module-specific logic; `capture_slider`, `push_params_to_faust`, `init`,
      `destroy` and `process_float` are identical across all three.
      `src/host/faust_adapter.h` already generalises the UIGlue half — the
      missing piece is a `MOVEFORGE_FAUST_ADAPTER(prefix, core_t, PARAM_COUNT)`
      macro plus two hooks: `MF_FAUST_EXTRA_ZONES(label)` for
      `gate`/`freq`/`gain`/`_dtime`, and `MF_FAUST_PRE_COMPUTE(s)` for
      `compute_dtime`. This is Suggested Improvement #6 in `CLAUDE.md`, and it
      is fully achievable today.
- [ ] **7.3 Size `zones[]` from the generated count.**
      `faust_voice_core.h:30` is `zones[5]`, `faust_drive_core.h:26` is
      `zones[4]`, and **both Faust scaffolding templates ship `zones[1]`/`zones[2]`**
      — so adding one param to a freshly scaffolded Faust module is an
      out-of-bounds write in `capture_slider`, with no compiler warning, no
      validate error and no test failure. `trail_core.h:22` has the mirror
      variant (`TRAIL_NUM_PARAMS 9` duplicating `TRAIL_PARAM_COUNT`, mixed
      between `trail_adapter.c:38` and `:44`). One-line fix:
      `void *zones[<UPPER>_PARAM_COUNT];`.
- [ ] **7.4 Emit `ui_chain.js` as a thin call into a shared `.mjs`.**
      `diff src/modules/trail/ui_chain.js src/modules/faust_drive/ui_chain.js`
      → 26 differing lines out of ~470, all data. Modules already import
      `constants.mjs` / `input_filter.mjs` / `menu_layout.mjs` from
      `/data/UserData/schwung/shared/`, so the mechanism exists; the generator
      just inlines ~440 lines of behaviour instead of emitting
      `globalThis.chain_ui = makeChainUI({ title, params, knobs, hasPresets })`.
      Today a chain-editor bug fix means regenerating and redeploying all seven
      modules.
- [ ] **7.5 Use `knob_engine.mjs`.** Every native chain/master-FX param edit
      goes through it (`SW/src/shared/knob_engine.mjs`, enforced by
      `SW/tests/shadow/test_shadow_uses_knob_engine.sh`); the generated
      `ui_chain.js` uses raw `decodeDelta` + a fixed step
      (`templates/generated/ui_chain.js.tmpl:191-194,407-451`), so encoder feel
      diverges from every stock module — no acceleration, no self-reset, no
      enum divisor.
- [ ] **7.6 Batch `fetchParams()`.** `host_module_get_param` is a synchronous
      SHM round-trip serviced once per SPI frame (~2.9 ms,
      `SW/src/shadow/shadow_ui.c:810-830`). `ui_chain.js.tmpl:157-161` does one
      call **per param**, and `changePreset()` calls it on every jog detent
      (`:229`) — ~18 × 2.9 ms ≈ 50 ms of lag per detent for westfold.
- [ ] **7.7 Deduplicate the small stuff.** `<id>_params_clampf_` is a 7× copy of
      `moveforge_clampf`; `schwung_wasm_glue_fx.c:105-119` reimplements the
      `_shared/dsp_runtime.h` int16 helpers inline; `<id>_apply_preset` does an
      O(n²) `strcmp` walk instead of emitting indices.

**Done when:** adding a parameter to a Faust module touches `module.json`, the
`.dsp`, and nothing else hand-written.

---

## Phase 8 — Validation and docs debt

Cheap, and it stops the earlier phases from silently regressing.

- [ ] **8.1 `await` the floating promise.** `scripts/validate-params.ts:146`
      calls the `async` `validateGenInc` without `await`; its pushes land after
      `validateModule()` resolves, so line 82 has already read an empty array.
      If a module has no other errors, the whole group is dropped and validate
      exits 0. (Masked in `mise run validate` because the byte comparison runs
      first, but `validate-params.ts` is runnable standalone.)
- [ ] **8.2 Delete orphaned generated files.** All four generators `continue`
      when their input is absent and nothing ever cleans up. Remove
      `capabilities.scope` from a `module.json` and `<id>_scope.gen.inc` is
      frozen forever while the wrapper still `#include`s it and still compiles
      (`gen-params.ts:84`; same shape at `gen-faust.ts:31`,
      `gen-ui-chain.ts:127-129`).
- [ ] **8.3 Validate `step`, `type`, and reserved names.** `step` is never
      checked at all — and `gen-ui-chain.ts:49-55` **ignores the declared step
      for continuous params**, using `range/100` instead, so `module.json`'s
      `step` is a lie on every device encoder (`westfold.bend_range` declares
      0.1 over [0,12] and moves in 0.12). `type` is checked for presence only.
      The key regex accepts every lowercase C keyword, and a param named
      `count` collides with the generated `<UPPER>_PARAM_COUNT` macro.
- [ ] **8.4 Cross-check `.dsp` hslider labels against `module.json` keys.** A
      typo'd label means `<id>_param_id()` returns -1, the zone is never
      captured, and `push_params_to_faust` silently skips it — **a dead knob
      with zero diagnostics** that compiles, validates, renders and ships.
      Defaults already drift: `trail.dsp:34` declares `hslider("mod", 0.12,…)`
      against `trail/module.json:32`'s `0.2`.
- [ ] **8.5 Escape `new-module` inputs.** `--name` and `--abbrev` are
      unescaped (`scripts/new-module.ts:48-49`); `--name 'A"B'` writes corrupt
      JSON into `module.json` and every subsequent read fails.
      `scripts/lib/c.ts:7-9` handles only `\` and `"` — a preset name with a
      newline produces an unterminated C string literal. `gen-params.ts:129`
      interpolates `p.key` into a C string literal without `escapeCString` at
      all, unlike `gen-presets.ts`.
- [ ] **8.6 Don't strand a half-scaffolded module.** `gen-faust.ts:57` calls
      `process.exit()` from inside a library function that `new-module.ts:106`
      imports, so a Faust failure leaves the directory written but unregistered,
      and re-running hits "refusing to overwrite existing directory".
- [ ] **8.7 Reconcile the three "add a parameter" rituals.** `CLAUDE.md:57-68`
      (10 steps), `README.md:150-161` (12) and `SKILL.md:87-101` (11) disagree,
      and all three are wrong in the same way: they scope the
      `float <key>;` core-struct edit to "plain C only", but
      `validate-params.ts:277-284` runs `validateCoreStruct` for **every**
      module including Faust ones. A Faust author following the docs exactly
      gets a compile error and a validate failure. None of the three mentions
      growing `zones[N]` (7.3), and only `SKILL.md` mentions the mandatory
      `metadata.json` `randomize` entry (`validate-params.ts:178-182`).
      Collapse to one canonical list — ideally one that shrinks as 7.1-7.3 land.
- [ ] **8.8 Cross-check `index.json`.** `kind` and `name` are a third
      independent copy, never compared against `module.json`
      (`validate-params.ts:96-106`). `arpy/module.json:11` declares
      `"api_version": 2` while `arpy.c:52` sets `MOVE_MIDI_FX_API_VERSION` (1);
      nothing validates it. `lobber` is missing from the module table in
      `CLAUDE.md:13-20` despite being the largest module in the repo.
- [ ] **8.9 Model the real chain-UI runtime in the test harness.**
      `tests/ui-chain/harness.ts:73,92-93` strips imports with a regex and runs
      the source in a Node `vm` in **sloppy script** mode; the device evaluates
      with `JS_EVAL_FLAG_STRICT | JS_EVAL_TYPE_MODULE`
      (`SW/src/shadow/shadow_ui.c:654-657`). An accidental implicit global
      passes locally and throws on device — and the symptom there is a silently
      dead slot, since a failed load just falls back to the preset browser.
      `drawMenuList` and friends are no-op stubs (`harness.ts:52-55`), so the
      real ~20-option `menu_layout.mjs:134` contract is never exercised.
      Borrow the pattern from `SW/tests/shadow/` (~60 grep/behaviour tests over
      the shared `.mjs` files).
- [ ] **8.10 Fix `dustline/ui.js`** — it exports `render(ctx, state)` instead of
      setting `globalThis.init`/`tick`, so it will never be called by the host.
      Dustline's solo screen is dead.
- [ ] **8.11 Handle blocks properly instead of truncating.** Every wrapper does
      `if (frames > MOVEFORGE_BLOCK_FRAMES) frames = MOVEFORGE_BLOCK_FRAMES;`
      (`westfold.c:104`, `dustline.c:74`, `faust_voice.c:87`, `trail.c:45`,
      `faust_drive.c:34`, `lobber.c:48`) and then writes only 128 frames,
      leaving the remainder **uninitialised** for sound generators. The ABI says
      frames is always 128 — but a chunked loop costs nothing and removes the
      failure class. Fold into 7.1.
- [ ] **8.12 Fix `update-upstream-schwung.sh`** (`:27-30` requires
      `upstream/schwung/.git`, which is gitignored and absent) and pin the three
      reference headers to a schwung revision with a drift check in
      `mise run check`.

---

## Sequencing

Phases 1-3 are roughly a day and change the confidence level of everything
after them: after Phase 3, nothing in Phases 4-8 can silently regress.

```
1  Fix dustline + sweep test          ── the live bug, and the regression test
2  Quality signal can fail            ── depends on 1 for something to catch
3  CI gate + warnings + sanitizers    ── locks in 1 and 2
4  Shared DSP layer                   ── makes the Phase 1 class of bug unwritable
5  Browser loop                       ── independent of 4; can run in parallel
6  Device fidelity                    ── needs 3 (CI) to be worth automating
7  Delete copy-paste                  ── safest after 3, and 7.1 unblocks presets
8  Validation + docs debt             ── continuous; 8.7 should land with 7.1-7.3
```

Phases 5 and 6 are independent of 4 and of each other. 8.1-8.6 are small enough
to pick up opportunistically.

## Out of scope for this branch

- New modules or new DSP features.
- The adaptive scope work in `docs/scope-adaptive-plan.md`.
- Publishing to `SW/module-catalog.json` (worth doing, but after the gate exists).
