#include <math.h>
#include <string.h>

#include "modules/_shared/dsp_runtime.h"
#include "modules/_shared/mf_dsp.h"
#include "swarf_core.h"

/* Calibrated so the loudest kit at velocity 127 peaks near -12 dBFS at the module
 * output *with voices summing* — four chain slots sum at unity into one int16
 * mailbox and nothing clamps between stages, so an overshoot wraps rather than
 * clips. Each voice inside therefore sits nearer -18 dBFS, which is also musically
 * right: a kick should be louder than a hat.
 *
 * Measured, not guessed: the loudest kit on its own render pattern is calibrated to
 * land on -12.0 dBFS with this value. Re-derive it if the preset
 * bank changes — tests/test_swarf_plugin.c asserts the result. */
#define SWARF_OUT_TRIM 0.553f

/* Below this a voice contributes nothing and its sample loop is skipped entirely.
 * Both stages of the amp envelope are tested — see mf_decay_is_idle. */
#define SWARF_IDLE_EPS 1.0e-5f

/* Carries a T60 out to SWARF_IDLE_EPS. T60 is the -60 dB time and the eps above is
 * -100 dB, so a partial needs 100/60 of its T60 to get there. */
#define SWARF_RING_TO_EPS 1.667f

#define SWARF_DECLICK_S 0.004f
#define SWARF_CHOKE_S 0.008f
#define SWARF_DRIVE_ENV_FLOOR 0.12f

/* The bus drive is gain-compensated, and the brief said it would not need to be — it
 * argued that a sum with a hit every sixteenth is "roughly continuous", so a static
 * pre-gain would glue rather than limit. Measured against this module's own output,
 * that is false. The bus crest factor is 26 dB, barely below a single voice's, so a
 * static pre-gain flattens it the same way. Level change across the `drive` range,
 * uncompensated:
 *
 *     curve    soft   asym   clip   fold  crush
 *     +RMS    +21.9  +17.9  +20.1  +16.2   +0.9  dB
 *     crest    26->8  26->13 24->4  26->11 26->23 dB
 *
 * — `drive` was a loudness control with a side of tone, and it left two Tool kits
 * 19 dB louder than the rest of the bank.
 *
 * The fix is *not* the per-voice trick of dividing by the envelope: a voice knows its
 * envelope in advance, a bus does not, and a follower fast enough to matter still
 * lags a percussion transient — tried, and it crushed every attack down to the
 * follower's floor (peaks fell 10 dB and the crest factor got worse, not better).
 *
 * So: measure what the stage did to the previous block and correct by it. Two
 * accumulators, one block of latency on a *level* correction, and it adapts to any
 * curve and any signal rather than to a fitted constant. Both sums are taken before
 * compensation, so this cannot feed back on itself. */
#define SWARF_BUS_COMP_MAX 8.0f
#define SWARF_BUS_COMP_GLIDE 0.25f

/* `decay` is declared 0..1 rather than in seconds. Percussion spans 5 ms to 4 s —
 * nearly three orders of magnitude — and a linear-in-seconds control would put every
 * hat in the bottom 5% of its travel. Exponential, so a Route Motion lane sweeping
 * it reads as linear in *perceived* length, which is what the lane is for. A
 * deliberate divergence from ballast, whose single voice spans one order and stays
 * linear so its automation stays linear in time. */
/* The comb and the partial bank are the two halves of one control, so they have to
 * arrive at similar level or `mat` becomes a volume knob. Measured at the conga's
 * own settings, body 1, across the 0.20-0.30 crossfade:
 *
 *     comb   peak -14.2 dBFS   RMS -57.6 dBFS   crest 43 dB
 *     bank   peak -16.4 dBFS   RMS -44.8 dBFS   crest 28 dB
 *
 * The comb is 13 dB quieter in energy and 15 dB peakier — it is a click train, which
 * is exactly right for wood and block and exactly why it needs help to sit beside a
 * ringing bank. Closing the gap fully would put its peak at -1.4 dBFS, so this closes
 * about a third of it and the rest is left to each voice's `level`. */
#define SWARF_COMB_GAIN 1.6f

#define SWARF_DECAY_MIN 0.005f
#define SWARF_DECAY_SPAN 800.0f   /* 0.005 * 800 = 4 s */

float swarf_decay_seconds(float position)
{
    return SWARF_DECAY_MIN * powf(SWARF_DECAY_SPAN, moveforge_clampf(position, 0.0f, 1.0f));
}

/* Ratio anchors for the `mat` morph, 10 partials each.
 *
 * A zero means the anchor has no partial there; the interpolation holds the
 * neighbouring anchor's ratio and fades the partial's gain instead, so the count
 * changes without a click or a jump in pitch.
 *
 * membrane is the ideal circular membrane's j_mn / j_01; free_bar is
 * (beta_n/beta_0)^2 for the ideal free-free bar; cluster is the 808 hi-hat's six
 * oscillator ratios, and it has exactly six because the circuit has six oscillators
 * — padding it with invented partials would make it something other than the thing
 * it is named after. */
