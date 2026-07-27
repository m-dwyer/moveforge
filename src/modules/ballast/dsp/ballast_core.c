#include "ballast_core.h"
#include <math.h>
#include <string.h>

#include "ballast_params.gen.inc"
#include "modules/_shared/dsp_runtime.h"

/* Pitch-envelope depths at full knob travel. The fast stage is the attack
 * character and the slow stage the body drop; 40 and 24 semitones put the
 * default patch's attack around 310 Hz over a 55 Hz fundamental, which is the
 * usual range for a synthesised kick. */
#define BALLAST_PUNCH_SEMIS 40.0f
#define BALLAST_DROP_SEMIS  24.0f

#define BALLAST_BEND_SEMIS   2.0f
#define BALLAST_TILT_MAX_DB 24.0f   /* +-12 dB */
#define BALLAST_TILT_PIVOT  700.0f

/* Body sits below unity so that body + click at t = 0 lands near full scale
 * and the output soft limiter only rounds the very peak rather than doing the
 * gain staging. */
#define BALLAST_BODY_GAIN   0.8f
/* Raised from 0.5 after measuring the attack band (2-6 kHz peak in the first
 * 10 ms, relative to the hit's overall peak). At 0.5 the click contributed
 * about 6 dB over what the pitch sweep alone provides; at 0.9 it contributes
 * 8-9 dB and lands the default patch around -8 dB band-relative, which reads
 * as a present click without becoming a click track over a kick. */
#ifndef BALLAST_CLICK_GAIN
#define BALLAST_CLICK_GAIN  0.9f
#endif

/* Calibrated so the Init preset at velocity 100 peaks near -12 dBFS. That is
 * the cross-engine reference: four Schwung slots sum at unity into one int16
 * mailbox with no limiter anywhere in the master path, so every engine has to
 * leave the headroom itself. */
#define BALLAST_OUT_TRIM    0.44f

/* Drive sees the signal divided by the body envelope and the envelope is
 * reimposed after, so the amount of saturation stays constant as the hit
 * decays instead of falling out of the clipper.
 *
 * With a static pre-gain the stage behaves as an infinite-ratio limiter with a
 * several-hundred-millisecond hold: measured crest factor collapsed from 11.9
 * dB clean to 1.9 dB at full hard clip, with a 426 ms flat top. That is a
 * square wave, not a drum — drive was buying midrange at roughly half a dB of
 * transient per dB of midrange, which is backwards.
 *
 * The floor stops the division running away once the body is inaudible, and
 * keeps the very end of a long tail from turning into a decaying square. The
 * output is bounded by the envelope either way, since the curves are bounded
 * by one. */
#ifndef BALLAST_DRIVE_ENV_FLOOR
#define BALLAST_DRIVE_ENV_FLOOR 0.12f
#endif

#define BALLAST_DECLICK_S   0.0007f
/* Below this the previous output is silence, and a fresh attack is wanted. */
#define BALLAST_DECLICK_FLOOR 0.002f
#define BALLAST_IDLE_EPS    1.0e-5f

static void ballast_reset_voice(ballast_core_t *s)
{
    s->osc_phase = 0.0f;
    s->declick = 0.0f;
    s->last_out = 0.0f;
    s->retrigger = 0;
    s->amp_exp = 0.0f;
    s->amp_lin = 0.0f;
    s->pitch_fast = 0.0f;
    s->pitch_slow = 0.0f;
    s->click_env = 0.0f;
    s->dirt_env = 0.0f;
}

/* Jump every ramped control to its parameter's current value.
 *
 * Needed because the idle early-out in ballast_process_float skips the sample
 * loop, so a control that ramps inside it stops tracking while the voice is
 * silent. Without this, changing volume with the transport stopped leaves the
 * next hit opening at the stale value: a muted Ballast still fires its whole
 * transient at -13 dBFS for ~29 ms, on every hit, forever. */
