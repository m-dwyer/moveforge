/* Swarf core tests.
 *
 * The assertions plans/perc-engine-brief.md Part 9 asks for, plus the traps it
 * inherited from ballast. Everything here is a *measurement* against the core rather
 * than an inspection of it: goldens only ever say "unchanged", and a bless can walk a
 * reference away, so the absolute numbers live here in C.
 */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "swarf_core.h"

#define BLOCK 128
#define SECONDS 4
#define N (44100 * SECONDS)

static float out_l[N];
static float out_r[N];

static void require_true(int condition, const char *message) {
    if (!condition) {
        fprintf(stderr, "FAIL: %s\n", message);
        exit(1);
    }
}

static float absf_local(float x) { return x < 0.0f ? -x : x; }

/* Voice indices, matching module.json's level order. */
enum { V_HAT = 0, V_OH, V_RIDE, V_CLAP, V_CONGA, V_WOOD };

static void render(swarf_core_t *s, int frames) {
    memset(out_l, 0, sizeof(out_l));
    memset(out_r, 0, sizeof(out_r));
    for (int f = 0; f + BLOCK <= frames; f += BLOCK) {
        swarf_process_float(s, NULL, NULL, out_l + f, out_r + f, BLOCK);
    }
}

/* One hit, rendered from silence. */
static void hit(swarf_core_t *s, int note, float velocity, int frames) {
    swarf_note_on(s, note, velocity);
    render(s, frames);
}

static float peak_of(const float *buf, int from, int n) {
    float p = 0.0f;
    for (int i = from; i < from + n && i < N; i++) {
        if (absf_local(buf[i]) > p) p = absf_local(buf[i]);
    }
    return p;
}

static float rms_of(const float *buf, int from, int n) {
    double sum = 0.0;
    int count = 0;
    for (int i = from; i < from + n && i < N; i++) {
        sum += (double)buf[i] * buf[i];
        count++;
    }
    return count ? (float)sqrt(sum / count) : 0.0f;
}

/* Energy in a frequency band over a window, by direct DFT. Slow and obviously
 * correct, which is what a test wants. */
#define DFT_N 1024

static void dft_bin(const float *buf, int start, int k, double *out_re, double *out_im) {
    double re = 0.0, im = 0.0;
    for (int i = 0; i < DFT_N; i++) {
        int idx = start + i;
        float x = (idx >= 0 && idx < N) ? buf[idx] : 0.0f;
        /* Hann, so a band measurement is not dominated by the window edges. */
        float w = 0.5f - 0.5f * cosf(MOVEFORGE_TWO_PI * (float)i / (float)(DFT_N - 1));
        double ang = -MOVEFORGE_TWO_PI * (double)k * (double)i / (double)DFT_N;
        re += (double)x * w * cos(ang);
        im += (double)x * w * sin(ang);
    }
    *out_re = re;
    *out_im = im;
}

static float band_energy(const float *buf, int start, float lo_hz, float hi_hz) {
    int lo_bin = (int)(lo_hz * DFT_N / MOVEFORGE_SAMPLE_RATE);
    int hi_bin = (int)(hi_hz * DFT_N / MOVEFORGE_SAMPLE_RATE);
    if (lo_bin < 1) lo_bin = 1;
    if (hi_bin > DFT_N / 2) hi_bin = DFT_N / 2;
    double total = 0.0;
    for (int k = lo_bin; k <= hi_bin; k++) {
        double re, im;
        dft_bin(buf, start, k, &re, &im);
        total += re * re + im * im;
    }
    return (float)total;
}

/* Amplitude-weighted mean frequency of a window. */
static float centroid(const float *buf, int start) {
    double num = 0.0, den = 0.0;
    for (int k = 1; k <= DFT_N / 2; k++) {
        double re, im;
        dft_bin(buf, start, k, &re, &im);
        double mag = sqrt(re * re + im * im);
        num += mag * ((double)k * MOVEFORGE_SAMPLE_RATE / DFT_N);
        den += mag;
    }
    return den > 0.0 ? (float)(num / den) : 0.0f;
}

static void init_default(swarf_core_t *s) {
    swarf_init(s);
    s->human = 0.0f;   /* deterministic unless a test asks otherwise */
}

/* --------------------------------------------------------------------------
 * Gain staging
 * ----------------------------------------------------------------------- */

