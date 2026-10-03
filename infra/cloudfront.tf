# ---------- HTTPS kiszolgálás: Amazon CloudFront ----------
#
# Egyetlen HTTPS belépési pont:
#   /api/*     → Lambda Function URL (AWS_IAM, Origin Access Control), cache nélkül
#   minden más → privát S3 bucket (Origin Access Control)
# HTTP → HTTPS átirányítás, tömörítés, biztonsági fejlécek. Az alapértelmezett
# *.cloudfront.net tanúsítványt használja (nincs szükség saját domainre / ACM-re).
# Mivel a felület és az API azonos originen van, CORS-ra nincs szükség.
# Free Tier (mindig ingyenes): havi 1 TB adatforgalom és 10 millió kérés.

locals {
  s3_origin_id  = "web-s3"
  api_origin_id = "api-lambda"
  # https://xxxx.lambda-url.<régió>.on.aws/ → xxxx.lambda-url.<régió>.on.aws
  api_origin_domain = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")

  # AWS által kezelt policy-k (azonosítóik minden fiókban azonosak)
  cache_policy_caching_optimized        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  cache_policy_caching_disabled         = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # Managed-CachingDisabled
  origin_request_all_viewer_except_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # Managed-AllViewerExceptHostHeader
  response_headers_security_headers     = "67f7725c-6f97-4210-82d7-5512b31e9d03" # Managed-SecurityHeadersPolicy
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project_name}-web-oac"
  description                       = "CloudFront → privát S3 bucket (${aws_s3_bucket.web.id})"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "${var.project_name}-api-oac"
  description                       = "CloudFront → Lambda Function URL (${local.function_name})"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "auth_gate" {
  name    = "${var.project_name}-auth-gate"
  comment = "Munkamenet-süti ellenőrzése a statikus tartalom előtt"
  runtime = "cloudfront-js-2.0"
  publish = true
  code = templatefile("${path.module}/functions/auth_gate.js", {
    session_secret = random_password.session_secret.result
  })
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  comment             = "${var.project_name} webes felület"
  default_root_object = "index.html"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  # Csak Észak-Amerika és Európa élhelyei — a legolcsóbb árkategória.
  price_class = "PriceClass_100"

  origin {
    origin_id                = local.s3_origin_id
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id                = local.api_origin_id
    domain_name              = local.api_origin_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.api.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
  }

  # REST API: minden metódus, gyorsítótár nélkül; a Host kivételével minden
  # fejléc, query string és süti továbbmegy (X-Access-Key, x-amz-content-sha256…).
  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = local.api_origin_id
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = local.cache_policy_caching_disabled
    origin_request_policy_id   = local.origin_request_all_viewer_except_host
    response_headers_policy_id = local.response_headers_security_headers
  }

  default_cache_behavior {
    target_origin_id = local.s3_origin_id

    # Belépés-kapu: érvényes munkamenet nélkül a felület egyetlen fájlja sem
    # töltődik be, a kérés a belépéshez irányul.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.auth_gate.arn
    }

    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    # Az origin Cache-Control fejlécét követi: a hash-elt assetek 1 évig, az
    # index.html és a config.json (no-cache) csak a minimális 1 másodpercig
    # gyorsítótárazódik — így telepítés után nincs szükség érvénytelenítésre.
    cache_policy_id            = local.cache_policy_caching_optimized
    response_headers_policy_id = local.response_headers_security_headers
  }

  # Szándékosan nincs custom_error_response (403/404 → index.html): az az
  # egész disztribúcióra vonatkozna, és elnyelné az API JSON hibaválaszait.
  # A felület csak hash-alapú (#) útvonalakat használ, így erre nincs is szükség.

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"
  }

  lifecycle {
    precondition {
      condition     = fileexists("${var.frontend_dist_dir}/index.html")
      error_message = "Nincs lebuildelt frontend. Futtasd előbb: make build (vagy cd frontend && npm ci && npm run build)."
    }
  }
}
