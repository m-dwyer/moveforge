#include "lobber_core.h"

#include <string.h>

#include "modules/_shared/dsp_runtime.h"
#include "modules/_shared/mf_dsp.h"
#include "lobber_params.gen.inc"

/* Beats per slice for each division index, matching the device note keys:
 * 0=1/4  1=1/8  2=1/16  3=1/4T  4=1/8T  5=1/16T  (regular page, then triplets). */
static const float LOBBER_DIV_BEATS[6] = {
    1.0f, 0.5f, 0.25f, 2.0f / 3.0f, 1.0f / 3.0f, 1.0f / 6.0f
};

void lobber_init(lobber_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));      /* zeroes the embedded record + loop buffers */
    s->dir = 1;
    s->slice_dir = 1;
    s->transport_running = 1;      /* default running; the wrapper overrides on device */
    s->last_offset = -1;
    s->last_division = -1;
    s->last_reverse = -1;
    s->last_ratchet = -1;
    s->last_capture = 0;
    s->last_mode = 0;
    lobber_apply_defaults(s);
}

void lobber_set_tempo(lobber_core_t *s, float bpm, int clock_available) {
    if (!s) return;
    if (clock_available && bpm > 0.0f) {
        s->host_bpm = bpm;
        s->use_host_bpm = 1;
    } else {
        s->use_host_bpm = 0;
    }
}

/* Function-key indices on channel 1 (port-local control surface; see ui.js). */
enum {
    LOBBER_FN_MODE    = 0,  /* cycle Live -> Loop -> Slice */
    LOBBER_FN_REVERSE = 1,  /* momentary reverse while held */
    LOBBER_FN_FREEZE  = 2,  /* momentary record-stop while held */
    LOBBER_FN_MUTE    = 3,  /* toggle mute */
    LOBBER_FN_CAPTURE = 4   /* snapshot / retrigger the loop */
};

void lobber_handle_midi(lobber_core_t *s, int status, int d1, int d2) {
    if (!s) return;
    const int type = status & 0xF0;
    const int chan = status & 0x0F;
    const int on  = (type == 0x90 && d2 > 0);
    const int off = (type == 0x80 || (type == 0x90 && d2 == 0));

    if (chan == 0) {
        /* toss grid: any note maps to a slice offset 0..15 (held = toss) */
        if (on) {
            s->pad_held = 1;
            s->pad_note = d1;
            s->pad_offset = d1 % 16;
        } else if (off && d1 == s->pad_note) {
            s->pad_held = 0;
        }
        return;
    }

    if (chan == 1) {
        /* function row: discrete controls that mirror the device's bottom keys */
        switch (d1) {
            case LOBBER_FN_MODE:
                if (on) {
                    int m = (int)(s->mode + 0.5f) + 1;
                    s->mode = (float)(m > 2 ? 0 : m);
                }
                break;
            case LOBBER_FN_REVERSE: s->midi_reverse_held = on ? 1 : 0; break;
            case LOBBER_FN_FREEZE:  s->midi_freeze_held  = on ? 1 : 0; break;
            case LOBBER_FN_MUTE:
                if (on) s->mute = (s->mute >= 0.5f) ? 0.0f : 1.0f;
                break;
            case LOBBER_FN_CAPTURE: s->capture = on ? 1.0f : 0.0f; break;
            default: break;
        }
    }
}

void lobber_set_transport(lobber_core_t *s, int running) {
    if (!s) return;
    s->transport_running = running ? 1 : 0;
}

/* Index the ring buffer. int64 & mask yields the correct nonnegative low bits
 * under two's complement (mandated by C23; holds on all our targets). */
static inline int lb_idx(int64_t p) { return (int)(p & LOBBER_BUF_MASK); }

/* Effective tempo: host clock when available, else the bpm param (offline/browser). */
static float lb_eff_bpm(const lobber_core_t *s) {
    float bpm = s->use_host_bpm ? s->host_bpm : s->bpm;
    if (bpm < 20.0f) bpm = 120.0f;
    return bpm;
}