static void test_gain_single_voice_and_all_six(void) {
    /* The -12 dBFS reference is a property of the module output *with voices
     * summing*: four chain slots sum at unity into one int16 mailbox and nothing
     * clamps between stages, so an overshoot wraps rather than clips. Both halves are
     * asserted here rather than only in a golden, because a golden only ever says
     * "unchanged" and a bless can walk the reference away. */
    swarf_core_t s;

    float loudest = 0.0f;
    int loudest_voice = -1;
    for (int v = 0; v < SWARF_VOICES; v++) {
        init_default(&s);
        hit(&s, 36 + v, 1.0f, 44100);
        float p = peak_of(out_l, 0, 44100);
        float pr = peak_of(out_r, 0, 44100);
        if (pr > p) p = pr;
        if (p > loudest) { loudest = p; loudest_voice = v; }
    }
    float loudest_db = 20.0f * log10f(loudest);
    if (loudest_db > -12.0f || loudest_db < -28.0f) {
        fprintf(stderr, "FAIL: loudest single voice (%d) peaks at %.1f dBFS, wanted -28..-12\n",
                loudest_voice, loudest_db);
        exit(1);
    }

    /* All six on the same block, which is what a busy step does and what no
     * monophonic render could ever have exercised. */
    init_default(&s);
    for (int v = 0; v < SWARF_VOICES; v++) swarf_note_on(&s, 36 + v, 1.0f);
    render(&s, 44100);
    float all = peak_of(out_l, 0, 44100);
    float all_r = peak_of(out_r, 0, 44100);
    if (all_r > all) all = all_r;
    float all_db = 20.0f * log10f(all);
    if (all_db > -6.0f) {
        fprintf(stderr, "FAIL: all six voices together peak at %.1f dBFS — too little "
                        "headroom for four chain slots summing\n", all_db);
        exit(1);
    }
    require_true(all > loudest, "six voices are louder than one");
}

static void test_per_voice_loudness_is_balanced(void) {
    /* Ballast's finding was that *perceived loudness* spread separates a good preset
     * set from a bad one, not peak spread. The analogue inside one kit is the balance
     * between its six voices: a kit whose ride is 15 dB under its hat is unusable
     * however clean each voice measures on its own. */
    swarf_core_t s;
    float quietest = 1.0e9f, loudest = 0.0f;
    int quiet_voice = -1, loud_voice = -1;
    for (int v = 0; v < SWARF_VOICES; v++) {
        init_default(&s);
        hit(&s, 36 + v, 1.0f, 44100);
        /* Peak, not RMS over a fixed window. The six voices are 45 ms to 2.4 s long,
         * so a fixed window reads a short hat as 7 dB quieter than a long ride purely
         * for being short — it measures decay, not balance. Peak is
         * decay-independent, and it is also what the -12 dBFS reference is about. */
        float p = peak_of(out_l, 0, 44100);
        if (p < quietest) { quietest = p; quiet_voice = v; }
        if (p > loudest) { loudest = p; loud_voice = v; }
    }
    float spread = 20.0f * log10f(loudest / quietest);
    /* Measured 1.9 dB with the shipped defaults, after balancing each voice's `level`
     * against this same number. 6 dB is loose enough for a deliberate emphasis and
     * tight enough to catch a voice that has drifted out of the kit. */
    if (spread > 6.0f) {
        fprintf(stderr, "FAIL: voice loudness spread is %.1f dB (voice %d loudest, %d quietest)\n",
                spread, loud_voice, quiet_voice);
        exit(1);
    }
}

/* --------------------------------------------------------------------------
 * Velocity
 * ----------------------------------------------------------------------- */

static void test_velocity_brightens_every_voice(void) {
    /* Ballast's regression, times six. Its measured spectral centroid ran *backwards*
     * — 180 Hz at velocity 0.25 down to 146 Hz at full — because the noise layers
     * stayed at full level while the body was attenuated, so a soft hit came out
     * relatively brighter than a hard one. That is the opposite of how a struck object
     * behaves, and it is most of why velocity reads as a level control rather than an
     * expressive one. Every voice is checked, not just one. */
    swarf_core_t s;
    const float velocities[] = { 0.1f, 0.35f, 0.6f, 0.85f, 1.0f };
    for (int v = 0; v < SWARF_VOICES; v++) {
        float previous = -1.0f;
        for (unsigned i = 0; i < sizeof(velocities) / sizeof(velocities[0]); i++) {
            init_default(&s);
            hit(&s, 36 + v, velocities[i], 22050);
            float c = centroid(out_l, 64);
            if (previous >= 0.0f && c < previous * 0.97f) {
                fprintf(stderr, "FAIL: voice %d centroid fell from %.0f Hz to %.0f Hz between "
                                "velocity %.2f and %.2f\n",
                        v, previous, c, velocities[i - 1], velocities[i]);
                exit(1);
            }
            previous = c;
        }
    }
}

