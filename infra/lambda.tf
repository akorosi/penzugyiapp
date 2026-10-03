# ---------- Dinamikus réteg: AWS Lambda + Function URL ----------
#
# A Flask REST API egy Lambda függvényben fut. A Function URL NEM nyilvános
# (AWS_IAM hitelesítés): kizárólag a CloudFront hívhatja, SigV4-gyel aláírva
# (Origin Access Control), az /api/* útvonalon. API Gateway nélkül — nincs
# külön díj.
# Free Tier (mindig ingyenes): havi 1 millió kérés és 400 000 GB-másodperc.

locals {
  function_name  = "${var.project_name}-api"
  website_origin = "https://${aws_cloudfront_distribution.web.domain_name}"
}

# Hozzáférési kulcs: a frontend az "X-Access-Key" fejlécben küldi (az
# Authorization fejlécet a CloudFront aláírása foglalja).
resource "random_password" "access_key" {
  length  = 40
  special = false
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = var.lambda_build_dir
  output_path = "${path.module}/.build/lambda.zip"

  lifecycle {
    precondition {
      condition     = fileexists("${var.lambda_build_dir}/lambda_handler.py")
      error_message = "Nincs Lambda csomag. Futtasd előbb: make build (vagy scripts/build_lambda.sh)."
    }
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${local.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]
  }

  statement {
    sid       = "DsqlConnect"
    actions   = ["dsql:DbConnectAdmin"]
    resources = [aws_dsql_cluster.main.arn]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "${local.function_name}-policy"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_lambda_function" "api" {
  function_name    = local.function_name
  description      = "Pénzügyek REST API (Flask) — Aurora DSQL"
  role             = aws_iam_role.api.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "lambda_handler.handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_s

  environment {
    variables = {
      DSQL_ENDPOINT = local.dsql_endpoint
      ACCESS_KEY    = random_password.access_key.result
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.api.name
  }

  depends_on = [aws_iam_role_policy.api]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM" # csak aláírt (CloudFront OAC) kérések
}

# Csak ez a CloudFront disztribúció hívhatja a Function URL-t. Mindkét
# engedély szükséges: InvokeFunctionUrl és (a Function URL-en keresztüli)
# InvokeFunction.
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "AllowCloudFrontInvokeFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.web.arn
  function_url_auth_type = "AWS_IAM"
}

resource "aws_lambda_permission" "cloudfront_invoke" {
  statement_id             = "AllowCloudFrontInvokeFunction"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.api.function_name
  principal                = "cloudfront.amazonaws.com"
  source_arn               = aws_cloudfront_distribution.web.arn
  invoked_via_function_url = true
}

# Adatbázis-séma létrehozása / frissítése telepítéskor (idempotens).
resource "aws_lambda_invocation" "migrate" {
  function_name = aws_lambda_function.api.function_name
  input         = jsonencode({ action = "migrate" })

  triggers = {
    code = data.archive_file.lambda.output_base64sha256
  }
}