static const float SWARF_ANCHOR[4][SWARF_PARTIALS] = {
    /* harmonic */ { 1.0f, 2.0f, 3.0f, 4.0f, 5.0f, 6.0f, 7.0f, 8.0f, 9.0f, 10.0f },
    /* membrane */ { 1.0f, 1.593f, 2.136f, 2.295f, 2.653f, 2.917f, 3.156f, 3.5f, 3.598f, 3.647f },
    /* cluster  */ { 1.0f, 1.447f, 1.617f, 1.927f, 2.503f, 2.664f, 0.0f, 0.0f, 0.0f, 0.0f },
    /* free bar */ { 1.0f, 2.757f, 5.404f, 8.933f, 13.345f, 18.638f, 24.814f, 31.872f, 0.0f, 0.0f }
};

/* How fast the upper partials die relative to the fundamental:
 * T60_k = T60_1 * (f_1/f_k)^tilt.
 *
 * A function of `mat`, not a constant. A drum head damps strongly with frequency; a
 * metal plate barely does, and a fixed positive tilt strips the top off a long hit —
 * which turns a ride into a bell ping, the thing a 10-partial bank is least naturally
 * good at. Asserted by the wash gate in tests/test_swarf_core.c. */
static float swarf_tilt(float mat)
{
    if (mat <= 0.5f) return 0.70f;                       /* membrane and below */
    return 0.70f - 0.50f * ((mat - 0.5f) * 2.0f);        /* 0.70 -> 0.20 at free bar */
}

static void swarf_anchor_pair(float mat, int *a, int *b, float *t)
{
    if (mat <= 0.25f) { *a = 0; *b = 0; *t = 0.0f; return; }
    if (mat < 0.5f)   { *a = 0; *b = 1; *t = (mat - 0.25f) * 4.0f; return; }
    if (mat < 0.75f)  { *a = 1; *b = 2; *t = (mat - 0.5f) * 4.0f; return; }
    *a = 2; *b = 3; *t = moveforge_clampf((mat - 0.75f) * 4.0f, 0.0f, 1.0f);
}

/* Rebuild one voice's partial bank. Per block, and only when something it depends on
 * changed — ten cosf + ten sinf + ten expf per voice per block is real money if it
 * is recomputed unconditionally. */
static void swarf_build_bank(swarf_voice_t *v, float f0, float decay_s, float mat,
                             float vel_bright)
{
    int ia, ib;
    float t;
    swarf_anchor_pair(mat, &ia, &ib, &t);
    float tilt = swarf_tilt(mat);
    /* Velocity has to reach the *resonant* path, not just its share of the mix.
     * Scaling only the direct excitation leaves a body-heavy voice with no timbre
     * response at all — measured, the wood voice's centroid sat flat at 5035 Hz
     * across the entire velocity range and the conga's moved 351 to 402 Hz, which is
     * ballast's "velocity is a level control" regression wearing a different hat.
     *
     * A soft strike puts less energy into the higher modes, so it tilts the bank's
     * *gains* by the same ratio the decay tilt uses. Ratio-relative by construction,
     * which a fixed-frequency filter cannot be: the multiplier that darkens a 233 Hz
     * conga usefully is far too dark for a 1 kHz hat. */
    float vel_tilt = (1.0f - moveforge_clampf(vel_bright, 0.0f, 1.0f)) * 1.5f;

    float ratio[SWARF_PARTIALS];
    float gain[SWARF_PARTIALS];
    float total = 0.0f;
    for (int k = 0; k < SWARF_PARTIALS; k++) {
        float ra = SWARF_ANCHOR[ia][k];
        float rb = SWARF_ANCHOR[ib][k];
        float fade;
        if (ra > 0.0f && rb > 0.0f) { ratio[k] = ra + (rb - ra) * t; fade = 1.0f; }
        else if (ra > 0.0f)         { ratio[k] = ra; fade = 1.0f - t; }
        else if (rb > 0.0f)         { ratio[k] = rb; fade = t; }
        else                        { ratio[k] = 1.0f; fade = 0.0f; }
        gain[k] = fade / (float)(k + 1);
        if (vel_tilt > 0.0f && ratio[k] > 1.0f) gain[k] *= powf(ratio[k], -vel_tilt);
        total += gain[k];
    }
    if (total <= 0.0f) total = 1.0f;

    v->live_count = 0;
    for (int k = 0; k < SWARF_PARTIALS; k++) {
        float f = f0 * ratio[k];
        float g = gain[k] / total;
        /* Skipping is load-bearing, not an optimisation: muting rather than letting
         * mf_reson_set clamp is what stops a rising `tune` from generating partials
         * that fold downward as the knob goes up. */
        if (!mf_reson_audible(f, g)) continue;
        float t60 = decay_s * powf(f0 / f, tilt);
        mf_reson_set(&v->partial_co[k], f, t60);
        v->partial_gain[k] = g;
        v->live[v->live_count++] = k;
    }
}

