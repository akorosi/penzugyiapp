# Pénzügyek — build és telepítés
#
#   make build     frontend + Lambda csomag
#   make deploy    build, majd terraform apply (AWS)
#   make destroy   AWS erőforrások törlése
#   make test      backend tesztek (TEST_DATABASE_URL kell hozzá)

TF ?= terraform
INFRA := infra

.PHONY: build frontend lambda init plan deploy destroy outputs test

build: frontend lambda

frontend:
	cd frontend && npm ci --no-audit --no-fund && npm run build

lambda:
	./scripts/build_lambda.sh

init:
	$(TF) -chdir=$(INFRA) init

plan: build init
	$(TF) -chdir=$(INFRA) plan

deploy: build init
	$(TF) -chdir=$(INFRA) apply
	@echo
	@echo "Weboldal:           $$($(TF) -chdir=$(INFRA) output -raw website_url)"
	@echo "Hozzáférési kulcs:  terraform -chdir=$(INFRA) output -raw access_key"

destroy:
	$(TF) -chdir=$(INFRA) destroy

outputs:
	$(TF) -chdir=$(INFRA) output

test:
	cd app && python -m pytest -q tests
