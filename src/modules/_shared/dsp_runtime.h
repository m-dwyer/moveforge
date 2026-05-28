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

static inline int16_t moveforge_float_to_i16(float x)
{
    float y = x * 32767.0f;
    if (y > 32767.0f) y = 32767.0f;
    if (y < -32768.0f) y = -32768.0f;
    return (int16_t)y;
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