static void test_velocity_moves_level_too(void) {
    swarf_core_t s;
    init_default(&s);
    hit(&s, 36, 1.0f, 22050);
    float hard = peak_of(out_l, 0, 22050);
    init_default(&s);
    hit(&s, 36, 0.2f, 22050);
    float soft = peak_of(out_l, 0, 22050);
    require_true(soft < hard * 0.8f, "a soft hit is quieter than a hard one");
    require_true(soft > 0.0f, "a soft hit still sounds");
}

/* --------------------------------------------------------------------------
 * Per-hit variation — the module's stated reason to exist
 * ----------------------------------------------------------------------- */

/* Spread of per-hit energy across eight hits, as a coefficient of variation. */
static float hit_energy_spread(float human) {
    swarf_core_t s;
    const int gap = 8000;
    float energy[8];

    init_default(&s);
    s.human = human;
    for (int i = 0; i < 8; i++) {
        swarf_note_on(&s, 36 + V_CONGA, 1.0f);
        memset(out_l, 0, sizeof(out_l));
        for (int f = 0; f + BLOCK <= gap; f += BLOCK) {
            swarf_process_float(&s, NULL, NULL, out_l + f, out_r + f, BLOCK);
        }
        energy[i] = rms_of(out_l, 0, gap);
    }

    double mean = 0.0;
    for (int i = 0; i < 8; i++) mean += energy[i];
    mean /= 8.0;
    double var = 0.0;
    for (int i = 0; i < 8; i++) var += (energy[i] - mean) * (energy[i] - mean);
    return mean > 0.0 ? (float)(sqrt(var / 8.0) / mean) : 0.0f;
}

static void test_consecutive_hits_differ(void) {
    /* "Sixteen consecutive hats are not sixteen copies" is the claim that justifies
     * this module over a sampler, so it gets asserted numbers rather than a paragraph.
     *
     * Two things this deliberately does *not* do. It does not assert that hits are
     * identical at human = 0: they are not and must not be, because the excitation is
     * a noise source whose sequence carries on across hits — measured, consecutive
     * hits already differ by 228% of their energy with human at 0, i.e. they are
     * essentially uncorrelated. Resetting the RNG per hit to make them match is
     * exactly the sampler behaviour this engine exists to avoid.
     *
     * And it does not measure `human` by that waveform distance, for the same reason:
     * the noise floor of the metric is already 228%, so human moves it by nothing
     * measurable. What human actually varies is pitch, decay, drive, level and pan —
     * so measure the *energy* of each hit, which averages the noise out and leaves
     * exactly those. */
    swarf_core_t s;
    const int gap = 5000;
    static float first_run[4 * 5000];

    /* Reproducibility is the property that has to hold at human = 0, or no golden
     * means anything. */
    for (int run = 0; run < 2; run++) {
        init_default(&s);
        for (int i = 0; i < 4; i++) {
            swarf_note_on(&s, 36, 1.0f);
            memset(out_l, 0, sizeof(out_l));
            for (int f = 0; f + BLOCK <= gap; f += BLOCK) {
                swarf_process_float(&s, NULL, NULL, out_l + f, out_r + f, BLOCK);
            }
            if (run == 0) {
                memcpy(first_run + i * gap, out_l, gap * sizeof(float));
            } else {
                for (int k = 0; k < gap; k++) {
                    require_true(first_run[i * gap + k] == out_l[k],
                                 "the same sequence renders bit-identically");
                }
            }
        }
    }

    /* Even the energy metric has a floor: a stochastic exciter varies the energy of
     * each hit on its own, measured at 33.6% for this voice with human at 0. So
     * subtract it in quadrature and assert what human itself contributes — 32% at
     * human 0.8, which is what +-22% of decay and +-12% of level come to. */
    float still = hit_energy_spread(0.0f);
    float moved = hit_energy_spread(0.8f);
    float own = moved > still ? sqrtf(moved * moved - still * still) : 0.0f;
    if (own < 0.15f) {
        fprintf(stderr, "FAIL: human's own contribution to hit-to-hit energy spread is "
                        "%.1f%% (total %.1f%% against a %.1f%% floor)\n",
                own * 100.0f, moved * 100.0f, still * 100.0f);
        exit(1);
    }
}