static void ballast_snap_controls(ballast_core_t *s)
{
    mf_smooth_snap(&s->volume_sm, s->volume);
    mf_tilt_gains((s->tone - 0.5f) * 2.0f, BALLAST_TILT_MAX_DB,
                  &s->tilt_low_cur, &s->tilt_high_cur);
    s->dirt_cur = moveforge_clampf(s->dirt, 0.0f, 1.0f);
    s->drive_cur = moveforge_clampf(s->drive, 0.0f, 1.0f);
    mf_smooth_snap(&s->drive_sm, s->drive_cur);
}

/* Recover from a non-finite in recursive state.
 *
 * mf_sanitize guards the output, but a NaN that reaches filter memory is
 * permanent: it never decays, and because every comparison against it is false
 * the idle check can never fire either, so the voice renders digital silence
 * and burns CPU forever. No input is known to produce one — every state
 * variable here is provably bounded — but the failure mode is silent and
 * unrecoverable, which is the kind worth spending a few lines on. */
static void ballast_sanitize_state(ballast_core_t *s)
{
    if (mf_is_bad(s->dc.x1) || mf_is_bad(s->dc.y1)) mf_dcblock_init(&s->dc);
    if (mf_is_bad(s->click_lp.y)) s->click_lp.y = 0.0f;
    if (mf_is_bad(s->dirt_bp.ic1eq) || mf_is_bad(s->dirt_bp.ic2eq)) mf_svf_init(&s->dirt_bp);
    if (mf_is_bad(s->tilt.lp.y)) s->tilt.lp.y = 0.0f;
    if (mf_is_bad(s->drive_state.hold)) mf_drive_init(&s->drive_state);
    if (mf_is_bad(s->declick)) s->declick = 0.0f;
    if (mf_is_bad(s->last_out)) s->last_out = 0.0f;
    if (mf_is_bad(s->osc_phase)) s->osc_phase = 0.0f;
}

void ballast_init(ballast_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));

    s->note_semis = 60.0f;
    s->velocity = 1.0f;
    s->hit_detune = 0.0f;
    s->hit_decay = 1.0f;
    s->hit_drive = 1.0f;
    s->hit_level = 1.0f;
    ballast_reset_voice(s);

    mf_rng_init(&s->rng, 0x8A11A57u);
    mf_onepole_init(&s->click_lp);
    mf_onepole_set_hz(&s->click_lp, 1500.0f);
    mf_svf_init(&s->dirt_bp);
    mf_tilt_init(&s->tilt, BALLAST_TILT_PIVOT);
    mf_dcblock_init(&s->dc);
    mf_drive_init(&s->drive_state);
    mf_smooth_init_gain(&s->volume_sm, 15.0f, 5.0f);
    mf_smooth_init(&s->drive_sm, 15.0f);

    ballast_apply_defaults(s);
    ballast_snap_controls(s);
}

/* Per-hit variation. A host LFO can move a parameter continuously but cannot
 * make two consecutive hits differ, which is the part that stops a sixteen-bar
 * loop sounding like one sample repeated. Seeded deterministically so offline
 * renders stay reproducible. */
static void ballast_roll_hit(ballast_core_t *s)
{
    float h = moveforge_clampf(s->human, 0.0f, 1.0f);
    if (h <= 0.0f) {
        s->hit_detune = 0.0f;
        s->hit_decay = 1.0f;
        s->hit_drive = 1.0f;
        s->hit_level = 1.0f;
        return;
    }
    s->hit_detune = mf_rng_bipolar(&s->rng) * h * 0.30f;          /* +-30 cents */
    s->hit_decay = 1.0f + mf_rng_bipolar(&s->rng) * h * 0.15f;
    s->hit_drive = 1.0f + mf_rng_bipolar(&s->rng) * h * 0.20f;
    s->hit_level = 1.0f + mf_rng_bipolar(&s->rng) * h * 0.10f;
}

void ballast_note_on(ballast_core_t *s, int note, float velocity) {
    if (!s || note < 0 || note > 127) return;

    s->note_semis = (float)note;
    s->velocity = moveforge_clampf(velocity, 0.0f, 1.0f);
    ballast_roll_hit(s);

    s->osc_phase = mf_wrap_phase(moveforge_clampf(s->phase, 0.0f, 1.0f));
    s->amp_exp = 1.0f;
    s->amp_lin = 1.0f;
    s->pitch_fast = 1.0f;
    s->pitch_slow = 1.0f;
    s->click_env = 1.0f;
    s->dirt_env = 1.0f;
    s->retrigger = 1;

    ballast_sanitize_state(s);
    ballast_snap_controls(s);
}

