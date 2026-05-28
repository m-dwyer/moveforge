#ifndef MOVEFORGE_FAUST_ADAPTER_H
#define MOVEFORGE_FAUST_ADAPTER_H

/* Shared boilerplate for moveforge adapters wrapping a Faust-generated
 * DSP. Provides the UIGlue / MetaGlue struct definitions the Faust C
 * backend expects, plus no-op callbacks for the parts we don't need.
 *
 * The Faust-generated `buildUserInterface<prefix>` is the only path
 * exposing each parameter's underlying FAUSTFLOAT zone address. Each
 * adapter defines its own slider capture callback to bind those zones
 * to its module-specific layout, then calls
 * `moveforge_faust_make_ui` to assemble a UIGlue that routes slider
 * callbacks through the adapter and ignores everything else.
 *
 * All functions are static inline so this header is safe to include
 * from multiple translation units. */

#ifndef FAUSTFLOAT
#define FAUSTFLOAT float
#endif

typedef void (*moveforge_faust_slider_cb)(void *ui_state, const char *label, FAUSTFLOAT *zone,
                                          FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step);

typedef struct UIGlue {
    void *uiInterface;
    void (*openTabBox)(void *ui, const char *label);
    void (*openHorizontalBox)(void *ui, const char *label);
    void (*openVerticalBox)(void *ui, const char *label);
    void (*closeBox)(void *ui);
    void (*addButton)(void *ui, const char *label, FAUSTFLOAT *zone);
    void (*addCheckButton)(void *ui, const char *label, FAUSTFLOAT *zone);
    void (*addVerticalSlider)(void *ui, const char *label, FAUSTFLOAT *zone,
                              FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step);
    void (*addHorizontalSlider)(void *ui, const char *label, FAUSTFLOAT *zone,
                                FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step);
    void (*addNumEntry)(void *ui, const char *label, FAUSTFLOAT *zone,
                        FAUSTFLOAT init, FAUSTFLOAT min, FAUSTFLOAT max, FAUSTFLOAT step);
    void (*addHorizontalBargraph)(void *ui, const char *label, FAUSTFLOAT *zone,
                                  FAUSTFLOAT min, FAUSTFLOAT max);
    void (*addVerticalBargraph)(void *ui, const char *label, FAUSTFLOAT *zone,
                                FAUSTFLOAT min, FAUSTFLOAT max);
    void (*addSoundfile)(void *ui, const char *label, const char *filename, void *sf_zone);
    void (*declare)(void *ui, FAUSTFLOAT *zone, const char *key, const char *value);
} UIGlue;

typedef struct MetaGlue {
    void *metaInterface;
    void (*declare)(void *m, const char *key, const char *value);
} MetaGlue;

static inline void moveforge_faust_noop_box(void *ui, const char *label) { (void)ui; (void)label; }
static inline void moveforge_faust_noop_close(void *ui) { (void)ui; }
static inline void moveforge_faust_noop_button(void *ui, const char *label, FAUSTFLOAT *zone) {
    (void)ui; (void)label; (void)zone;
}
static inline void moveforge_faust_noop_bargraph(void *ui, const char *label, FAUSTFLOAT *zone,
                                                 FAUSTFLOAT min, FAUSTFLOAT max) {
    (void)ui; (void)label; (void)zone; (void)min; (void)max;
}
static inline void moveforge_faust_noop_soundfile(void *ui, const char *label, const char *filename, void *sf_zone) {
    (void)ui; (void)label; (void)filename; (void)sf_zone;
}
static inline void moveforge_faust_noop_declare(void *ui, FAUSTFLOAT *zone, const char *key, const char *value) {
    (void)ui; (void)zone; (void)key; (void)value;
}

/* Build a UIGlue where every slider callback (vertical/horizontal/numentry)
 * routes to `cb(ui_state, label, zone, init, min, max, step)`. The adapter's
 * cb decides what to do with each captured zone — typically mapping the
 * label to a moveforge param id and storing the zone in its core struct. */
static inline UIGlue moveforge_faust_make_ui(void *ui_state, moveforge_faust_slider_cb cb) {
    UIGlue glue;
    glue.uiInterface = ui_state;
    glue.openTabBox = moveforge_faust_noop_box;
    glue.openHorizontalBox = moveforge_faust_noop_box;
    glue.openVerticalBox = moveforge_faust_noop_box;
    glue.closeBox = moveforge_faust_noop_close;
    glue.addButton = moveforge_faust_noop_button;
    glue.addCheckButton = moveforge_faust_noop_button;
    glue.addVerticalSlider = cb;
    glue.addHorizontalSlider = cb;
    glue.addNumEntry = cb;
    glue.addHorizontalBargraph = moveforge_faust_noop_bargraph;
    glue.addVerticalBargraph = moveforge_faust_noop_bargraph;
    glue.addSoundfile = moveforge_faust_noop_soundfile;
    glue.declare = moveforge_faust_noop_declare;
    return glue;
}

#endif