/* --------------------------------------------------------------------------
 * The wash gate
 * ----------------------------------------------------------------------- */

static void test_metal_voices_keep_their_top_end(void) {
    /* A thin ride is invisible to every other check here — no clipping, no DC, no NaN,
     * goldens stable — so a bell-ping ride would bless cleanly and ship. Same shape of
     * blind spot as the shared drive suite passing with three of five curves replaced
     * by `return x`.
     *
     * A metal-end voice must still have energy up top well into its tail, and a
     * membrane-end voice must not, or `mat` is not changing the damping profile at
     * all. Mutation-tested by flattening swarf_tilt. */
    swarf_core_t s;
    /* Both windows are inside the tail. Reading the "early" one at the attack would
     * measure how much of the *excitation burst* survives, which is small by
     * construction and says nothing about the damping profile; 100 ms is past the
     * transient and still early in a 3 s ring. */
    const int early = (int)(0.1f * MOVEFORGE_SAMPLE_RATE);
    const int late = (int)(0.5f * MOVEFORGE_SAMPLE_RATE);

    init_default(&s);
    s.ride_mat = 1.0f;          /* free bar */
    s.ride_decay = 0.95f;       /* ~3 s */
    s.ride_body = 0.85f;
    s.ride_level = 1.0f;
    hit(&s, 36 + V_RIDE, 1.0f, N);
    float metal_early = band_energy(out_l, early, 4000.0f, 10000.0f);
    float metal_ratio = metal_early > 0.0f
                      ? band_energy(out_l, late, 4000.0f, 10000.0f) / metal_early : 0.0f;

    init_default(&s);
    s.ride_mat = 0.5f;          /* membrane */
    s.ride_decay = 0.95f;
    s.ride_body = 0.85f;
    s.ride_level = 1.0f;
    hit(&s, 36 + V_RIDE, 1.0f, N);
    float skin_early = band_energy(out_l, early, 4000.0f, 10000.0f);
    float skin_ratio = skin_early > 0.0f
                     ? band_energy(out_l, late, 4000.0f, 10000.0f) / skin_early : 0.0f;

    /* Thresholds from the measured profile, not from taste. 4-10 kHz band energy at
     * 500 ms relative to 100 ms, on a 3 s ring:
     *
     *     mat 0.50 (membrane)  -45.9 dB     mat 0.875   -21.4 dB
     *     mat 0.75 (cluster)   -36.8 dB     mat 1.00 (free bar)  -17.8 dB
     *
     * so 0.008 is half the metal end's measured 0.0165 — a real regression trips it,
     * ordinary drift does not. Mutation-tested by flattening swarf_tilt, which drops
     * the metal end to the membrane end's figure. */
    if (metal_ratio < 0.008f) {
        fprintf(stderr, "FAIL: the metal end keeps only %.5f of its 4-10 kHz energy at 500 ms "
                        "— that is a bell ping, not a ride\n", metal_ratio);
        exit(1);
    }
    if (metal_ratio < skin_ratio * 20.0f) {
        fprintf(stderr, "FAIL: metal end holds %.5f of its top and the membrane end holds "
                        "%.5f — `mat` is not changing the damping profile\n",
                metal_ratio, skin_ratio);
        exit(1);
    }
}

/* --------------------------------------------------------------------------
 * Structure: skipping, early-out, choke, block boundaries
 * ----------------------------------------------------------------------- */

static void test_no_partial_survives_above_nyquist(void) {
    /* At the top of the `tune` range most of a free-bar bank is above Nyquist. Those
     * partials must be *skipped*, not clamped: a clamped partial still sounds, at the
     * wrong pitch, and folds a rising sweep into partials that move downward. */
    swarf_core_t s;
    init_default(&s);
    s.ride_tune = 108.0f;       /* top of the range */
    s.ride_mat = 1.0f;          /* free bar: ratios up to 31.9x */
    s.ride_body = 1.0f;
    s.ride_level = 1.0f;
    hit(&s, 36 + V_RIDE, 1.0f, 22050);

    float above = band_energy(out_l, 512, MOVEFORGE_SAMPLE_RATE * 0.45f,
                              MOVEFORGE_SAMPLE_RATE * 0.499f);
    float total = band_energy(out_l, 512, 20.0f, MOVEFORGE_SAMPLE_RATE * 0.499f);
    float fraction = total > 0.0f ? above / total : 0.0f;
    if (fraction > 0.02f) {
        fprintf(stderr, "FAIL: %.2f%% of the energy sits above 0.45*sr\n", fraction * 100.0f);
        exit(1);
    }
}

