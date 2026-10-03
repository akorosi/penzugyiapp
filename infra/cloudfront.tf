# ---------- HTTPS kiszolgálás: Amazon CloudFront ----------
#
# A privát S3 bucket elé kerül; HTTP → HTTPS átirányítás, tömörítés,
# biztonsági fejlécek. Az alapértelmezett *.cloudfront.net tanúsítványt
# használja (nincs szükség saját domainre / ACM-re).
# Free Tier (mindig ingyenes): havi 1 TB adatforgalom és 10 millió kérés.

locals {
  s3_origin_id = "web-s3"

  # AWS által kezelt policy-k (azonosítóik minden fiókban azonosak)
  cache_policy_caching_optimized    = "658327ea-f89d-4fab-a63d-7e88639e58f6" # Managed-CachingOptimized
  response_headers_security_headers = "67f7725c-6f97-4210-82d7-5512b31e9d03" # Managed-SecurityHeadersPolicy
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project_name}-web-oac"
  description                       = "CloudFront → privát S3 bucket (${aws_s3_bucket.web.id})"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
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

  default_cache_behavior {
    target_origin_id       = local.s3_origin_id
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

  # Ismeretlen útvonal → az alkalmazás (privát bucketnél a hiányzó objektum 403).
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }
  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

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