static int lb_beat_samples(const lobber_core_t *s) {
    int n = (int)((60.0f / lb_eff_bpm(s)) * MOVEFORGE_SAMPLE_RATE);
    return n < 1 ? 1 : n;
}

static int lb_slice_len(const lobber_core_t *s) {
    int di = (int)(s->division + 0.5f);
    if (di < 0) di = 0;
    if (di > 5) di = 5;
    float sec = (60.0f / lb_eff_bpm(s)) * LOBBER_DIV_BEATS[di];
    int len = (int)(sec * MOVEFORGE_SAMPLE_RATE);
    if (len < 1) len = 1;
    if (len > LOBBER_BUF_LEN / 2) len = LOBBER_BUF_LEN / 2;
    return len;
}

int lobber_slice_samples(const lobber_core_t *s) {
    return s ? lb_slice_len(s) : 0;
}

/* Wrap an index into [0, len). len must be >= 1. */
static inline int lb_loop_wrap(int idx, int len) {
    idx %= len;
    if (idx < 0) idx += len;
    return idx;
}

/* Linear-interpolated read of the captured loop at a fractional position that is
 * assumed already wrapped into [0, loop_len). */
static inline void lb_loop_read_sample(const lobber_core_t *s, double pos,
                                       float *l, float *r) {
    const int len = s->loop_len;
    const int i0 = (int)pos;
    const double frac = pos - (double)i0;
    const int a = lb_loop_wrap(i0, len);
    const int b = lb_loop_wrap(i0 + 1, len);
    *l = (float)(s->loop_l[a] * (1.0 - frac) + s->loop_l[b] * frac);
    *r = (float)(s->loop_r[a] * (1.0 - frac) + s->loop_r[b] * frac);
}

/* Snapshot the most recent loop_beats of live audio out of the ring into the loop
 * buffer. Requests longer than what has been recorded (or than the buffer holds)
 * are clamped; loop_beats_captured records the musical length actually grabbed so
 * Loop mode can time-stretch it to follow tempo. */
static void lb_capture(lobber_core_t *s) {
    int beats = (int)(s->loop_beats + 0.5f);
    if (beats < 1) beats = 1;
    if (beats > 16) beats = 16;
    const int beat_samples = lb_beat_samples(s);

    int64_t want = (int64_t)beats * beat_samples;
    if (want > LOBBER_LOOP_LEN) want = LOBBER_LOOP_LEN;
    int64_t available = s->write_pos;              /* samples ever written */
    if (available > LOBBER_BUF_LEN) available = LOBBER_BUF_LEN;
    if (want > available) want = available;
    if (want < 1) want = 1;

    const int64_t start = s->write_pos - want;
    for (int64_t j = 0; j < want; j++) {
        s->loop_l[j] = s->buf_l[lb_idx(start + j)];
        s->loop_r[j] = s->buf_r[lb_idx(start + j)];
    }
    s->loop_len = (int)want;
    s->loop_beats_captured = (float)want / (float)beat_samples;
    if (s->loop_beats_captured < 0.001f) s->loop_beats_captured = (float)beats;
    s->loop_filled = 1;

    /* restart playback / clear transient read state */
    s->loop_read = 0.0;
    s->loop_phase = 0;
    s->loop_win_start = 0;
    s->loop_win_len = 0;
    s->slice_active = 0;
}

