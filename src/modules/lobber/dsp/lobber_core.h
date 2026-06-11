#ifndef LOBBER_CORE_H
#define LOBBER_CORE_H

#include <stdint.h>

/* Ring buffer length in samples (power of two). ~11.9 s at 44.1 kHz — enough for
 * 16 quarter-note slices at 120 BPM. Embedded in the core struct so it is
 * allocated once when the instance is calloc'd, never in the audio loop. */
#define LOBBER_BUF_LEN  (1 << 19)
#define LOBBER_BUF_MASK (LOBBER_BUF_LEN - 1)

typedef struct {
    /* --- parameters: one float per module.json key (gen-params writes these) --- */
    float active;     /* >=0.5 engages tossing via knob (pads override) */
    float offset;     /* slices behind "now" to jump to */
    float division;   /* slice grid index: 0=1/4 1=1/8 2=1/8T 3=1/16 4=1/32 */
    float loop;       /* >=0.5 loops the slice (stutter); else plays through */
    float ratchet;    /* subdivides the loop window (0..4, each step halves it) */
    float reverse;    /* >=0.5 reads backwards */
    float freeze;     /* >=0.5 stops recording (buffer holds) */
    float mix;        /* wet/dry */
    float bpm;        /* fallback tempo when the host clock is unavailable */
    float xfade;      /* declick crossfade length, milliseconds */

    /* --- tempo supplied by the wrapper each block --- */
    float host_bpm;
    int   use_host_bpm;

    /* --- record buffer + write head --- */
    float   buf_l[LOBBER_BUF_LEN];
    float   buf_r[LOBBER_BUF_LEN];
    int64_t write_pos;        /* absolute index of the next sample to write */

    /* --- read-head state machine --- */
    int     tossing;          /* currently reading from the buffer? */
    int     pad_held;         /* a pad/note is holding a toss */
    int     pad_note;         /* MIDI note currently holding the toss */
    int     pad_offset;       /* slice offset requested by the held pad */

    int64_t head_a;           /* primary read position (absolute) */
    int64_t head_b;           /* incoming read position during a jump crossfade */
    int     dir;              /* +1 forward, -1 reverse */
    int64_t window_start;     /* absolute start of the current loop window */
    int     window_len;       /* loop window length in samples */
    int     phase;            /* samples read since window_start */

    int     xf_pos;           /* samples left in the head A->B crossfade (0 = none) */
    int     xf_len;           /* length of the current crossfade */

    float   wet_env;          /* 0..1 dry->wet slew (declick on toss engage/release) */

    /* latched control state, to detect changes that require a re-jump */
    int     last_offset;
    int     last_division;
    int     last_reverse;
    int     last_ratchet;
} lobber_core_t;

void  lobber_init(lobber_core_t *s);
void  lobber_apply_defaults(lobber_core_t *s);
int   lobber_param_id(const char *key);
void  lobber_set_param(lobber_core_t *s, int param_id, float value);
float lobber_get_param(const lobber_core_t *s, int param_id);

/* Wrapper feeds host tempo each block. clock_available=0 (e.g. browser/offline)
 * falls back to the bpm parameter. */
void  lobber_set_tempo(lobber_core_t *s, float bpm, int clock_available);

/* MIDI in: a note holds a toss at a slice offset, release returns to live. */
void  lobber_handle_midi(lobber_core_t *s, int status, int d1, int d2);

void  lobber_process_float(lobber_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif
