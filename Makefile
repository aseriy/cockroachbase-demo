UI_SOURCES := $(wildcard ui/src/*) ui/index.html ui/vite.config.ts ui/package.json
UI_BUNDLE  := build/ui/index.html

DEPLOYABLE := crs/semgrep.yaml

MANIFESTS := build/manifests/schema.json \
             build/manifests/semgrep-api.json \
             build/manifests/semgrep.json

.PHONY: all crs image clean

all: crs image

crs: $(DEPLOYABLE)

$(UI_BUNDLE): $(UI_SOURCES)
	npm --prefix ui install
	npm --prefix ui run build

build/manifests/schema.json: schema/schema.sql Makefile
	mkdir -p $(dir $@)
	jq -n --rawfile sql $< \
	  '{apiVersion:"core.supabase.io/v1alpha1",kind:"Migration",metadata:{name:"supabase-semgrep-schema",namespace:"default"},spec:{databaseRef:{kind:"CockroachDB",name:"supabase"},migrations:[{name:"schema",sql:$$sql}]}}' > $@

build/manifests/semgrep-api.json: functions/semgrep-api/index.ts Makefile
	mkdir -p $(dir $@)
	jq -n --rawfile src $< \
	  '{apiVersion:"core.supabase.io/v1alpha1",kind:"Function",metadata:{name:"supabase-semgrep-api-function",namespace:"default"},spec:{projectRef:"supabase",functionName:"semgrep-api",verifyJwt:false,source:{"index.ts":$$src}}}' > $@

build/manifests/semgrep.json: Makefile
	mkdir -p $(dir $@)
	jq -n \
	  '{apiVersion:"apps/v1",kind:"Deployment",metadata:{name:"semgrep",namespace:"default"},spec:{replicas:0,selector:{matchLabels:{app:"semgrep"}},template:{metadata:{labels:{app:"semgrep"}},spec:{containers:[{name:"semgrep",image:"localhost:5000/semgrep:latest",imagePullPolicy:"Always",ports:[{containerPort:8080}],env:[{name:"SEMGREP_URL",value:"http://supabase-envoy:8000"},{name:"SUPABASE_SERVICE_ROLE_KEY",valueFrom:{secretKeyRef:{name:"supabase-jwt",key:"service-key"}}},{name:"SUPABASE_ANON_KEY",valueFrom:{secretKeyRef:{name:"supabase-jwt",key:"anon-key"}}}]}]}}}}' > $@

IMG ?= semgrep:latest

image: $(UI_BUNDLE)
	cp $(UI_BUNDLE) generator/index.html
	docker build -t $(IMG) generator

$(DEPLOYABLE): $(MANIFESTS)
	mkdir -p crs
	{ cat build/manifests/schema.json; \
	  printf -- '---\n'; cat build/manifests/semgrep-api.json; \
	  printf -- '---\n'; cat build/manifests/semgrep.json; } > $@

clean:
	rm -rf build crs ui/node_modules generator/index.html