/* A comb is infinitely many harmonic partials for almost nothing, and gives the
 * hollow/plastic/pipe character that a handful of resonators at harmonic ratios only
 * imitates thinly. Feedback set so the ring decays 60 dB in `decay_s`: one round trip
 * is 1/f0 seconds, so f0*decay_s of them fit inside the tail. */
static void swarf_build_comb(swarf_voice_t *v, float f0, float decay_s, float mat,
                             float vel_bright)
{
    float delay = MOVEFORGE_SAMPLE_RATE / moveforge_clampf(f0, 20.0f, 8000.0f);
    if (delay > (float)(SWARF_COMB_LEN - 2)) delay = (float)(SWARF_COMB_LEN - 2);
    if (delay < 2.0f) delay = 2.0f;
    v->comb_delay = delay;
    {
        float frac = delay - (float)(int)delay;
        v->comb_ap_c = (1.0f - frac) / (1.0f + frac);
    }

    float trips = f0 * decay_s;
    if (trips < 0.5f) trips = 0.5f;
    v->comb_fb = moveforge_clampf(expf(-6.9078f / trips), 0.0f, 0.995f);

    /* Damping in the feedback path is what makes this read as wood or plastic rather
     * than as a tuned delay line: each round trip loses more top than bottom. */
    /* Same idea as the bank's velocity tilt, in the only place a comb has to put it:
     * a softer hit damps the feedback path harder, so fewer harmonics survive each
     * round trip. Relative to f0, so it means the same thing at every pitch. */
    float damp_hz = f0 * (1.5f + 14.0f * moveforge_clampf(vel_bright, 0.0f, 1.0f));
    v->comb_damp_a = moveforge_clampf(MOVEFORGE_TWO_PI * damp_hz / MOVEFORGE_SAMPLE_RATE,
                                      0.02f, 0.95f);

    /* The comb-to-bank transition is a structural seam, so it is a crossfade rather
     * than a morph — sitting between "dense harmonic" and "sparse harmonic", the
     * smallest perceptual gap on the whole axis, which is the right place to hide it.
     * Both are driven from the same f0, so the crossfade stays musical. */
    v->comb_mix = 1.0f - moveforge_clampf((mat - 0.20f) * 10.0f, 0.0f, 1.0f);
}

static float swarf_note_hz(float semitones, float bend)
{
    float n = moveforge_clampf(semitones + bend * 2.0f, 0.0f, 127.0f);
    return 440.0f * powf(2.0f, (n - 69.0f) / 12.0f);
}

static void swarf_voice_init(swarf_voice_t *v, int index)
{
    memset(v, 0, sizeof(*v));
    /* Seeded from a constant mixed with the voice index. Six voices sharing one seed
     * draw the identical noise sequence, so they sum coherently at +15.6 dB instead
     * of +7.8 and six hits sound like one loud hit. Still deterministic, so renders
     * stay reproducible. */
    mf_rng_init(&v->rng, 0x8A11A57u + (uint32_t)index * 0x9E3779B9u);
    mf_exciter_init(&v->exciter, 0x5EED0000u + (uint32_t)index * 0x85EBCA6Bu);
    mf_decay_init(&v->amp);
    mf_svf_init(&v->tone_filt);
    mf_drive_init(&v->drive);
    for (int k = 0; k < SWARF_PARTIALS; k++) mf_reson_init(&v->partial[k]);
    v->choke_gain = 1.0f;
    v->hit_tune = 1.0f;
    v->hit_decay = 1.0f;
    v->hit_drive = 1.0f;
    v->hit_level = 1.0f;
    v->pan_l = 0.70710678f;
    v->pan_r = 0.70710678f;
    v->velocity = 1.0f;
    v->dirty = 1;
}

/* Clear the resonant state as well as the envelopes.
 *
 * Needed only since the partials stopped being gated by the amp envelope: a choked
 * or stopped voice holds its ring in swarf_voice_t's filter state, muted by
 * choke_gain rather than gone. Retriggering snaps choke_gain back to 1, so without
 * this the *previous* hit's tail reappears underneath the new one. The comb memset
 * is the expensive part and it happens on all-notes-off and choke completion only,
 * never per block. */
static void swarf_voice_silence(swarf_voice_t *v)
{
    mf_decay_release(&v->amp);
    mf_exciter_release(&v->exciter);
    for (int k = 0; k < SWARF_PARTIALS; k++) mf_reson_init(&v->partial[k]);
    memset(v->comb, 0, sizeof(v->comb));
    v->comb_ap = 0.0f;
    v->comb_damp = 0.0f;
    v->ring_left = 0;
}

