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

variable "extra_cors_origins" {
  description = "További engedélyezett originek az API-hoz (pl. [\"http://localhost:5173\"] a helyi Vite fejlesztéshez)."
  type        = list(string)
  default     = []
}

variable "frontend_dist_dir" {
  description = "A lebuildelt frontend könyvtára (npm run build kimenete)."
  type        = string
  default     = "../frontend/dist"
}

variable "lambda_build_dir" {
  description = "A Lambda csomag könyvtára (scripts/build_lambda.sh kimenete)."
  type        = string
  default     = "../build/lambda"
}
