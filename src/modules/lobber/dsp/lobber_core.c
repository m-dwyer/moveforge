#include "lobber_core.h"

#include <string.h>

#include "modules/_shared/dsp_runtime.h"
#include "lobber_params.gen.inc"

/* Beats per slice for each division index (1/4, 1/8, 1/8 triplet, 1/16, 1/32). */
static const float LOBBER_DIV_BEATS[5] = { 1.0f, 0.5f, 1.0f / 3.0f, 0.25f, 0.125f };

void lobber_init(lobber_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));      /* zeroes the embedded record buffer */
    s->dir = 1;
    s->last_offset = -1;
    s->last_division = -1;
    s->last_reverse = -1;
    s->last_ratchet = -1;
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

void lobber_handle_midi(lobber_core_t *s, int status, int d1, int d2) {
    if (!s) return;
    int type = status & 0xF0;
    if (type == 0x90 && d2 > 0) {                 /* note on */
        s->pad_held = 1;
        s->pad_note = d1;
        s->pad_offset = d1 % 16;                  /* map any note to a slice offset 0..15 */
    } else if (type == 0x80 || (type == 0x90 && d2 == 0)) { /* note off */
        if (d1 == s->pad_note) s->pad_held = 0;
    }
}

/* Index the ring buffer. int64 & mask yields the correct nonnegative low bits
 * under two's complement (mandated by C23; holds on all our targets). */
static inline int tt_idx(int64_t p) { return (int)(p & LOBBER_BUF_MASK); }

static int tt_slice_len(const lobber_core_t *s) {
    float bpm = s->use_host_bpm ? s->host_bpm : s->bpm;
    if (bpm < 20.0f) bpm = 120.0f;
    int di = (int)(s->division + 0.5f);
    if (di < 0) di = 0;
    if (di > 4) di = 4;
    float sec = (60.0f / bpm) * LOBBER_DIV_BEATS[di];
    int len = (int)(sec * MOVEFORGE_SAMPLE_RATE);
    if (len < 1) len = 1;
    if (len > LOBBER_BUF_LEN / 2) len = LOBBER_BUF_LEN / 2;
    return len;
}

void lobber_process_float(lobber_core_t *s,
                            const float *in_left, const float *in_right,
                            float *out_left, float *out_right,
                            int frames) {
    if (!s || !in_left || !in_right || !out_left || !out_right) return;

    const int   slice_len  = tt_slice_len(s);
    const int   division   = (int)(s->division + 0.5f);
    int         ratchet    = (int)(s->ratchet + 0.5f);
    if (ratchet < 0) ratchet = 0;
    if (ratchet > 4) ratchet = 4;
    int window_len = slice_len >> ratchet;
    if (window_len < 1) window_len = 1;

    const int   reverse = (s->reverse >= 0.5f);
    const int   freeze  = (s->freeze >= 0.5f);
    const int   loop    = (s->loop >= 0.5f);
    const float mix     = s->mix;

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

    if (want_toss) {
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
        } else if (eff_offset != s->last_offset || division != s->last_division ||
                   reverse != s->last_reverse || ratchet != s->last_ratchet) {
            /* re-jump: crossfade the current head out, the new position in */
            s->window_start = target_start;
            s->window_len   = window_len;
            s->dir          = reverse ? -1 : 1;
            s->head_b       = head_at;
            s->xf_pos       = xfade;
            s->xf_len       = xfade;
            s->phase        = 0;
        }
        s->last_offset   = eff_offset;
        s->last_division = division;
        s->last_reverse  = reverse;
        s->last_ratchet  = ratchet;
    }

    const float target_env = want_toss ? 1.0f : 0.0f;

    for (int i = 0; i < frames; i++) {
        const float dry_l = in_left[i];
        const float dry_r = in_right[i];

        /* write head: capture live input unless frozen, then advance */
        if (!freeze) {
            s->buf_l[tt_idx(s->write_pos)] = dry_l;
            s->buf_r[tt_idx(s->write_pos)] = dry_r;
        }
        s->write_pos++;

        float wet_l = dry_l;
        float wet_r = dry_r;

        if (s->tossing) {
            /* loop seam: when the window is exhausted, crossfade back to its start */
            if (loop && s->xf_pos == 0 && s->phase >= s->window_len) {
                s->head_b = s->dir > 0 ? s->window_start
                                       : (s->window_start + s->window_len - 1);
                s->xf_pos = xfade;
                s->xf_len = xfade;
                s->phase  = 0;
            }

            if (s->xf_pos > 0) {
                const float t = 1.0f - (float)s->xf_pos / (float)s->xf_len; /* 0..1 */
                wet_l = s->buf_l[tt_idx(s->head_a)] * (1.0f - t) + s->buf_l[tt_idx(s->head_b)] * t;
                wet_r = s->buf_r[tt_idx(s->head_a)] * (1.0f - t) + s->buf_r[tt_idx(s->head_b)] * t;
                s->head_a += s->dir;
                s->head_b += s->dir;
                s->xf_pos--;
                if (s->xf_pos == 0) s->head_a = s->head_b;
            } else {
                wet_l = s->buf_l[tt_idx(s->head_a)];
                wet_r = s->buf_r[tt_idx(s->head_a)];
                s->head_a += s->dir;
            }
            s->phase++;
        }

        /* dry->wet slew (declick on engage/release) */
        if (s->wet_env < target_env) {
            s->wet_env += env_inc;
            if (s->wet_env > target_env) s->wet_env = target_env;
        } else if (s->wet_env > target_env) {
            s->wet_env -= env_inc;
            if (s->wet_env < target_env) s->wet_env = target_env;
        }
        if (!want_toss && s->wet_env <= 0.0f) s->tossing = 0;

        const float m = mix * s->wet_env;
        out_left[i]  = dry_l * (1.0f - m) + wet_l * m;
        out_right[i] = dry_r * (1.0f - m) + wet_r * m;
    }
}
