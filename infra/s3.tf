# ---------- Statikus tartalom: Amazon S3 (privát bucket) ----------
#
# A lebuildelt React felület (frontend/dist) és a futásidejű config.json.
# Kiszolgálás HTTPS-en, CloudFronton keresztül (lásd cloudfront.tf).

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "web" {
  bucket        = "${var.project_name}-web-${random_id.bucket_suffix.hex}"
  force_destroy = true # csak build-termékeket tartalmaz, a forrás a git
}

resource "aws_s3_bucket_ownership_controls" "web" {
  bucket = aws_s3_bucket.web.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# A bucket teljesen privát: csak a CloudFront olvashatja (Origin Access
# Control), közvetlen S3 elérés nincs.
resource "aws_s3_bucket_public_access_block" "web" {
  bucket                  = aws_s3_bucket.web.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "web_cloudfront_read" {
  statement {
    sid       = "AllowCloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket     = aws_s3_bucket.web.id
  policy     = data.aws_iam_policy_document.web_cloudfront_read.json
  depends_on = [aws_s3_bucket_public_access_block.web]
}

locals {
  mime_types = {
    html  = "text/html; charset=utf-8"
    js    = "text/javascript; charset=utf-8"
    mjs   = "text/javascript; charset=utf-8"
    css   = "text/css; charset=utf-8"
    json  = "application/json"
    svg   = "image/svg+xml"
    png   = "image/png"
    jpg   = "image/jpeg"
    ico   = "image/x-icon"
    webp  = "image/webp"
    woff  = "font/woff"
    woff2 = "font/woff2"
    txt   = "text/plain; charset=utf-8"
    map   = "application/json"
  }
  web_files = setsubtract(fileset(var.frontend_dist_dir, "**"), ["config.json"])
}

resource "aws_s3_object" "web" {
  for_each = local.web_files

  bucket       = aws_s3_bucket.web.id
  key          = each.value
  source       = "${var.frontend_dist_dir}/${each.value}"
  etag         = filemd5("${var.frontend_dist_dir}/${each.value}")
  content_type = lookup(local.mime_types, lower(try(regex("[^.]+$", each.value), "")), "application/octet-stream")
  # A hash-elt nevű assetek örökre gyorsítótárazhatók, a többi mindig frissüljön.
  cache_control = startswith(each.value, "assets/") ? "public, max-age=31536000, immutable" : "no-cache"
}

# Futásidejű konfiguráció: így a frontend tudja, hol az API (újrabuildelés nélkül).
resource "aws_s3_object" "config" {
  bucket        = aws_s3_bucket.web.id
  key           = "config.json"
  content_type  = "application/json"
  cache_control = "no-cache"
  content = jsonencode({
    apiBaseUrl = trimsuffix(aws_lambda_function_url.api.function_url, "/")
  })
}