/* One-shot: `decay` owns the length of a hit, so a note-off is not a musical
 * event here. See the header. */
void ballast_note_off(ballast_core_t *s, int note) {
    (void)s;
    (void)note;
}

void ballast_all_notes_off(ballast_core_t *s) {
    if (!s) return;
    /* Collapse the envelopes and let the declick ramp carry the output down,
     * rather than cutting to zero and clicking. */
    s->amp_exp = 0.0f;
    s->amp_lin = 0.0f;
    s->click_env = 0.0f;
    s->dirt_env = 0.0f;
    s->retrigger = 1;
}

void ballast_pitch_bend(ballast_core_t *s, float bend) {
    if (!s) return;
    s->pitch_bend = moveforge_clampf(bend, -1.0f, 1.0f);
}

static int ballast_is_idle(const ballast_core_t *s)
{
    return s->amp_exp < BALLAST_IDLE_EPS && s->amp_lin <= 0.0f
        && s->click_env < BALLAST_IDLE_EPS && s->dirt_env < BALLAST_IDLE_EPS
        && fabsf(s->declick) < BALLAST_IDLE_EPS
        && fabsf(s->last_out) < BALLAST_IDLE_EPS
        && fabsf(s->dc.y1) < BALLAST_IDLE_EPS
        && !s->retrigger;
}

/* Triangle from a [0,1) phase: 0 at phase 0, +1 at 0.25, -1 at 0.75. */
static inline float ballast_tri(float phase)
{
    float q = phase + 0.25f;
    q -= floorf(q);
    return 1.0f - 4.0f * fabsf(q - 0.5f);
}

