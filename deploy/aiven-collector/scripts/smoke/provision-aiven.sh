#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# scripts/smoke/provision-aiven.sh
#
# Wrapper that automates the Aiven Terraform POC apply/destroy workflow.
#
# Prerequisites:
#   - terraform >= 1.7 installed
#   - infra/aiven/backend-override.tf created from backend-override.tf.example
#   - infra/aiven/poc.auto.tfvars created from poc.auto.tfvars.example
#   - TF_VAR_aiven_api_token and TF_VAR_aiven_project set in environment
#
# Usage:
#   ./scripts/smoke/provision-aiven.sh plan
#   ./scripts/smoke/provision-aiven.sh apply
#   ./scripts/smoke/provision-aiven.sh destroy
#   ./scripts/smoke/provision-aiven.sh outputs   # print outputs as JSON
# ---------------------------------------------------------------------------
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AIVEN_DIR="$REPO_ROOT/infra/aiven"
POC_TFVARS="$AIVEN_DIR/poc.auto.tfvars"
BACKEND_OVERRIDE="$AIVEN_DIR/backend-override.tf"
OUTPUTS_FILE="$AIVEN_DIR/poc-outputs.json"

# Guard: required files
if [[ ! -f "$POC_TFVARS" ]]; then
  echo "ERROR: $POC_TFVARS not found."
  echo "  cp infra/aiven/poc.auto.tfvars.example infra/aiven/poc.auto.tfvars"
  echo "  # then edit cloud_name, plans, etc."
  exit 1
fi
if [[ ! -f "$BACKEND_OVERRIDE" ]]; then
  echo "ERROR: $BACKEND_OVERRIDE not found."
  echo "  cp infra/aiven/backend-override.tf.example infra/aiven/backend-override.tf"
  exit 1
fi
if [[ -z "${TF_VAR_aiven_api_token:-}" ]]; then
  echo "ERROR: TF_VAR_aiven_api_token is not set."
  exit 1
fi
if [[ -z "${TF_VAR_aiven_project:-}" ]]; then
  echo "ERROR: TF_VAR_aiven_project is not set."
  exit 1
fi

ACTION="${1:-plan}"
cd "$AIVEN_DIR"

case "$ACTION" in
  plan)
    terraform init -reconfigure -upgrade
    terraform plan -var-file=poc.auto.tfvars
    ;;
  apply)
    terraform init -reconfigure -upgrade
    terraform apply -var-file=poc.auto.tfvars -auto-approve
    terraform output -json > "$OUTPUTS_FILE"
    echo "[provision] Outputs written to $OUTPUTS_FILE"
    ;;
  destroy)
    terraform init -reconfigure
    terraform destroy -var-file=poc.auto.tfvars -auto-approve
    echo "[provision] Destroyed. Verify with: aiven_service_list in the MCP."
    ;;
  outputs)
    terraform output -json | tee "$OUTPUTS_FILE"
    ;;
  *)
    echo "Unknown action: $ACTION (use plan|apply|destroy|outputs)"
    exit 1
    ;;
esac
