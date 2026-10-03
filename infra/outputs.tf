output "website_url" {
  description = "A webes felület címe (S3 statikus weboldal)."
  value       = local.website_origin
}

output "api_url" {
  description = "A REST API címe (Lambda Function URL)."
  value       = aws_lambda_function_url.api.function_url
}

output "access_key" {
  description = "Hozzáférési kulcs a belépéshez: terraform output -raw access_key"
  value       = random_password.access_key.result
  sensitive   = true
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