void swarf_init(swarf_core_t *s)
{
    if (!s) return;
    memset(s, 0, sizeof(*s));
    for (int v = 0; v < SWARF_VOICES; v++) swarf_voice_init(&s->voice[v], v);

    mf_tilt_init(&s->tilt_l, 1500.0f);
    mf_tilt_init(&s->tilt_r, 1500.0f);
    mf_drive_init(&s->bus_drive_l);
    mf_drive_init(&s->bus_drive_r);
    mf_dcblock_init(&s->dc_l);
    mf_dcblock_init(&s->dc_r);
    mf_smooth_init_gain(&s->volume_sm, 15.0f, 5.0f);
    s->declick_coeff = expf(-3.0f / (SWARF_DECLICK_S * MOVEFORGE_SAMPLE_RATE));
    s->bus_comp = 1.0f;

    /* The gather table. Order must match the SWARF_VP_* enum, which is the
     * declaration order of a voice's level in module.json. */
#define SWARF_BIND(i, prefix)                        \
    s->vp[i][SWARF_VP_TUNE]   = &s->prefix##_tune;   \
    s->vp[i][SWARF_VP_DECAY]  = &s->prefix##_decay;  \
    s->vp[i][SWARF_VP_MAT]    = &s->prefix##_mat;    \
    s->vp[i][SWARF_VP_BODY]   = &s->prefix##_body;   \
    s->vp[i][SWARF_VP_TONE]   = &s->prefix##_tone;   \
    s->vp[i][SWARF_VP_STRIKE] = &s->prefix##_strike; \
    s->vp[i][SWARF_VP_GRIT]   = &s->prefix##_grit;   \
    s->vp[i][SWARF_VP_LEVEL]  = &s->prefix##_level
    SWARF_BIND(0, hat);
    SWARF_BIND(1, oh);
    SWARF_BIND(2, ride);
    SWARF_BIND(3, clap);
    SWARF_BIND(4, conga);
    SWARF_BIND(5, wood);
#undef SWARF_BIND

    swarf_apply_defaults(s);
    mf_smooth_snap(&s->volume_sm, s->volume);
}

#include "swarf_params.gen.inc"

/* Which voice a note plays, and at what pitch ratio.
 *
 * root..root+5 trigger the six voices at their own `tune`. Notes at root+12 and
 * above play the voice named by `chrom` chromatically, tracking relative to middle C
 * — which is what a tuned tom or conga run needs, without a mode switch, and it
 * leaves `root` free to move the block out of another module's way. */
int swarf_voice_for_note(const swarf_core_t *s, int note, float *out_ratio)
{
    if (out_ratio) *out_ratio = 1.0f;
    if (!s) return -1;
    int root = (int)(s->root + 0.5f);

    if (note >= root && note < root + SWARF_VOICES) return note - root;

    int chrom = (int)(s->chrom + 0.5f);
    if (chrom > 0 && note >= root + 12) {
        if (out_ratio) *out_ratio = powf(2.0f, (float)(note - 60) / 12.0f);
        return chrom - 1;
    }
    return -1;
}

/* Mono voices do *not* give hat self-choke for free: a closed hat retriggering does
 * nothing to a separate open-hat voice. Cross-voice choke needs an explicit group. */
static void swarf_choke_others(swarf_core_t *s, int voice)
{
    int group = (int)(s->choke + 0.5f);
    if (group <= 0) return;
    int members = (group == 1) ? 2 : 3;
    if (voice >= members) return;
    for (int v = 0; v < members; v++) {
        if (v == voice) continue;
        swarf_voice_t *o = &s->voice[v];
        /* The whole voice, not just its amp envelope: since the partials stopped
         * being gated by that envelope, a voice can be ringing loudly with both of
         * its stages long spent, and testing the envelope alone would leave exactly
         * the sounds a choke group exists for — a long open hat — unchokeable. */
        if (swarf_voice_is_idle(s, v)) continue;
        /* A ramp, not a cut: an instant mute clicks. Not the declick's job either —
         * that one exists for retrigger steps, and this ramp is continuous by
         * construction. */
        o->choke_step = -o->choke_gain / (SWARF_CHOKE_S * MOVEFORGE_SAMPLE_RATE);
    }
}