static void test_idle_voices_are_actually_skipped(void) {
    /* Count what ran, not just that the output was silent: a voice that renders
     * silence still costs its whole sample loop, six times over. */
    swarf_core_t s;
    init_default(&s);
    require_true(swarf_is_idle(&s), "a fresh module is idle");
    for (int v = 0; v < SWARF_VOICES; v++) {
        require_true(swarf_voice_is_idle(&s, v), "every voice starts idle");
    }

    swarf_note_on(&s, 36, 1.0f);
    require_true(!swarf_voice_is_idle(&s, V_HAT), "the struck voice is live");
    for (int v = 1; v < SWARF_VOICES; v++) {
        require_true(swarf_voice_is_idle(&s, v), "the other five stay idle");
    }

    render(&s, 44100 * 2);
    require_true(swarf_is_idle(&s), "the module returns to idle after the tail");

    /* Trap T1: a muted module must not keep firing transients. Ballast, muted with the
     * transport stopped, still fired its whole transient at -13 dBFS on every hit,
     * forever — because an idle early-out freezes anything smoothed inside the sample
     * loop. */
    init_default(&s);
    s.volume = 0.0f;
    for (int i = 0; i < 8; i++) {
        swarf_note_on(&s, 36, 1.0f);
        render(&s, 8192);
        float p = peak_of(out_l, 0, 8192);
        if (p > 1.0e-4f) {
            fprintf(stderr, "FAIL: hit %d at volume 0 still peaked at %.1f dBFS\n",
                    i, 20.0f * log10f(p));
            exit(1);
        }
    }
}

static void test_choke_silences_the_open_hat(void) {
    /* Mono voices do not give hat self-choke for free — a closed hat retriggering does
     * nothing to a separate open-hat voice — so this is an explicit group, and it has
     * to be a ramp: an instant cut clicks. */
    swarf_core_t s;
    init_default(&s);
    s.choke = 1.0f;
    s.oh_decay = 0.9f;          /* long, so a natural decay cannot pass for a choke */
    s.oh_level = 1.0f;

    swarf_note_on(&s, 36 + V_OH, 1.0f);
    render(&s, 8192);
    float before = rms_of(out_l, 4096, 4096);
    require_true(before > 1.0e-4f, "the open hat is ringing before the choke");

    swarf_note_on(&s, 36 + V_HAT, 1.0f);
    render(&s, 8192);
    /* Well after the ~8 ms ramp and the closed hat's own short decay. */
    float after = rms_of(out_l, 4410, 3000);
    require_true(after < before * 0.15f, "the choke silences the open hat within 100 ms");

    /* And it does it smoothly. Measured with the *triggering* voice silenced: a
     * closed hat's own attack is a percussion onset with a legitimately huge
     * sample-to-sample step, so leaving it in measures the attack rather than the
     * ramp — which is how a choke that cut instantly would still pass. */
    init_default(&s);
    s.choke = 1.0f;
    s.oh_decay = 0.9f;
    s.oh_level = 1.0f;
    s.hat_level = 0.0f;
    swarf_note_on(&s, 36 + V_OH, 1.0f);
    render(&s, 8192);
    float slew_before = 0.0f;
    for (int i = 4097; i < 8192; i++) slew_before += absf_local(out_l[i] - out_l[i - 1]);
    slew_before /= 4095.0f;

    swarf_note_on(&s, 36 + V_HAT, 1.0f);
    render(&s, 8192);
    float worst_step = 0.0f;
    for (int i = 1; i < 2205; i++) {
        float step = absf_local(out_l[i] - out_l[i - 1]);
        if (step > worst_step) worst_step = step;
    }
    if (worst_step > slew_before * 30.0f) {
        fprintf(stderr, "FAIL: the choke ramp stepped %.6f against the ringing voice's own "
                        "%.6f per-sample slew\n", worst_step, slew_before);
        exit(1);
    }

    init_default(&s);
    s.choke = 0.0f;
    s.oh_decay = 0.9f;
    s.oh_level = 1.0f;
    swarf_note_on(&s, 36 + V_OH, 1.0f);
    render(&s, 8192);
    float unchoked_before = rms_of(out_l, 4096, 4096);
    swarf_note_on(&s, 36 + V_HAT, 1.0f);
    render(&s, 8192);
    float unchoked_after = rms_of(out_l, 4410, 3000);
    require_true(unchoked_after > unchoked_before * 0.15f,
                 "with choke off the open hat keeps ringing");
}

