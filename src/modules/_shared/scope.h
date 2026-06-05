#ifndef MOVEFORGE_MODULES_SHARED_SCOPE_H
#define MOVEFORGE_MODULES_SHARED_SCOPE_H

/*
 * Shared, optional oscilloscope helper for moveforge DSP modules.
 *
 * The capture point is the wrapper's float output buffer -- the same
 * out_left/out_right every sound_generator and audio_fx wrapper produces just
 * before int16 conversion. Because that seam is identical for plain-C cores and
 * Faust adapters, this helper works for both without touching DSP internals.
 *
 * A module opts in by:
 *   1. holding an mf_scope_t in its plugin struct,
 *   2. mf_scope_init(..., mode, style) in create_instance,
 *   3. mf_scope_capture(...) in render_block after process_float,
 *   4. returning mf_scope_serialize(...) for the reserved "__scope" key in
 *      get_param,
 *   5. (one-shot mode) mf_scope_arm(...) on note-on,
 *   6. declaring capabilities.scope { mode, style, window } in module.json.
 *
 * The UI reads "__scope" via host_module_get_param and draws the columns. The
 * serialized format is ALWAYS 128 columns x (max-row, min-row), regardless of
 * style, so the chain UI is style-agnostic -- style only changes how the frame
 * is built here, DSP-side. Everything is allocation-free and RT-safe.
 *
 * STYLE: untriggered min/max ("envelope") is the universal default. It makes no
 * assumption about the signal, so it stays honest for noise, chords, transient
 * hits, FX tails and inharmonic FM alike -- it never goes blank or misleads.
 * Trigger/line are opt-ins for modules whose author knows the signal suits them
 * (a mono, harmonic, sustained voice). See docs/scope-adaptive-plan.md for the
 * future auto-adaptive default.
 */

#define MF_SCOPE_COLS 128   /* one column per display pixel-x (128x64 OLED) */
#define MF_SCOPE_ROWS 64    /* display height; serialized value range */
#define MF_SCOPE_ENC_BASE 48 /* printable ASCII base for encoded rows */
#define MF_SCOPE_SQUELCH 0.02f /* frames quieter than this serve nothing (idle/silence) */

/* capture cadence */
enum {
    MF_SCOPE_CONTINUOUS = 0, /* refill frames forever (animates while sounding) */
    MF_SCOPE_ONESHOT    = 1  /* fill one frame after arm, then hold it frozen */
};

/* render style (how each frame is built; serialized format is unchanged) */
enum {
    MF_SCOPE_ENVELOPE  = 0,  /* untriggered min/max -- the honest universal default */
    MF_SCOPE_TRIGGERED = 1,  /* min/max, each frame phase-locked to a rising zero-crossing */
    MF_SCOPE_LINE      = 2,  /* one decimated sample per column (thin trace; aliases) */
    MF_SCOPE_NONE      = 3   /* disabled: capture and serialize are no-ops */
};

typedef struct {
    int   window;               /* samples per full frame */
    int   pos;                  /* samples into the current frame */
    int   mode;                 /* MF_SCOPE_CONTINUOUS | MF_SCOPE_ONESHOT */
    int   style;                /* MF_SCOPE_ENVELOPE | TRIGGERED | LINE | NONE */
    int   running;              /* 1 = actively filling */
    int   have_frame;           /* a published frame exists */
    int   active;               /* last frame's peak >= squelch (i.e. sounding) */
    int   trig_wait;            /* TRIGGERED: waiting for a rising zero-crossing */
    int   trig_age;             /* samples spent waiting (for the timeout) */
    float prev;                 /* previous sample (edge detection) */
    float cur_min[MF_SCOPE_COLS];
    float cur_max[MF_SCOPE_COLS];
    float pub_min[MF_SCOPE_COLS];
    float pub_max[MF_SCOPE_COLS];
} mf_scope_t;

static inline void mf_scope_reset_accum(mf_scope_t *s)
{
    for (int i = 0; i < MF_SCOPE_COLS; i++) {
        s->cur_min[i] = 1e30f;
        s->cur_max[i] = -1e30f;
    }
    s->pos = 0;
}

static inline void mf_scope_init(mf_scope_t *s, int window_samples, int mode, int style)
{
    if (!s) return;
    if (window_samples < MF_SCOPE_COLS) window_samples = MF_SCOPE_COLS;
    s->window = window_samples;
    s->mode = mode;
    s->style = style;
    s->have_frame = 0;
    s->active = 0;
    s->running = (mode == MF_SCOPE_CONTINUOUS) ? 1 : 0;
    s->trig_wait = (style == MF_SCOPE_TRIGGERED) ? 1 : 0;
    s->trig_age = 0;
    s->prev = 0.0f;
    for (int i = 0; i < MF_SCOPE_COLS; i++) {
        s->pub_min[i] = 0.0f;
        s->pub_max[i] = 0.0f;
    }
    mf_scope_reset_accum(s);
}

/* Re-arm a one-shot scope (e.g. from on_midi note-on) and restart the frame. */
static inline void mf_scope_arm(mf_scope_t *s)
{
    if (!s) return;
    mf_scope_reset_accum(s);
    s->trig_wait = (s->style == MF_SCOPE_TRIGGERED) ? 1 : 0;
    s->trig_age = 0;
    s->running = 1;
}

