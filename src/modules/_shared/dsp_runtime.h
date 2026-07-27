#ifndef MOVEFORGE_MODULES_SHARED_DSP_RUNTIME_H
#define MOVEFORGE_MODULES_SHARED_DSP_RUNTIME_H

#include <stdint.h>
#include <math.h>

#define MOVEFORGE_SAMPLE_RATE 44100.0f
#define MOVEFORGE_BLOCK_FRAMES 128
#define MOVEFORGE_TWO_PI 6.2831853071795864769f

static inline float moveforge_clampf(float x, float lo, float hi)
{
    return x < lo ? lo : (x > hi ? hi : x);
}

static inline float moveforge_i16_to_float(int16_t x)
{
    return (float)x / 32768.0f;
}

static inline float moveforge_midi_note_to_hz(float note_semis)
{
    return 440.0f * powf(2.0f, (note_semis - 69.0f) / 12.0f);
}

/* Offline-only non-finite trap.
 *
 * This is the single point where every module's float output becomes int16, and
 * therefore the exact point where a NaN stops being detectable: both clamp
 * comparisons below are false for NaN, and converting NaN to an integer yields
 * 0 on every target we build for, so a filter blowup renders as digital
 * silence. That is how dustline shipped two silent presets whose goldens had
 * been blessed twice.
 *
 * The offline harnesses compile with -DMOVEFORGE_COUNT_NONFINITE and fail the
 * render if the count is non-zero. Device and WASM builds do not define it, so
 * the audio path is unchanged where it matters. */
#ifdef MOVEFORGE_COUNT_NONFINITE
extern unsigned long moveforge_nonfinite_count;
#endif

static inline int16_t moveforge_float_to_i16(float x)
{
#ifdef MOVEFORGE_COUNT_NONFINITE
    if (!isfinite(x)) moveforge_nonfinite_count++;
#endif
    float y = x * 32767.0f;
    if (y > 32767.0f) y = 32767.0f;
    if (y < -32768.0f) y = -32768.0f;
    /* Round, don't truncate. A truncating cast biases every sample toward zero
     * and its error is correlated with the signal rather than noise-like —
     * worst exactly where quiet decaying tails live. Upstream Schwung rounds at
     * every float-to-int16 point it owns (lroundf in schwung_shim.c); this was
     * the only place in the pipeline that didn't. */
    return (int16_t)lroundf(y);
}

static inline float moveforge_midi_bend_normalized(uint8_t lsb, uint8_t msb)
{
    int bend = ((int)msb << 7) | lsb;
    return ((float)bend - 8192.0f) / 8192.0f;
}

static inline void moveforge_stereo_i16_to_float(const int16_t *in,
                                                  float *left,
                                                  float *right,
                                                  int frames)
{
    for (int i = 0; i < frames; i++) {
        left[i] = moveforge_i16_to_float(in[i * 2]);
        right[i] = moveforge_i16_to_float(in[i * 2 + 1]);
    }
}

static inline void moveforge_stereo_float_to_i16(const float *left,
                                                  const float *right,
                                                  int16_t *out,
                                                  int frames)
{
    for (int i = 0; i < frames; i++) {
        out[i * 2] = moveforge_float_to_i16(left[i]);
        out[i * 2 + 1] = moveforge_float_to_i16(right[i]);
    }
}

#endif