void swarf_note_on(swarf_core_t *s, int note, float velocity)
{
    if (!s) return;
    float ratio = 1.0f;
    int idx = swarf_voice_for_note(s, note, &ratio);
    if (idx < 0) return;

    /* Trap T1, on a bus control rather than a voice one. The module early-outs while
     * idle, so the sample loop that advances the volume smoother does not run — the
     * smoother is frozen at whatever it held when the kit last went quiet, and the
     * first hit after a preset load or an automation move comes out at the *old*
     * volume for 15 ms. Measured: three kits peaked 4 dB hot in every golden, which
     * read as a limiter problem and was not one. Snap when a hit starts from silence;
     * a volume change inside a running groove still glides, which is what the
     * smoother is for. */
    if (swarf_is_idle(s)) mf_smooth_snap(&s->volume_sm, moveforge_clampf(s->volume, 0.0f, 1.0f));

    swarf_voice_t *v = &s->voice[idx];
    float human = moveforge_clampf(s->human, 0.0f, 1.0f);

    /* Per-hit variation, drawn from this voice's own RNG. The one thing a host LFO
     * structurally cannot do, which is why it lives in the module and a
     * general-purpose LFO does not. Hats want more decay and tone movement and less
     * pitch than a kick, so the depths differ from ballast's. */
    v->hit_tune = ratio * (1.0f + human * mf_rng_bipolar(&v->rng) * 0.012f);  /* +-20 cents */
    v->hit_decay = 1.0f + human * mf_rng_bipolar(&v->rng) * 0.22f;
    v->hit_drive = 1.0f + human * mf_rng_bipolar(&v->rng) * 0.25f;
    v->hit_level = 1.0f + human * mf_rng_bipolar(&v->rng) * 0.12f;

    v->pending_velocity = moveforge_clampf(velocity, 0.0f, 1.0f);
    /* 0-3 ms, deterministic per voice. MIDI's block quantisation makes two voices on
     * one step sample-exactly simultaneous, which is much of what reads as
     * machine-like. Latency is not fixable; simultaneity is. */
    v->pending_delay = (int)(human * (0.0005f + 0.0025f * (float)idx / (float)(SWARF_VOICES - 1))
                             * MOVEFORGE_SAMPLE_RATE);
    v->pending = 1;
    v->dirty = 1;

    swarf_choke_others(s, idx);
}

void swarf_note_off(swarf_core_t *s, int note)
{
    /* Percussion is one-shot: a note-off does not stop the ring. Retriggering does,
     * and so does the choke group. */
    (void)s;
    (void)note;
}

void swarf_all_notes_off(swarf_core_t *s)
{
    if (!s) return;
    for (int i = 0; i < SWARF_VOICES; i++) {
        swarf_voice_silence(&s->voice[i]);
        s->voice[i].pending = 0;
        s->voice[i].choke_gain = 1.0f;
        s->voice[i].choke_step = 0.0f;
    }
}

void swarf_pitch_bend(swarf_core_t *s, float bend)
{
    if (!s) return;
    s->pitch_bend = moveforge_clampf(bend, -1.0f, 1.0f);
    for (int i = 0; i < SWARF_VOICES; i++) s->voice[i].dirty = 1;
}

int swarf_voice_is_idle(const swarf_core_t *s, int voice)
{
    if (!s || voice < 0 || voice >= SWARF_VOICES) return 1;
    const swarf_voice_t *v = &s->voice[voice];
    return !v->pending
        && v->ring_left <= 0
        && mf_decay_is_idle(&v->amp, SWARF_IDLE_EPS)
        && mf_exciter_is_idle(&v->exciter, SWARF_IDLE_EPS);
}

int swarf_is_idle(const swarf_core_t *s)
{
    if (!s) return 1;
    for (int i = 0; i < SWARF_VOICES; i++) if (!swarf_voice_is_idle(s, i)) return 0;
    /* The DC blocker's state has to be in the test or the bus tail is truncated. */
    return fabsf(s->declick_l) < SWARF_IDLE_EPS && fabsf(s->declick_r) < SWARF_IDLE_EPS
        && fabsf(s->dc_l.y1) < SWARF_IDLE_EPS && fabsf(s->dc_r.y1) < SWARF_IDLE_EPS;
}

/* Recompute everything one voice needs. Per block, never per sample: every
 * transcendental in this engine lives in here, which is why the sample loop below
 * has no sinf, powf, expf or tanf in it at all. */
