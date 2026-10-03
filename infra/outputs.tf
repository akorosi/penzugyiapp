output "website_url" {
  description = "A webes felület címe (CloudFront, HTTPS)."
  value       = local.website_origin
}

output "api_url" {
  description = "A REST API címe (CloudFront → Lambda, /api/*)."
  value       = "${local.website_origin}/api"
}

output "cognito_domain" {
  description = "A Cognito belépési domain."
  value       = local.cognito_domain_url
}

output "google_oauth_redirect_uri" {
  description = "Ezt kell megadni a Google OAuth kliensnél az „Authorized redirect URIs” alatt."
  value       = "${local.cognito_domain_url}/oauth2/idpresponse"
}

output "google_oauth_javascript_origin" {
  description = "Ezt kell megadni a Google OAuth kliensnél az „Authorized JavaScript origins” alatt."
  value       = local.cognito_domain_url
}

output "cognito_user_pool_id" {
  description = "A Cognito felhasználói készlet azonosítója."
  value       = aws_cognito_user_pool.main.id
}

output "allowed_emails" {
  description = "A belépésre jogosult e-mail címek."
  value       = local.allowed_emails
}

output "dsql_endpoint" {
  description = "Az Aurora DSQL klaszter végpontja (pl. adatátköltöztetéshez)."
  value       = local.dsql_endpoint
}

output "dsql_cluster_identifier" {
  description = "Az Aurora DSQL klaszter azonosítója."
  value       = aws_dsql_cluster.main.identifier
}

output "web_bucket" {
  description = "A statikus tartalmat tároló S3 bucket neve."
  value       = aws_s3_bucket.web.id
}

output "migration_result" {
  description = "A telepítéskor lefutott sémamigráció eredménye."
  value       = jsondecode(aws_lambda_invocation.migrate.result)
}

output "cloudfront_distribution_id" {
  description = "A CloudFront disztribúció azonosítója (pl. kézi cache-érvénytelenítéshez)."
  value       = aws_cloudfront_distribution.web.id
}
