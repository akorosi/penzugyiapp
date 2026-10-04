# Pénzügyek — build és telepítés (Windows, macOS, Linux)
#
#   make build     frontend + Lambda csomag
#   make deploy    build, majd terraform apply (AWS)
#   make destroy   AWS erőforrások törlése
#   make test      backend tesztek (TEST_DATABASE_URL kell hozzá)

TF ?= terraform
INFRA := infra

# Windowson a "python3" gyakran csak a Microsoft Store-ra mutató álparancs.
ifeq ($(OS),Windows_NT)
PYTHON ?= python
else
PYTHON ?= python3
endif

.PHONY: build frontend lambda init plan deploy destroy outputs test

build: frontend lambda

frontend:
	cd frontend && npm ci --no-audit --no-fund && npm run build

lambda:
	$(PYTHON) scripts/build_lambda.py

init:
	$(TF) -chdir=$(INFRA) init

plan: build init
	$(TF) -chdir=$(INFRA) plan

deploy: build init
	$(TF) -chdir=$(INFRA) apply
	$(TF) -chdir=$(INFRA) output website_url

destroy:
	$(TF) -chdir=$(INFRA) destroy

outputs:
	$(TF) -chdir=$(INFRA) output

test:
	cd app && $(PYTHON) -m pytest -q tests