static void swarf_voice_prepare(swarf_core_t *s, int idx)
{
    swarf_voice_t *v = &s->voice[idx];
    float * const *p = s->vp[idx];

    float vel = v->velocity;
    float vd = moveforge_clampf(s->vel_depth, 0.0f, 1.0f);
    float vel_pitch = 1.0f - vd * 0.30f * (1.0f - vel);
    float vel_drive = 1.0f - vd * 0.40f * (1.0f - vel);
    /* Noise and excitation scale by velocity *squared*, i.e. steeper than level.
     * Without it a soft hit comes out relatively brighter than a hard one and the
     * spectral centroid runs backwards — the opposite of how a struck object
     * behaves, and most of why velocity reads as a level control. */
    float vel_bright = 1.0f - vd * (1.0f - vel * vel);

    /* The three macros exist for Route Motion: one lane that opens every decay in
     * the kit over eight bars is a move the per-voice controls cannot make. */
    float mat = moveforge_clampf(*p[SWARF_VP_MAT] + (s->warp - 0.5f) * 0.5f, 0.0f, 1.0f);
    float tone = moveforge_clampf(*p[SWARF_VP_TONE] + (s->bright - 0.5f) * 0.5f, 0.0f, 1.0f);
    float body = moveforge_clampf(*p[SWARF_VP_BODY], 0.0f, 1.0f);

    float kit_mul = 0.25f * powf(16.0f, moveforge_clampf(s->kit_decay, 0.0f, 1.0f));
    float decay_s = swarf_decay_seconds(*p[SWARF_VP_DECAY]) * kit_mul * v->hit_decay;
    decay_s = moveforge_clampf(decay_s, 0.004f, 8.0f);

    float f0 = swarf_note_hz(*p[SWARF_VP_TUNE], s->pitch_bend) * v->hit_tune * vel_pitch;

    swarf_build_bank(v, f0, decay_s, mat, vel_bright);
    swarf_build_comb(v, f0, decay_s, mat, vel_bright);
    mf_decay_set(&v->amp_co, decay_s, moveforge_clampf(s->shape, 0.0f, 1.0f));

    /* How long one hit rings, now that the amp envelope no longer ends it. Every
     * partial's T60 is decay_s * (f0/f_k)^tilt with every anchor ratio >= 1 and every
     * tilt >= 0, so no partial outlasts decay_s, and swarf_build_comb sets the comb's
     * feedback to the same figure. Extended rather than reset when a parameter moves
     * mid-ring, or a Route Motion lane on `decay` would keep restarting the count and
     * the voice would never reach the early-out. */
    v->ring_samples = (int)(decay_s * SWARF_RING_TO_EPS * MOVEFORGE_SAMPLE_RATE) + 1;
    if (v->ring_samples > v->ring_left) v->ring_left = v->ring_samples;
    /* Bounded by this voice's own decay: excitation that outlasts the resonance it
     * excites makes `strike` a decay control that outranks `decay`. See
     * mf_exciter_set for the floors this removes. */
    mf_exciter_set(&v->exciter_co, moveforge_clampf(*p[SWARF_VP_STRIKE], 0.0f, 1.0f),
                   decay_s);

    /* One SVF as a monotone brightness sweep, so the knob never reverses: a 20 kHz
     * lowpass and a 20 Hz highpass are both transparent, so the halves meet
     * continuously at the centre. Resonant colour comes from the partial bank; this
     * is brightness only. Q ~1.2 — a slight corner emphasis is what makes a hat sit.
     * Picked per block, not per sample. */
    if (tone < 0.5f) {
        v->tone_is_highpass = 0;
        mf_svf_set(&v->tone_co, 300.0f * powf(66.7f, tone * 2.0f), 0.224f);
    } else {
        v->tone_is_highpass = 1;
        mf_svf_set(&v->tone_co, 20.0f * powf(600.0f, (tone - 0.5f) * 2.0f), 0.224f);
    }

    float grit = moveforge_clampf(*p[SWARF_VP_GRIT], 0.0f, 1.0f) * v->hit_drive * vel_drive;
    mf_drive_set(&v->drive_co, (int)(s->curve + 0.5f), moveforge_clampf(grit, 0.0f, 1.0f));

    v->exc_gain = (1.0f - body) * vel_bright;
    v->bank_gain = body;

    /* Equal-power pan, spread outward from the centre by voice index, with a per-hit
     * jitter so two hits of one voice do not land in exactly the same place. Per-voice
     * pan survives to the device output: render_block writes interleaved L/R straight
     * into the chain buffer and every stage downstream is index-wise. */
    float spread = moveforge_clampf(s->spread, 0.0f, 1.0f);
    float slot = ((float)idx / (float)(SWARF_VOICES - 1)) * 2.0f - 1.0f;
    float jitter = mf_rng_bipolar(&v->rng) * 0.15f * moveforge_clampf(s->human, 0.0f, 1.0f);
    float pos = moveforge_clampf((slot + jitter) * spread, -1.0f, 1.0f);
    float angle = (pos * 0.5f + 0.5f) * (MOVEFORGE_TWO_PI * 0.25f);
    v->pan_l = cosf(angle);
    v->pan_r = sinf(angle);

    float vel_gain = 1.0f - vd * (1.0f - vel);
    v->out_gain = moveforge_clampf(*p[SWARF_VP_LEVEL], 0.0f, 1.0f) * vel_gain * v->hit_level;
    v->dirty = 0;
}

