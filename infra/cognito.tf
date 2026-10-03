# ---------- Hitelesítés: Amazon Cognito + Google social login ----------
#
# - A felhasználói készletbe csak Google-fiókkal lehet belépni (nincs saját
#   regisztráció / jelszó).
# - A pre sign-up trigger (functions/pre_signup.py) csak az allowed_emails
#   listán szereplő címeket engedi be; mindenki mást már a Cognito elutasít.
# - Az alkalmazás-kliens bizalmas (client secret): a kódot a Lambda cseréli
#   tokenre, a böngésző tokent nem lát (lásd app/auth.py).
# Free Tier (mindig ingyenes): havi 10 000 aktív felhasználó (MAU).

resource "aws_cognito_user_pool" "main" {
  name           = "${var.project_name}-users"
  user_pool_tier = "ESSENTIALS"

  # Csak föderált (Google) felhasználók; saját regisztráció tiltva.
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.pre_signup.arn
  }

  # A felhasználók a Google-fiókjukból újra létrejönnek, ezért a készlet
  # elvesztése nem okoz adatvesztést (az adatok az e-mail címhez tartoznak).
  deletion_protection = "INACTIVE"
}

resource "aws_cognito_user_pool_domain" "main" {
  domain       = var.cognito_domain_prefix
  user_pool_id = aws_cognito_user_pool.main.id
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.main.id
  provider_name = "Google"
  provider_type = "Google"

  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
    # A Cognito által kitöltött alapértékek — megadva, hogy ne legyen állandó diff.
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = "true"
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    oidc_issuer                   = "https://accounts.google.com"
    token_request_method          = "POST"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
  }

  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
    name           = "name"
    username       = "sub"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.main.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = [aws_cognito_identity_provider.google.provider_name]
  callback_urls                        = ["${local.website_origin}/api/auth/callback"]
  logout_urls                          = ["${local.website_origin}/api/auth/logged-out"]

  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true

  # A tokeneket csak a belépéskor használjuk (utána az alkalmazás saját
  # munkamenet-sütije él), ezért rövid élettartam is elég.
  id_token_validity      = 60
  access_token_validity  = 60
  refresh_token_validity = 1
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

locals {
  cognito_domain_url = "https://${aws_cognito_user_pool_domain.main.domain}.auth.${var.aws_region}.amazoncognito.com"
  ssm_prefix         = "/${var.project_name}/auth"
}

# A Lambda futásidőben olvassa (környezeti változóként függőségi kört okozna:
# Lambda → Cognito kliens → CloudFront cím → Lambda Function URL → Lambda).
# Standard paraméterek: díjmentesek.
resource "aws_ssm_parameter" "client_id" {
  name  = "${local.ssm_prefix}/client_id"
  type  = "String"
  value = aws_cognito_user_pool_client.web.id
}

resource "aws_ssm_parameter" "client_secret" {
  name  = "${local.ssm_prefix}/client_secret"
  type  = "SecureString"
  value = aws_cognito_user_pool_client.web.client_secret
}

resource "aws_ssm_parameter" "app_url" {
  name  = "${local.ssm_prefix}/app_url"
  type  = "String"
  value = local.website_origin
}

# ---------- pre sign-up trigger: engedélyezett e-mail címek ----------

data "archive_file" "pre_signup" {
  type        = "zip"
  source_file = "${path.module}/functions/pre_signup.py"
  output_path = "${path.module}/.build/pre_signup.zip"
}

resource "aws_cloudwatch_log_group" "pre_signup" {
  name              = "/aws/lambda/${var.project_name}-pre-signup"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "pre_signup" {
  name               = "${var.project_name}-pre-signup-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "pre_signup" {
  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.pre_signup.arn}:*"]
  }
}

resource "aws_iam_role_policy" "pre_signup" {
  name   = "${var.project_name}-pre-signup-policy"
  role   = aws_iam_role.pre_signup.id
  policy = data.aws_iam_policy_document.pre_signup.json
}

resource "aws_lambda_function" "pre_signup" {
  function_name    = "${var.project_name}-pre-signup"
  description      = "Cognito pre sign-up: csak az engedélyezett e-mail címek"
  role             = aws_iam_role.pre_signup.arn
  runtime          = "python3.13"
  architectures    = ["arm64"]
  handler          = "pre_signup.handler"
  filename         = data.archive_file.pre_signup.output_path
  source_code_hash = data.archive_file.pre_signup.output_base64sha256
  memory_size      = 128
  timeout          = 5

  environment {
    variables = {
      ALLOWED_EMAILS = join(",", local.allowed_emails)
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.pre_signup.name
  }

  depends_on = [aws_iam_role_policy.pre_signup]
}

resource "aws_lambda_permission" "cognito_pre_signup" {
  statement_id  = "AllowCognitoPreSignUp"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_signup.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.main.arn
}
