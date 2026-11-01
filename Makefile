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

build/manifests/schema.json: schema/schema.sql manifests/schema.json Makefile
	mkdir -p $(dir $@)
	jq --rawfile sql $< '.spec.migrations[0].sql = $$sql' manifests/schema.json > $@

build/manifests/semgrep-api.json: functions/semgrep-api/index.ts manifests/semgrep-api.json Makefile
	mkdir -p $(dir $@)
	jq --rawfile src $< '.spec.source["index.ts"] = $$src' manifests/semgrep-api.json > $@

build/manifests/semgrep.json: manifests/semgrep.json Makefile
	mkdir -p $(dir $@)
	cp $< $@

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
