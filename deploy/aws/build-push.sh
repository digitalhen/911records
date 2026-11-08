#!/usr/bin/env bash
# build-push.sh — build the app and pipeline images for ARM64 Fargate and push them to the ECR
# repositories the Terraform created, then print the tfvars lines to set.
#
#   cd deploy/aws && terraform apply        # first time: creates the registries (and the data tier)
#   ./build-push.sh                          # needs docker buildx, aws CLI, deploy/aws/build.env
#   # paste the printed app_image / pipeline_image into terraform.tfvars, then terraform apply
set -euo pipefail
cd "$(dirname "$0")"
[ -f build.env ] || { echo "copy build.env.example to build.env and fill it in" >&2; exit 1; }
set -a; . ./build.env; set +a
: "${SITE_URL:?set SITE_URL in build.env}" "${OPERATOR_NAME:?}" "${CONTACT_EMAIL:?}"

APP_REPO=$(terraform output -raw app_repository)
PIPE_REPO=$(terraform output -raw pipeline_repository)
REGION=$(echo "$APP_REPO" | cut -d. -f4)
TAG="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${APP_REPO%%/*}"

docker buildx build --platform linux/arm64 --push -t "$APP_REPO:$TAG" \
  -f ../../Dockerfile \
  --build-arg NEXT_PUBLIC_SITE_URL="$SITE_URL" \
  --build-arg NEXT_PUBLIC_GA_ID="${NEXT_PUBLIC_GA_ID:-off}" \
  --build-arg NEXT_PUBLIC_ADS="${NEXT_PUBLIC_ADS:-off}" \
  --build-arg NEXT_PUBLIC_SITE_NAME="${SITE_NAME:-}" \
  --build-arg NEXT_PUBLIC_SITE_SLUG="${SITE_SLUG:-}" \
  --build-arg NEXT_PUBLIC_SITE_ALIASES="${SITE_ALIASES:-}" \
  --build-arg NEXT_PUBLIC_FORMER_HOST="${FORMER_HOST:-off}" \
  --build-arg NEXT_PUBLIC_OPERATOR_NAME="$OPERATOR_NAME" \
  --build-arg NEXT_PUBLIC_CONTACT_EMAIL="$CONTACT_EMAIL" \
  --build-arg NEXT_PUBLIC_ISSUES_URL="${ISSUES_URL:-off}" \
  --build-arg NEXT_PUBLIC_DONATE_URL="${DONATE_URL:-off}" \
  --build-arg NEXT_PUBLIC_ADSENSE_CLIENT="${ADSENSE_CLIENT:-off}" \
  --build-arg NEXT_PUBLIC_ADSENSE_SLOT="${ADSENSE_SLOT:-}" \
  --build-arg GIT_SHA="$(git rev-parse --short HEAD)" \
  ../../web

docker buildx build --platform linux/arm64 --push -t "$PIPE_REPO:$TAG" \
  -f ../Dockerfile.pipeline ../..

echo
echo "Set in terraform.tfvars, then terraform apply:"
echo "app_image      = \"$APP_REPO:$TAG\""
echo "pipeline_image = \"$PIPE_REPO:$TAG\""
