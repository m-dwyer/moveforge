#include <stddef.h>
#include "dustline_core.h"

#define BLOCK_FRAMES 128

static dustline_core_t g_core;
static float g_left[BLOCK_FRAMES];
static float g_right[BLOCK_FRAMES];

__attribute__((export_name("wf_init")))
void wf_init(void) {
    dustline_init(&g_core);
}

__attribute__((export_name("wf_set_param")))
void wf_set_param(int id, float value) {
    dustline_set_param(&g_core, id, value);
}

__attribute__((export_name("wf_note_on")))
void wf_note_on(int note, float velocity) {
    dustline_note_on(&g_core, note, velocity);
}

__attribute__((export_name("wf_note_off")))
void wf_note_off(int note) {
    dustline_note_off(&g_core, note);
}

__attribute__((export_name("wf_all_notes_off")))
void wf_all_notes_off(void) {
    dustline_all_notes_off(&g_core);
}

__attribute__((export_name("wf_set_pitch_bend")))
void wf_set_pitch_bend(float bend) {
    dustline_pitch_bend(&g_core, bend);
}

__attribute__((export_name("wf_left_ptr")))
float *wf_left_ptr(void) {
    return g_left;
}

__attribute__((export_name("wf_right_ptr")))
float *wf_right_ptr(void) {
    return g_right;
}

__attribute__((export_name("wf_render")))
void wf_render(int frames) {
    if (frames > BLOCK_FRAMES) frames = BLOCK_FRAMES;
    dustline_process_float(&g_core, NULL, NULL, g_left, g_right, frames);
}