void lobber_process_float(lobber_core_t *s,
                            const float *in_left, const float *in_right,
                            float *out_left, float *out_right,
                            int frames) {
    if (!s || !in_left || !in_right || !out_left || !out_right) return;

    const int   slice_len  = lb_slice_len(s);
    const int   division   = (int)(s->division + 0.5f);
    int         ratchet    = (int)(s->ratchet + 0.5f);
    if (ratchet < 0) ratchet = 0;
    if (ratchet > 4) ratchet = 4;
    int window_len = slice_len >> ratchet;
    if (window_len < 1) window_len = 1;

    /* Momentary function-pad holds OR with the param toggles. */
    const int   reverse = (s->reverse >= 0.5f) || s->midi_reverse_held;
    const int   freeze  = (s->freeze  >= 0.5f) || s->midi_freeze_held;
    const int   loop    = (s->loop    >= 0.5f);
    const int   mute    = (s->mute    >= 0.5f);
    const float mix     = s->mix;

    int mode = (int)(s->mode + 0.5f);
    if (mode < 0) mode = 0;
    if (mode > 2) mode = 2;

    /* Declick crossfade in samples (>=1), capped to half the window so a loop
     * window always has room for its seam crossfade. */
    int xfade = (int)(s->xfade * 0.001f * MOVEFORGE_SAMPLE_RATE);
    if (xfade < 1) xfade = 1;
    if (xfade > window_len / 2) xfade = window_len / 2;
    if (xfade < 1) xfade = 1;
    const float env_inc = 1.0f / (float)xfade;

    /* Toss intent is constant across the block (params/MIDI change between
     * blocks), so resolve engage/re-jump once up front; seams happen per-sample. */
    const int want_toss = s->pad_held || (s->active >= 0.5f);
    int eff_offset = s->pad_held ? s->pad_offset : (int)(s->offset + 0.5f);
    if (eff_offset < 0) eff_offset = 0;
    if (eff_offset > 16) eff_offset = 16;

    /* Capture: an explicit rising edge grabs immediately; otherwise Loop/Slice
     * auto-capture once enough live audio has been recorded for a full loop (so a
     * mode switch with no history doesn't snapshot a sliver of silence). */
    const int cap = (s->capture >= 0.5f);
    if (cap && !s->last_capture) {
        lb_capture(s);
    } else if (mode != 0 && !s->loop_filled) {
        int beats = (int)(s->loop_beats + 0.5f);
        if (beats < 1) beats = 1;
        if (beats > 16) beats = 16;
        int64_t want = (int64_t)beats * lb_beat_samples(s);
        if (want > LOBBER_LOOP_LEN) want = LOBBER_LOOP_LEN;
        if (want > LOBBER_BUF_LEN) want = LOBBER_BUF_LEN;
        if (s->write_pos >= want) lb_capture(s);
    }
    s->last_capture = cap;

    /* A mode change clears transient read state so modes don't bleed together. */
    if (mode != s->last_mode) {
        s->tossing = 0;
        s->wet_env = 0.0f;
        s->slice_active = 0;
        s->loop_phase = 0;
        if (mode != 0 && s->loop_filled) s->loop_read = 0.0;
        s->last_mode = mode;
    }

    const int controls_changed =
        (eff_offset != s->last_offset || division != s->last_division ||
         reverse != s->last_reverse || ratchet != s->last_ratchet);

    /* ---------- Live (0): engage/re-jump the ring-buffer read head ---------- */
    if (mode == 0 && want_toss) {
        /* Look-back to the requested slice, clamped to the ring. When looping
         * (stutter) the window must sit in recorded audio, so anchor it to the
         * oldest sample (max 0) — otherwise a toss with no history yet would
         * lock onto a never-written, silent window. Play-through (loop off)
         * leaves it unclamped so a delay still gets its natural pre-delay ramp. */
        int64_t back = (int64_t)eff_offset * slice_len;
        const int64_t max_back = LOBBER_BUF_LEN - window_len - 1;
        if (back > max_back) back = max_back;
        int64_t target_start = s->write_pos - back;
        if (loop && target_start < 0) target_start = 0;
        const int64_t head_at = reverse ? (target_start + window_len - 1) : target_start;

        if (!s->tossing) {
            /* engage: jump and start reading; wet_env fades the wet in from dry */
            s->window_start = target_start;
            s->window_len   = window_len;
            s->dir          = reverse ? -1 : 1;
            s->head_a       = head_at;
            s->phase        = 0;
            s->xf_pos       = 0;
            s->tossing      = 1;
        } else if (controls_changed) {
            /* re-jump: crossfade the current head out, the new position in */
            s->window_start = target_start;
            s->window_len   = window_len;
            s->dir          = reverse ? -1 : 1;
            s->head_b       = head_at;
            s->xf_pos       = xfade;
            s->xf_len       = xfade;
            s->phase        = 0;
        }
    }

    /* ---------- Loop (1): varispeed loop playback + optional stutter -------- */
    double loop_rate = 1.0;
    if (mode == 1 && s->loop_filled && s->loop_len > 0) {
        /* Rudimentary time-stretch: make the captured beats span the loop at the
         * current tempo, so the loop follows the host clock. */
        double target_len = (double)s->loop_beats_captured * (double)lb_beat_samples(s);
        if (target_len < 1.0) target_len = (double)s->loop_len;
        loop_rate = (double)s->loop_len / target_len;

        int jump = 0;
        if (want_toss) {
            if (!s->tossing) { jump = 1; s->tossing = 1; }
            else if (controls_changed) jump = 1;
        } else {
            s->tossing = 0;
        }
        if (jump) {
            int wl = window_len < s->loop_len ? window_len : s->loop_len;
            if (wl < 1) wl = 1;
            int ws = lb_loop_wrap((int)s->loop_read - eff_offset * slice_len, s->loop_len);
            s->loop_win_start = ws;
            s->loop_win_len   = wl;
            s->loop_phase     = 0;
            s->loop_read = reverse
                ? (double)lb_loop_wrap(ws + wl - 1, s->loop_len)
                : (double)ws;
        }
    }

    /* ---------- Slice (2): play slices of the loop while a toss is held ------
     * Press fires the slice at the offset; holding plays the following slices in
     * sequence (the device's default sequence, recreating the loop). */
    if (mode == 2 && want_toss && s->loop_filled && s->loop_len > 0) {
        int nslices = s->loop_len / slice_len;
        if (nslices < 1) nslices = 1;
        int retrigger = 0;
        if (!s->tossing)            { s->slice_idx = eff_offset; retrigger = 1; }
        else if (controls_changed)  { s->slice_idx = eff_offset; retrigger = 1; }
        else if (!s->slice_active)  { s->slice_idx = (s->slice_idx + 1) % nslices; retrigger = 1; }
        if (retrigger) {
            int wl = slice_len < s->loop_len ? slice_len : s->loop_len;
            if (wl < 1) wl = 1;
            int start = lb_loop_wrap(s->slice_idx * slice_len, s->loop_len);
            s->slice_dir       = reverse ? -1 : 1;
            s->slice_read      = reverse ? (double)lb_loop_wrap(start + wl - 1, s->loop_len)
                                         : (double)start;
            s->slice_remaining = wl;
            s->slice_active    = 1;
        }
    }
    if (mode == 2) {
        s->tossing = want_toss ? 1 : 0;   /* latch for edge detection */
    }

    s->last_offset   = eff_offset;
    s->last_division = division;
    s->last_reverse  = reverse;
    s->last_ratchet  = ratchet;

    const float live_target = want_toss ? 1.0f : 0.0f;
    const float loop_target = (s->transport_running && !mute) ? 1.0f : 0.0f;
    const int   rev_dir     = reverse ? -1 : 1;

    for (int i = 0; i < frames; i++) {
        const float dry_l = in_left[i];
        const float dry_r = in_right[i];

        /* keep recording the live input unless frozen, then advance the write head */
        if (!freeze) {
            s->buf_l[lb_idx(s->write_pos)] = dry_l;
            s->buf_r[lb_idx(s->write_pos)] = dry_r;
        }
        s->write_pos++;

        float out_l, out_r;

        if (mode == 0) {
            /* ----- Live: toss the ring; blend wet over dry via wet_env * mix ----- */
            float wet_l = dry_l, wet_r = dry_r;
            if (s->tossing) {
                /* loop seam: when the window is exhausted, crossfade back to start */
                if (loop && s->xf_pos == 0 && s->phase >= s->window_len) {
                    s->head_b = s->dir > 0 ? s->window_start
                                           : (s->window_start + s->window_len - 1);
                    s->xf_pos = xfade;
                    s->xf_len = xfade;
                    s->phase  = 0;
                }
                if (s->xf_pos > 0) {
                    const float t = 1.0f - (float)s->xf_pos / (float)s->xf_len; /* 0..1 */
                    wet_l = s->buf_l[lb_idx(s->head_a)] * (1.0f - t) + s->buf_l[lb_idx(s->head_b)] * t;
                    wet_r = s->buf_r[lb_idx(s->head_a)] * (1.0f - t) + s->buf_r[lb_idx(s->head_b)] * t;
                    s->head_a += s->dir;
                    s->head_b += s->dir;
                    s->xf_pos--;
                    if (s->xf_pos == 0) s->head_a = s->head_b;
                } else {
                    wet_l = s->buf_l[lb_idx(s->head_a)];
                    wet_r = s->buf_r[lb_idx(s->head_a)];
                    s->head_a += s->dir;
                }
                s->phase++;
            }
            if (s->wet_env < live_target) {
                s->wet_env += env_inc;
                if (s->wet_env > live_target) s->wet_env = live_target;
            } else if (s->wet_env > live_target) {
                s->wet_env -= env_inc;
                if (s->wet_env < live_target) s->wet_env = live_target;
            }
            if (!want_toss && s->wet_env <= 0.0f) s->tossing = 0;

            const float m  = mix * s->wet_env;
            const float dl = mute ? 0.0f : dry_l;
            const float dr = mute ? 0.0f : dry_r;
            out_l = dl * (1.0f - m) + wet_l * m;
            out_r = dr * (1.0f - m) + wet_r * m;
        } else if (mode == 1) {
            /* ----- Loop: play the captured loop, tempo-followed ----- */
            float wet_l = 0.0f, wet_r = 0.0f;
            if (s->loop_filled && s->loop_len > 0) {
                lb_loop_read_sample(s, s->loop_read, &wet_l, &wet_r);
                s->loop_read += loop_rate * (double)rev_dir;
                if (s->tossing && loop) {       /* stutter: confine to the toss window */
                    s->loop_phase++;
                    if ((double)s->loop_phase * loop_rate >= (double)s->loop_win_len) {
                        s->loop_phase = 0;
                        s->loop_read = reverse
                            ? (double)lb_loop_wrap(s->loop_win_start + s->loop_win_len - 1, s->loop_len)
                            : (double)s->loop_win_start;
                    }
                }
                while (s->loop_read >= (double)s->loop_len) s->loop_read -= (double)s->loop_len;
                while (s->loop_read <  0.0)                 s->loop_read += (double)s->loop_len;
            }
            if (s->wet_env < loop_target) {
                s->wet_env += env_inc;
                if (s->wet_env > loop_target) s->wet_env = loop_target;
            } else if (s->wet_env > loop_target) {
                s->wet_env -= env_inc;
                if (s->wet_env < loop_target) s->wet_env = loop_target;
            }
            out_l = wet_l * s->wet_env;
            out_r = wet_r * s->wet_env;
        } else {
            /* ----- Slice: live passthrough with one-shot slices layered on top ----- */
            float sl = 0.0f, sr = 0.0f;
            int slice_playing = 0;
            if (s->slice_active && s->loop_filled && s->loop_len > 0) {
                slice_playing = 1;
                lb_loop_read_sample(s, s->slice_read, &sl, &sr);
                s->slice_read += (double)s->slice_dir;
                while (s->slice_read >= (double)s->loop_len) s->slice_read -= (double)s->loop_len;
                while (s->slice_read <  0.0)                 s->slice_read += (double)s->loop_len;
                if (--s->slice_remaining <= 0) s->slice_active = 0;
            }
            const float dl = mute ? 0.0f : dry_l;
            const float dr = mute ? 0.0f : dry_r;
            /* Slice layers a one-shot on top of the live signal, so dry + wet
             * can reach +-2 at mix=1. Unlike Live and Loop this is additive, not
             * a crossfade, and the only thing downstream was the hard clamp in
             * moveforge_float_to_i16 — i.e. harsh digital clipping.
             *
             * The limiter only engages while a slice is actually sounding, so
             * idle Slice mode stays a bit-exact passthrough (a slicer must not
             * colour the dry signal while doing nothing). During a slice the dry
             * path may be very slightly compressed, which is inaudible against
             * the slice itself. */
            out_l = slice_playing ? mf_soft_limit(dl + sl * mix) : dl;
            out_r = slice_playing ? mf_soft_limit(dr + sr * mix) : dr;
        }

        out_left[i]  = out_l;
        out_right[i] = out_r;
    }
}