void ballast_process_float(ballast_core_t *s,
                           const float *in_left, const float *in_right,
                           float *out_left, float *out_right,
                           int frames) {
    (void)in_left;
    (void)in_right;
    if (!s || !out_left || !out_right || frames <= 0) return;

    /* A silent voice costs nothing. Schwung's own idle gate only stops
     * rendering a slot after a full second under -78 dBFS, which never happens
     * inside a running groove, so skipping here is what actually saves the
     * budget between patterns. */
    if (ballast_is_idle(s)) {
        memset(out_left, 0, (size_t)frames * sizeof(float));
        memset(out_right, 0, (size_t)frames * sizeof(float));
        return;
    }

    /* ---- per-block coefficients ---- */

    const float sr = MOVEFORGE_SAMPLE_RATE;

    /* Pitch-envelope times. The old ranges (2-40 ms and 20-400 ms) left the
     * default patch 3 semitones sharp a third of the way into a 450 ms hit —
     * 187 ms to settle within a semitone, which reads as rubbery rather than
     * solid. They were also locked at exactly 10:1 at every knob position, so
     * neither "3 ms tick over a long dive" nor "slow bloom, tight body" was
     * reachable. Shortening the slow stage more than the fast one both fixes
     * the settling time and lets the ratio range over roughly 7:1 to 13:1
     * without spending a parameter slot on it. */
    float t_fast = 0.0015f + s->sweep * 0.0135f;  /* 1.5..15 ms */
    float t_slow = 0.010f + s->sweep * 0.190f;    /* 10..200 ms */
    float k_fast = expf(-3.0f / (t_fast * sr));
    float k_slow = expf(-3.0f / (t_slow * sr));

    float dec = moveforge_clampf(s->decay * s->hit_decay, 0.02f, 4.0f);
    float k_amp = expf(-6.9078f / (dec * sr));    /* -60 dB over `dec` */
    float lin_step = 1.0f / (dec * sr);

    /* A harder punch implies a tighter click. */
    float t_click = 0.0015f + (1.0f - s->punch) * 0.0040f;
    float k_click = expf(-4.0f / (t_click * sr));

    float t_dirt = moveforge_clampf(dec * 0.4f, 0.01f, 1.5f);
    float k_dirt = expf(-4.0f / (t_dirt * sr));

    float k_declick = expf(-3.0f / (BALLAST_DECLICK_S * sr));

    /* Velocity is the main expressive axis on Move's pads and reaches the
     * module untouched, so it moves timbre as well as level. */
    float vel = s->velocity;
    float vd = s->vel_depth;
    float vel_gain = 1.0f - vd * (1.0f - vel);
    float vel_pitch = 1.0f - vd * 0.50f * (1.0f - vel);
    float vel_drive = 1.0f - vd * 0.40f * (1.0f - vel);

    /* Drive is smoothed at block rate rather than per sample: its coefficients
     * are a whole struct including a curve selector, so ramping them per sample
     * would mean running the nonlinearity twice. A 15 ms glide turns a hold-mode
     * automation step from one -27 dBFS click into a handful of inaudible ones. */
    s->drive_cur = mf_smooth_tick(&s->drive_sm, moveforge_clampf(s->drive, 0.0f, 1.0f));
    mf_drive_coeffs_t drive_co;
    mf_drive_set(&drive_co, (int)(s->curve + 0.5f),
                 moveforge_clampf(s->drive_cur * s->hit_drive * vel_drive, 0.0f, 1.0f));

    /* Tilt and dirt level ramp linearly to their block target instead. Both
     * scale a signal directly, so a raw step is an amplitude discontinuity —
     * a `tone` jump of 0.3 measures 64x the signal's own slew, which is a
     * click. Two adds per sample, landing exactly on target at the block end. */
    float tilt_low, tilt_high;
    mf_tilt_gains((s->tone - 0.5f) * 2.0f, BALLAST_TILT_MAX_DB, &tilt_low, &tilt_high);
    float inv_frames = 1.0f / (float)frames;
    float tilt_low_step = (tilt_low - s->tilt_low_cur) * inv_frames;
    float tilt_high_step = (tilt_high - s->tilt_high_cur) * inv_frames;

    mf_svf_coeffs_t dirt_co;
    mf_svf_set(&dirt_co, 1200.0f + s->dirt * 2200.0f, 0.45f);

    /* `tune` is the pitch at track = 0; tracking transposes it relative to
     * middle C rather than replacing it, so the control stays meaningful at
     * every setting instead of going dead at full tracking. */
    float base_semis = s->tune
                     + s->track * (s->note_semis - 60.0f)
                     + s->hit_detune
                     + s->pitch_bend * BALLAST_BEND_SEMIS;
    float base_hz = moveforge_midi_note_to_hz(base_semis);

    /* The pitch envelope runs linearly in Hz rather than in semitones: it
     * reaches the same start and end pitches, costs two multiply-adds instead
     * of a powf per sample, and is what an analog kick circuit actually does
     * when an envelope drives a linear FM input. */
    float punch_semis = s->punch * BALLAST_PUNCH_SEMIS * vel_pitch;
    float drop_semis = s->drop * BALLAST_DROP_SEMIS * vel_pitch;
    float punch_hz = base_hz * (powf(2.0f, punch_semis / 12.0f) - 1.0f);
    float drop_hz = base_hz * (powf(2.0f, drop_semis / 12.0f) - 1.0f);

    float body = moveforge_clampf(s->body, 0.0f, 1.0f);
    float shape = moveforge_clampf(s->shape, 0.0f, 1.0f);
    float click_level = s->punch * BALLAST_CLICK_GAIN;
    float dirt_level = moveforge_clampf(s->dirt, 0.0f, 1.0f);
    float dirt_step = (dirt_level - s->dirt_cur) * inv_frames;
    float out_gain = vel_gain * s->hit_level * BALLAST_OUT_TRIM;
    float phase_inc_scale = 1.0f / sr;

    for (int i = 0; i < frames; i++) {
        /* ---- pitch ---- */
        float hz = base_hz + punch_hz * s->pitch_fast + drop_hz * s->pitch_slow;
        hz = moveforge_clampf(hz, 10.0f, sr * 0.45f);
        s->pitch_fast = mf_flush_denorm(s->pitch_fast * k_fast);
        s->pitch_slow = mf_flush_denorm(s->pitch_slow * k_slow);

        s->osc_phase += hz * phase_inc_scale;
        if (s->osc_phase >= 1.0f) s->osc_phase -= floorf(s->osc_phase);

        float sine = sinf(MOVEFORGE_TWO_PI * s->osc_phase);
        float osc = sine + (ballast_tri(s->osc_phase) - sine) * body;

        /* ---- envelopes ---- */
        s->amp_exp = mf_flush_denorm(s->amp_exp * k_amp);
        s->amp_lin -= lin_step;
        if (s->amp_lin < 0.0f) s->amp_lin = 0.0f;
        float amp = s->amp_exp + (s->amp_lin - s->amp_exp) * shape;

        s->click_env = mf_flush_denorm(s->click_env * k_click);
        s->dirt_env = mf_flush_denorm(s->dirt_env * k_dirt);

        /* ---- layers ----
         * Two independent draws. Sharing one made the grain a band-passed copy
         * of the click rather than a separate source, correlating two layers
         * that are meant to sit in different places. */
        float click_noise = mf_rng_bipolar(&s->rng);
        float click = click_noise - mf_onepole_tick(&s->click_lp, click_noise);

        mf_svf_tick(&s->dirt_bp, &dirt_co, mf_rng_bipolar(&s->rng));
        float grain = s->dirt_bp.bp;

        s->dirt_cur += dirt_step;

        float mix = osc * amp * BALLAST_BODY_GAIN
                  + click * s->click_env * click_level
                  + grain * s->dirt_env * s->dirt_cur;

        /* ---- character ---- */
        s->tilt_low_cur += tilt_low_step;
        s->tilt_high_cur += tilt_high_step;
        float y = mf_tilt_tick(&s->tilt, mix, s->tilt_low_cur, s->tilt_high_cur);

        float env = (amp > BALLAST_DRIVE_ENV_FLOOR) ? amp : BALLAST_DRIVE_ENV_FLOOR;
        y = mf_drive_tick(&s->drive_state, &drive_co, y / env) * env;

        y = mf_dcblock_tick(&s->dc, y);

        /* ---- output ----
         * Two limiter stages, doing different jobs.
         *
         * The first runs at unity, upstream of the gain, and is doing real
         * level control rather than only catching faults: `tone` can add up to
         * 12 dB to whichever band the signal sits in, so a dark patch with a
         * near-sine body arrives here well over full scale. Moving it below the
         * gain spread the preset peaks from +-0.9 dB to 6.5 dB.
         *
         * The declick sits between the gain and a second limiter. It only makes
         * continuous whatever node it sits on, so capturing it upstream of the
         * gain would leave the real output free to step by the full gain ratio
         * — exactly what happens between two hits at different velocities, the
         * case the mechanism exists for. The second limiter then catches the
         * one thing that can overshoot after it, a declick seeded from a loud
         * previous hit; being monotonic and continuous it cannot reintroduce a
         * step of its own. */
        y = mf_soft_limit(y);
        y *= mf_smooth_tick(&s->volume_sm, s->volume) * out_gain;

        if (s->retrigger) {
            /* Only declick over something already sounding. Seeding this from
             * silence would force the output to start at exactly zero, which
             * cancels `phase` outright — the whole point of a start-phase
             * control is that opening at the waveform peak is an instant
             * full-amplitude excursion, and that is a transient to keep, not a
             * discontinuity to hide. Measured: without this guard every `phase`
             * setting produced the same first sample and the knob moved peak
             * level by 0.27 dB across its entire travel. */
            s->declick = (fabsf(s->last_out) > BALLAST_DECLICK_FLOOR)
                       ? s->last_out - y
                       : 0.0f;
            s->retrigger = 0;
        }
        y += s->declick;
        s->declick = mf_flush_denorm(s->declick * k_declick);
        s->last_out = y;

        y = mf_soft_limit(y);
        y = mf_sanitize(y, 0.0f);

        out_left[i] = y;
        out_right[i] = y;
    }
}