static void test_no_discontinuity_across_block_boundaries(void) {
    /* Ballast's trap T4: a loop starting at i = 1 inside the post-trigger buffer never
     * looks at the pair that matters, so the test passes with the feature deleted.
     * This one measures *between* the last sample of one buffer and the first of the
     * next, which is exactly where a per-block coefficient update lands. */
    swarf_core_t s;
    init_default(&s);
    s.human = 0.5f;

    float worst = 0.0f, typical = 0.0f;
    int steps = 0, boundaries = 0, block_index = 0;
    for (int f = 0; f + BLOCK <= 44100 * 2; f += BLOCK, block_index++) {
        if (block_index % 40 == 0) {
            swarf_note_on(&s, 36 + (block_index / 40) % SWARF_VOICES, 0.9f);
        }
        swarf_process_float(&s, NULL, NULL, out_l + f, out_r + f, BLOCK);
        if (f > 0) {
            float across = absf_local(out_l[f] - out_l[f - 1]);
            if (across > worst) worst = across;
            boundaries++;
        }
        for (int i = f + 1; i < f + BLOCK; i++) {
            typical += absf_local(out_l[i] - out_l[i - 1]);
            steps++;
        }
    }
    typical /= (float)steps;
    require_true(boundaries > 100, "enough block boundaries to be worth measuring");
    if (worst > typical * 80.0f) {
        fprintf(stderr, "FAIL: worst block-boundary step is %.5f against a typical in-block "
                        "step of %.5f\n", worst, typical);
        exit(1);
    }
}

/* --------------------------------------------------------------------------
 * Mapping and controls
 * ----------------------------------------------------------------------- */

static void test_note_mapping(void) {
    swarf_core_t s;
    init_default(&s);
    float ratio = 0.0f;

    for (int v = 0; v < SWARF_VOICES; v++) {
        require_true(swarf_voice_for_note(&s, 36 + v, &ratio) == v, "root+n plays voice n");
        require_true(ratio == 1.0f, "a mapped note plays at the voice's own tune");
    }
    require_true(swarf_voice_for_note(&s, 35, &ratio) == -1, "below root plays nothing");
    require_true(swarf_voice_for_note(&s, 42, &ratio) == -1, "above the block plays nothing");

    /* The chromatic zone, which is what a tuned tom or conga run needs — and what
     * keeps note-selects-voice and note-carries-pitch from colliding. */
    s.chrom = 5.0f;
    require_true(swarf_voice_for_note(&s, 60, &ratio) == 4, "the chrom zone plays its voice");
    require_true(absf_local(ratio - 1.0f) < 0.001f, "middle C is the zone's unity point");
    swarf_voice_for_note(&s, 72, &ratio);
    require_true(absf_local(ratio - 2.0f) < 0.001f, "an octave up doubles the ratio");
    require_true(swarf_voice_for_note(&s, 38, &ratio) == 2, "the voice block still wins");

    /* root moves the whole block out of another module's way. */
    init_default(&s);
    s.root = 60.0f;
    require_true(swarf_voice_for_note(&s, 60, &ratio) == 0, "root moves the block");
    require_true(swarf_voice_for_note(&s, 36, &ratio) == -1, "and vacates where it was");
}

static void test_decay_taper(void) {
    /* `decay` is declared 0..1 and mapped exponentially: linear in seconds would put
     * every hat in the bottom 5% of the travel. */
    require_true(absf_local(swarf_decay_seconds(0.0f) - 0.005f) < 1.0e-5f, "0 is 5 ms");
    require_true(absf_local(swarf_decay_seconds(1.0f) - 4.0f) < 0.01f, "1 is 4 s");
    float mid = swarf_decay_seconds(0.5f);
    require_true(mid > 0.13f && mid < 0.15f, "the midpoint is the geometric mean, ~141 ms");
    float previous = 0.0f;
    for (int i = 0; i <= 100; i++) {
        float d = swarf_decay_seconds((float)i / 100.0f);
        require_true(d > previous, "decay rises monotonically across its travel");
        previous = d;
    }
}

