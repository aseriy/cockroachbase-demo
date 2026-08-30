SIZE_LIMIT := 972800

UI_SOURCES := $(wildcard ui/src/*) ui/index.html ui/vite.config.ts ui/package.json
UI_BUNDLE  := build/ui/index.html
PAGE_MOD   := build/demo-ui/page.ts

MANIFESTS := crs/supabase-semantic-function.yaml \
             crs/supabase-demo-ui-function.yaml \
             crs/supabase-demo-schema-migration.yaml

.PHONY: all ui crs clean

all: crs

ui: $(PAGE_MOD)

crs: $(MANIFESTS)

$(UI_BUNDLE): $(UI_SOURCES)
	npm --prefix ui install
	npm --prefix ui run build

$(PAGE_MOD): $(UI_BUNDLE)
	mkdir -p $(dir $@)
	{ printf 'export default '; jq -Rs . < $<; printf ';\n'; } > $@

define check_size
	@sz=$$(stat -c%s $@); \
	if [ $$sz -gt $(SIZE_LIMIT) ]; then rm -f $@; echo "error: $@ is $$sz bytes, over $(SIZE_LIMIT)" >&2; exit 1; fi; \
	echo "packaged $@ ($$sz bytes)"
endef

crs/supabase-semantic-function.yaml: functions/semantic/index.ts
	mkdir -p crs
	jq -n --rawfile src $< \
	  '{apiVersion:"core.supabase.io/v1alpha1",kind:"Function",metadata:{name:"supabase-semantic-function",namespace:"default"},spec:{projectRef:"supabase",functionName:"semantic",verifyJwt:false,source:{"index.ts":$$src}}}' > $@
	$(check_size)

crs/supabase-demo-ui-function.yaml: functions/demo-ui/index.ts $(PAGE_MOD)
	mkdir -p crs
	jq -n --rawfile stub functions/demo-ui/index.ts --rawfile page $(PAGE_MOD) \
	  '{apiVersion:"core.supabase.io/v1alpha1",kind:"Function",metadata:{name:"supabase-demo-ui-function",namespace:"default"},spec:{projectRef:"supabase",functionName:"demo-ui",verifyJwt:false,source:{"index.ts":$$stub,"page.ts":$$page}}}' > $@
	$(check_size)

crs/supabase-demo-schema-migration.yaml: schema/demo-schema.sql
	mkdir -p crs
	jq -n --rawfile sql $< \
	  '{apiVersion:"core.supabase.io/v1alpha1",kind:"Migration",metadata:{name:"supabase-demo-schema",namespace:"default"},spec:{databaseRef:{kind:"CockroachDB",name:"supabase"},migrations:[{name:"demo-schema",sql:$$sql}]}}' > $@
	$(check_size)

clean:
	rm -rf build crs
