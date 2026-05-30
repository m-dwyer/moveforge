#ifndef {{moduleUpper}}_CORE_H
#define {{moduleUpper}}_CORE_H

typedef struct {
    float mix;
    float level;

    void *fdsp;
    void *zones[2];
} {{moduleId}}_core_t;

void {{moduleId}}_init({{moduleId}}_core_t *s);
void {{moduleId}}_destroy({{moduleId}}_core_t *s);
void {{moduleId}}_apply_defaults({{moduleId}}_core_t *s);
int {{moduleId}}_param_id(const char *key);
void {{moduleId}}_set_param({{moduleId}}_core_t *s, int param_id, float value);
float {{moduleId}}_get_param(const {{moduleId}}_core_t *s, int param_id);
void {{moduleId}}_process_float({{moduleId}}_core_t *s,
                             const float *in_left, const float *in_right,
                             float *out_left, float *out_right,
                             int frames);

#endif
