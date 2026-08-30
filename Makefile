SIZE_LIMIT := 972800

UI_SOURCES := $(wildcard ui/src/*) ui/index.html ui/vite.config.ts ui/package.json
UI_BUNDLE  := build/ui/index.html
PAGE_MOD   := build/semgrep/page.ts

DEPLOYABLE := crs/semgrep.yaml

MANIFESTS := build/manifests/schema.json \
             build/manifests/semgrep-api.json \
             build/manifests/semgrep.json \
             build/manifests/generator.json

.PHONY: all ui crs generator-image clean

all: crs

ui: $(PAGE_MOD)

crs: $(DEPLOYABLE)

$(UI_BUNDLE): $(UI_SOURCES)
	npm --prefix ui install
	npm --prefix ui run build

$(PAGE_MOD): $(UI_BUNDLE)
	mkdir -p $(dir $@)
	{ printf 'export default '; jq -Rs . < $<; printf ';\n'; } > $@

build/manifests/schema.json: schema/schema.sql Makefile
	mkdir -p $(dir $@)
	jq -n --rawfile sql $< \
	  '{apiVersion:"core.supabase.io/v1alpha1",kind:"Migration",metadata:{name:"supabase-semgrep-schema",namespace:"default"},spec:{databaseRef:{kind:"CockroachDB",name:"supabase"},migrations:[{name:"schema",sql:$$sql}]}}' > $@

build/manifests/semgrep-api.json: functions/semgrep-api/index.ts Makefile
	mkdir -p $(dir $@)
	jq -n --rawfile src $< \
	  '{apiVersion:"core.supabase.io/v1alpha1",kind:"Function",metadata:{name:"supabase-semgrep-api-function",namespace:"default"},spec:{projectRef:"supabase",functionName:"semgrep-api",verifyJwt:false,source:{"index.ts":$$src}}}' > $@

build/manifests/semgrep.json: functions/semgrep/index.ts $(PAGE_MOD) Makefile
	mkdir -p $(dir $@)
	jq -n --rawfile stub functions/semgrep/index.ts --rawfile page $(PAGE_MOD) \
	  '{apiVersion:"core.supabase.io/v1alpha1",kind:"Function",metadata:{name:"supabase-semgrep-function",namespace:"default"},spec:{projectRef:"supabase",functionName:"semgrep",verifyJwt:false,source:{"index.ts":$$stub,"page.ts":$$page}}}' > $@

build/manifests/generator.json: Makefile
	mkdir -p $(dir $@)
	jq -n \
	  '{apiVersion:"apps/v1",kind:"Deployment",metadata:{name:"semgrep-generator",namespace:"default"},spec:{replicas:0,selector:{matchLabels:{app:"semgrep-generator"}},template:{metadata:{labels:{app:"semgrep-generator"}},spec:{containers:[{name:"generator",image:"localhost:5000/semgrep-generator:latest",imagePullPolicy:"Always",env:[{name:"SEMGREP_URL",value:"http://supabase-envoy:8000"},{name:"SUPABASE_SERVICE_ROLE_KEY",valueFrom:{secretKeyRef:{name:"supabase-jwt",key:"service-key"}}}]}]}}}}' > $@

IMG ?= semgrep-generator:latest

generator-image:
	docker build -t $(IMG) generator

$(DEPLOYABLE): $(MANIFESTS)
	mkdir -p crs
	{ cat build/manifests/schema.json; \
	  printf -- '---\n'; cat build/manifests/semgrep-api.json; \
	  printf -- '---\n'; cat build/manifests/semgrep.json; \
	  printf -- '---\n'; cat build/manifests/generator.json; } > $@
	@sz=$$(stat -c%s $@); \
	if [ $$sz -gt $(SIZE_LIMIT) ]; then rm -f $@; echo "error: $@ is $$sz bytes, over $(SIZE_LIMIT)" >&2; exit 1; fi; \
	echo "packaged $@ ($$sz bytes)"

clean:
	rm -rf build crs ui/node_modules