static void swarf_render_voice(swarf_core_t *s, int idx, float *out_l, float *out_r, int frames)
{
    swarf_voice_t *v = &s->voice[idx];

    for (int i = 0; i < frames; i++) {
        if (v->pending) {
            if (v->pending_delay > 0) { v->pending_delay--; continue; }
            /* Trap T1: an idle early-out freezes anything smoothed inside the sample
             * loop, so every ramped control is *snapped* here rather than glided.
             * Ballast, muted with the transport stopped, still fired its whole
             * transient at -13 dBFS on every hit, forever. */
            v->velocity = v->pending_velocity;
            v->pending = 0;
            v->choke_gain = 1.0f;
            v->choke_step = 0.0f;
            swarf_voice_prepare(s, idx);
            mf_decay_trigger(&v->amp);
            mf_exciter_trigger(&v->exciter, &v->exciter_co);
            v->ring_left = v->ring_samples;
        }

        if (v->ring_left > 0) v->ring_left--;

        float env = mf_decay_tick(&v->amp, &v->amp_co);
        float exc = mf_exciter_tick(&v->exciter, &v->exciter_co);

        /* --- partials --- */
        float bank = 0.0f;
        if (v->comb_mix < 1.0f) {
            for (int n = 0; n < v->live_count; n++) {
                int k = v->live[n];
                bank += mf_reson_tick(&v->partial[k], &v->partial_co[k], exc) * v->partial_gain[k];
            }
        }
        float comb = 0.0f;
        if (v->comb_mix > 0.0f) {
            /* Allpass fractional delay, not linear interpolation. A linear
             * interpolator's *magnitude* depends on the fractional part — unity at
             * frac 0, a null at Nyquist at frac 0.5 — so the comb's brightness swings
             * with the arbitrary fractional part of sr/f0. Measured: velocity's 3%
             * pitch move swept that fraction and the wood voice's spectral centroid
             * swung +-30% with it, non-monotonically, which is exactly the velocity
             * regression this engine is supposed to have fixed. An allpass has flat
             * magnitude, so only the phase moves. */
            float read = (float)v->comb_write - v->comb_delay;
            if (read < 0.0f) read += (float)SWARF_COMB_LEN;
            int i0 = (int)read;
            int i1 = (i0 + 1) & (SWARF_COMB_LEN - 1);
            float older = v->comb[i0 & (SWARF_COMB_LEN - 1)];
            float newer = v->comb[i1];
            comb = v->comb_ap_c * newer + older - v->comb_ap_c * v->comb_ap;
            v->comb_ap = mf_flush_denorm(comb);
            v->comb_damp += v->comb_damp_a * (comb - v->comb_damp);
            v->comb_damp = mf_flush_denorm(v->comb_damp);
            v->comb[v->comb_write] = mf_flush_denorm(exc + v->comb_damp * v->comb_fb);
            v->comb_write = (v->comb_write + 1) & (SWARF_COMB_LEN - 1);
        }
        float resonant = comb * (v->comb_mix * SWARF_COMB_GAIN) + bank * (1.0f - v->comb_mix);

        /* The two paths are enveloped differently because only one of them needs an
         * envelope. A resonator's T60 *is* its decay, and the comb's feedback is set
         * from the same figure, so multiplying either by an amp envelope of the same
         * length applies the decay twice: two exponentials at T60 = D multiply to
         * T60 = D/2. Measured on the conga before this split, at shape 0 —
         *
         *     knob      0.450   0.631   0.800   0.950
         *     asked     101ms   339ms  1051ms  2864ms
         *     got        90ms   170ms   515ms  1365ms
         *     ratio      0.89    0.50    0.49    0.48
         *
         * — so `decay` was a knob that lied by an octave everywhere it mattered, and
         * a ride could not reach 2 s because reaching it meant asking for 4.
         *
         * The excitation path is a different case: it is a noise burst, not a
         * resonance, and its only length is whatever envelope it is given. It keeps
         * the full amp envelope, which is what leaves `decay` meaningful at body 0.
         *
         * `shape` survives on the resonant path as the linear stage alone. That is
         * the half of it that is not double-counting: an exponential amp stage over
         * an exponentially decaying partial is the bug above, but a linear ramp to
         * zero over one is a *gate*, which is exactly the abrupt electronic ending
         * the control exists to reach. At shape 0 the gate is open and the partials
         * ring for their own T60. */
        float gate = 1.0f - v->amp_co.shape_w * (1.0f - v->amp.lin_v);

        float mix = exc * v->exc_gain * env + resonant * v->bank_gain * gate;

        /* --- filter --- */
        mf_svf_tick(&v->tone_filt, &v->tone_co, mix);
        float y = v->tone_is_highpass ? v->tone_filt.hp : v->tone_filt.lp;

        /* --- drive, normalised by this voice's own envelope ---
         * Distort y/env and reimpose env, exactly as ballast does. A static pre-gain
         * into a decaying voice is an infinite-ratio limiter: ballast measured crest
         * factor collapsing from 11.9 dB to 1.9 dB with a 426 ms flat top, which is a
         * square wave, not a drum. Per voice rather than global is structural — 808
         * hat density comes from clipping the clustered partials, so a global drive
         * would make the hats metallic by also driving the conga. */
        float norm = env > SWARF_DRIVE_ENV_FLOOR ? env : SWARF_DRIVE_ENV_FLOOR;
        y = mf_drive_tick(&v->drive, &v->drive_co, y / norm) * norm;

        if (v->choke_step != 0.0f) {
            v->choke_gain += v->choke_step;
            if (v->choke_gain <= 0.0f) {
                v->choke_gain = 0.0f;
                v->choke_step = 0.0f;
                swarf_voice_silence(v);
            }
        }

        float g = v->out_gain * v->choke_gain;
        out_l[i] += y * g * v->pan_l;
        out_r[i] += y * g * v->pan_r;
    }
}

