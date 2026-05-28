#ifndef FAUST_VOICE_CORE_H
#define FAUST_VOICE_CORE_H

/* Moveforge core API for the Faust-backed faust_voice sound generator.
 * The C wrapper owns MIDI dispatch (note on/off, pitch bend) and drives
 * the Faust patch's `gate`, `freq`, `gain` zones each block. User-facing
 * params (cutoff, resonance, attack, release, level) are driven through
 * the standard moveforge param API. */

typedef struct {
    /* User-facing params, populated by faust_voice_apply_defaults. */
    float cutoff;
    float resonance;
    float attack;
    float release;
    float level;

    /* Mono voice state. */
    int   active_note;     /* MIDI note number, -1 when no voice held */
    float current_freq;    /* Hz */
    float current_gain;    /* 0..1 (scaled MIDI velocity) */
    float gate;            /* 0.0 or 1.0 */
    float pitch_bend_semis;/* semitones */

    /* Faust handle. */
    void *fdsp;

    /* Param zones captured by buildUserInterface, indexed by
     * FAUST_VOICE_PARAM_*. */
    void *zones[5];

    /* C-driven control zones, captured by hardcoded label. */
    void *zone_gate;
    void *zone_freq;
    void *zone_gain;
} faust_voice_core_t;

void faust_voice_init(faust_voice_core_t *s);
void faust_voice_destroy(faust_voice_core_t *s);
void faust_voice_apply_defaults(faust_voice_core_t *s);
int  faust_voice_param_id(const char *key);
void faust_voice_set_param(faust_voice_core_t *s, int param_id, float value);
float faust_voice_get_param(const faust_voice_core_t *s, int param_id);
void faust_voice_note_on(faust_voice_core_t *s, int note, float velocity);
void faust_voice_note_off(faust_voice_core_t *s, int note);
void faust_voice_all_notes_off(faust_voice_core_t *s);
void faust_voice_pitch_bend(faust_voice_core_t *s, float bend_normalized);
void faust_voice_process_float(faust_voice_core_t *s,
                               const float *in_left, const float *in_right,
                               float *out_left, float *out_right,
                               int frames);

#endif
