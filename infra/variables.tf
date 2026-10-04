variable "aws_region" {
  description = "AWS régió. Olyat válassz, ahol az Aurora DSQL elérhető (pl. eu-central-1, eu-west-1, us-east-1)."
  type        = string
  default     = "eu-central-1"
}

variable "project_name" {
  description = "Erőforrásnév-előtag (kisbetű, szám, kötőjel)."
  type        = string
  default     = "penzugyek"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$", var.project_name))
    error_message = "A project_name 3–32 karakter: kisbetű, szám, kötőjel."
  }
}

variable "lambda_memory_mb" {
  description = "A Lambda memóriája (MB). A Free Tier havi 400 000 GB-másodpercet ad."
  type        = number
  default     = 512
}

variable "lambda_timeout_s" {
  description = "A Lambda időkorlátja (másodperc)."
  type        = number
  default     = 30
}

variable "log_retention_days" {
  description = "A CloudWatch naplók megőrzési ideje (nap)."
  type        = number
  default     = 14
}

variable "dsql_deletion_protection" {
  description = "Törlésvédelem az Aurora DSQL klaszteren (pénzügyi adatok!). `terraform destroy` előtt false-ra kell állítani."
  type        = bool
  default     = true
}

variable "allowed_emails" {
  description = "Az alkalmazásba belépni jogosult Google-fiókok e-mail címei."
  type        = list(string)
  default     = ["hundjmada@gmail.com", "dferenczi@gmail.com"]

  validation {
    condition     = length(var.allowed_emails) > 0 && alltrue([for e in var.allowed_emails : can(regex("^[^@\\s,~]+@[^@\\s,~]+$", trimspace(e)))])
    error_message = "Legalább egy érvényes e-mail cím kell (vessző és ~ nélkül)."
  }
}

variable "legacy_data_owner" {
  description = "A többfelhasználós verzió előtti (tulajdonos nélküli) tételek tulajdonosa. Az allowed_emails egyike, vagy üres."
  type        = string
  default     = "hundjmada@gmail.com"
}

variable "cognito_domain_prefix" {
  description = "A Cognito belépési domain előtagja (régiónként globálisan egyedi), pl. penzugyek-hundjmada → https://penzugyek-hundjmada.auth.<régió>.amazoncognito.com"
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$", var.cognito_domain_prefix)) && !can(regex("aws|amazon|cognito", var.cognito_domain_prefix))
    error_message = "Csak kisbetű, szám és kötőjel; nem tartalmazhatja az aws, amazon vagy cognito szót."
  }
}

variable "google_client_id" {
  description = "A Google Cloud Console-ban létrehozott OAuth 2.0 kliens azonosítója (Web application)."
  type        = string
}

variable "google_client_secret" {
  description = "A Google OAuth 2.0 kliens titka."
  type        = string
  sensitive   = true
}

variable "session_ttl_hours" {
  description = "A bejelentkezés érvényessége (óra); lejárta után a Google-lel automatikusan újra belép."
  type        = number
  default     = 8
}

variable "frontend_dist_dir" {
  description = "A lebuildelt frontend könyvtára (npm run build kimenete)."
  type        = string
  default     = "../frontend/dist"
}

variable "lambda_build_dir" {
  description = "A Lambda csomag könyvtára (scripts/build_lambda.py kimenete)."
  type        = string
  default     = "../build/lambda"
}