static void test_mat_sweeps_without_a_seam(void) {
    /* `mat` is the flagship control and the whole answer to "why not the Drum
     * Sampler", so it has to be sweepable end to end with no dead zone and no step —
     * including across the comb-to-bank crossfade at 0.20-0.30, which is the one
     * structural seam on the axis. */
    swarf_core_t s;
    float previous = -1.0f, worst_jump = 0.0f, worst_at = 0.0f;
    for (int i = 0; i <= 40; i++) {
        float mat = (float)i / 40.0f;
        init_default(&s);
        s.conga_mat = mat;
        s.conga_body = 1.0f;
        s.conga_level = 1.0f;
        hit(&s, 36 + V_CONGA, 1.0f, 22050);
        float energy = rms_of(out_l, 0, 11025);
        require_true(energy > 1.0e-5f, "every point on the mat axis makes a sound");
        if (previous > 0.0f) {
            float jump = absf_local(20.0f * log10f(energy / previous));
            if (jump > worst_jump) { worst_jump = jump; worst_at = mat; }
        }
        previous = energy;
    }
    if (worst_jump > 9.0f) {
        fprintf(stderr, "FAIL: mat steps %.1f dB in one 0.025 move, near %.3f\n",
                worst_jump, worst_at);
        exit(1);
    }
}

static void test_output_is_finite_across_extremes(void) {
    /* Nothing clamps between FX stages downstream, so an overshoot wraps rather than
     * clips. Every parameter at each end, all six voices at once. */
    swarf_core_t s;
    for (int extreme = 0; extreme < 2; extreme++) {
        swarf_init(&s);
        for (int i = 0; i < SWARF_PARAM_COUNT; i++) {
            swarf_set_param(&s, i, extreme ? 1.0e9f : -1.0e9f);
        }
        for (int v = 0; v < SWARF_VOICES; v++) swarf_note_on(&s, 36 + v, 1.0f);
        render(&s, 44100);
        for (int i = 0; i < 44100; i++) {
            if (!isfinite(out_l[i]) || !isfinite(out_r[i]) ||
                absf_local(out_l[i]) > 1.0f || absf_local(out_r[i]) > 1.0f) {
                fprintf(stderr, "FAIL: extreme %d produced %.4f / %.4f at sample %d\n",
                        extreme, out_l[i], out_r[i], i);
                exit(1);
            }
        }
    }
}

static void test_stereo_is_real(void) {
    /* This is the first moveforge module to rely on stereo surviving to the device
     * output, so assert the channels actually differ — and that at spread 0 they do
     * not, which is what makes the control mean something. */
    swarf_core_t s;
    init_default(&s);
    s.spread = 0.0f;
    for (int v = 0; v < SWARF_VOICES; v++) swarf_note_on(&s, 36 + v, 1.0f);
    render(&s, 22050);
    for (int i = 0; i < 22050; i++) {
        require_true(out_l[i] == out_r[i], "spread 0 is mono");
    }

    init_default(&s);
    s.spread = 1.0f;
    for (int v = 0; v < SWARF_VOICES; v++) swarf_note_on(&s, 36 + v, 1.0f);
    render(&s, 22050);
    double diff = 0.0, energy = 0.0;
    for (int i = 0; i < 22050; i++) {
        double d = (double)out_l[i] - out_r[i];
        diff += d * d;
        energy += (double)out_l[i] * out_l[i];
    }
    require_true(diff > energy * 0.05, "spread 1 puts the voices in different places");
}

int main(void) {
    test_decay_taper();
    test_note_mapping();
    test_gain_single_voice_and_all_six();
    test_per_voice_loudness_is_balanced();
    test_velocity_brightens_every_voice();
    test_velocity_moves_level_too();
    test_consecutive_hits_differ();
    test_metal_voices_keep_their_top_end();
    test_no_partial_survives_above_nyquist();
    test_idle_voices_are_actually_skipped();
    test_choke_silences_the_open_hat();
    test_no_discontinuity_across_block_boundaries();
    test_mat_sweeps_without_a_seam();
    test_output_is_finite_across_extremes();
    test_stereo_is_real();
    printf("swarf core tests passed\n");
    return 0;
}