static inline void mf_scope_publish(mf_scope_t *s)
{
    float peak = 0.0f;
    for (int c = 0; c < MF_SCOPE_COLS; c++) {
        if (s->cur_max[c] < s->cur_min[c]) {
            /* column saw no samples -> collapse to centre */
            s->pub_min[c] = 0.0f;
            s->pub_max[c] = 0.0f;
        } else {
            s->pub_min[c] = s->cur_min[c];
            s->pub_max[c] = s->cur_max[c];
        }
        float lo = s->pub_min[c] < 0.0f ? -s->pub_min[c] : s->pub_min[c];
        float hi = s->pub_max[c] < 0.0f ? -s->pub_max[c] : s->pub_max[c];
        if (lo > peak) peak = lo;
        if (hi > peak) peak = hi;
    }
    s->active = (peak >= MF_SCOPE_SQUELCH) ? 1 : 0;
    /* LINE: each column holds one decimated sample (min==max). Span each
     * column's bar to the NEXT column's sample so the points join into a
     * connected trace instead of disconnected dots. Forward pass reads each
     * neighbour's value while it is still raw. */
    if (s->style == MF_SCOPE_LINE) {
        for (int c = 0; c < MF_SCOPE_COLS; c++) {
            float a = s->pub_min[c];
            float b = (c + 1 < MF_SCOPE_COLS) ? s->pub_min[c + 1] : a;
            s->pub_min[c] = a < b ? a : b;
            s->pub_max[c] = a > b ? a : b;
        }
    }
    s->have_frame = 1;
}

static inline void mf_scope_accumulate(mf_scope_t *s, float v)
{
    long col = (long)s->pos * MF_SCOPE_COLS / s->window;
    if (col < 0) col = 0;
    if (col >= MF_SCOPE_COLS) col = MF_SCOPE_COLS - 1;
    if (s->style == MF_SCOPE_LINE) {
        s->cur_min[col] = v;   /* decimate: one sample per column */
        s->cur_max[col] = v;
    } else {
        if (v < s->cur_min[col]) s->cur_min[col] = v;
        if (v > s->cur_max[col]) s->cur_max[col] = v;
    }
    s->pos++;
}

/* Feed one processed block. `right` may be NULL for mono. */
static inline void mf_scope_capture(mf_scope_t *s,
                                    const float *left, const float *right,
                                    int frames)
{
    if (!s || !left || !s->running || s->window <= 0 || s->style == MF_SCOPE_NONE) return;
    const int trig_timeout = s->window * 2;  /* give up waiting on DC/quiet signals */
    for (int i = 0; i < frames; i++) {
        float v = right ? 0.5f * (left[i] + right[i]) : left[i];

        if (s->trig_wait) {
            int crossed = (s->prev < 0.0f && v >= 0.0f);
            s->trig_age++;
            if (crossed || s->trig_age >= trig_timeout) {
                s->trig_wait = 0;
                s->trig_age = 0;
                mf_scope_reset_accum(s);
                /* fall through: this sample is the first of the new frame */
            } else {
                s->prev = v;
                continue;
            }
        }

        mf_scope_accumulate(s, v);
        s->prev = v;
        if (s->pos >= s->window) {
            mf_scope_publish(s);
            mf_scope_reset_accum(s);
            if (s->mode == MF_SCOPE_ONESHOT) {
                s->running = 0;  /* hold the frame; drop the rest of the block */
                return;
            }
            if (s->style == MF_SCOPE_TRIGGERED) {
                s->trig_wait = 1;  /* re-arm trigger for the next frame */
                s->trig_age = 0;
            }
        }
    }
}

static inline char mf_scope_enc(float v)
{
    /* v in [-1, 1] -> row 0 (top) .. ROWS-1 (bottom) -> printable ASCII */
    float rowf = (1.0f - v) * 0.5f * (float)(MF_SCOPE_ROWS - 1);
    int r = (int)(rowf + 0.5f);
    if (r < 0) r = 0;
    if (r > MF_SCOPE_ROWS - 1) r = MF_SCOPE_ROWS - 1;
    return (char)(MF_SCOPE_ENC_BASE + r);
}

/* Serialize the last published frame as 2*COLS printable chars (max-row then
 * min-row per column). Returns length, or 0 (empty string) if no frame yet. */
static inline int mf_scope_serialize(const mf_scope_t *s, char *buf, int buf_len)
{
    if (!s || !buf || buf_len < MF_SCOPE_COLS * 2 + 1) {
        if (buf && buf_len > 0) buf[0] = '\0';
        return 0;
    }
    /* squelch: serve nothing while the voice is silent/idle, so the UI only
     * shows the scope when the module is actually sounding. */
    if (!s->have_frame || s->style == MF_SCOPE_NONE || !s->active) { buf[0] = '\0'; return 0; }
    int n = 0;
    for (int c = 0; c < MF_SCOPE_COLS; c++) {
        buf[n++] = mf_scope_enc(s->pub_max[c]); /* top pixel of the column */
        buf[n++] = mf_scope_enc(s->pub_min[c]); /* bottom pixel of the column */
    }
    buf[n] = '\0';
    return n;
}

#endif /* MOVEFORGE_MODULES_SHARED_SCOPE_H */