void swarf_process_float(swarf_core_t *s,
                         const float *in_left, const float *in_right,
                         float *out_left, float *out_right,
                         int frames)
{
    (void)in_left;
    (void)in_right;
    if (!s || !out_left || !out_right || frames <= 0) return;

    /* Module-level early-out. An idle voice accumulates nothing into the bus, so it
     * costs literally nothing — not even a memset. */
    if (swarf_is_idle(s)) {
        memset(out_left, 0, (size_t)frames * sizeof(float));
        memset(out_right, 0, (size_t)frames * sizeof(float));
        s->sounded = 0;
        return;
    }

    memset(out_left, 0, (size_t)frames * sizeof(float));
    memset(out_right, 0, (size_t)frames * sizeof(float));

    for (int v = 0; v < SWARF_VOICES; v++) {
        if (swarf_voice_is_idle(s, v)) continue;
        if (s->voice[v].dirty && !s->voice[v].pending) swarf_voice_prepare(s, v);
        swarf_render_voice(s, v, out_left, out_right, frames);
    }

    /* --- bus ---
     * The bus drive is deliberately a *static* pre-gain, unlike the per-voice one: on
     * a sum with a hit every sixteenth the level is roughly continuous, so it behaves
     * as drum-bus glue rather than as the infinite-ratio limiter ballast measured on a
     * single decaying voice. Two different jobs, two different behaviours. */
    float tilt_low, tilt_high;
    mf_tilt_gains(moveforge_clampf(s->tone, 0.0f, 1.0f), 12.0f, &tilt_low, &tilt_high);
    mf_drive_set(&s->bus_drive_co, (int)(s->curve + 0.5f), moveforge_clampf(s->drive, 0.0f, 1.0f));
    double drive_in = 0.0, drive_out = 0.0;
    float bus_comp = s->bus_comp;

    for (int i = 0; i < frames; i++) {
        float l = mf_tilt_tick(&s->tilt_l, out_left[i], tilt_low, tilt_high);
        float r = mf_tilt_tick(&s->tilt_r, out_right[i], tilt_low, tilt_high);

        drive_in += (double)l * l + (double)r * r;
        l = mf_drive_tick(&s->bus_drive_l, &s->bus_drive_co, l);
        r = mf_drive_tick(&s->bus_drive_r, &s->bus_drive_co, r);
        drive_out += (double)l * l + (double)r * r;
        l *= bus_comp;
        r *= bus_comp;

        l = mf_dcblock_tick(&s->dc_l, l);
        r = mf_dcblock_tick(&s->dc_r, r);

        /* At unity, upstream of the gain: ballast moved its first limiter below the
         * output gain and its preset peaks spread from +-0.9 dB to 6.5 dB. The
         * limiter catches faults; it does not do the gain staging. */
        l = mf_soft_limit(l);
        r = mf_soft_limit(r);

        float vol = mf_smooth_tick(&s->volume_sm, moveforge_clampf(s->volume, 0.0f, 1.0f));
        l *= vol * SWARF_OUT_TRIM;
        r *= vol * SWARF_OUT_TRIM;

        /* Declick sits downstream of the gain that steps, and is never seeded from
         * silence or it cancels the attack of the first hit. */
        if (s->sounded) {
            s->declick_l = mf_flush_denorm(s->declick_l * s->declick_coeff);
            s->declick_r = mf_flush_denorm(s->declick_r * s->declick_coeff);
            l += s->declick_l;
            r += s->declick_r;
        }

        l = mf_soft_limit(l);
        r = mf_soft_limit(r);

        out_left[i] = mf_sanitize(l, 0.0f);
        out_right[i] = mf_sanitize(r, 0.0f);
    }

    /* Correct the next block by what this one measured. Glided, so a preset load or a
     * curve change is a short slew rather than a step. */
    if (drive_in > 1.0e-12 && drive_out > 1.0e-12) {
        float target = (float)sqrt(drive_in / drive_out);
        if (target > SWARF_BUS_COMP_MAX) target = SWARF_BUS_COMP_MAX;
        s->bus_comp += (target - s->bus_comp) * SWARF_BUS_COMP_GLIDE;
    }

    s->last_l = out_left[frames - 1];
    s->last_r = out_right[frames - 1];
    s->sounded = 1;
}
