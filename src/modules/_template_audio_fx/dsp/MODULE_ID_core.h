#ifndef MODULE_UPPER_CORE_H
#define MODULE_UPPER_CORE_H

typedef enum {
    MODULE_UPPER_PARAM_MIX = 0,
    MODULE_UPPER_PARAM_DRIVE = 1,
    MODULE_UPPER_PARAM_TONE = 2,
    MODULE_UPPER_PARAM_COUNT
} MODULE_ID_param_t;

typedef struct {
    float mix;
    float drive;
    float tone;
    float lp_l;
    float lp_r;
} MODULE_ID_core_t;

void MODULE_ID_init(MODULE_ID_core_t *s);
int MODULE_ID_param_id(const char *key);
void MODULE_ID_set_param(MODULE_ID_core_t *s, int param_id, float value);
float MODULE_ID_get_param(const MODULE_ID_core_t *s, int param_id);
void MODULE_ID_process_float(MODULE_ID_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif
