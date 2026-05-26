#include "arpy_core.h"
#include <string.h>

#include "arpy_params.gen.inc"

/* Chord modes: semitone offsets from the held note, including the root.
 * Counts table tells us how many notes each chord uses. */
#define ARPY_MAX_NOTES 4
static const int8_t k_chord_notes[5][ARPY_MAX_NOTES] = {
    { 0,  0,  0,  0  }, /* single */
    { 0,  12, 0,  0  }, /* octave */
    { 0,  7,  12, 0  }, /* power */
    { 0,  4,  7,  0  }, /* triad */
    { 0,  4,  7,  10 }  /* dom7 */
};
static const int k_chord_counts[5] = { 1, 2, 3, 3, 4 };

void arpy_init(arpy_core_t *s) {
    if (!s) return;
    memset(s, 0, sizeof(*s));
    s->playing_note = -1;
    arpy_apply_defaults(s);
}

static int param_mode(float v, int max) {
    int m = (int)(v + 0.5f);
    if (m < 0) m = 0;
    if (m > max) m = max;
    return m;
}

static int rate_to_frames(float rate, int sample_rate) {
    /* Map rate 0..1 -> 50ms..1000ms (linear) at the given sample rate. */
    if (rate < 0.0f) rate = 0.0f;
    if (rate > 1.0f) rate = 1.0f;
    float ms = 50.0f + rate * 950.0f;
    int frames = (int)((ms * 0.001f) * (float)sample_rate);
    if (frames < 1) frames = 1;
    return frames;
}

static int emit(uint8_t out_msgs[][3], int out_lens[], int max_out, int idx,
                uint8_t status, uint8_t d1, uint8_t d2) {
    if (idx >= max_out) return idx;
    out_msgs[idx][0] = status;
    out_msgs[idx][1] = d1;
    out_msgs[idx][2] = d2;
    out_lens[idx] = 3;
    return idx + 1;
}

/* Map a step index to a chord-note index for the active pattern.
 *   pattern 1 (up):       0,1,2,...,N-1,0,1,...      period N
 *   pattern 2 (down):     N-1,N-2,...,0,N-1,...      period N
 *   pattern 3 (up-down):  0,1,...,N-1,N-2,...,1,...  period max(1, 2*(N-1))
 */
static int step_to_chord_idx(int step, int n, int pattern) {
    if (n <= 1) return 0;
    if (pattern == 1) return ((step % n) + n) % n;
    if (pattern == 2) return (n - 1) - (((step % n) + n) % n);
    if (pattern == 3) {
        int period = 2 * (n - 1);
        int p = ((step % period) + period) % period;
        return p < n ? p : (2 * (n - 1) - p);
    }
    return 0;
}

int arpy_process_midi(arpy_core_t *s,
                      const uint8_t *in_msg, int in_len,
                      uint8_t out_msgs[][3], int out_lens[], int max_out) {
    if (!s || !in_msg || in_len < 1 || max_out < 1) return 0;

    uint8_t status = in_msg[0] & 0xF0;
    uint8_t channel = in_msg[0] & 0x0F;
    int pattern = param_mode(s->pattern, 3);
    int n = 0;

    if (status == 0x90 && in_len >= 3 && in_msg[2] > 0) {
        if (pattern == 0) {
            return emit(out_msgs, out_lens, max_out, n, in_msg[0], in_msg[1], in_msg[2]);
        }
        /* Arming the arpeggiator: a fresh held note resets the step counter so
         * the first emitted note is always the root. If a previous arp note is
         * still sounding, close it cleanly so the synth's envelope retriggers. */
        if (s->playing_note >= 0) {
            n = emit(out_msgs, out_lens, max_out, n, 0x80 | s->held_channel,
                     (uint8_t)s->playing_note, 0);
            s->playing_note = -1;
        }
        s->held_active = 1;
        s->held_note = in_msg[1];
        s->held_velocity = in_msg[2];
        s->held_channel = channel;
        s->step_index = 0;
        s->frames_to_next_step = 0; /* fire on the next tick */
        s->frames_until_gate_off = 0;
        return n;
    }

    if (status == 0x80 || (status == 0x90 && in_len >= 3 && in_msg[2] == 0)) {
        if (pattern == 0) {
            return emit(out_msgs, out_lens, max_out, n, in_msg[0], in_msg[1], 0);
        }
        /* Only stop the arp if the released note matches the held one; ignore
         * spurious note-offs for stacked input notes we didn't track. */
        if (s->held_active && s->held_note == in_msg[1]) {
            s->held_active = 0;
            /* The currently sounding arp note will be released by the next tick
             * when its gate timer expires; that gives a natural decay rather
             * than a sharp cutoff when the user lifts the key. */
        }
        return n;
    }

    /* Other messages pass through unchanged. */
    return emit(out_msgs, out_lens, max_out, n, in_msg[0],
                in_len > 1 ? in_msg[1] : 0,
                in_len > 2 ? in_msg[2] : 0);
}

int arpy_tick(arpy_core_t *s,
              int frames, int sample_rate,
              uint8_t out_msgs[][3], int out_lens[], int max_out) {
    if (!s || frames <= 0 || sample_rate <= 0 || max_out < 1) return 0;
    int pattern = param_mode(s->pattern, 3);
    if (pattern == 0) return 0;

    int n = 0;
    int step_frames = rate_to_frames(s->rate, sample_rate);
    int gate_frames = (step_frames * 7) / 10; /* 70% gate */

    /* Step 1: close any sounding arp note whose gate has expired. */
    if (s->playing_note >= 0) {
        s->frames_until_gate_off -= frames;
        if (s->frames_until_gate_off <= 0) {
            n = emit(out_msgs, out_lens, max_out, n, 0x80 | s->held_channel,
                     (uint8_t)s->playing_note, 0);
            s->playing_note = -1;
            s->frames_until_gate_off = 0;
        }
    }

    /* Step 2: if a key is held, advance the step clock and fire new notes
     * whenever the interval timer reaches zero. */
    if (s->held_active) {
        s->frames_to_next_step -= frames;
        while (s->frames_to_next_step <= 0 && n < max_out) {
            int chord_mode = param_mode(s->chord, 4);
            int chord_count = k_chord_counts[chord_mode];
            int idx = step_to_chord_idx(s->step_index, chord_count, pattern);
            int offset = k_chord_notes[chord_mode][idx];
            int note = (int)s->held_note + offset;
            if (note >= 0 && note <= 127) {
                /* Close any still-sounding arp note before starting the next
                 * one — keeps the synth envelope behavior predictable on a
                 * monophonic generator and avoids overlapping note-offs. */
                if (s->playing_note >= 0) {
                    n = emit(out_msgs, out_lens, max_out, n, 0x80 | s->held_channel,
                             (uint8_t)s->playing_note, 0);
                    s->playing_note = -1;
                }
                n = emit(out_msgs, out_lens, max_out, n, 0x90 | s->held_channel,
                         (uint8_t)note, s->held_velocity);
                s->playing_note = (int8_t)note;
                s->frames_until_gate_off = gate_frames;
            }
            s->step_index++;
            s->frames_to_next_step += step_frames;
        }
    }
    return n;
}
