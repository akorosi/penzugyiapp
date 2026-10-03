# ---------- Adatbázis: Amazon Aurora DSQL ----------
#
# Szerver nélküli, PostgreSQL-kompatibilis adatbázis. Nincs VPC, nincs
# példány: a Lambda a nyilvános végponton, TLS-en és IAM tokennel csatlakozik.
# Free Tier (mindig ingyenes): havi 100 000 DPU és 1 GB tárhely.

resource "aws_dsql_cluster" "main" {
  deletion_protection_enabled = var.dsql_deletion_protection

  tags = {
    Name = "${var.project_name}-db"
  }
}

locals {
  dsql_endpoint = "${aws_dsql_cluster.main.identifier}.dsql.${var.aws_region}.on.aws"
}
