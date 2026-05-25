#include <stddef.h>
#include "foo_core.h"

#define BLOCK_FRAMES 128

static foo_core_t g_core;
static float g_left[BLOCK_FRAMES];
static float g_right[BLOCK_FRAMES];

__attribute__((export_name("mf_init")))
void mf_init(void) { foo_init(&g_core); }

__attribute__((export_name("mf_set_param")))
void mf_set_param(int id, float value) { foo_set_param(&g_core, id, value); }

__attribute__((export_name("mf_note_on")))
void mf_note_on(int note, float velocity) { foo_note_on(&g_core, note, velocity); }

__attribute__((export_name("mf_note_off")))
void mf_note_off(int note) { foo_note_off(&g_core, note); }

__attribute__((export_name("mf_all_notes_off")))
void mf_all_notes_off(void) { foo_all_notes_off(&g_core); }

__attribute__((export_name("mf_set_pitch_bend")))
void mf_set_pitch_bend(float bend) { foo_pitch_bend(&g_core, bend); }

__attribute__((export_name("mf_left_ptr")))
float *mf_left_ptr(void) { return g_left; }

__attribute__((export_name("mf_right_ptr")))
float *mf_right_ptr(void) { return g_right; }

__attribute__((export_name("mf_render")))
void mf_render(int frames) {
    if (frames > BLOCK_FRAMES) frames = BLOCK_FRAMES;
    foo_process_float(&g_core, NULL, NULL, g_left, g_right, frames);
}
